/**
 * `scripts/agent/lib/deps.cjs` 的单元测试（node:test，零依赖、不联网）。
 *
 * ## 为什么要有它
 *
 * 依赖判断出过**一次假阴性**：依赖写的是 **PR 号**（GitHub 里 PR 也是 issue），
 * `gh issue view <PR>` 返回 `state = "MERGED"` ⇒ 只认 `CLOSED` 的老代码把
 * **已合并的 PR 误判成「依赖没合」** ⇒ `ready` 队列里的活谁也领不了（实测卡在 #59）。
 *
 * ⇒ 这类**只在真领活时才暴露**的判断，必须有测试兜住。
 *
 * ## 跑法
 *
 * ```bash
 * node --test scripts/agent/*.test.cjs
 * ```
 */
const test = require('node:test');
const assert = require('node:assert');

const { parseDependencies, isSettled } = require('./lib/deps.cjs');

test('parseDependencies：读「## 依赖」一节里的号', () => {
  const body = ['## 目标', '正文里提到 #11772（上游的号，不算依赖）', '', '## 依赖', '- #57', '- #58', ''].join(
    '\n',
  );
  assert.deepStrictEqual(parseDependencies(body).sort((a, b) => a - b), [57, 58]);
});

test('parseDependencies：写「无」⇒ 没有依赖', () => {
  assert.deepStrictEqual(parseDependencies('## 依赖\n\n无（现在 ready 队列是空的）\n'), []);
});

test('parseDependencies：没有「## 依赖」一节 ⇒ 空', () => {
  assert.deepStrictEqual(parseDependencies('## 目标\n\n随便写点 #12\n'), []);
});

test('isSettled：issue 已关闭 ⇒ true', () => {
  const runner = () => JSON.stringify({ state: 'CLOSED', stateReason: 'COMPLETED' });
  assert.strictEqual(isSettled(57, runner), true);
});

test('isSettled：**已合并的 PR 也算落地**（GitHub 里 PR 也是 issue，state 是 MERGED）', () => {
  const runner = () => JSON.stringify({ state: 'MERGED', stateReason: '' });
  assert.strictEqual(isSettled(58, runner), true);
});

test('isSettled：还没关的 issue / 没合的 PR ⇒ false', () => {
  assert.strictEqual(isSettled(59, () => JSON.stringify({ state: 'OPEN' })), false);
  assert.strictEqual(isSettled(59, () => JSON.stringify({ state: 'OPEN', stateReason: '' })), false);
});
