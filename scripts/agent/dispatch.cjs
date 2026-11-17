/**
 * 派活 —— PM 把一条 issue 交给一个 **headless 的开发 agent 子会话**去做。
 *
 * ## 为什么要有它
 *
 * 原来的协作方式里，**开发 agent 的每一轮都要人去启动**（人对着它的会话说「领 #xx 去做」）。
 * ⇒ 人成了「调度器」⇒ PM 反而成了旁观者。
 *
 * 本脚本让 **PM 成为唯一的调度方**：
 * 人只跟 PM 说需求 ⇒ PM 建 issue ⇒ PM 派活（子会话自己领、自己做、自己提 PR）
 * ⇒ PM 汇总给 人 ⇒ 只有**需要人拍板的事**才去找人。
 *
 * ## 它做什么（`--issue`）
 *
 * 1. **校验**：issue 必须带 `ready` 标签，且**依赖已全部落地**（复用 `lib/deps.cjs` 的同一套判断）
 * 2. **认领**：撤 `ready`、打 `in-progress`（与开发 agent 手工领活时的动作一致）
 * 3. **隔离**：用 `worktree.cjs add` 开一个**独立工作区**（一个 agent 一个工作区）
 * 4. **起子会话**：`pi -p ... --append-system-prompt .pi/prompts/dev.md`（**后台**，日志落盘）
 * 5. **记状态**：`��.scratch/dispatch/<号>.json`（pid / 日志 / 工作区 / PR 号）
 *
 * ## 它不做什么
 *
 * ❌ 不合并 PR（除非明确允许）—— 大改动必须**人拍板**（见 `--no-merge` 的默认用法）
 * ❌ 不写产品代码（子会话干）
 * ❌ 不碰其它 issue（子会话只做指定的那一条）
 *
 * ## 用法
 *
 * ```bash
 * node scripts/agent/dispatch.cjs --issue 82 --no-merge   # 派一条（只开 PR，不合）
 * node scripts/agent/dispatch.cjs --issue 55               # 派一条（CI 绿就合）
 * node scripts/agent/dispatch.cjs --dry-run --issue 82     # 只看会做什么，不动手
 * node scripts/agent/dispatch.cjs --status                 # 看所有派活的状态
 * node scripts/agent/dispatch.cjs --status 82              # 看某一条的进度（尾部日志 + PR + CI）
 * node scripts/agent/dispatch.cjs --collect 82             # 收集结果（PM 汇总用）
 *
 * # **接着往已有分支派**（上一个子会话挂住了、或要在同一分支上继续）：
 * node scripts/agent/dispatch.cjs --issue 101 --worktree <路径> --branch <分支>
 * ```
 */
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { parseDependencies, isSettled } = require('./lib/deps.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.scratch', 'dispatch');
const SESSION_DIR = path.join(STATE_DIR, 'sessions');
const DEFAULT_MODEL = process.env.DISPATCH_MODEL || 'minimax-cn/MiniMax-M3.1-Flash';

/** 跑一条命令（拿文本输出）。 */
function run(cmd, args, options = {}) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: options.inherit ? 'inherit' : 'pipe',
      cwd: options.cwd ?? REPO_ROOT,
    });
    // ⚠️ `stdio: 'inherit'` 时 execFileSync 返回 **null**（没有管道可读）⇒ 不能直接 trim
    return out == null ? '' : String(out).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    throw new Error(`${cmd} ${args.join(' ')} 失败：${stderr || error.message}`);
  }
}

/** 参数。 */
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);

const issueNumber = opt('--issue');
const dryRun = has('--dry-run');
const noMerge = has('--no-merge');
const model = opt('--model', DEFAULT_MODEL);
const statusTarget = opt('--status');
const collectTarget = opt('--collect');
/** 派到**已有工作区/分支**（接着上一个子会话干）。 */
const reuseWorktree = opt('--worktree');
const reuseBranch = opt('--branch');
/** 追加给子会话的额外指令（多轮迭代时用）。 */
const note = opt('--note');

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

// ── 状态文件的读写 ────────────────────────────────────────────
function statePath(n) {
  return path.join(STATE_DIR, `${n}.json`);
}

function readState(n) {
  try {
    return JSON.parse(fs.readFileSync(statePath(n), 'utf8'));
  } catch {
    return null;
  }
}

/** 进程还活着吗（Windows 上也可用）。 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 取 issue。 */
function getIssue(n) {
  return JSON.parse(run('gh', ['issue', 'view', String(n), '--json', 'number,title,state,labels,milestone,body,url']));
}

