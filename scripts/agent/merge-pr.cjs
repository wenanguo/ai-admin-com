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
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** 跑一条命令（拿文本输出）。 */
function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    cwd: options.cwd,
  }).trim();
}

/** 跑一条命令（失败就抛出，错误信息带上）。 */
function tryRun(cmd, args, options = {}) {
  try {
    return run(cmd, args, options);
  } catch (error) {
    // ⚠️ stderr 可能是 **null**（网络掐断时）⇒ 不能无条件 .trim()
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    const detail = stderr.length > 0 ? stderr : error.message;
    throw new Error(`${cmd} ${args.join(' ')} 失败：${detail}`);
  }
}

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
    'number,title,state,mergeable,mergeStateStatus,statusCheckRollup,headRefName,baseRefName,url,reviewDecision,isDraft',
  ]),
);

console.log(`\nPR #${info.number}：${info.title}`);
console.log(`  ${info.url}`);
console.log(`  分支：${info.headRefName} → ${info.baseRefName}`);
console.log(`  状态：${info.state}${info.isDraft ? '（草稿）' : ''} · 可合并：${info.mergeable} · ${info.mergeStateStatus}`);

// ── ② 检查项 ────────────────────────────────────────────────
const checks = info.statusCheckRollup ?? [];
const failed = checks.filter(
  (c) => c.conclusion && c.conclusion !== 'SUCCESS' && c.conclusion !== 'NEUTRAL' && c.conclusion !== 'SKIPPED',
);
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
// ⚠️ **自我保护**：`gh pr merge --delete-branch` 会删**本地分支** ⇒
//    如果这个脚本正躺在那个分支上，它会把自己删掉（合并仍然成功，只是脚本没了）。
//    ⇒ 先把自己 copy 到临时目录再继续。
const SELF = __filename;
const SELF_COPY = path.join(
  require('node:os').tmpdir(),
  `merge-pr-${process.pid}.cjs`,
);
try {
  fs.copyFileSync(SELF, SELF_COPY);
  console.log(`(脚本已复制到临时目录，避免随分支被删：${SELF_COPY})`);
} catch {
  // 复制失败就继续（顶多脚本被删，重跑时从 main 上恢复即可）
}
console.log('\n合并中…');
tryRun('gh', ['pr', 'merge', String(info.number), `--${strategy}`, '--delete-branch'], { inherit: true });

// ── ⑤ 本地清理 ──────────────────────────────────────────────
const repoRoot = path.resolve(__dirname, '..', '..');
const branch = info.headRefName;
console.log(`\n本地清理（${branch}）：`);
tryRun('git', ['checkout', info.baseRefName], { cwd: repoRoot, inherit: true });
tryRun('git', ['pull', '--ff-only'], { cwd: repoRoot, inherit: true });
tryRun('git', ['branch', '-d', branch], { cwd: repoRoot, inherit: true });

console.log('\n完成：');
console.log(`  · PR #${info.number} 已合并（${strategy}）`);
console.log('  · 远端分支已删');
console.log(`  · 本地已切回 ${info.baseRefName} 并同步`);
