/**
 * 巡检开单纪律 —— 找出「没按规矩开」的 issue，让不一致**可发现**，而不是靠人盯。
 *
 * ## 为什么有它
 *
 * 2026-11-14 出现了两条**没走闸门**的 issue：
 * - #57（最大化工作台顶到最上沿）—— **既没有 `agent-task` 标签，也没挂 milestone**
 *   ⇒ 开发 agent 的 `pick-next.cjs` 根本看不到它（只认 `ready`）⇒ 只能被人手动指派；
 *   ⇒ 看板（milestone 的 open_issues）也对不上。
 *
 * ⇒ 立一条硬规矩：**任何 issue 算「已开单」，必须同时满足三个条件**
 *   ① 有 `agent-task` 标签   ② 挂了 milestone   ③ 在 `docs/pm/log.md` 里有对应记录
 *
 * 本脚本就是这条规矩的**巡检器**：跑一遍，报出所有不满足的 issue。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/pm/check-queue.cjs           # 巡检 + 打印报告
 * node scripts/pm/check-queue.cjs --json    # 机器可读
 * ```
 *
 * ⚠️ **只读**：不改任何 GitHub 对象、不改任何文件。
 * ⚠️ **退出码**：0 = 全部合规；1 = 有不合规项（适合挂 CI 或提交前自查）。
 */
const { execFileSync } = require('node:child_process');

/** 跑一条命令（拿文本输出）。 */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    throw new Error(`${cmd} ${args.join(' ')} 失败：${stderr || error.message}`);
  }
}

const asJson = process.argv.includes('--json');

/** 全部开着的 issue（不管有没有标签）。 */
const issues = JSON.parse(
  run('gh', [
    'issue', 'list', '--state', 'open', '--limit', '100',
    '--json', 'number,title,labels,milestone,createdAt',
  ]),
);

/** 全部 milestone（含 open/closed 计数）。 */
const milestones = JSON.parse(
  run('gh', ['api', 'repos/wenanguo/ai-admin-com/milestones', '--jq', '[.[] | {number,title,open_issues,closed_issues}]']),
);

const milestoneTitles = new Set(milestones.map((m) => m.title));

/**
 * `docs/pm/log.md` 里出现过的 issue 号（用来判断「有没有记一笔」）。
 *
 * ⚠️ **读远端，不读本地**：本地工作区可能还没 pull（刚开单时正是如此）
 * ⇒ 读本地会把「刚写进 log.md 的那条」误报成「没记录」。
 * 远端拿不到时回退到本地文件。
 */
function readLogText() {
  try {
    const remote = run('gh', [
      'api', 'repos/wenanguo/ai-admin-com/contents/docs/pm/log.md?ref=main',
      '--jq', '.content',
    ]);
    return Buffer.from(remote.replace(/\s/g, ''), 'base64').toString('utf8');
  } catch {
    try {
      return require('node:fs').readFileSync('docs/pm/log.md', 'utf8');
    } catch {
      return '';
    }
  }
}
const logText = readLogText();
const logMentions = (n) => logText.includes(`#${n}`);

/** 在途的 issue（有 `in-progress`）—— 它们可以没有 `ready`，但其它条件必须满足。 */
const problems = [];

for (const issue of issues) {
  const labels = issue.labels.map((l) => l.name);
  const missing = [];

  if (!labels.includes('agent-task')) missing.push('缺 `agent-task` 标签');
  if (!issue.milestone) missing.push('没挂 milestone');
  else if (!milestoneTitles.has(issue.milestone.title)) missing.push(`milestone「${issue.milestone.title}」不存在`);
  if (!logMentions(issue.number)) missing.push('`docs/pm/log.md` 里没有记录（#号没出现过）');

  if (missing.length > 0) {
    problems.push({
      number: issue.number,
      title: issue.title,
      labels,
      milestone: issue.milestone?.title ?? null,
      missing,
    });
  }
}

/**
 * 另检 milestone 的两种「空」：
 * - **空壳**：从来没装过 issue（open=0 且 closed=0）⇒ 假看板，应删掉或装上活；
 * - **已完成**：全部 issue 都关了（closed>0）⇒ 不是空壳，只是**该收尾**（关掉它，归到「已完成」）。
 */
const emptyMilestones = milestones
  .filter((m) => m.open_issues === 0 && m.closed_issues === 0)
  .map((m) => ({ number: m.number, title: m.title }));

const finishedMilestones = milestones
  .filter((m) => m.open_issues === 0 && m.closed_issues > 0)
  .map((m) => ({ number: m.number, title: m.title, done: m.closed_issues }));

if (asJson) {
  console.log(JSON.stringify({ problems, emptyMilestones, finishedMilestones }, null, 2));
} else {
  console.log(`\n巡检：开着的 issue ${issues.length} 条 · milestone ${milestones.length} 个\n`);
  if (problems.length === 0) {
    console.log('✅ 全部 issue 都满足「已开单」三条件（标签 + milestone + log 记录）');
  } else {
    console.log(`⚠️ ${problems.length} 条 issue 不合规：`);
    for (const p of problems) {
      console.log(`  #${p.number} ${p.title}`);
      console.log(`      缺：${p.missing.join(' / ')}`);
    }
  }
  if (emptyMilestones.length > 0) {
    console.log(`\n⚠️ ${emptyMilestones.length} 个 milestone 是**空壳**（从来没装过 issue ⇒ 假看板）：`);
    for (const m of emptyMilestones) console.log(`  #${m.number} ${m.title}`);
  }
  if (finishedMilestones.length > 0) {
    console.log(`\nℹ️ ${finishedMilestones.length} 个 milestone 已全部做完（可以关掉归档）：`);
    for (const m of finishedMilestones) console.log(`  #${m.number} ${m.title}（已关 ${m.done} 条）`);
  }
}

process.exit(problems.length > 0 || emptyMilestones.length > 0 ? 1 : 0);
