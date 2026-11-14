/**
 * 合并 PR + 清理分支 —— 把「合并完还要记得删分支」这件事变成一条命令。
 *
 * ## 为什么要有它
 *
 * - 仓库的 `delete_branch_on_merge = false` ⇒ **合并后分支不会自动删**；
 * - 忘了删 ⇒ 本地/远端堆积一堆死分支，`git branch -vv` 全是 gone；
 * - 合并到 main 是**公共动作** ⇒ 脚本**默认只检查**，真合并要显式 `--yes`。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/agent/merge-pr.cjs 8            # 只检查（默认，不动任何东西）
 * node scripts/agent/merge-pr.cjs 8 --yes      # 检查通过就合并 + 删分支（本地+远端）
 * node scripts/agent/merge-pr.cjs 8 --strategy merge   # 合并方式：squash(默认) / merge / rebase
 * ```
 *
 * ## 两条硬规矩（都是踩过坑才加的）
 *
 * 1. **不用 `gh pr merge --delete-branch`** ⇒ 它会连**本地分支**一起删，
 *    而 agent 的分支常常**正被一个工作区（worktree）签出** ⇒ 实测它把那个工作区的源码删光了
 *    （合并完只剩两个 `node_modules` 软链）。
 *    ⇒ 现在：合并**不带** `--delete-branch`；远端分支用 `git push origin --delete` 删；
 *      本地分支**先问一句**「有没有被工作区签出」（`branchCheckedOutInWorktree`），
 *      被签出就**只提示、不删**。
 * 2. **收尾不许崩** ⇒ `execFileSync` 在 `stdio: 'inherit'` 时返回 **null**
 *    ⇒ 以前直接 `.trim()` 就炸（`TypeError`）⇒ 合并成功了但脚本后半段（切回 main / 删分支 /
 *      `fetch --prune`）没跑 ⇒ 每棒都要人手工收尾（#38 / #39 / #41 连续三棒都踩到）。
 *    ⇒ 现在输出统一走 `scripts/agent/lib/exec.cjs`（null 兜成 `''`），
 *      且 `pull` / `fetch` 失败只**警告**不崩。
 */
const path = require('node:path');
const { run, tryRun, branchCheckedOutInWorktree } = require('./lib/exec.cjs');

/** 参数。 */
const args = process.argv.slice(2);
const prNumber = args.find((a) => /^\d+$/.test(a));
const yes = args.includes('--yes');
const strategyIndex = args.indexOf('--strategy');
const strategy =
  strategyIndex >= 0 ? args[strategyIndex + 1] : 'squash';

if (!prNumber) {
  console.error('用法：node scripts/agent/merge-pr.cjs <PR号> [--yes] [--strategy squash|merge|rebase]');
  process.exit(2);
}
if (!['squash', 'merge', 'rebase'].includes(strategy)) {
  console.error(`不认识的合并方式：${strategy}（可用：squash / merge / rebase）`);
  process.exit(2);
}

// ── ① 读 PR 状态 ──────────────────────────────────────────────
const info = JSON.parse(
  tryRun('gh', [
    'pr', 'view', prNumber, '--json',
    'number,title,state,mergeable,mergeStateStatus,headRefOid,headRefName,baseRefName,url,reviewDecision,isDraft',
  ]),
);

console.log(`\nPR #${info.number}：${info.title}`);
console.log(`  ${info.url}`);
console.log(`  分支：${info.headRefName} → ${info.baseRefName}`);
console.log(`  状态：${info.state}${info.isDraft ? '（草稿）' : ''} · 可合并：${info.mergeable} · ${info.mergeStateStatus}`);

// ── ② 检查项 ────────────────────────────────────────────────
/**
 * 取 CI 状态：**每个检查名只看最新一次**。
 *
 * ⚠️ **为什么不用 `statusCheckRollup`**：它会把**历史**的 run 也列进来
 *    （同名 check 会出现多次）⇒ 实测：我故意让 body-check 失败一次做负向测试，
 *    之后即使修好了、重新跑绿了，`statusCheckRollup` 里那个 failure 还在
 *    ⇒ 脚本永远说「有 CI 失败」⇒ PR 被永久卡住。
 *
 * ⇒ 走 check-runs API，按名字分组取最新（GitHub 自己的合并按钮也是这么判的）。
 */
function collectLatestChecks(sha) {
  const raw = tryRun('gh', [
    'api',
    `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`,
    '--jq',
    '.check_runs[] | {name, status, conclusion, completed_at}',
  ]);
  const latest = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const item = JSON.parse(line);
    const seen = latest.get(item.name);
    if (!seen || (item.completed_at ?? '') > (seen.completed_at ?? '')) {
      latest.set(item.name, item);
    }
  }
  return [...latest.values()];
}

const checks = collectLatestChecks(info.headRefOid);
// ⚠️ check-runs API 的 `conclusion` 是**小写**（`success`），
//    而 `statusCheckRollup` 里是大写（`SUCCESS`）⇒ 比较要大小写不敏感。
const failed = checks.filter((c) => {
  const conclusion = (c.conclusion ?? '').toUpperCase();
  return (
    conclusion.length > 0 &&
    conclusion !== 'SUCCESS' &&
    conclusion !== 'NEUTRAL' &&
    conclusion !== 'SKIPPED'
  );
});
const pending = checks.filter((c) => c.status === 'QUEUED' || c.status === 'IN_PROGRESS' || c.status === 'PENDING');

console.log(`  CI：${checks.length} 项（失败 ${failed.length} · 未完成 ${pending.length}）`);
for (const c of failed) console.log(`    ✗ ${c.name}：${c.conclusion}`);
for (const c of pending) console.log(`    … ${c.name}：${c.status}`);

