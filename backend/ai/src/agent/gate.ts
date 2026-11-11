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
import { createPendingAction } from "../pending-write.ts";
import type { AiTaskContext } from "./context.ts";
import { sanitizeWriteArgs, type SanitizedWrite } from "./context.ts";
import type { PendingWaiterRegistry } from "./pending-waiters.ts";

/** 默认等多久（毫秒）。 */
export const DEFAULT_GATE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 这个工具是「批量改**可用状态**」的，不是「批量改**任务状态**」。
 *
 * ⚠️ **线上事实**（后端 `pm_task/controller.py` + `BatchSetAvailable`）：
 *    `PATCH /pm_task/status/batch` 的入参是 `{ids, status:int(0/1)}`
 *    ⇒ 它改的是「是否可用」，**改不了 `status_code`**。
 *    但 MCP 把它叫 `patch_task_status`、描述也写着「批量修改任务状态」⇒
 *    模型会以为它能改任务状态 ⇒ 用了就**状态没改，还顺手动了可用状态**。
 *
 * ⇒ 讨论某条任务时，**不许用**它改状态 ⇒ 拦住它并告诉模型改用 `update_task`。
 */
export function isAvailabilityTool(toolName: string): boolean {
	return toolName.replace(/^mcp__[^_]+__/, "") === "patch_task_status";
}

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
	/**
	 * 当前讨论的上下文（**没有就是 undefined**）。
	 *
	 * ⚠️ 有它 ⇒ 写操作的参数会被**收窄**到允许回填的字段
	 *    （见 `sanitizeWriteArgs`）⇒ 「限定回填字段」是代码保证的。
	 */
	taskContext?: AiTaskContext | undefined;
}

/**
 * 把工具的入参**就地**换成收窄后的那份。
 *
 * ⚠️ 必须**就地改**：pi 的 `_beforeToolCall` 把 `args` **同一个对象引用**
 *    传给 hook（见 SDK 的 `agent-session.js`）⇒ 改属性才生效；
 *    换引用没用（pi 之后用的还是原来那个对象）。
 *
 * ⇒ 先删掉多余的键，再覆盖剩下的 —— `Object.assign` 不会删键。
 */
export function replaceToolInput(
	input: Record<string, unknown>,
	sanitized: Record<string, unknown>,
): void {
	for (const key of Object.keys(input)) {
		if (!(key in sanitized)) {
			delete input[key];
		}
	}
	Object.assign(input, sanitized);
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
			// ⚠️ **讨论某条任务时，不许用 patch_task_status 改状态**：
			//    它改的是「是否可用」(0/1)，**改不了 status_code**
			//    （见 `isAvailabilityTool`）⇒ 拦住并让模型改用 update_task。
			//    ⚠️ 拦在**建待确认之前** ⇒ 不会留下孤儿待确认记录。
			if (context.taskContext !== undefined && isAvailabilityTool(event.toolName)) {
				return {
					block: true,
					reason:
						"patch_task_status 改的是「是否可用」(0/1)，**不是任务状态**。" +
						"要改任务状态请用 update_task（带上完整的任务对象当基线）。",
				};
			}
			// ⚠️ **先把参数收窄**（有讨论上下文时）:
			//    只留允许回填的字段，其余按上下文里的原值回填
			//    ⇒ 模型就算想顺手改负责人/截止日，也在这一层被丢掉。
			//    ⇒ 而且待确认卡片里显示的就是**真正要写的那份**。
			const input = event.input as Record<string, unknown>;
			let sanitized: SanitizedWrite;
			try {
				sanitized = sanitizeWriteArgs(
					event.toolName,
					input,
					context.taskContext ?? null,
				);
			} catch (error) {
				// 收窄失败（基线缺必填字段）⇒ 别把一个会 422 的 PUT 放出去
				return {
					block: true,
					reason: error instanceof Error ? error.message : String(error),
				};
			}
			if (sanitized.args !== input) {
				replaceToolInput(input, sanitized.args);
			}
			const row = await createPending({
				conversationId: context.conversationId,
				userId: context.userId,
				command: event.toolName,
				args: sanitized.args,
				preview: { tool: event.toolName, args: sanitized.args },
				ttlMs: timeoutMs,
			});
			context.onPending({ id: row.id, command: event.toolName, args: sanitized.args });

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
