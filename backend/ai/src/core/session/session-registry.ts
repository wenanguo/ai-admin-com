/**
 * 会话注册表 —— **「会话 id ↔ dsh session id」的映射** + SSE 管道（issue #175 · S4）。
 *
 * 里面只有两样东西：**映射**（会话 id ⇒ dsh 的 session id ⇒ 今天两者相等）
 * 与 **SSE 管道**（订阅者 + 回放窗口 —— 我们的 SSE 帧 ≠ dsh 的事件 ⇒ 回放留在我们这边）。
 *
 * ⚠️ **会话本身不在这里**：dsh 的会话住在**运行时子进程**里 ⇒ 我们这边只有**句柄**
 * ⇒ 句柄归**适配层**管（`core/adapter/dsh/`）⇒ 这里不再自己维护「通道 + 会话」两套。
 *
 * ⚠️ **进程内的事实（token / 用户 / 锚点 / 写规则）只在内存** ⇒ 绝不落盘
 *    （token 落盘 = 凭据落盘）⇒ 每条命令刷新一次。
 */

import type { AgentSessionLike } from "../adapter/dsh/session.ts";
import type { ContextAnchor, WriteToolRule } from "../context/anchor.ts";
import { ReplayWindow, type StreamFrame } from "../http/sse.ts";
import { EventBridgeState } from "./event-bridge.ts";

/** SSE 订阅者：收到一帧就被叫一次。 */
export type ChannelSubscriber = (frame: StreamFrame) => void;

/** 会话的**业务上下文**（**只在内存**；每条命令刷新）。 */
export interface ConversationContext {
	/** 调用方的 token（**只在内存**；刷新命令时会被新的 token 覆盖）。 */
	token: string | undefined;
	/** 当前登录用户的 id（**只在内存**；写审计要记「谁干的」）。 */
	userId: string | undefined;
	/** 当前讨论的**锚点**（**只在内存**；每条带上下文的消息都会覆盖它）。 */
	anchor: ContextAnchor | undefined;
	/** 这个会话的**写规则**（**插件给的** ⇒ 闸门不写死工具名 / 字段名）。 */
	writeRules: readonly WriteToolRule[] | undefined;
}
/** 一个会话通道（**进程内的视图**）。 */
export interface ConversationChannel {
	/** 会话 id。 */
	readonly conversationId: string;
	/** dsh 的 session id（**等于会话 id** ⇒ dsh 侧能按同一个 id 恢复会话）。 */
	readonly dshSessionId: string;
	/** 业务上下文（**每条命令刷新**）。 */
	readonly context: ConversationContext;
	/** 事件翻译的中间状态（**每个会话一份**）。 */
	readonly bridge: EventBridgeState;
	/** SSE 订阅者。 */
	readonly subscribers: Set<ChannelSubscriber>;
	/** 回放窗口（后连上来的客户端先补发这些帧）。 */
	readonly backlog: ReplayWindow;
	/** dsh 会话（懒创建：第一次有命令时才建）+ 退订函数。 */
	session: AgentSessionLike | undefined;
	unsubscribe: (() => void) | undefined;
	/** 正在流式输出？通道被关掉了？最后一次被用（毫秒）。 */
	isStreaming: boolean;
	ended: boolean;
	lastUsedAt: number;
	/** 分配消息序号（进程内单调递增）。 */
	allocateSeq(initial: number): number;
}
/** 默认最多同时留多少个通道。 */
const DEFAULT_MAX_CHANNELS = 64;

/** 空闲多久就回收（毫秒）。 */
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;

/** 会话注册表的参数。 */
export interface SessionRegistryOptions {
	/** 通道数上限。 */
	maxChannels?: number;
	/** 空闲回收时间（毫秒）。 */
	idleTtlMs?: number;
}

/** 会话注册表（**会话 id ↔ dsh session id** + SSE 管道）。 */
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

	/** 取通道；没有就建一个（**会话 id 就是 dsh 的 session id**）。 */
	ensure(conversationId: string): ConversationChannel {
		const existing = this.get(conversationId);
		if (existing !== undefined) {
			return existing;
		}
		// 消息序号状态（进程内；通道关掉就一起没了）
		let nextSeq: number | undefined;
		const channel: ConversationChannel = {
			conversationId,
			dshSessionId: conversationId,
			context: { token: undefined, userId: undefined, anchor: undefined, writeRules: undefined },
			bridge: new EventBridgeState(),
			subscribers: new Set<ChannelSubscriber>(),
			backlog: new ReplayWindow(),
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

	/** 发布一帧：进回放窗口 + 送给所有订阅者（**送的是缓冲里那一帧** ⇒ 带序号）。 */
	publish(channel: ConversationChannel, frame: Omit<StreamFrame, "seq">): void {
		const stored = channel.backlog.push(frame);
		for (const subscriber of channel.subscribers) {
			try {
				subscriber(stored);
			} catch {
				// 某个订阅者炸了 ⇒ 不拖累别人
			}
		}
	}

	/** 关掉一个通道（**连同它的 dsh 会话**）。 */
	close(conversationId: string): void {
		const channel = this.#channels.get(conversationId);
		if (channel === undefined) {
			return;
		}
		channel.ended = true;
		channel.unsubscribe?.();
		channel.unsubscribe = undefined;
		channel.session?.dispose();
		channel.session = undefined;
		channel.subscribers.clear();
		this.#channels.delete(conversationId);
	}

	/** 关掉全部通道。 */
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
			const oldest = [...this.#channels.entries()].sort(
				(a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
			)[0];
			if (oldest === undefined) {
				return;
			}
			this.close(oldest[0]);
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
