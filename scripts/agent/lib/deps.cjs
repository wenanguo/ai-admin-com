/**
 * 依赖检查的两个纯函数 —— 「issue 正文里写了依赖哪些号」与「那些号是不是已经落地了」。
 *
 * ## 为什么单独拆出来
 *
 * `pick-next.cjs` 是 CLI（顶层就干活）⇒ 里面的函数**没法直接测**。
 * ⇒ 把纯逻辑拆到这里，CLI 与测试都用同一份 ⇒ 改一处、两处都跟着变。
 *
 * ## ⚠️ 依赖既可能是 issue，也可能是 PR
 *
 * GitHub 里 **PR 也是 issue** ⇒ `gh issue view 58` 对一个已合并的 PR 返回
 * `state = "MERGED"`（不是 `"CLOSED"`）。
 * ⇒ 只认 `CLOSED` 会把**已合并的 PR 误判成「依赖没合」** ⇒ 队列被卡住
 * （实测：#59 依赖 #58（PR，已合）⇒ 脚本说「依赖未合」⇒ 谁都领不了）。
 */
const { execFileSync } = require('node:child_process');

/**
 * 从 issue 正文里抽出依赖的 issue 号。
 *
 * 只看「## 依赖」那一节（到下一个 **二级** 标题为止）—— 正文别处出现的 `#号`
 * 可能是上游仓库的 issue 号（例：#11772 属上游 Ant Design Pro），不能当依赖。
 *
 * ⚠️ 逐行扫（不用正则一把抓）：正则里写 `\Z`（JS **没有**这个锚点）⇒
 *    「## 依赖」是**最后一节**时会整段匹配失败 ⇒ 依赖被当成「没有」⇒ 抢跑。
 *
 * @param {string} body issue 正文
 * @returns {number[]} 依赖号（去重）
 */
function parseDependencies(body) {
  const lines = String(body ?? '').split(/\r?\n/);
  const sectionLines = [];
  let inSection = false;
  let found = false;

  for (const line of lines) {
    if (!inSection) {
      if (/^##\s*依赖\s*$/.test(line)) {
        inSection = true;
        found = true;
      }
      continue;
    }
    // 下一个**二级**标题 ⇒ 依赖段结束（`###` 小节不算，原来的行为也是不算）
    if (/^##\s/.test(line)) break;
    sectionLines.push(line);
  }

  if (!found) return [];
  const sectionText = sectionLines.join('\n');
  if (/无/.test(sectionText)) return [];
  const ids = [...sectionText.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  return [...new Set(ids)];
}

/**
 * 查一个号（issue **或** PR）是否已经「落地」。
 *
 * - issue：`state === "CLOSED"` ⇒ 已关闭
 * - PR：`state === "MERGED"` ⇒ 已合并（GitHub 里 PR 也是 issue，`gh issue view` 能查到）
 *
 * @param {number} number 号
 * @param {(cmd: string, args: string[]) => string} [runner] 跑命令的函数（测试可注入假的）
 * @returns {boolean} 是否已落地
 */
function isSettled(number, runner = defaultRunner) {
  const json = runner('gh', ['issue', 'view', String(number), '--json', 'state,stateReason']);
  const info = JSON.parse(json);
  return info.state === 'CLOSED' || info.state === 'MERGED';
}

/** 默认的跑命令方式（失败就抛出，错误信息带上）。 */
function defaultRunner(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    const detail = stderr.length > 0 ? stderr : error.message;
    throw new Error(`${cmd} ${args.join(' ')} 失败：${detail}`);
  }
}

module.exports = { parseDependencies, isSettled };
