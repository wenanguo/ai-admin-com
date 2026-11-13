/**
 * 领一条活 —— 从 GitHub 的 `ready` 队列里挑一条**依赖已满足**的 issue 并认领。
 *
 * ## 为什么要有它
 *
 * - **并发不撞车**：两个开发 agent 同时开工，靠喊话约好「各领一条」靠不住；
 *   `ready` 标签就是队列，认领 = 撤 `ready` + 打 `in-progress`。
 * - **依赖不抢跑**：依赖没合并的 issue，就算误打了 `ready` 也不会被领走
 *   （脚本会读 issue 正文里的「依赖」段，逐条查那些 issue 是否已关闭）。
 * - **状态自动记账**：`in-progress` 标签 = 现在谁在做什么 ⇒ PM 一眼看到进度。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/agent/pick-next.cjs              # 只看会挑哪条（不动任何东西）
 * node scripts/agent/pick-next.cjs --claim      # 认领（撤 ready、打 in-progress、打印分支名）
 * node scripts/agent/pick-next.cjs --list       # 只列队列（ready / in-progress）
 * node scripts/agent/pick-next.cjs --claim --issue 10   # 认领指定的一条（跳过自动挑选）
 * ```
 *
 * ⚠️ 默认**只检查**：跟 `merge-pr.cjs` 一个脾气 —— 公共动作要显式 `--claim`。
 * ⚠️ 认领只是**改标签**，不动代码、不建分支；分支由开发 agent 自己建。
 */
const { execFileSync } = require('node:child_process');

/** 跑一条命令（失败就抛出，错误信息带上）。 */
function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (error) {
    // ⚠️ stderr 可能是 **null**（网络掐断时）⇒ 不能无条件 .trim()
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    const detail = stderr.length > 0 ? stderr : error.message;
    throw new Error(`${cmd} ${args.join(' ')} 失败：${detail}`);
  }
}

/** 参数。 */
const args = process.argv.slice(2);
const claim = args.includes('--claim');
const listOnly = args.includes('--list');
const issueIndex = args.indexOf('--issue');
const wantedIssue = issueIndex >= 0 ? args[issueIndex + 1] : undefined;

// ── ① 读队列 ────────────────────────────────────────────────
const ready = JSON.parse(
  tryRun('gh', [
    'issue', 'list', '--state', 'open', '--label', 'ready',
    '--limit', '50', '--json', 'number,title,body,milestone',
  ]),
);
const inProgress = JSON.parse(
  tryRun('gh', [
    'issue', 'list', '--state', 'open', '--label', 'in-progress',
    '--limit', '50', '--json', 'number,title,milestone',
  ]),
);

console.log(`\n队列：ready ${ready.length} 条 · in-progress ${inProgress.length} 条`);
for (const it of inProgress) {
  console.log(`  🔨 #${it.number} [${it.milestone?.title ?? '无'}] ${it.title}`);
}

if (listOnly) {
  console.log('\n可领（还没检查依赖）：');
  for (const it of ready) {
    console.log(`  🟢 #${it.number} [${it.milestone?.title ?? '无'}] ${it.title}`);
  }
  process.exit(0);
}

if (ready.length === 0) {
  console.log('\n队列是空的：没有带 `ready` 的 issue ⇒ 先找 PM 放行。');
  process.exit(0);
}

// ── ② 读 issue 正文里的「依赖」段 ────────────────────────────
/**
 * 从正文里抽出依赖的 issue 号。
 *
 * 只看「## 依赖」那一节（到下一个 `##` 为止）—— 正文别处出现的 `#号`
 * 可能是上游仓库的 issue 号（例：#11772 属上游 Ant Design Pro），不能当依赖。
 */
function parseDependencies(body) {
  const section = body.match(/^##\s*依赖\s*$([\s\S]*?)(?=^##\s|\Z)/m);
  if (!section) return [];
  const text = section[1];
  if (/无/.test(text)) return [];
  const ids = [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  return [...new Set(ids)];
}

/** 查一个 issue 是否已关闭。 */
function isClosed(number) {
  const json = tryRun('gh', ['issue', 'view', String(number), '--json', 'state,stateReason']);
  const info = JSON.parse(json);
  return info.state === 'CLOSED';
}

// ── ③ 挑一条：依赖全满足 + 里程碑最早到期 + 编号最小 ─────────
const milestones = JSON.parse(
  tryRun('gh', ['api', 'repos/:owner/:repo/milestones', '--jq', '[.[] | {number,title,due_on}]']),
);
const dueByMs = new Map(milestones.map((m) => [m.title, m.due_on ?? '9999-12-31']));

/** 候选评估结果。 */
const evaluated = ready.map((issue) => {
  const deps = parseDependencies(issue.body ?? '');
  const unmet = deps.filter((d) => !isClosed(d));
  return {
    issue,
    deps,
    unmet,
    due: dueByMs.get(issue.milestone?.title ?? '') ?? '9999-12-31',
  };
});

for (const e of evaluated) {
  const depText = e.deps.length > 0 ? e.deps.map((d) => `#${d}`).join(' ') : '无';
  const state = e.unmet.length > 0 ? `⛔ 依赖未合（${e.unmet.map((d) => `#${d}`).join(' ')}）` : '✅ 依赖已满足';
  console.log(`  · #${e.issue.number} [${e.issue.milestone?.title ?? '无'}] 依赖：${depText} → ${state}`);
}

let chosen;
if (wantedIssue) {
  chosen = evaluated.find((e) => e.issue.number === Number(wantedIssue));
  if (!chosen) {
    console.error(`\n❌ #${wantedIssue} 不在 ready 队列里。`);
    process.exit(1);
  }
  if (chosen.unmet.length > 0) {
    console.error(`\n❌ #${wantedIssue} 的依赖还没合：${chosen.unmet.map((d) => `#${d}`).join(' ')}`);
    process.exit(1);
  }
} else {
  const ok = evaluated
    .filter((e) => e.unmet.length === 0)
    .sort((a, b) => a.due.localeCompare(b.due) || a.issue.number - b.issue.number);
  chosen = ok[0];
  if (!chosen) {
    console.log('\n⏳ 队列里的 issue 依赖都还没合 ⇒ 先把上游合掉。');
    process.exit(0);
  }
}

const issue = chosen.issue;
console.log(`\n${claim ? '🎯 认领' : '👀 会挑'}：#${issue.number} ${issue.title}`);
console.log(`   里程碑：${issue.milestone?.title ?? '无'}${chosen.due !== '9999-12-31' ? `（due ${chosen.due.slice(0, 10)}）` : ''}`);
console.log(`   依赖：${chosen.deps.length > 0 ? chosen.deps.map((d) => `#${d}`).join(' ') : '无'}`);
console.log(`   建议分支：feat/${issue.number}-<简短关键词>`);
console.log('\n─── issue 正文 ───');
console.log(issue.body ?? '（空）');
console.log('─────────────────');

if (!claim) {
  console.log('\n（检查模式：加 --claim 才会真的认领）');
  process.exit(0);
}

// ── ④ 认领：撤 ready、打 in-progress ────────────────────────
tryRun('gh', ['issue', 'edit', String(issue.number), '--remove-label', 'ready', '--add-label', 'in-progress']);

console.log(`\n✅ 已认领 #${issue.number}（撤了 ready，打上 in-progress）`);
console.log(`   下一步：git checkout -b feat/${issue.number}-<简短关键词> && git push -u origin <分支名>`);
console.log('   然后照 docs/process.md 的流程做：设计/计划 → 实现 → 自审 → PR → CI → 合并 → 关 issue → 删分支');
