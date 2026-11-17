/**
 * 帧缓冲 —— SSE 的**回放窗口**。
 *
 * 客户端可能在事件发生之后才连上来（刷新页面、换标签页）。
 * 缓冲里留着最近的帧，连上来时先补发，再接增量。
 *
 * ## 为什么要设上限
 *
 * 缓冲是**进程内存**，一个长对话能把内存吃光 ⇒ 设字节上限（默认 16 MB）。
 * 超限时**优先丢「可重建」的帧**（`text_delta` —— 文本增量可以从
 * `GET /api/agent/:cid/state` 的快照重建），**保留结构帧**
 * （`tool_call` / `tool_result` / `agent_settled` —— 这些是「发生了什么」的事实，
 * 丢了就真的丢了）。
 *
 * 「快照才是真相」这条规则让丢增量变得安全：客户端随时能用 state 补齐。
 */

/** 缓冲里的一帧。 */
export interface StreamFrame {
	/** 事件名（`text_delta` / `tool_call` / …）。 */
	event: string;
	/** 载荷（已序列化的 JSON 字符串）。 */
	data: string;
	/** 这一帧是不是「可重建的」（可重建 ⇒ 超限时优先丢）。 */
	rebuildable: boolean;
	/** 这帧占多少字节（含事件名与序列化后的载荷）。 */
	bytes: number;
	/**
	 * 帧的序号（缓冲内单调递增）。
	 *
	 * 用途：SSE 连接建立时先给「回放快照」，再接增量流。
	 * 用序号去重 ⇒ **既不重复也不漏**（快照与增量之间那几帧正好被序号盖住）。
	 */
	seq: number;
}

/** 默认上限：16 MB。 */
export const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export interface FrameBufferOptions {
	/** 字节上限（默认 16 MB）。 */
	maxBytes?: number;
}

/** 帧的字节数（事件名 + 载荷 + 换行等开销，粗算即可）。 */
function frameBytes(event: string, data: string): number {
	// SSE 一帧的线上开销：`event: x\n` + `data: …\n` + 空行
	return event.length + data.length + 16;
}

export class FrameBuffer {
	readonly #maxBytes: number;
	readonly #frames: StreamFrame[] = [];
	#bytes = 0;
	#nextSeq = 1;

	constructor(options: FrameBufferOptions = {}) {
		this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	}

	/** 当前占用的字节数。 */
	get byteSize(): number {
		return this.#bytes;
	}

	/** 当前缓冲的帧数。 */
	get size(): number {
		return this.#frames.length;
	}

	/** 塞一帧进去（超限就按规则淘汰）。 */
	push(frame: { event: string; data: string; rebuildable: boolean }): StreamFrame {
		const stored: StreamFrame = {
			event: frame.event,
			data: frame.data,
			rebuildable: frame.rebuildable,
			bytes: frameBytes(frame.event, frame.data),
			seq: this.#nextSeq,
		};
		this.#nextSeq += 1;
		this.#frames.push(stored);
		this.#bytes += stored.bytes;
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

	/**
	 * 淘汰：超限时**先丢可重建的帧**（最老的先丢），
	 * 还是超限才丢结构帧（最老的先丢）。
	 *
	 * ⚠️ 最后一轮可能把结构帧也丢光 —— 这是刻意的：
	 * **内存上限是硬约束**，宁可少回放，也不让进程被撑爆。
	 */
	#evict(): void {
		if (this.#bytes <= this.#maxBytes) {
			return;
		}
		// 第一轮：只丢可重建的帧
		for (let index = 0; index < this.#frames.length && this.#bytes > this.#maxBytes; ) {
			const frame = this.#frames[index];
			if (frame === undefined || !frame.rebuildable) {
				index += 1;
				continue;
			}
			this.#frames.splice(index, 1);
			this.#bytes -= frame.bytes;
		}
		// 第二轮：还是超限 ⇒ 连结构帧也丢（从最老的开始）
		while (this.#bytes > this.#maxBytes && this.#frames.length > 0) {
			const frame = this.#frames.shift();
			if (frame !== undefined) {
				this.#bytes -= frame.bytes;
			}
		}
	}
}
