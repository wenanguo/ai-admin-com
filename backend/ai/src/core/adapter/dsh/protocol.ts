/**
 * dsh 的**线协议词汇**（我们自己写的，不 import dsh 的类型）。
 *
 * ## 为什么自己写
 *
 * spec §7 的「类型边界」：dsh 是 RC ⇒ 它的 API 会变。
 * ⇒ 我们在适配层里**只认 JSON 形状**（自己声明类型）⇒
 * **dsh 升级不会引起我们的编译错误**，差异只在适配层里显式可见。
 *
 * ⚠️ 这里的类型都是**结构化 JSON**（可序列化）⇒ 跨层只传 JSON（spec §7 第三层防线）。
 */

/** dsh 的**持久事件名**（我们关心的那几种；其余事件内部用，不外发）。 */
export const DSH_EVENTS = {
	/** 助手的一条消息（含模型流）。 */
	ASSISTANT_MESSAGE: "assistant/message",
	/** 模型要调工具了。 */
	TOOL_CALL: "tool/call",
	/** 工具执行完了。 */
	TOOL_RESULT: "tool/result",
	/** 一轮结束。 */
	TURN_END: "turn/end",
	/** 审批问了（dsh 的审计事件；**我们的 pending 事件另发**）。 */
	APPROVAL_ASKED: "approval/asked",
	/** 审批有结果了。 */
	APPROVAL_DECIDED: "approval/decided",
} as const;

/** dsh 事件名。 */
export type DshEventName = (typeof DSH_EVENTS)[keyof typeof DSH_EVENTS];

// 一条 dsh 会话事件（**我们自己声明的形状**）。
// ⚠️ `data` 是 `unknown` ⇒ 适配层里按需解析（不假设 dsh 的内部模型）。
export interface DshSessionEvent {
	/** 事件名（如 `assistant/message`）。 */
	type: string;
	/** 事件数据（形状随事件而变 ⇒ 交给映射层解析）。 */
	data?: unknown;
}

/** dsh 的**审批结果**词汇（一问一答 ⇒ 四个值）。 */
export const DSH_APPROVAL_OUTCOMES = {
	/** 放行这一次。 */
	ALLOWED_ONCE: "allowed-once",
	/** 人拒绝了。 */
	REJECTED: "rejected",
	/** 问的过程中被撤了。 */
	CANCELLED: "cancelled",
} as const;

/** dsh 的审批结果。 */
export type DshApprovalOutcome =
	(typeof DSH_APPROVAL_OUTCOMES)[keyof typeof DSH_APPROVAL_OUTCOMES];

// 运行时向宿主（= 我们的服务）问的一次审批。
// ⚠️ **载荷里没有工具参数**（只有 `sessionId` / `toolName` / `callId?` / `reason?`）
//    ⇒ 参数靠 `callId` 关联 `tool/call` 事件（见 `events.ts` 的缓存）。
export interface DshApprovalRequest {
	/** 会话 id。 */
	sessionId: string;
	/** 要放行哪个工具。 */
	toolName: string;
	/** 这次工具调用的 id（**有它才能拿到参数**）。 */
	callId?: string;
	/** 问的理由（人话）。 */
	reason?: string;
}

/** 未知形状的对象 → 记录（不是对象就 undefined）。 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

/** 记录里的字符串字段（不是字符串就 undefined）。 */
export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
