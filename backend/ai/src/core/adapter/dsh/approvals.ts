/**
 * 闸门接线 —— dsh 的 `approval/request` ⇒ **我们的闸门**。
 *
 * ## 口径不变：「新增放行、修改要点头」
 *
 * 判定住在**我们的命令定义**这边（`core/gate/gate.ts` 的 `requiresConfirmation`：
 * `update_` / `patch_` 要点头）⇒ dsh 只是**执行点**（它的一问一答审批缝）。
 *
 * ⚠️ **决策只有一份**（`core/gate/decision.ts` ⇒ 与宿主无关）⇒
 *    这里只做「把结论翻译成 dsh 的 outcome」。
 *
 * ## 往返
 *
 * ```
 * dsh 运行时 ──approval/request──▶ 我们的适配层
 *                                  ├─ 算口径（要不要问）· 收窄参数 · 建待确认
 *                                  ├─ 推 SSE `pending`（前端「待确认」页签）
 *                                  ├─ 等人（approve / reject 端点 ⇒ pendingWaiters）
 *                                  └─ 回 outcome：allowed-once / rejected / cancelled
 * ```
 *
 * ⚠️ **没有回答者 ⇒ 不放行**（fail closed，与今天一致）。
 */

import {
	type ContextAnchor,
	type WriteToolRule,
} from "../../context/anchor.ts";
import { requiresConfirmation } from "../../gate/gate.ts";
import { decideWrite } from "../../gate/decision.ts";
import { bareToolName } from "../../mcp/tool-names.ts";
import type { PendingWaiterRegistry } from "../../gate/pending-waiters.ts";
import { DSH_APPROVAL_OUTCOMES, type DshApprovalOutcome, type DshApprovalRequest } from "./protocol.ts";

/** 闸门要的上下文（每个会话一份）。 */
export interface DshGateContext {
	/** 这个对话的 id。 */
	conversationId: string;
	/** 发起人的 id。 */
	userId: string;
	/** 当前讨论的锚点（**没有就是 undefined** ⇒ 不收窄字段）。 */
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
	timeoutMs: number;
	/** 取这次工具调用的参数（**按 callId 关联 `tool/call` 事件**）。 */
	argsOf: (callId: string | undefined) => Record<string, unknown> | undefined;
	// 决策落地了（**人做的决定**）⇒ 回报给留痕层（审计 + 事件日志）。
	// ⚠️ 不给 ⇒ 不留痕（**留痕失败不许影响放行 / 拒绝**）。
	onDecision?: ((input: {
		command: string;
		args: Record<string, unknown>;
		decision: "approved" | "rejected";
	}) => void) | undefined;
}

// 处理一次审批请求 ⇒ 给出结果。
// @param request dsh 发来的审批请求。
// @param context 闸门上下文。
export async function decideApproval(
	request: DshApprovalRequest,
	context: DshGateContext,
): Promise<DshApprovalOutcome> {
	const command = bareToolName(request.toolName);
	// ⚠️ **口径**：`update_` / `patch_` 要点头，其余放行。
	//    （dsh 侧只对「我们标了 confirm」的工具问 ⇒ 这里再判一次是双保险。）
	if (!requiresConfirmation(command)) {
		return DSH_APPROVAL_OUTCOMES.ALLOWED_ONCE;
	}

	const anchor = context.anchor ?? null;
	const rules = context.writeRules ?? [];

	// ⚠️ **参数从 `tool/call` 事件里取**（审批载荷里没有参数 ⇒ 靠 callId 关联）。
	const input = context.argsOf(request.callId) ?? {};

	// ⚠️ **决策只有一份**（`core/gate/decision.ts`）⇒ 这里只翻译结论。
	const decision = await decideWrite(
		{ toolName: command, args: input },
		{
			conversationId: context.conversationId,
			userId: context.userId,
			anchor: anchor ?? undefined,
			writeRules: rules,
			onPending: context.onPending,
			waiters: context.waiters,
			createPending: context.createPending,
			timeoutMs: context.timeoutMs,
		},
	);

	// ⚠️ **留痕**（**人做的决定**）⇒ 审计 + 事件日志。
	//    只有真的问过人（建过待确认）才留痕（被规则拦下的不算人的决定）。
	//    失败不许影响放行 / 拒绝 ⇒ 外面包一层。
	if (decision.asked) {
		try {
			context.onDecision?.({
				command: decision.command,
				args: decision.args,
				decision: decision.kind === "allow" ? "approved" : "rejected",
			});
		} catch (error) {
			console.error("[dsh] 闸门决策留痕失败（不影响放行 / 拒绝）", error);
		}
	}
	if (decision.kind === "allow") {
		return DSH_APPROVAL_OUTCOMES.ALLOWED_ONCE;
	}
	return DSH_APPROVAL_OUTCOMES.REJECTED;
}
