/**
 * 提交信息规范（monorepo 根级）。
 *
 * ⚠️ 规则包装在 `frontend/node_modules` 里（根目录没有 node_modules）
 *    ⇒ 用 require.resolve 指过去，别让 commitlint 从根去解析（找不到）。
 */
module.exports = {
  extends: [require.resolve('./frontend/node_modules/@commitlint/config-conventional')],
};
