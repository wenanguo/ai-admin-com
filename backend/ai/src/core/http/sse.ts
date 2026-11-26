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

import { isRebuildable } from "../session/events.ts";

// 缓冲里的一帧（**SSE 的一帧**）。
// ⚠️ **序号（`seq`）是回放的关键**：SSE 连接建立时先给「回放快照」，再接增量流
//    ⇒ 用序号去重 ⇒ **既不重复也不漏**（快照与增量之间那几帧正好被序号盖住）。
export interface StreamFrame {
	/** 事件名（`text_delta` / `tool_call` / …）。 */
	event: string;
	/** 载荷（已序列化的 JSON 字符串）。 */
	data: string;
	/** 这一帧是不是「可重建的」（可重建 ⇒ 超限时优先丢）。 */
	rebuildable: boolean;
	/** 帧的序号（缓冲内单调递增）。 */
	seq: number;
}

/** SSE 响应头。 */
export const SSE_HEADERS: Record<string, string> = {
	"Content-Type": "text/event-stream; charset=utf-8",
	// 不缓存、不转码（不转码很重要：代理可能把流压成一块）
	"Cache-Control": "no-cache, no-transform",
	Connection: "keep-alive",
	// 防 nginx 缓冲（尖峰实测：不加这个头可能被代理攒着一起发）
	"X-Accel-Buffering": "no",
};

// 拼一帧。
// @param event 事件名。
// @param payload 载荷（会被 JSON 序列化）。
export function sseFrame(event: string, payload: unknown): string {
	return `event: ${event}\ndata: ${safeJson(payload)}\n\n`;
}

// 拼一帧**注释**（心跳）。
// 注释行以 `:` 开头，EventSource 会直接忽略 ⇒ 不会污染前端的事件命名空间，
// 但能证明连接还活着（也能让代理别把连接判成空闲超时）。
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

// 把「事件 + 载荷」变成缓冲里的一帧。
// @param event 事件名。
// @param payload 载荷。
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

/* ------------------------------------------------------------------ *
 * 回放窗口 —— SSE 的**补发缓冲**（客户端晚连上 ⇒ 先补发这些帧）
 * ------------------------------------------------------------------ */

// ## 为什么它在我们这边（issue #175 · S4）
// **我们的 SSE 帧 ≠ dsh 的事件**（帧里混着我们自己的事：`pending` / `entity_updated`）
// ⇒ 「从 dsh 的持久化重放」会**改掉帧的字节序** ⇒ 违反「SSE 事件名与顺序一字不变」。
// ⇒ 补发缓冲留在**内核这一侧**（只管「晚连上的那几秒」⇒ 不长胖）。
// ## 两条规矩
// - **上限是硬约束**（进程内存）⇒ 超限时**先丢可重建的帧**（`text_delta` ——
//   文本增量能用 `GET /api/agent/:cid/state` 的快照重建），**再丢结构帧**
//   （`tool_call` / `tool_result` / `agent_settled` —— 这些是「发生了什么」的事实）。
// - **序号单调递增** ⇒ 回放快照与增量流之间**不重不漏**（订阅者按 `seq` 去重）。

/** 回放窗口的默认上限：16 MB。 */
const DEFAULT_MAX_BACKLOG_BYTES = 16 * 1024 * 1024;

/** 回放窗口。 */
export class ReplayWindow {
	readonly #frames: StreamFrame[] = [];
	readonly #maxBytes: number;
	#bytes = 0;
	#nextSeq = 1;

	constructor(maxBytes: number = DEFAULT_MAX_BACKLOG_BYTES) {
		this.#maxBytes = maxBytes;
	}

	/** 当前占用的字节数。 */
	get byteSize(): number {
		return this.#bytes;
	}

	/** 塞一帧进去（超限就按规则淘汰）。 */
	push(frame: { event: string; data: string; rebuildable: boolean }): StreamFrame {
		const stored: StreamFrame = { ...frame, seq: this.#nextSeq };
		this.#nextSeq += 1;
		this.#frames.push(stored);
		this.#bytes += frameBytes(stored);
		this.#evict();
		return stored;
	}

	/** 缓冲里的帧（按时间顺序）。 */
	list(): StreamFrame[] {
		return [...this.#frames];
	}

	/** 清空。 */
	clear(): void {
		this.#frames.length = 0;
		this.#bytes = 0;
	}

	// 淘汰：超限时**先丢可重建的帧**（最老的先丢），还是超限才丢结构帧（最老的先丢）。
	// ⚠️ 最后一轮可能把结构帧也丢光 —— 这是刻意的：
	//    **内存上限是硬约束**，宁可少回放，也不让进程被撑爆。
	#evict(): void {
		if (this.#bytes <= this.#maxBytes) {
			return;
		}
		for (let index = 0; index < this.#frames.length && this.#bytes > this.#maxBytes; ) {
			const frame = this.#frames[index];
			if (frame === undefined || !frame.rebuildable) {
				index += 1;
				continue;
			}
			this.#frames.splice(index, 1);
			this.#bytes -= frameBytes(frame);
		}
		while (this.#bytes > this.#maxBytes && this.#frames.length > 0) {
			const frame = this.#frames.shift();
			if (frame !== undefined) {
				this.#bytes -= frameBytes(frame);
			}
		}
	}
}

/** 帧的字节数（事件名 + 载荷 + SSE 的线上开销，粗算即可）。 */
function frameBytes(frame: { event: string; data: string }): number {
	// SSE 一帧的线上开销：`event: x\n` + `data: …\n` + 空行
	return frame.event.length + frame.data.length + 16;
}