/**
 * 取某条 issue 的 PR。
 *
 * ⚠️ **不能只按分支名找**：子会话会**自己起分支名**（如 \`feat/101-agent-picker\`），
 * 跟我建的 \`agent/pm-dev-<号>\` 无关 ⇒ 还得按 **PR 正文/标题里含 issue 号**来找。
 */
function findPr(branch, issueNumber) {
  const byBranch = JSON.parse(
    run('gh', ['pr', 'list', '--state', 'all', '--head', branch, '--json', 'number,state,url,title,headRefName,mergedAt']),
  );
  if (byBranch[0]) return byBranch[0];
  if (!issueNumber) return null;
  const all = JSON.parse(
    run('gh', ['pr', 'list', '--state', 'all', '--limit', '50', '--json', 'number,state,url,title,headRefName,mergedAt,body']),
  );
  const tag = `#${issueNumber}`;
  const hits = all.filter((p) => (p.title ?? '').includes(tag) || (p.body ?? '').includes(tag));
  // 最新的在前（gh 默认按创建时间倒序）⇒ 取第一个 open 的，没有就用第一个
  return hits.find((p) => p.state === 'OPEN') ?? hits[0] ?? null;
}

/** PR 的 CI 概况。 */
function prChecks(pr) {
  if (!pr) return null;
  const rollup = JSON.parse(
    run('gh', ['pr', 'view', String(pr.number), '--json', 'statusCheckRollup', '--jq', '.statusCheckRollup']),
  );
  const failed = rollup.filter((c) => c.conclusion && c.conclusion !== 'SUCCESS' && c.conclusion !== 'NEUTRAL' && c.conclusion !== 'SKIPPED');
  const pending = rollup.filter((c) => !c.conclusion);
  return { total: rollup.length, failed: failed.length, pending: pending.length, failedNames: failed.map((c) => c.name ?? c.context) };
}

// ── 模式 1：--status（看进度）────────────────────────────────
if (has('--status')) {
  const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('\n还没有派过活。\n');
    process.exit(0);
  }
  for (const f of files) {
    const st = readState(path.basename(f, '.json'));
    if (!st) continue;
    if (statusTarget && String(st.issue) !== String(statusTarget)) continue;
    const alive = st.pid ? isAlive(st.pid) : false;
    const pr = findPr(st.branch, st.issue);
    console.log(`\n=== issue #${st.issue} ${st.title ?? ''}`);
    console.log(`   子会话：${alive ? '🟢 运行中' : '⚪ 已结束'}（pid ${st.pid}）`);
    console.log(`   工作区：${st.worktree}`);
    console.log(`   日志：${st.log}`);
    if (pr) {
      const checks = prChecks(pr);
      console.log(`   PR #${pr.number} ${pr.state}${pr.mergedAt ? `（合并于 ${pr.mergedAt.slice(0, 16)}）` : ''} ${pr.url}`);
      if (checks) console.log(`   CI：${checks.total} 项（失败 ${checks.failed} · 未完成 ${checks.pending}）`);
    } else {
      console.log('   PR：还没提');
    }
    if (alive && fs.existsSync(st.log)) {
      const lines = fs.readFileSync(st.log, 'utf8').split('\n');
      console.log('   ── 日志尾部 ──');
      console.log(lines.slice(-12).map((l) => '   ' + l).join('\n'));
    }
    // ⚠️ **pi 的 print 模式只在「会话结束时」才输出** ⇒ 中途日志是空的
    //    ⇒ **中途看进度只能看 git**（工作区改动 + 最近提交）。
    if (st.worktree && fs.existsSync(st.worktree)) {
      try {
        const changed = run('git', ['status', '--porcelain'], { cwd: st.worktree });
        const nChanged = changed ? changed.split('\n').filter(Boolean).length : 0;
        const recent = run('git', ['log', '--oneline', '-3'], { cwd: st.worktree });
        console.log(`   工作区：${nChanged} 个文件有改动`);
        if (nChanged > 0) {
          console.log(
            changed
              .split('\n')
              .filter(Boolean)
              .slice(0, 6)
              .map((l) => '     ' + l)
              .join('\n'),
          );
        }
        console.log('   最近提交：');
        console.log(recent.split('\n').filter(Boolean).map((l) => '     ' + l).join('\n'));
      } catch {
        /* 工作区读不到就跳过 */
      }
    }
  }
  console.log('');
  process.exit(0);
}

