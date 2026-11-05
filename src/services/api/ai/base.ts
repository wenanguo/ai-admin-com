/**
 * AI 服务（`D:/project/ai-admin-ai`）的**前缀常量**。
 *
 * ## 为什么单独一个文件（叶子模块）
 *
 * 共享的请求配置（`src/requestErrorConfig.ts`）要用 `AI_API_BASE_URL`
 * 判断「这条请求是不是 AI 服务的」——它不能失败、不能有副作用、不能拖进一堆依赖。
 *
 * 而 AI 客户端（`src/services/api/ai/client.ts`）import 了 `@umijs/max` 的 `request`
 * （umi 的运行时）⇒ 从 client.ts import 会把整个运行时拖进请求配置，
 * 请求配置又是 umi 运行时的一部分 ⇒ **循环依赖的温床**。
 *
 * ⇒ 这里只放常量与一个纯函数：**不 import 任何东西** ⇒ 谁都能安全地 import 它。
 */

/**
 * AI 服务的前缀（构建期由 `config/config.ts` 的 `define` 注入）。
 *
 * - 开发期：`/ai-api`（走 `config/proxy.ts` 的代理规则）
 * - 生产期：AI 服务的绝对地址
 *
 * ⚠️ umi 不会把任意 `process.env.*` 暴露给浏览器 ⇒ 自定义变量要在
 * `config/config.ts` 的 `define` 里配（那里已有 `process.env.CI` 等的先例）。
 */
export const AI_API_BASE_URL: string = process.env.AI_API_BASE_URL || '/ai-api';

/** 拼 AI 服务的完整路径（不含 origin）。 */
export function aiUrl(path: string): string {
  return `${AI_API_BASE_URL}${path}`;
}
