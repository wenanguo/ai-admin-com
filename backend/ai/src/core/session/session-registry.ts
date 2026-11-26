/**
 * 会话注册表 —— 一个 `conversationId` 对应一个「通道」。
 *
 * 通道里挂着四样东西：
 * 1. **SSE 订阅者**（每个连上来的客户端一个）；
 * 2. **回放窗口**（后连上来的客户端先补发这些帧）；
 * 3. **调用方的 token**（⚠️ **只在内存**，绝不落盘、绝不进日志）；
 * 4. **dsh 会话**（懒创建：第一次有命令时才建）。
 *
 * ## 为什么不漏
 *
 * - 通道数有上限（默认 64）：超了就把**最久没用**的那个关掉（连同它的 dsh 会话）；
 * - 空闲超过 TTL（默认 30 分钟）的通道会被清掉；
 * - `close()` 显式关掉一个会话（会话被删、用户点了「结束对话」时用）。
 *
 * ## ⚠️ 为什么**没有**用 dsh 的会话注册表（issue #169 · S4）
 *
 * dsh 的注册表住在**运行时子进程**里 ⇒ 我们的 HTTP 层**订阅不到**
 * ⇒ 订阅者 / 回放窗口 / token 这些**进程内的事实**只能自己管。
 * ⇒ 真正归位的是「**我们不再自己实现会话机制**」：
 *    会话怎么跑、事件怎么来 ⇒ 全在 dsh 那一侧（我们只做翻译）。
 */

import type { AgentEvent } from "./agent-event.ts";
import type { ContextAnchor, WriteToolRule } from "../context/anchor.ts";
import type { StreamFrame } from "../http/sse.ts";

/** SSE 订阅者：收到一帧就被叫一次。 */
export type ChannelSubscriber = (frame: StreamFrame) => void;

/**
 * dsh 会话的**最小接口**（真实现是 `core/adapter/dsh/session.ts`；测试可注入假实现）。
 */
export interface AgentSessionLike {
	/** 发起一轮对话。 */
	prompt(
		text: string,
		options?: { expandPromptTemplates?: boolean; streamingBehavior?: "steer" | "followUp" },
	): Promise<void>;
	/** 订阅事件；返回退订函数。 */
	subscribe(listener: (event: AgentEvent) => void): () => void;
	/** 释放会话。 */
	dispose(): void;
	/** 正在流式输出？ */
	readonly isStreaming: boolean;
	/**
	 * 排到当前轮**之后**（不打断）：当前 run 干完活就处理它。
	 *
	 * ⚠️ 这是 dsh 的原生排队语义 ⇒ 自己造队列只能做到「等整轮跑完」，做不到「插进去」。
	 */
	followUp?(text: string): Promise<"queued" | "handled">;
	/**
	 * **打断**当前轮：插到当前助手轮次（及其工具调用）之后、下一次模型调用之前。
	 */
	steer?(text: string): Promise<"queued" | "handled">;
	/** 停掉当前正在跑的操作（用户点「停止」）。 */
	abort?(): Promise<void>;
}

