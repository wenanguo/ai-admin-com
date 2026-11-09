/**
 * 闸门 —— **修改已有数据要先问人**。
 *
 * ## 机制：pi 的 `tool_call` hook 里**同步等批准**
 *
 * SDK 的 `AgentSession._beforeToolCall` 是 **async 且被 await**
 * （`await runner.emitToolCall(...)`）⇒ hook 里可以 await ⇒
 * 我们就在 hook 里等用户的批准：
 *
 * - **批准** ⇒ hook 返回 `undefined`（不 block）⇒ **pi 照常执行原工具调用**
 *   ⇒ 模型拿到正常结果 ⇒ **那一轮不打断**（不需要往会话里注入系统消息）；
 * - **拒绝/超时** ⇒ hook 返回 `{block:true, reason}` ⇒ 模型收到一个错误工具结果
 *   ⇒ **它会自己告诉用户这次没做成**。
 *
 * ## 只拦「修改已有数据」
 *
 * 用户定的口径（2026-11-06）：**新增放行、修改要点头**。
 * ⇒ 判定：工具名里的 `update_` / `patch_` ⇒ 要点头；其余（`create_` / `list_` / `get_`）放行。
 *
 * ⚠️ **没有上下文就放行**：拿不到会话/用户 ⇒ 没法挂起 ⇒ 不能把 AI 卡死。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPendingAction } from "../pending-write";
import type { PendingWaiterRegistry } from "./pending-waiters";

/** 默认等多久（毫秒）。 */
export const DEFAULT_GATE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 这个工具要不要人点头？
 *
 * @param toolName 工具名（可能带 `mcp__<server>__` 前缀）。
 */
export function requiresConfirmation(toolName: string): boolean {
	const bare = toolName.replace(/^mcp__[^_]+__/, "");
	return bare.startsWith("update_") || bare.startsWith("patch_");
}

/** 闸门需要的上下文。 */
export interface GateContext {
	/** 这次对话的 id。 */
	conversationId: string;
	/** 发起人的 id。 */
	userId: string;
	/** 挂起后通知外界（推 SSE pending 事件）。 */
	onPending: (row: { id: string; command: string; args: Record<string, unknown> }) => void;
}

/**
 * 造闸门扩展。
 *
 * @param options 等待者注册表、超时、上下文提供者。
 */
export function createGateExtension(options: {
	waiters: PendingWaiterRegistry;
	timeoutMs?: number;
	/** 提供对话上下文（每个会话一份）。 */
	context?: () => GateContext;
	/**
	 * 建一条待确认（**测试可注入**；生产用真的那个）。
	 *
	 * ⚠️ 做成依赖是因为它要落库 ⇒ 不注入就没法在单测里跑。
	 */
	createPending?: (input: {
		conversationId: string;
		userId: string;
		command: string;
		args: Record<string, unknown>;
		preview: Record<string, unknown>;
		ttlMs: number;
	}) => Promise<{ id: string }>;
}): (pi: ExtensionAPI) => void {
	const timeoutMs = options.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
	const createPending = options.createPending ?? createPendingAction;
	return (pi: ExtensionAPI) => {
		pi.on("tool_call", async (event) => {
			if (!requiresConfirmation(event.toolName)) {
				return undefined;
			}
			const context = options.context?.();
			if (context === undefined) {
				// 没有上下文 ⇒ 没法挂起 ⇒ **放行**（别把 AI 卡死）
				return undefined;
			}
			const row = await createPending({
				conversationId: context.conversationId,
				userId: context.userId,
				command: event.toolName,
				args: event.input,
				preview: { tool: event.toolName, args: event.input },
				ttlMs: timeoutMs,
			});
			context.onPending({ id: row.id, command: event.toolName, args: event.input });

			const decision = await options.waiters.wait(row.id, timeoutMs);
			if (decision === "approved") {
				// 放行：pi 照常执行原调用（参数还是模型给的那份）
				return undefined;
			}
			return {
				block: true,
				reason:
					decision === "timeout"
						? "这次修改等了很久都没人确认，已经作废了。"
						: "用户拒绝了这次修改，没有执行。",
			};
		});
	};
}