const problems = [];
if (info.state !== 'OPEN') problems.push('PR 不是 OPEN 状态');
if (info.isDraft) problems.push('PR 还是草稿');
if (info.mergeable !== 'MERGEABLE') problems.push(`当前不可合并（${info.mergeable}）`);
if (failed.length > 0) problems.push(`有 ${failed.length} 项 CI 失败`);
if (pending.length > 0) problems.push(`有 ${pending.length} 项 CI 未完成`);
if (info.reviewDecision === 'CHANGES_REQUESTED') problems.push('有 review 要求修改');

// ── ③ 模式：只检查 ───────────────────────────────────────────
if (problems.length > 0) {
  console.log('\n⚠️ 还不具备合并条件：');
  for (const p of problems) console.log(`   · ${p}`);
  console.log('\n（这是检查模式，什么都没改）');
  process.exit(1);
}

console.log('\n✅ 检查通过：可以合并。');
console.log(`   合并方式：${strategy}（默认 squash：一个 PR 一个提交）`);
console.log(`   合并后会做：删远端分支 ${info.headRefName} → 切回 ${info.baseRefName} → pull → 删本地分支`);

if (!yes) {
  console.log('\n（检查模式：加 --yes 才会真的合并）');
  process.exit(0);
}

// ── ④ 合并（公共动作 ⇒ 显式 --yes 才做）──────────────────────
//
// ⚠️ **先切回 base 分支**：脚本**常驻 main** ⇒ 先切到 main，脚本就活着了
//    （别让脚本躺在待删的分支上）。
const repoRoot = path.resolve(__dirname, '..', '..');
const branch = info.headRefName;
const base = info.baseRefName;

const currentBranch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  cwd: repoRoot,
});
if (currentBranch === branch) {
  console.log(`\n（先切回 ${base}：脚本常驻 base 分支，免得随 ${branch} 被删）`);
  tryRun('git', ['checkout', base], { cwd: repoRoot, inherit: true });
}

console.log('\n合并中…');
try {
  // ⚠️ **不要加 `--delete-branch`**：它会删本地分支 ⇒ 分支正被工作区签出时，
  //    **那个工作区的文件会被一起删掉**（实测：agent 工作区的源码全没了）。
  //    删分支的事交给下面的「⑤ 清理」⇒ 那里会先问「有没有被工作区签出」。
  tryRun(
    'gh',
    ['pr', 'merge', String(info.number), `--${strategy}`],
    { inherit: true },
  );
} catch (error) {
  /*
    ⚠️ **gh 会在「删分支」收尾时抛自己的内部错误**（实测：
       `Cannot read properties of null (reading 'trim')`），
       但**合并其实已经成功**了 ⇒ 别把它当成失败。
       ⇒ 核对 PR 的**真实状态**再决定。
  */
  const after = JSON.parse(
    tryRun(
      'gh',
      ['pr', 'view', String(info.number), '--json', 'state,mergedAt'],
      { cwd: repoRoot },
    ),
  );
  if (after.state !== 'MERGED') {
    console.error(`\n合并失败：${error.message}`);
    console.error('（若是网络断了 ⇒ 远端不会有变化，等网络恢复后重跑同一条命令即可）');
    process.exit(1);
  }
  console.log('(gh 收尾时报错，但 PR 实际已合并 ⇒ 继续清理)');
}

// ── ⑤ 清理 ──────────────────────────────────────────────────
console.log(`\n清理（${branch}）：`);

// 远端分支（远端可能已被 gh 删了 ⇒ 容忍「不存在」）
try {
  tryRun('git', ['push', 'origin', '--delete', branch], {
    cwd: repoRoot,
    inherit: true,
  });
} catch {
  console.log('  · 远端分支已不存在（gh 已删）');
}

// 本地分支
// ⚠️ **squash 合并后必须用 `-D`**：`git branch -d` 会说「分支未合并」
//    （squash 产生的是新提交，原分支的提交不在 main 的历史里）⇒ 删不掉。
//
// ⚠️ **被工作区签出时不能删**：删了会把那个工作区的文件带走（实测事故）
//    ⇒ 只提示，让人自己决定（或者先把工作区切走）。
if (branchCheckedOutInWorktree(branch, repoRoot)) {
  console.log(`  · 本地分支 ${branch} 正被某个工作区签出 ⇒ **不删**（删了会连带删掉那个工作区的文件）`);
  console.log(`    · 想删：先把那个工作区切到别的分支，再 git branch -D ${branch}`);
} else {
  try {
    tryRun('git', ['branch', '-D', branch], { cwd: repoRoot, inherit: true });
  } catch {
    console.log('  · 本地分支已不存在（gh 已删）');
  }
}

// 切回 base 并同步
if (currentBranch !== base) {
  tryRun('git', ['checkout', base], { cwd: repoRoot, inherit: true });
}
// ⚠️ **pull / fetch 失败只警告，不崩**：合并已经成功了 ⇒ 崩掉只会让后半段清理没跑
//    （这就是之前连续三棒要人手工收尾的原因）。
try {
  tryRun('git', ['pull', '--ff-only'], { cwd: repoRoot, inherit: true });
} catch (error) {
  console.warn(`  · git pull 失败（不影响合并结果）：${error.message}`);
  console.warn(`    · 手工同步：cd ${repoRoot} && git pull --ff-only`);
}
try {
  tryRun('git', ['fetch', '--prune'], { cwd: repoRoot });
} catch (error) {
  console.warn(`  · git fetch --prune 失败：${error.message}`);
}

console.log('\n完成：');
console.log(`  · PR #${info.number} 已合并（${strategy}）`);
console.log('  · 远端分支已删');
console.log(`  · 本地分支已处理，已切回 ${base} 并同步`);
