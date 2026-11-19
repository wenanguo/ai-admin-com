/**
 * 闸门**决策** —— 「这次修改要不要人点头」的**唯一实现**（issue #123：拔掉 pi）。
 *
 * ## 为什么单独一个模块
 *
 * 以前这段逻辑住在 `gate.ts` 的 `createGateExtension` 里 —— 那是 **pi 专有**的
 * （pi 的 `tool_call` hook + `block` 语义）⇒ 拔 pi 时会连它一起删掉。
 *
 * ⇒ 现在决策**与宿主无关**：
 * - 判定要不要问人（`requiresConfirmation`）；
 * - 按插件的写规则**收窄参数**（`narrowWriteArgs`）；
 * - 建一条待确认、通知外界（推 SSE `pending`）、等人点头；
 * - 给出结论：**放行** / **拒绝（带人话原因）**。
 *
 * ⇒ 宿主（今天是 dsh 的审批缝）只负责「怎么问」与「怎么答」，
 *    **口径只有这一份** ⇒ 换宿主不会换语义。
 *
 * ## 口径（人 2026-11-06 定的）
 *
 * **新增放行、修改要点头** ⇒ `update_` / `patch_` 前缀的工具要点头，其余放行。
 *
 * ⚠️ **没有上下文就放行**：拿不到会话 / 用户 ⇒ 没法挂起 ⇒ 不能把 AI 卡死。
 */

import {
	blockedWriteReason,
	narrowWriteArgs,
	type ContextAnchor,
	type WriteToolRule,
} from "../context/anchor.ts";
import { bareToolName } from "../mcp/tool-names.ts";
import type { PendingWaiterRegistry } from "./pending-waiters.ts";
import { DEFAULT_GATE_TIMEOUT_MS, requiresConfirmation } from "./gate.ts";

/** 闸门要的上下文（**与宿主无关** ⇒ 任何宿主都能用同一份口径）。 */
export interface GateContext {
	/** 这个对话的 id。 */
	conversationId: string;
	/** 发起人的 id。 */
	userId: string;
	/**
	 * 当前讨论的**锚点**（**没有就是 undefined** ⇒ 不收窄字段）。
	 */
	anchor?: ContextAnchor | undefined;
	/** 写规则（**插件给的** ⇒ 闸门不写死工具名 / 字段名）。 */
	writeRules?: readonly WriteToolRule[] | undefined;
	/** 挂起后通知外界（推 SSE `pending`）。 */
	onPending: (row: { id: string; command: string; args: Record<string, unknown> }) => void;
	/** 等人的等待者注册表（与 approve / reject 端点共用同一份）。 */
	waiters: PendingWaiterRegistry;
	/** 建一条待确认（测试可注入；生产用真的那个）。 */
	createPending: (input: {
		conversationId: string;
		userId: string;
		command: string;
		args: Record<string, unknown>;
		preview: Record<string, unknown>;
		ttlMs: number;
	}) => Promise<{ id: string }>;
	/** 等多久（毫秒）。 */
	timeoutMs?: number;
}

/** 决策的结果。 */
export type GateDecision =
	| { kind: "allow"; command: string; args: Record<string, unknown>; asked: boolean }
	| { kind: "reject"; command: string; args: Record<string, unknown>; reason: string; asked: boolean };

/**
 * 判一次工具调用要不要人点头，并给结论。
 *
 * @param input 工具名（**可以带 `mcp__<server>__` 前缀**）与参数。
 * @param context 闸门上下文。
 */
export async function decideWrite(
	input: { toolName: string; args: Record<string, unknown> },
	context: GateContext,
): Promise<GateDecision> {
	const command = bareToolName(input.toolName);
	// ⚠️ **口径**：`update_` / `patch_` 要点头，其余放行。
	if (!requiresConfirmation(command)) {
		return { kind: "allow", command, args: input.args, asked: false };
	}

	const anchor = context.anchor ?? null;
	const rules = context.writeRules ?? [];
	// ⚠️ **插件说这个工具在这个 scope 里不许用** ⇒ 直接拒（不留孤儿待确认）。
	const blocked = blockedWriteReason(command, anchor, rules);
	if (blocked !== undefined) {
		return { kind: "reject", command, args: input.args, reason: blocked, asked: false };
	}

	// ⚠️ **先把参数收窄**（有讨论上下文时）：
	//    只留允许回填的字段，其余按锚点里的原值回填
	//    ⇒ 模型就算想顺手改负责人 / 截止日，也在这一层被丢掉。
	//    ⇒ 而且待确认卡片里显示的就是**真正要写的那份**。
	let args: Record<string, unknown>;
	try {
		args = narrowWriteArgs(command, input.args, anchor, rules).args;
	} catch (error) {
		// 收窄失败（基线缺必填字段）⇒ 别把一个会 422 的写放出去
		return {
			kind: "reject",
			command,
			args: input.args,
			reason: error instanceof Error ? error.message : String(error),
			asked: false,
		};
	}

	const timeoutMs = context.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
	const row = await context.createPending({
		conversationId: context.conversationId,
		userId: context.userId,
		command,
		args,
		preview: { tool: command, args },
		ttlMs: timeoutMs,
	});
	context.onPending({ id: row.id, command, args });

	const decision = await context.waiters.wait(row.id, timeoutMs);
	if (decision === "approved") {
		return { kind: "allow", command, args, asked: true };
	}
	return {
		kind: "reject",
		command,
		args,
		reason:
			decision === "timeout"
				? "这次修改等了很久都没人确认，已经作废了。"
				: "用户拒绝了这次修改，没有执行。",
		asked: true,
	};
}
