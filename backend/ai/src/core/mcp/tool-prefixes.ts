/**
 * 工具名的**前缀口径** —— 全仓**只有这一份**（issue #195）。
 *
 * ## 为什么要有它
 *
 * 「**哪些工具要人点头**」这条口径以前**散在两处**（而且是同源的两份）：
 *
 * - `core/gate/gate.ts`（内核的闸门）⇒ `update_` / `patch_` 要点头；
 * - `dsh-plugin/src/mcp.js`（**dsh 侧插件**）⇒ **又硬编码了一遍** ⇒ 改一处忘另一处
 *   ⇒ 口径漂移 ⇒ 「修改已有数据要点头」这条规矩被绕过（**静默**）。
 *
 * ⇒ 现在**字面量只住在本文件** ⇒ 别的模块一律来这里拿 ⇒ **口径只有一份**。
 *
 * ## 两张清单（为什么不是一张）
 *
 * | 清单 | 含义 | 谁用 |
 * | ---- | ---- | ---- |
 * | `ASK_PREFIXES` | **要人点头**（口径：新增放行、修改要点头） | 闸门（`core/gate/gate.ts`）· 交给 dsh 侧插件 |
 * | `WRITE_PREFIXES` | **会改数据**（**新建也算** ⇒ 要留审计） | 事件桥（`core/session/event-bridge.ts`）|
 *
 * ⚠️ **两张清单的语义不同**（审计比闸门多一个 `create_`）⇒ **别混用**。
 *
 * ## 为什么清单能被 dsh 侧插件拿到
 *
 * dsh 侧插件是**另一个进程**（跑在 dsh 运行时里 ⇒ 而且是**拷贝**进去的）
 * ⇒ 它**没法 import 我们的内核** ⇒ 内核把清单**算好**交给它（环境变量
 * `AI_DSH_GATE_ASK_PREFIXES`，见 `core/adapter/dsh/runner.ts`）
 * ⇒ **插件侧不再知道 `update_` / `patch_` 这两个词** ⇒ 它只负责**问**。
 *
 * ⚠️ **插件拿不到清单 ⇒ 一律问**（fail closed）⇒ 结论仍由内核那一份判定
 *    （`core/gate/decision.ts`）⇒ **不会因为配置漏了就绕过闸门**。
 */

import { bareToolName } from "./tool-names.ts";

/**
 * **要人点头**的工具名前缀（口径：新增放行、修改要点头）。
 *
 * ⚠️ **这是口径本身**（人 2026-11-06 定的）⇒ 改这里 = 改口径 ⇒ 要人点头。
 */
export const ASK_PREFIXES: readonly string[] = ["update_", "patch_"];

/**
 * **会改数据**的工具名前缀（新建 / 修改）⇒ 用来决定**要不要留审计**。
 *
 * ⚠️ 比 `ASK_PREFIXES` 多一个 `create_`（新建也改了数据 ⇒ 也要留痕）
 *    ⇒ **闸门不许用这张**（新建是放行的）。
 */
export const WRITE_PREFIXES: readonly string[] = ["create_", "update_", "patch_"];

/**
 * 这个工具名**要不要人点头**（按 `ASK_PREFIXES` 判）。
 *
 * @param toolName 工具名（**可以带 `mcp__<server>__` 前缀**）。
 */
export function matchesAskPrefix(toolName: string): boolean {
	const bare = bareToolName(toolName);
	return ASK_PREFIXES.some((prefix) => bare.startsWith(prefix));
}

/**
 * 这个工具名**会不会改数据**（按 `WRITE_PREFIXES` 判）。
 *
 * @param toolName 工具名（**可以带 `mcp__<server>__` 前缀**）。
 */
export function matchesWritePrefix(toolName: string): boolean {
	const bare = bareToolName(toolName);
	return WRITE_PREFIXES.some((prefix) => bare.startsWith(prefix));
}
