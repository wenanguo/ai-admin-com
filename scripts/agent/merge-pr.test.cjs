/**
 * `scripts/agent/merge-pr.cjs` 及其工具的**单元测试**（node:test，零依赖）。
 *
 * ## 为什么要有它
 *
 * ⚠️ 这个脚本已经**连续三棒**（#38 / #39 / #41）在「合并成功之后」崩掉：
 * `execFileSync` 在 `stdio: 'inherit'` 时返回 **null** ⇒ 旧的 `.trim()` 直接炸
 * ⇒ 合并成功了，但「切回 main / 删本地分支 / `fetch --prune`」全没跑
 * ⇒ 每棒都要人手工收尾。
 *
 * ⇒ 这类**收尾脚本的 bug 不会自己暴露**（要等到「真的合并一次」才炸），
 * 所以必须有测试兜住。
 *
 * ## 跑法
 *
 * ```bash
 * node --test scripts/agent/*.test.cjs
 * ```
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run, tryRun, branchCheckedOutInWorktree } = require('./lib/exec.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * 只留**代码**（去掉注释）—— 注释里会提到被禁用的写法（解释「为什么不用」），
 * 静态断言不能被注释里的字样骗过。
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

test('run：pipe 模式拿得到输出（去首尾空白）', () => {
  const out = run('node', ['-e', 'console.log("  hello  ")'], { cwd: REPO_ROOT });
  assert.strictEqual(out, 'hello');
});

test('run：**inherit 模式返回空串而不是崩**（旧 bug：execFileSync 在 inherit 下返回 null）', () => {
  const out = run('node', ['-e', 'console.log("hi")'], { cwd: REPO_ROOT, inherit: true });
  assert.strictEqual(out, '');
});

test('tryRun：命令失败 ⇒ 抛错，且错误信息里有命令名', () => {
  assert.throws(
    () => tryRun('node', ['-e', 'process.exit(3)'], { cwd: REPO_ROOT }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /node/);
      return true;
    },
  );
});

test('tryRun：命令失败 ⇒ 错误信息里有 stderr（不是空）', () => {
  assert.throws(
    () => tryRun('node', ['-e', 'console.error("boom"); process.exit(1)'], { cwd: REPO_ROOT }),
    (error) => {
      assert.match(error.message, /boom/);
      return true;
    },
  );
});

test('branchCheckedOutInWorktree：被工作区签出的分支 ⇒ true', () => {
  // ⚠️ **不能假设「当前分支被签出」**：CI 的 pull_request 事件是**游离 HEAD**（合并提交）
  //    ⇒ `git worktree list` 里那条没有 branch 行 ⇒ 断言会假失败。
  //    ⇒ 自己造一个临时工作区来验。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-wt-'));
  const branch = 'tmp/agent-worktree-probe';
  try {
    run('git', ['worktree', 'add', '-b', branch, tmp, 'HEAD'], { cwd: REPO_ROOT });
    assert.strictEqual(branchCheckedOutInWorktree(branch, REPO_ROOT), true);
  } finally {
    tryRun('git', ['worktree', 'remove', '--force', tmp], { cwd: REPO_ROOT });
    tryRun('git', ['branch', '-D', branch], { cwd: REPO_ROOT });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('branchCheckedOutInWorktree：不存在的分支 ⇒ false', () => {
  assert.strictEqual(
    branchCheckedOutInWorktree('definitely-not-a-branch-xyz', REPO_ROOT),
    false,
  );
});

test('merge-pr.cjs：**不带 `--delete-branch`**（它会连带删掉工作区的文件）', () => {
  const source = codeOnly(fs.readFileSync(path.join(__dirname, 'merge-pr.cjs'), 'utf8'));
  assert.ok(
    !source.includes('--delete-branch'),
    'merge-pr.cjs 的代码里出现了 --delete-branch ⇒ 合并时会把 agent 工作区的文件删掉',
  );
});

test('merge-pr.cjs：删本地分支**前**先问「有没有被工作区签出」', () => {
  const source = fs.readFileSync(path.join(__dirname, 'merge-pr.cjs'), 'utf8');
  assert.ok(source.includes('branchCheckedOutInWorktree'));
  const guardAt = source.indexOf('branchCheckedOutInWorktree(branch');
  const deleteAt = source.indexOf("['branch', '-D', branch]");
  assert.ok(guardAt > -1 && deleteAt > -1, '没找到分支删除的代码');
  assert.ok(guardAt < deleteAt, '必须**先**检查工作区占用，再删本地分支');
});

test('merge-pr.cjs：输出走 lib/exec.cjs（null 兜底在那里）', () => {
  const source = codeOnly(fs.readFileSync(path.join(__dirname, 'merge-pr.cjs'), 'utf8'));
  assert.ok(source.includes("require('./lib/exec.cjs')"));
  assert.ok(
    !/execFileSync/.test(source),
    'merge-pr.cjs 不该自己调 execFileSync（统一走 lib/exec.cjs）',
  );
});

test('worktree.cjs：同样不踩「inherit ⇒ null」的坑', () => {
  const source = codeOnly(fs.readFileSync(path.join(__dirname, 'worktree.cjs'), 'utf8'));
  assert.ok(
    /\(\w+\s*\?\?\s*''\)\.trim\(\)/.test(source),
    'worktree.cjs 里 execFileSync 的返回值没有兜 null ⇒ inherit 模式下会崩',
  );
});
