/**
 * 闸门 —— **修改已有数据要先问人**。
 *
 * ## 口径（人 2026-11-06 定的）
 *
 * **新增放行、修改要点头**。
 * ⇒ 判定：工具名里的 `update_` / `patch_` ⇒ 要点头；其余（`create_` / `list_` / `get_`）放行。
 *
 * ## 决策在**另一个文件**里（issue #123：拔掉 pi）
 *
 * 以前这段逻辑是 pi 的 `tool_call` hook（`createGateExtension`）⇒ pi 一拔就跟着没了。
 * ⇒ 现在**口径与决策**住在 `decision.ts`（**与宿主无关**）⇒
 *    宿主（dsh 的审批缝）只负责「怎么问 / 怎么答」。
 *
 * ## 闸门**不写死**业务知识
 *
 * - 「这次写操作能不能改哪些字段」⇒ **插件的写规则**（`WriteToolRule`）；
 * - 「这个工具在这个 scope 里不许用」（如 PM 的 `patch_task_status`）⇒ **插件的规则**。
 *
 * ⇒ 闸门只做三件事：① 判断要不要问人 ② 按规则**收窄**参数 ③ 挂起等人点头。
 */

import { bareToolName } from "../mcp/tool-names.ts";

/** 默认等多久（毫秒）。 */
export const DEFAULT_GATE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 这个工具要不要人点头？
 *
 * @param toolName 工具名（可能带 `mcp__<server>__` 前缀）。
 */
export function requiresConfirmation(toolName: string): boolean {
	const bare = bareToolName(toolName);
	return bare.startsWith("update_") || bare.startsWith("patch_");
}

/**
 * 命令闸门 —— 决定一次命令要不要**先问人**。
 *
 * ⚠️ **住在闸门这一层**（issue #169 · S3：以前它在 `core/tools/types.ts`
 *    ⇒ 工具机制删掉后，闸门契约归它自己 ⇒ **内核里不再有第二套工具机制**）。
 */
export interface CommandGate {
	/** 这个命令要不要先问人。 */
	requiresConfirmation(command: string, args: Record<string, unknown>): boolean;
	/** 等人的答复；返回 `true` = 放行执行。 */
	awaitConfirmation(command: string, args: Record<string, unknown>): Promise<boolean>;
}

/** 恒放行的闸门（非破坏性命令用）。 */
export const ALLOW_ALL_GATE: CommandGate = {
	requiresConfirmation: () => false,
	awaitConfirmation: async () => true,
};
