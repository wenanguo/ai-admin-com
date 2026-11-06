/**
 * pi 事件 → SSE 事件的映射。
 *
 * pi 的事件序列（尖峰实测）：
 * `agent_start` → `turn_start` → `message_start` → `message_update`* →
 * `message_end` → `tool_execution_start` → `tool_execution_end` → … →
 * `turn_end` → `agent_end` → `agent_settled`
 *
 * 前端只认七种事件（见 `events.ts`），所以这里做一次收敛：
 * - `message_update` 只留 `text_delta` 与 `thinking_delta`
 *   （其它子事件不对前端有意义）；
 * - 助手的消息才发 `message_start` / `message_end`（用户那条不回显）；
 * - `agent_start` / `turn_*` / `agent_end` 不外发（对前端没意义）。
 *
 * ## 为什么 `message_start` 要「等有文本才发」
 *
 * 模型的第一轮常常**只带工具调用、没有正文**。那时候就发 `message_start` + `message_end`
 * （正文为空），前端会多出一个空气泡。
 * ⇒ `message_start` 推迟到**第一条文本增量**到来时才发；
 * 整轮都没有正文 ⇒ 这一轮一个气泡都不开。
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { SSE_EVENTS, type SseEventName, type SsePayload } from "./events";

/** 映射结果。 */
export interface MappedEvent {
	event: SseEventName;
	payload: SsePayload;
}

/** 未知形状的对象 → 记录（不是对象就 undefined）。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

/** 这条消息是不是助手说的？ */
export function isAssistantMessage(message: unknown): boolean {
	return asRecord(message)?.["role"] === "assistant";
}

/** 助手消息里的文本（把多个 text 段拼起来）。 */
export function extractAssistantText(message: unknown): string {
	const content = asRecord(message)?.["content"];
	if (!Array.isArray(content)) {
		return "";
	}
	const parts: string[] = [];
	for (const item of content) {
		const part = asRecord(item);
		if (part?.["type"] !== "text") {
			continue;
		}
		const text = part["text"];
		if (typeof text === "string") {
			parts.push(text);
		}
	}
	return parts.join("");
}

/** 工具结果里的一句话结论。 */
export function summarizeToolResult(result: unknown, toolName: string): string {
	const details = asRecord(asRecord(result)?.["details"]);
	const summary = details?.["summary"];
	if (typeof summary === "string" && summary.length > 0) {
		return summary;
	}
	// 退而求其次：把工具回给模型的第一段文本拿来当结论
	const content = asRecord(result)?.["content"];
	if (Array.isArray(content)) {
		for (const item of content) {
			const part = asRecord(item);
			if (
				part?.["type"] === "text" &&
				typeof part["text"] === "string" &&
				part["text"].length > 0
			) {
				return part["text"];
			}
		}
	}
	return `工具 ${toolName} 执行完成`;
}

/**
 * 事件映射器（**每个会话一个** —— 它要记住「这一轮助手消息开过头没有」）。
 */
export class AgentEventMapper {
	/** 这一轮助手消息是否已经发过 `message_start`。 */
	#messageStarted = false;

	/**
	 * 把一个 pi 事件映射成若干个 SSE 事件。
	 *
	 * @returns 不用外发的事件返回空数组。
	 */
	map(conversationId: string, event: AgentSessionEvent): MappedEvent[] {
		const frames: MappedEvent[] = [];
		switch (event.type) {
			case "message_start": {
				// 不在这里发：等真的有文本增量时再开泡（见文件头的说明）
				this.#messageStarted = false;
				break;
			}
			case "message_update": {
				const inner = event.assistantMessageEvent;
				if (inner.type === "thinking_delta") {
					// ⚠️ 思考增量**不开泡**：思考不是「助手说的话」，
					//    只是「它还在想」⇒ 前端自己显示「思考中…」。
					frames.push({
						event: SSE_EVENTS.THINKING_DELTA,
						payload: { conversationId, delta: inner.delta },
					});
					break;
				}
				if (inner.type !== "text_delta") {
					break;
				}
				if (!this.#messageStarted) {
					this.#messageStarted = true;
					frames.push({
						event: SSE_EVENTS.MESSAGE_START,
						payload: { conversationId, role: "assistant" },
					});
				}
				frames.push({
					event: SSE_EVENTS.TEXT_DELTA,
					payload: { conversationId, delta: inner.delta },
				});
				break;
			}
			case "message_end": {
				if (!isAssistantMessage(event.message)) {
					break;
				}
				const text = extractAssistantText(event.message);
				if (!this.#messageStarted) {
					// 没有增量但有正文（供应商没走流式）⇒ 补一次开始
					if (text.length === 0) {
						break;
					}
					this.#messageStarted = true;
					frames.push({
						event: SSE_EVENTS.MESSAGE_START,
						payload: { conversationId, role: "assistant" },
					});
				}
				frames.push({
					event: SSE_EVENTS.MESSAGE_END,
					payload: { conversationId, text },
				});
				this.#messageStarted = false;
				break;
			}
			case "tool_execution_start": {
				frames.push({
					event: SSE_EVENTS.TOOL_CALL,
					payload: { conversationId, toolName: event.toolName, args: event.args },
				});
				break;
			}
			case "tool_execution_end": {
				const result: unknown = event.result;
				frames.push({
					event: SSE_EVENTS.TOOL_RESULT,
					payload: {
						conversationId,
						toolName: event.toolName,
						status: event.isError ? "error" : "ok",
						summary: summarizeToolResult(result, event.toolName),
						details: asRecord(result)?.["details"],
					},
				});
				break;
			}
			case "agent_settled": {
				frames.push({
					event: SSE_EVENTS.AGENT_SETTLED,
					payload: { conversationId },
				});
				break;
			}
			default: {
				break;
			}
		}
		return frames;
	}
}
