/**
 * agent 工作区（git worktree）管理 —— 让**多个 agent 不再共用一个目录**。
 *
 * ## 为什么
 *
 * 之前两个会话（开发 agent / PM 调度 agent）共用 `D:/project/ai-admin-com` 一个目录
 * ⇒ 谁切分支谁就踩到对方（实测：我干活期间它把我的工作区切到了 main，
 * 它的设计文档也差点被我 `git add -A` 带进我的提交）。
 *
 * ⇒ 规矩：**一个 agent 一个 worktree**，目录彼此独立 ⇒ 切分支互不影响。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/agent/worktree.cjs list              # 列出所有工作区
 * node scripts/agent/worktree.cjs add dev            # 建 .worktrees/dev（分支 agent/dev）
 * node scripts/agent/worktree.cjs add pm             # 建 .worktrees/pm（分支 agent/pm）
 * node scripts/agent/worktree.cjs remove pm          # 删工作区 + 分支
 * ```
 *
 * ## 建工作区时顺手做掉的两件事
 *
 * 1. **接依赖**：把主 checkout 的 `node_modules` 用 **junction** 接过来
 *    （省掉每个工作区 2.5GB 的重复安装；改依赖时要在**主 checkout** 装，或删掉 junction 重装）。
 * 2. **生成类型**：`frontend/` 里跑一次 `max setup`（生成 `src/.umi`，被 gitignore
 *    ⇒ 新工作区没有它 ⇒ `tsc` 会报 `@umijs/max` 的类型缺失）。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * **主 checkout** 的根目录（不是当前工作区）。
 *
 * ⚠️ 脚本可能是在**工作区**里跑的（`scripts/agent/` 在每个工作区都有一份）
 *    ⇒ `__dirname/../..` 是**当前工作区**的根 ⇒ `.worktrees/` 会算错位置。
 * ⇒ 用 `git rev-parse --git-common-dir` 拿主仓的 `.git` ⇒ 它的父目录就是主 checkout。
 */
function resolveMainCheckout() {
  const common = run('git', ['rev-parse', '--git-common-dir'], { cwd: __dirname });
  const commonDir = path.isAbsolute(common)
    ? common
    : path.resolve(__dirname, common);
  return path.dirname(commonDir);
}

/** 仓库根目录（脚本在 `<root>/scripts/agent/`）。 */
const repoRoot = resolveMainCheckout();
/**
 * 工作区根目录。
 *
 * ⚠️ **故意放在仓库外**（实测教训）：
 *    最初放在仓库内的 `.worktrees/`，结果**另一个 agent 把它删了**
 *    （工作区目录没了，只剩分支）⇒ 仓库内的目录会被别的进程/agent 误动。
 *    ⇒ 放在仓库外（同级的 `ai-admin-com-worktrees/`）⇒ 不受仓库内操作影响。
 *
 *    可用环境变量 `AI_WORKTREE_ROOT` 覆盖。
 */
