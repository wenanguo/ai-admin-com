/**
 * 空壳插件 —— 顶替 dsh 自带的「pi-ai 支撑的 provider 适配器」。
 *
 * ## 为什么要有它（issue #123 · D5=A）
 *
 * dsh 的底座（`dsh-base`）默认挂着 `@deepseek-ai/dsh-llm-pi-ai`
 * ⇒ 它的依赖里有 **`@earendil-works/pi-ai`** ⇒ pi-ai 会进我们的依赖树。
 *
 * 而我们**不依赖 pi-ai**：模型 provider 是**我们自己写的**
 * （`backend/ai/dsh-plugin/src/provider.js` ⇒ 建在 `dsh-llm` 的缝上
 * ⇒ OpenAI 兼容协议 ⇒ DeepSeek / MiniMax 都能用）。
 *
 * ⇒ 用 npm 的 `overrides` 把 `@deepseek-ai/dsh-llm-pi-ai` 指向**这个空壳**
 * ⇒ **pi-ai 物理上不在依赖树里**（比「不用它」更强：它**用不了**）。
 *
 * ## 为什么换掉它是安全的
 *
 * dsh 侧那个适配器本来就是**休眠的**：不配 `llm-pi-ai:` 设置段 ⇒ **零路由**
 * ⇒ 我们的 profile 从来没走过它 ⇒ 换成一个什么都不做的插件，**行为一字不变**。
 *
 * ⚠️ **别把它改回真的** ⇒ `npm ls @earendil-works/pi-ai` 会重新出现它。
 */

/** 插件名（**与被顶替的那个同名** ⇒ dsh 的补丁层不用改）。 */
export const name = 'llm-pi-ai';

/**
 * 装插件（**什么都不做** ⇒ 不注册任何 provider 路由）。
 *
 * @param {object} ctx cordis 上下文（**不用**）。
 */
export function apply() {
  // ⚠️ **故意是空的** —— 见文件头的说明。
}