/** 一个会话通道。 */
export interface ConversationChannel {
	/** 会话 id。 */
	readonly conversationId: string;
	/** SSE 订阅者。 */
	readonly subscribers: Set<ChannelSubscriber>;
	/** 回放窗口（后连上来的客户端先补发这些帧）。 */
	readonly backlog: ReplayWindow;
	/** 调用方的 token（**只在内存**；刷新命令时会被新的 token 覆盖）。 */
	token: string | undefined;
	/**
	 * 当前登录用户的 id（**只在内存**）。
	 *
	 * ⚠️ 写审计要记「谁干的」⇒ 这里存一下（运行时 submitCommand 时写进去）。
	 */
	userId: string | undefined;
	/**
	 * 当前讨论的**锚点**（**只在内存**）。
	 *
	 * ⚠️ 每次带上下文的消息都会覆盖它 ⇒ 它表示「**此刻**在聊哪条东西」。
	 *    没有上下文的对话（用户没点「与 AI 讨论」）⇒ 它是 undefined。
	 */
	anchor: ContextAnchor | undefined;
	/**
	 * 这个会话的**写规则**（**插件给的** ⇒ 闸门不写死工具名/字段名）。
	 *
	 * ⚠️ 建会话时按**这个智能体的插件**取 ⇒ 与锚点来自同一个插件。
	 */
	writeRules: readonly WriteToolRule[] | undefined;
	/**
	 * 最近一次**写操作**（工具开始执行时记下，成功后用来发 entity_updated）。
	 */
	lastWrite: { toolName: string; entityId: number; fields: string[] } | undefined;
	/**
	 * 最近一次**MCP 写操作**的参数（用来写审计行）。
	 *
	 * ⚠️ MCP 的写（update_task / patch_task_status）**不走**我们自己的工具
	 *    ⇒ 不写审计就没人知道「这条任务是谁改的」⇒ 这里记一份。
	 */
	lastMcpWrite:
		| { toolName: string; args: Record<string, unknown> }
		| undefined;
	/** dsh 会话（懒创建）。 */
	session: AgentSessionLike | undefined;
	/**
	 * 这个会话用到的 **MCP 工具名前缀**（`mcp__<server>__`）。
	 *
	 * ⚠️ **按已知的服务器名算**（不是正则猜）⇒ 多服务器 / 名字带连字符都不会认错。
	 * ⚠️ 会话建起来时才知道（那时才知道挂了哪些服务器）⇒ 之前是空的。
	 */
	mcpPrefixes: string[];
	/** 退订函数（关会话时调用）。 */
	unsubscribe: (() => void) | undefined;
	/** 正在流式输出？ */
	isStreaming: boolean;
	/** 通道被关掉了？（SSE 写循环看到它就收摊）。 */
	ended: boolean;
	/** 最后一次被使用的时间（毫秒）。 */
	lastUsedAt: number;
	/** 分配消息序号（进程内单调递增）。 */
	allocateSeq(initial: number): number;
}

/** 回放窗口的默认上限：16 MB。 */
const DEFAULT_MAX_BACKLOG_BYTES = 16 * 1024 * 1024;

/**
 * 回放窗口 —— SSE 的**补发缓冲**（客户端晚连上 ⇒ 先补发这些帧）。
 *
 * ## 为什么还有它（issue #169 · S4）
 *
 * ⚠️ **我们的 SSE 帧 ≠ dsh 的事件**（帧里混着我们自己的事：pending / entity_updated）
 *    ⇒ 「从 dsh 的持久化重放」会**改掉帧的字节序** ⇒ 违反「SSE 事件名与顺序一字不变」。
 * ⇒ 这里保留一个**小的内存窗口**（**不再单起一个文件**）⇒ 行为一字不变。
 *
 * ## 两条规矩
 *
 * - **上限是硬约束**（进程内存）⇒ 超限时**先丢可重建的帧**（`text_delta` ——
 *   文本增量能用 `GET /api/agent/:cid/state` 的快照重建），**再丢结构帧**
 *   （`tool_call` / `tool_result` / `agent_settled` —— 这些是「发生了什么」的事实）。
 * - **序号单调递增** ⇒ 回放快照与增量流之间**不重不漏**（订阅者按 `seq` 去重）。
 */
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

	/**
	 * 淘汰：超限时**先丢可重建的帧**（最老的先丢），还是超限才丢结构帧（最老的先丢）。
	 *
	 * ⚠️ 最后一轮可能把结构帧也丢光 —— 这是刻意的：
	 *    **内存上限是硬约束**，宁可少回放，也不让进程被撑爆。
	 */
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

/** 默认最多同时留多少个通道。 */
const DEFAULT_MAX_CHANNELS = 64;

/** 空闲多久就回收（毫秒）。 */
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;

export interface SessionRegistryOptions {
	/** 通道数上限。 */
	maxChannels?: number;
	/** 空闲回收时间（毫秒）。 */
	idleTtlMs?: number;
}

export class SessionRegistry {
	readonly #channels = new Map<string, ConversationChannel>();
	readonly #maxChannels: number;
	readonly #idleTtlMs: number;

	constructor(options: SessionRegistryOptions = {}) {
		this.#maxChannels = options.maxChannels ?? DEFAULT_MAX_CHANNELS;
		this.#idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
	}