const worktreeRoot = process.env.AI_WORKTREE_ROOT
  ? path.resolve(process.env.AI_WORKTREE_ROOT)
  : path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-worktrees`);

/** 跑一条命令。 */
function run(cmd, args, options = {}) {
  // ⚠️ Windows 上 `npx` 是 `npx.cmd` ⇒ 直接 spawn 会 ENOENT
  //    （不用 shell:true ⇒ 不会有参数拼接的安全警告）
  const finalCmd =
    process.platform === 'win32' && cmd === 'npx' ? 'npx.cmd' : cmd;
  return execFileSync(finalCmd, args, {
    encoding: 'utf8',
    cwd: options.cwd ?? repoRoot,
    stdio: options.inherit ? 'inherit' : 'pipe',
  }).trim();
}

/** 跑一条命令（失败就抛出，错误信息带上）。 */
function tryRun(cmd, args, options = {}) {
  try {
    return run(cmd, args, options);
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    throw new Error(
      `${cmd} ${args.join(' ')} 失败：${stderr.length > 0 ? stderr : error.message}`,
    );
  }
}

/** 已存在的工作区（名字 → 路径）。 */
function listWorktrees() {
  const out = run('git', ['worktree', 'list', '--porcelain']);
  const result = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: '' };
      result.push(current);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim().replace('refs/heads/', '');
    }
  }
  return result;
}

/** 把主 checkout 的 node_modules 用 junction 接进工作区。 */
function linkDependencies(target) {
  const deps = ['frontend', 'backend/ai'];
  for (const dep of deps) {
    const source = path.join(repoRoot, dep, 'node_modules');
    const destination = path.join(target, dep, 'node_modules');
    if (!fs.existsSync(source)) {
      console.log(`  · ${dep}/node_modules 主仓没有 ⇒ 跳过（该子项目可能还没装依赖）`);
      continue;
    }
    if (fs.existsSync(destination)) {
      console.log(`  · ${dep}/node_modules 已是链接/目录 ⇒ 跳过`);
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(source, destination, 'junction');
    console.log(`  · ${dep}/node_modules → junction（不重复安装）`);
  }
}

/** 生成前端类型（`src/.umi` 被 gitignore ⇒ 新工作区必须生成一次）。 */
function generateUmiTypes(target) {
  const frontend = path.join(target, 'frontend');
  if (!fs.existsSync(path.join(frontend, 'package.json'))) {
    return;
  }
  console.log('  · 生成前端类型（max setup）…');
  try {
    tryRun('npx', ['max', 'setup'], { cwd: frontend, inherit: true });
  } catch (error) {
    /*
      ⚠️ `max setup` 会在**生成完文件之后**抛自己的内部错误
      （实测：`Cannot read properties of null (reading 'trim')`）⇒ 退出码非 0，
      但 `src/.umi` 已经生成好了。
      ⇒ 以**产物是否生成**判定成败，不看退出码。
    */
    const generated = fs.existsSync(path.join(frontend, 'src', '.umi'));
    if (generated) {
      console.log('  · max setup 退出码非 0，但类型已生成 ⇒ 视为成功');
    } else {
      throw error;
    }
  }
}

const args = process.argv.slice(2);
const command = args[0];
const name = args[1];
/** 合并目标分支（算「未合并提交」时要用）。 */
const base = 'main';

switch (command) {
  case 'list': {
    const worktrees = listWorktrees();
    console.log('工作区：');
    for (const item of worktrees) {
      const marker = item.path === repoRoot ? '（主 checkout）' : '';
      console.log(`  · ${item.path}  [${item.branch || '?'}] ${marker}`);
    }
    console.log(`\n规矩：一个 agent 一个工作区（别共用主 checkout）`);
    break;
  }

  case 'add': {
    if (!name) {
      console.error('用法：node scripts/agent/worktree.cjs add <名字>');
      process.exit(2);
    }
    const target = path.join(worktreeRoot, name);
    const branch = `agent/${name}`;
    if (fs.existsSync(target)) {
      console.log(`工作区已存在：${target}`);
      // ⚠️ 已存在也要**补做**接依赖与生成类型（新机器/新会话时可能是半成品）
      console.log('补做：');
      linkDependencies(target);
      generateUmiTypes(target);
      break;
    }
    fs.mkdirSync(worktreeRoot, { recursive: true });
    const exists = tryRun('git', ['branch', '--list', branch]);
    if (exists) {
      console.log(`分支 ${branch} 已存在 ⇒ 挂上去（不新建）`);
      tryRun('git', ['worktree', 'add', target, branch]);
    } else {
      console.log(`建工作区 ${target}（分支 ${branch}）…`);
      tryRun('git', ['worktree', 'add', target, '-b', branch]);
    }
    console.log('接依赖 + 生成类型：');
    linkDependencies(target);
    generateUmiTypes(target);
    console.log(`\n完成 ⇒ 进去干活：cd ${target}`);
    break;
  }

  case 'remove': {
    if (!name) {
      console.error('用法：node scripts/agent/worktree.cjs remove <名字>');
      process.exit(2);
    }
    const target = path.join(worktreeRoot, name);
    // ⚠️ 分支名**从 worktree 列表读**（不猜）⇒ 目录名与分支名可以不一致
    const entry = listWorktrees().find(
      (item) => path.resolve(item.path) === path.resolve(target),
    );
    const branch = entry?.branch ?? `agent/${name}`;
    if (!fs.existsSync(target)) {
      console.log(`工作区不存在：${target}`);
      break;
    }

    /*
      ⚠️ **防误删**（实测教训）：另一个 agent 照着文档跑 `remove dev`
      ⇒ 想删掉**别人**的工作区 ⇒ git 只拦「工作区脏」，**已提交但未合并**的
      提交会被直接删掉（⇒ 丢代码）。
      ⇒ 删之前先自查：有没有未合并的提交 / 有没有脏改动 ⇒ 有就拒绝。
    */
    const dirty = tryRun('git', ['status', '--porcelain'], { cwd: target });
    const unmerged = tryRun(
      'git',
      ['log', '--oneline', `${branch}..${base}`],
      { cwd: target },
    );
    if (dirty.length > 0 || unmerged.length > 0) {
      console.error(`\n拒绝删除 ${target}：`);
      if (dirty.length > 0) {
        console.error('  · 有未提交改动：');
        console.error(dirty.split('\n').map((line) => `      ${line}`).join('\n'));
      }
      if (unmerged.length > 0) {
        console.error('  · 分支上有**未合并**的提交（删了会丢代码）：');
        console.error(
          unmerged.split('\n').map((line) => `      ${line}`).join('\n'),
        );
        console.error('  ⇒ 先把它们合进 main（或 cherry-pick 到别的分支）再删。');
      }
      console.error('  · 确认要丢的话：git worktree remove --force <路径>');
      process.exit(1);
    }

    // ⚠️ 先删 junction（不然 `git worktree remove` 会把主仓的 node_modules 删掉！）
    for (const dep of ['frontend', 'backend/ai']) {
      const link = path.join(target, dep, 'node_modules');
      if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) {
        fs.unlinkSync(link);
        console.log(`  · 已摘掉 junction：${dep}/node_modules`);
      }
    }
    tryRun('git', ['worktree', 'remove', target], { inherit: true });
    try {
      tryRun('git', ['branch', '-D', branch]);
    } catch {
      console.log(`  · 分支 ${branch} 删不掉（可能还有提交）⇒ 留着`);
    }
    console.log(`完成 ⇒ 已移除 ${target}`);
    break;
  }

  default:
    console.error(
      '用法：\n  node scripts/agent/worktree.cjs list\n  node scripts/agent/worktree.cjs add <名字>\n  node scripts/agent/worktree.cjs remove <名字>',
    );
    process.exit(2);
}