// ── 模式 2：--collect（收集结果，PM 汇总用）──────────────────
if (collectTarget) {
  const n = Number(collectTarget);
  const issue = getIssue(n);
  const st = readState(n);
  const branch = st?.branch ?? `agent/pm-dev-${n}`;
  const pr = findPr(branch, n);
  const comments = JSON.parse(
    run('gh', ['api', `repos/wenanguo/ai-admin-com/issues/${n}/comments`, '--jq', '[]']),
  );
  const lastComment = comments.length ? comments[comments.length - 1] : null;
  const notes = run('bash', ['-lc', `ls -t docs/notes/*.md 2>/dev/null | head -3`]).split('\n').filter(Boolean);

  console.log(`\n📋 issue #${n} ${issue.title}`);
  console.log(`   状态：${issue.state} · 标签 ${issue.labels.map((l) => l.name).join('/') || '（无）'} · milestone ${issue.milestone?.title ?? '（无）'}`);
  if (pr) {
    const checks = prChecks(pr);
    console.log(`   PR #${pr.number} ${pr.state}${pr.mergedAt ? `（合并于 ${pr.mergedAt.slice(0, 16)}）` : ''}`);
    console.log(`   ${pr.url}`);
    if (checks) console.log(`   CI：${checks.total} 项（失败 ${checks.failed}${checks.failedNames.length ? '：' + checks.failedNames.join(', ') : ''} · 未完成 ${checks.pending}）`);
  } else {
    console.log('   PR：还没提');
  }
  if (st) {
    console.log(`   子会话：${st.pid && isAlive(st.pid) ? '🟢 运行中' : '已结束'} · 日志 ${st.log}`);
  }
  if (lastComment) {
    console.log('\n─── issue 最后一条评论（dev 的反馈）───');
    console.log(lastComment.body.split('\n').slice(0, 20).map((l) => '   ' + l).join('\n'));
  }
  if (notes.length) {
    console.log('\n─── 最近的交接文档 ──');
    for (const p of notes) console.log('   ' + p);
  }
  console.log('');
  process.exit(0);
}

// ── 模式 3：--issue（派活）────────────────────────────────────
if (!issueNumber) {
  console.error('用法：node scripts/agent/dispatch.cjs --issue <号> [--no-merge] [--dry-run]');
  console.error('      node scripts/agent/dispatch.cjs --status [<号>]');
  console.error('      node scripts/agent/dispatch.cjs --collect <号>');
  process.exit(2);
}

const n = Number(issueNumber);
const issue = getIssue(n);

if (issue.state !== 'OPEN') {
  console.error(`✗ issue #${n} 不是 OPEN（${issue.state}）⇒ 不派。`);
  process.exit(1);
}

const labels = issue.labels.map((l) => l.name);
const isReady = labels.includes('ready');
const isInProgress = labels.includes('in-progress');
// ⚠️ 认领与起子会话是**两步** ⇒ 上一次派活可能**认领了但没起来**（崩了/被 kill）
// ⇒ 判据不能只看标签：
//    - 有 `ready` ⇒ 正常可派
//    - 只有 `in-progress` 且**没有活着的子会话** ⇒ 上次派活的中断现场 ⇒ 允许重派
//    - 其它（无标签 / 已关闭）⇒ 不派
if (!isReady && !isInProgress) {
  console.error(`✗ issue #${n} 既没有 \`ready\` 也不是 \`in-progress\`（当前：${labels.join('/') || '无'}）⇒ 不派。`);
  console.error('   ⇒ 派活队列由 PM 放行；没有 ready 就没有可派的东西。');
  process.exit(1);
}

