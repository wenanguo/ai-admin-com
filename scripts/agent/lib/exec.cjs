/**
 * 跑命令的小工具 —— 给 `scripts/agent/**` 用。
 *
 * ## 为什么单独一个文件
 *
 * ⚠️ **`execFileSync` 在 `stdio: 'inherit'` 时返回 `null`**（不是空字符串）⇒
 *    直接 `.trim()` 会炸：`TypeError: Cannot read properties of null (reading 'trim')`。
 *    这个坑已经让 `merge-pr.cjs` 在**合并成功之后**崩了三次（#38 / #39 / #41 三棒都踩到），
 *    每次都要人手工收尾 ⇒ 抽到这里，**一处修好**，并且**有测试**（`merge-pr.test.cjs`）。
 *
 * ## 用法
 *
 * ```js
 * const { run, tryRun, branchCheckedOutInWorktree } = require('./lib/exec.cjs');
 * ```
 */
const { execFileSync } = require('node:child_process');

/**
 * 跑一条命令，拿文本输出。
 *
 * ⚠️ **`stdio: 'inherit'` 时返回 null** ⇒ 这里统一兜成 `''`。
 *
 * @param {string} cmd 命令。
 * @param {string[]} args 参数。
 * @param {{cwd?: string, inherit?: boolean}} [options] 选项。
 * @returns {string} stdout（去掉了首尾空白；inherit 模式 ⇒ 空串）。
 */
function run(cmd, args, options = {}) {
	const out = execFileSync(cmd, args, {
		encoding: 'utf8',
		stdio: options.inherit ? 'inherit' : 'pipe',
		cwd: options.cwd,
	});
	// ⚠️ **inherit 模式下 execFileSync 返回 null** ⇒ 不能无条件 .trim()
	return (out ?? '').trim();
}

/**
 * 跑一条命令（失败就抛出，错误信息带上命令与 stderr）。
 *
 * @param {string} cmd 命令。
 * @param {string[]} args 参数。
 * @param {{cwd?: string, inherit?: boolean}} [options] 选项。
 * @returns {string} stdout。
 */
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

/**
 * 这个分支是不是**正被某个工作区（worktree）签出**。
 *
 * ## 为什么需要它
 *
 * `gh pr merge --delete-branch` 会删**本地分支**；如果那个分支正被一个工作区签出
 * （agent 的工作区就是这种情况！）⇒ gh 会把**那个工作区的文件一起删掉**
 * ⇒ 实测：合并完 #45 之后，agent 的工作区只剩两个 `node_modules` 软链，源码全没了。
 *
 * ⇒ 合并脚本要：**先问一句**「这个分支有没有被工作区签出」，
 *    有就别删（只提示），没有才删。
 *
 * @param {string} branch 分支名（不带 `refs/heads/`）。
 * @param {string} [cwd] 仓库目录。
 * @returns {boolean} 被某个工作区签出 ⇒ true。
 */
function branchCheckedOutInWorktree(branch, cwd) {
	let raw = '';
	try {
		raw = run('git', ['worktree', 'list', '--porcelain'], { cwd });
	} catch {
		return false;
	}
	// porcelain 输出：一段 `worktree <路径>` 后跟可选的 `branch refs/heads/<名>`
	let current = null;
	for (const line of raw.split('\n')) {
		if (line.startsWith('worktree ')) {
			current = { path: line.slice('worktree '.length).trim(), branch: '' };
			continue;
		}
		if (line.startsWith('branch ') && current !== null) {
			current.branch = line.slice('branch '.length).trim().replace('refs/heads/', '');
			if (current.branch === branch) {
				return true;
			}
		}
	}
	return false;
}

module.exports = { run, tryRun, branchCheckedOutInWorktree };
