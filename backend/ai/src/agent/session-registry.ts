/**
 * 会话注册表 —— 一个 `conversationId` 对应一个「通道」。
 *
 * 通道里挂着四样东西：
 * 1. **SSE 订阅者**（每个连上来的客户端一个）；
 * 2. **回放窗口**（`FrameBuffer`）—— 后连上来的客户端先补发这些帧；
 * 3. **调用方的 token**（⚠️ **只在内存**，绝不落盘、绝不进日志）；
 * 4. **pi 会话**（懒创建：第一次有命令时才建）。
 *
 * ## 为什么不漏
 *
 * - 通道数有上限（默认 64）：超了就把**最久没用**的那个关掉（连同它的 pi 会话）；
 * - 空闲超过 TTL（默认 30 分钟）的通道会被清掉；
 * - `close()` 显式关掉一个会话（会话被删、用户点了「结束对话」时用）。
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AiTaskContext } from "./context.ts";
import { FrameBuffer, type StreamFrame } from "./frame-buffer.ts";

/** SSE 订阅者：收到一帧就被叫一次。 */
export type ChannelSubscriber = (frame: StreamFrame) => void;

/**
 * pi 会话的**最小接口**（真实现是 SDK 的 `AgentSession`；测试可注入假实现）。
 */
export interface AgentSessionLike {
	/** 发起一轮对话。 */
	prompt(
		text: string,
		options?: { expandPromptTemplates?: boolean; streamingBehavior?: "steer" | "followUp" },
	): Promise<void>;
	/** 订阅事件；返回退订函数。 */
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	/** 释放会话。 */
	dispose(): void;
	/** 正在流式输出？ */
	readonly isStreaming: boolean;
	/**
	 * 排到当前轮**之后**（不打断）：当前 run 干完活就处理它。
	 *
	 * ⚠️ 这是 SDK 的原生排队语义（`AgentSession.followUp`）——
	 *    自己造队列只能做到「等整轮跑完」，做不到「插进去」。
	 */
	followUp?(text: string): Promise<"queued" | "handled">;
	/**
	 * **打断**当前轮：插到当前助手轮次（及其工具调用）之后、下一次模型调用之前。
	 *
	 * ⚠️ SDK 原生语义（`AgentSession.steer`）。
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
	/** 回放窗口。 */
	readonly backlog: FrameBuffer;
	/** 调用方的 token（**只在内存**；刷新命令时会被新的 token 覆盖）。 */
	token: string | undefined;
	/**
	 * 当前登录用户的 id（**只在内存**）。
	 *
	 * ⚠️ 写审计要记「谁干的」⇒ 这里存一下（运行时 submitCommand 时写进去）。
	 */
	userId: string | undefined;
	/**
	 * 当前讨论的上下文（**只在内存**）。
	 *
	 * ⚠️ 每次带上下文的消息都会覆盖它 ⇒ 它表示「**此刻**在聊哪条任务」。
	 *    没有上下文的对话（用户没点「与 AI 讨论」）⇒ 它是 undefined。
	 */
	taskContext: AiTaskContext | undefined;
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
	/** pi 会话（懒创建）。 */
	session: AgentSessionLike | undefined;
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
			backlog: new FrameBuffer(),
			token: undefined,
			userId: undefined,
			taskContext: undefined,
			lastWrite: undefined,
			lastMcpWrite: undefined,
			session: undefined,
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
	publish(channel: ConversationChannel, frame: Omit<StreamFrame, "bytes" | "seq">): void {
		const stored = channel.backlog.push(frame);
		for (const subscriber of channel.subscribers) {
			try {
				subscriber(stored);
			} catch {
				// 某个客户端的写失败了 —— 它自己会断开，别拖累别人
			}
		}
	}

	/** 关掉一个通道（连同它的 pi 会话）。 */
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