// 依赖必须已落地
const deps = parseDependencies(issue.body ?? '');
const unmet = deps.filter((d) => !isSettled(d, run));
if (unmet.length > 0) {
  console.error(`✗ issue #${n} 的依赖还没落地：${unmet.map((d) => `#${d}`).join(' ')} ⇒ 不派（会抢跑）。`);
  process.exit(1);
}

// 已经在跑？
const existing = readState(n);
if (existing && existing.pid && isAlive(existing.pid)) {
  console.error(`✗ issue #${n} 已经有一个子会话在跑（pid ${existing.pid}）⇒ 不重复派。`);
  process.exit(1);
}

const worktreeName = `pm-dev-${n}`;
const worktreePath = reuseWorktree
  ? path.resolve(reuseWorktree)
  : path.join(path.dirname(REPO_ROOT), `${path.basename(REPO_ROOT)}-worktrees`, worktreeName);
const branch = reuseBranch ?? `agent/${worktreeName}`;
const logPath = path.join(STATE_DIR, `dev-${n}.log`);

const extra = noMerge
  ? '**本次只开 PR，不要合并** —— 这是大改动/高风险 ⇒ 停下来等人拍板。'
  : 'CI 绿后按流程合并（PR 正文写 Closes #xx）。';
const message =
  `按上面附加的开发流程完成 issue #${n}。` +
  `\n额外要求：${extra}` +
  `\n只做这一条 issue，不要碰别的。` +
  `\n完成前请：更新 docs/notes/、在 issue 上留一条评论（做了什么 / 怎么验 / PR 号）。` +
  (note ? `\n\n【本次的具体指令】\n${note}` : '');

const piArgs = [
  '-p',
  message,
  '--append-system-prompt',
  path.join(REPO_ROOT, '.pi', 'prompts', 'dev.md'),
  '--model',
  model,
  '--session-dir',
  path.join(SESSION_DIR, String(n)),
  '--approve',
];

console.log(`\n📤 派活：issue #${n} ${issue.title}`);
console.log(`   模型：${model}`);
console.log(`   工作区：${worktreePath}（分支 ${branch}）`);
console.log(`   日志：${logPath}`);
console.log(`   合并：${noMerge ? '❌ 不合并（等人拍板）' : '✅ CI 绿则合'}`);

if (dryRun) {
  console.log('\n（--dry-run：什么都没做）\n');
  process.exit(0);
}

// ① 认领（与开发 agent 手工领活时的动作一致）—— **幂等**：
//    已经 `in-progress`（上次派活中断的现场）就不要重复改标签
if (isReady) {
  run('gh', ['issue', 'edit', String(n), '--remove-label', 'ready', '--add-label', 'in-progress']);
  console.log('\n① 已认领（撤 ready、打 in-progress）');
} else {
  console.log('\n① 已是 in-progress（上一次派活的中断现场）⇒ 沿用，不重复改标签');
}

// ② 独立工作区（\--worktree 指定时**沿用已有工作区**，不新建）
if (reuseWorktree) {
  const cur = run('git', ['branch', '--show-current'], { cwd: worktreePath });
  console.log(`\n② 沿用工作区 ${worktreePath}（当前分支 ${cur}）`);
  if (reuseBranch && cur !== reuseBranch) {
    console.error(`✗ 该工作区当前在 ${cur}，与你指定的 ${reuseBranch} 不一致 ⇒ 先切过去再派。`);
    process.exit(1);
  }
} else {
  console.log('② 开工作区…');
  run('node', [path.join('scripts', 'agent', 'worktree.cjs'), 'add', worktreeName], { inherit: true });
}

// ③ 后台起子会话
// ⚠️ **不要用 `shell: true`**：Windows 的 cmd.exe 会重新解析参数
//    （中文/括号/星号会被拆坏 ⇒ 表现为「进程活着但日志空白」）。
//    ⇒ 直接 spawn **node + pi-launcher.js**（`~/.pi/agent/bin/pi` 那个 sh 脚本最终也是 exec 它）
//    ⇒ 无 shell、无引号问题。
const PI_LAUNCHER = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.pi', 'agent', 'bin', 'pi-launcher.js',
);
if (!fs.existsSync(PI_LAUNCHER)) {
  console.error(`✗ 找不到 pi 的启动器：${PI_LAUNCHER}`);
  console.error('   ⇒ 用 PI_LAUNCHER 环境变量指定它。');
  process.exit(1);
}

const out = fs.openSync(logPath, 'a');
const child = spawn('node', [PI_LAUNCHER, ...piArgs], {
  cwd: worktreePath,
  detached: true,
  stdio: ['ignore', out, out],
  env: { ...process.env },
});
child.unref();
fs.closeSync(out);

const state = {
  issue: n,
  title: issue.title,
  pid: child.pid,
  branch,
  worktree: worktreePath,
  log: logPath,
  model,
  noMerge,
  startedAt: new Date().toISOString(),
};
fs.writeFileSync(statePath(n), JSON.stringify(state, null, 2));

console.log(`\n③ 子会话已起（pid ${child.pid}，后台）`);
console.log(`\n下一步：`);
console.log(`   看进度： node scripts/agent/dispatch.cjs --status ${n}`);
console.log(`   收结果： node scripts/agent/dispatch.cjs --collect ${n}`);
console.log('');
