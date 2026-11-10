/**
 * SSE 事件 —— **前端按这几种写**，别多也别少。
 *
 * 载荷里都带 `conversationId`：一个页面可能同时开多个会话的流，
 * 客户端靠它把事件分派到对应的气泡。
 */

/** 事件名。 */
export const SSE_EVENTS = {
	/** 连接建立（第一帧）。 */
	CONNECTED: "connected",
	/** 助手开始说话。 */
	MESSAGE_START: "message_start",
	/** 增量文本。 */
	TEXT_DELTA: "text_delta",
	/**
	 * 思考增量（模型的「心里话」）。
	 *
	 * ⚠️ **默认不外发**（思考级别默认 `off` ⇒ 服务端压根不会产生它）。
	 *    开了思考才会发 ⇒ 前端要能展示「思考中…」，否则界面就是卡住。
	 */
	THINKING_DELTA: "thinking_delta",
	/** 一条助手消息结束（带完整文本）。 */
	MESSAGE_END: "message_end",
	/** 模型要调工具了。 */
	TOOL_CALL: "tool_call",
	/** 工具执行完了。 */
	TOOL_RESULT: "tool_result",
	/** 一轮结束，模型闲置了。 */
	AGENT_SETTLED: "agent_settled",
	/**
	 * **挂起中**：模型想改已有数据，等人点头。
	 *
	 * ⚠️ 这是**我们自己**发的事件（不是 pi 的）⇒ 与 pi 事件分开。
	 *    前端拿到它 ⇒ 「待确认」页签出现一条，界面上显示「等待确认」。
	 */
	PENDING: "pending",
	/**
	 * **写回成功**：AI 真的改了某条任务。
	 *
	 * ⚠️ 这是**我们自己**发的事件（不是 pi 的）⇒ 前端拿到它就把
	 *    左边的列表/看板/甘特刷新一遍，并把那一条高亮一下
	 *    （否则用户不知道写回落到哪一行了）。
	 */
	ENTITY_UPDATED: "entity_updated",
} as const;

/** 事件名的联合类型。 */
export type SseEventName = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];

/**
 * 哪些事件是「**可重建**」的。
 *
 * 可重建 = 客户端能用 `GET /api/agent/:cid/state` 的快照补回来。
 * 回放缓冲超限时**优先丢这些**（见 `frame-buffer.ts`）。
 */
const REBUILDABLE_EVENTS: ReadonlySet<string> = new Set<string>([SSE_EVENTS.TEXT_DELTA]);

/** 这个事件是不是可重建的。 */
export function isRebuildable(event: string): boolean {
	return REBUILDABLE_EVENTS.has(event);
}

/** `connected` 的载荷。 */
export interface ConnectedPayload {
	conversationId: string;
	isStreaming: boolean;
}

/** `message_start` 的载荷。 */
export interface MessageStartPayload {
	conversationId: string;
	role: "assistant";
}

/** `text_delta` 的载荷。 */
export interface TextDeltaPayload {
	conversationId: string;
	delta: string;
}

/** `thinking_delta` 的载荷。 */
export interface ThinkingDeltaPayload {
	conversationId: string;
	delta: string;
}

/** `message_end` 的载荷。 */
export interface MessageEndPayload {
	conversationId: string;
	text: string;
	/** 失败时才有：这一轮出错的原因。 */
	error?: string;
}

/** `tool_call` 的载荷。 */
export interface ToolCallPayload {
	conversationId: string;
	toolName: string;
	args: unknown;
}

/** `tool_result` 的载荷。 */
export interface ToolResultPayload {
	conversationId: string;
	toolName: string;
	status: "ok" | "error";
	summary: string;
	details?: unknown;
}

/** `agent_settled` 的载荷。 */
export interface AgentSettledPayload {
	conversationId: string;
}

/** `pending` 的载荷（挂起等人点头）。 */
export interface PendingPayload {
	conversationId: string;
	/** 待确认行的 id（批准/拒绝时用它）。 */
	id: string;
	/** 命令（工具）名。 */
	command: string;
	/** 参数（原样透出，给界面显示）。 */
	args: Record<string, unknown>;
}

/** `entity_updated` 的载荷（写回成功）。 */
export interface EntityUpdatedPayload {
	conversationId: string;
	/** 实体类型（现在只有任务）。 */
	entityType: "task";
	/** 实体的 id（前端拿它高亮那一行）。 */
	entityId: number;
	/** 被改的字段名（前端可以顺带提示「状态已改为完成」）。 */
	fields: string[];
}

/** 载荷的联合类型。 */
export type SsePayload =
	| ConnectedPayload
	| MessageStartPayload
	| TextDeltaPayload
	| ThinkingDeltaPayload
	| MessageEndPayload
	| ToolCallPayload
	| ToolResultPayload
	| AgentSettledPayload
	| PendingPayload
	| EntityUpdatedPayload;
