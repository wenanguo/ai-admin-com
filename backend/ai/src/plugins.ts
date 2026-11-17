/**
 * 插件注册 —— **入口侧唯一 import 插件的地方**。
 *
 * ## 为什么要有这个文件
 *
 * 内核（`core/**`）**永远不 import 插件** ⇒ 插件只能从**外面**送进去。
 * 这个文件就是那个「外面」：入口启动时把插件注册进**进程级注册表**
 * （`core/plugins.ts`），运行时（`agent/runtime.ts`）从注册表里取。
 *
 * ⚠️ 注册表是**懒读**的 ⇒ 插件晚一点注册也没关系（运行时在**建会话时**才读）。
 */

import { pluginRegistry } from "./core/plugins.ts";
import { createPmPlugin } from "./plugins/pm/index.ts";

/**
 * 注册本进程要用的插件。
 *
 * ⚠️ 幂等（同一个 id 覆盖自己）⇒ 重复调用没坏处。
 */
export function registerPlugins(): void {
	pluginRegistry.register(createPmPlugin());
}
