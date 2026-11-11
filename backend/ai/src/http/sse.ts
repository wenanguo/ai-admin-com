/**
 * SSE（Server-Sent Events）—— 服务端推事件。
 *
 * 帧格式（标准）：
 * ```
 * event: text_delta
 * data: {"conversationId":"...","delta":"你"}
 *
 * ```
 * （`event:` 行给出事件名，`data:` 行给出 JSON 载荷，最后一个空行表示帧结束。）
 */

import { isRebuildable } from "../agent/events.ts";
import type { StreamFrame } from "../agent/frame-buffer.ts";

/** SSE 响应头。 */
export const SSE_HEADERS: Record<string, string> = {
	"Content-Type": "text/event-stream; charset=utf-8",
	// 不缓存、不转码（不转码很重要：代理可能把流压成一块）
	"Cache-Control": "no-cache, no-transform",
	Connection: "keep-alive",
	// 防 nginx 缓冲（尖峰实测：不加这个头可能被代理攒着一起发）
	"X-Accel-Buffering": "no",
};

/**
 * 拼一帧。
 *
 * @param event 事件名。
 * @param payload 载荷（会被 JSON 序列化）。
 */
export function sseFrame(event: string, payload: unknown): string {
	return `event: ${event}\ndata: ${safeJson(payload)}\n\n`;
}

/**
 * 拼一帧**注释**（心跳）。
 *
 * 注释行以 `:` 开头，EventSource 会直接忽略 ⇒ 不会污染前端的事件命名空间，
 * 但能证明连接还活着（也能让代理别把连接判成空闲超时）。
 */
export function sseComment(text: string): string {
	return `: ${text}\n\n`;
}

/** JSON 序列化；序列化不了就退化成一段说明（绝不让一帧把整条流搞挂）。 */
function safeJson(payload: unknown): string {
	try {
		return JSON.stringify(payload) ?? "null";
	} catch {
		return JSON.stringify({ error: "载荷无法序列化" });
	}
}

/**
 * 把「事件 + 载荷」变成缓冲里的一帧。
 *
 * @param event 事件名。
 * @param payload 载荷。
 */
export function buildFrame(event: string, payload: unknown): {
	event: string;
	data: string;
	rebuildable: boolean;
} {
	return {
		event,
		data: safeJson(payload),
		rebuildable: isRebuildable(event),
	};
}

/** 缓冲里的一帧 ⇒ 线上的 SSE 文本。 */
export function frameToSse(frame: StreamFrame): string {
	return `event: ${frame.event}\ndata: ${frame.data}\n\n`;
}