	/** 当前通道数。 */
	get size(): number {
		return this.#channels.size;
	}

	/** 取通道；没有返回 undefined。 */
	get(conversationId: string): ConversationChannel | undefined {
		const channel = this.#channels.get(conversationId);
		if (channel === undefined) {
			return undefined;
		}
		channel.lastUsedAt = Date.now();
		return channel;
	}

	/** 取通道；没有就建一个。 */
	ensure(conversationId: string): ConversationChannel {
		const existing = this.get(conversationId);
		if (existing !== undefined) {
			return existing;
		}
		// 消息序号状态（进程内；通道关掉就一起没了）
		let nextSeq: number | undefined;
		const channel: ConversationChannel = {
			conversationId,
			subscribers: new Set<ChannelSubscriber>(),
			backlog: new ReplayWindow(),
			token: undefined,
			userId: undefined,
			anchor: undefined,
			writeRules: undefined,
			lastWrite: undefined,
			lastMcpWrite: undefined,
			session: undefined,
			mcpPrefixes: [],
			unsubscribe: undefined,
			isStreaming: false,
			ended: false,
			lastUsedAt: Date.now(),
			allocateSeq: (initial: number) => {
				const value = nextSeq ?? initial + 1;
				nextSeq = value + 1;
				return value;
			},
		};
		this.#channels.set(conversationId, channel);
		this.#sweepIdle();
		this.#evictIfNeeded();
		return channel;
	}

	/** 订阅一个通道；返回退订函数。 */
	subscribe(conversationId: string, subscriber: ChannelSubscriber): () => void {
		const channel = this.ensure(conversationId);
		channel.subscribers.add(subscriber);
		return () => {
			channel.subscribers.delete(subscriber);
		};
	}

	/**
	 * 发布一帧：进回放窗口 + 送给所有订阅者。
	 *
	 * 送出去的是**缓冲里存下来的那一帧**（带序号）——
	 * 订阅者靠序号判断「这帧是不是已经在回放快照里了」。
	 *
	 * 一个订阅者抛错**不影响**其它订阅者（也不影响发布方）。
	 */
	publish(channel: ConversationChannel, frame: Omit<StreamFrame, "seq">): void {
		const stored = channel.backlog.push(frame);
		for (const subscriber of channel.subscribers) {
			try {
				subscriber(stored);
			} catch {
				// 某个客户端的写失败了 —— 它自己会断开，别拖累别人
			}
		}
	}

	/** 关掉一个通道（连同它的 dsh 会话）。 */
	close(conversationId: string): void {
		const channel = this.#channels.get(conversationId);
		if (channel === undefined) {
			return;
		}
		this.#channels.delete(conversationId);
		channel.ended = true;
		try {
			channel.unsubscribe?.();
		} catch {
			// 退订失败也不该挡住关闭
		}
		channel.unsubscribe = undefined;
		const session = channel.session;
		channel.session = undefined;
		if (session !== undefined) {
			try {
				session.dispose();
			} catch {
				// 释放失败也别把关闭流程搞崩
			}
		}
	}

	/** 关掉全部通道（进程退出时）。 */
	closeAll(): void {
		for (const conversationId of [...this.#channels.keys()]) {
			this.close(conversationId);
		}
	}

	/** 回收空闲太久的通道。 */
	sweep(): void {
		this.#sweepIdle();
	}

	/** 回收最久没用的通道（超过上限时）。 */
	#evictIfNeeded(): void {
		while (this.#channels.size > this.#maxChannels) {
			let oldestId: string | undefined;
			let oldestAt = Number.POSITIVE_INFINITY;
			for (const [conversationId, channel] of this.#channels.entries()) {
				if (channel.lastUsedAt < oldestAt) {
					oldestAt = channel.lastUsedAt;
					oldestId = conversationId;
				}
			}
			if (oldestId === undefined) {
				return;
			}
			this.close(oldestId);
		}
	}

	/** 顺手扫一次空闲通道。 */
	#sweepIdle(): void {
		const deadline = Date.now() - this.#idleTtlMs;
		for (const [conversationId, channel] of [...this.#channels.entries()]) {
			if (channel.lastUsedAt < deadline) {
				this.close(conversationId);
			}
		}
	}
}
