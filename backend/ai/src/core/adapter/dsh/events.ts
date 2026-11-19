/**
 * dsh 事件 → **我们的事件词汇**（运行时已经在说的那套）。
 *
 * ## 为什么映射到「pi 形状」而不是直接出 SSE
 *
 * 运行时的闸门 / 审计 / 落库逻辑（`core/session/runtime.ts`）都挂在**事件**上
 * （工具开始 / 工具结束 / 助手说完话）⇒ 两个 runner 必须说**同一种话**，
 * 否则运行时就得长出两条分支（⇒ 双跑不可切、契约容易走样）。
 *
 * ⇒ 适配层把 dsh 的事件**翻译成运行时已经懂的那套事件**
 * （`agent_start` / `message_update` / `tool_execution_start` / …）。
 * ⇒ **运行时代码一个字不改** ⇒ 对外契约（9 个端点 + SSE 事件）一字不改。
 *
 * ⚠️ 这层词汇以后会随「拔 pi」（#123）改名成我们自己的 —— 但**形状不变**，
 *    所以那一次只是改名，不是重写。
 *
 * ## dsh 事件 → 我们的事件
 *
 * | dsh 事件 | 我们的事件 |
 * | -------- | ---------- |
 * | `assistant/message` | `message_start` + `message_update`（text_delta）+ `message_end` |
 * | `tool/call` | `tool_execution_start` |
 * | `tool/result` | `tool_execution_end` |
 * | `turn/end` | `agent_settled` |
 *
 * ⚠️ **增量是「成批」的**（D1=A：子进程 ⇒ `text_delta` 在一步结束时一起到）
 *    ⇒ 事件名与载荷不变 ⇒ **前端零改动**。
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { DSH_EVENTS, asRecord, asString, type DshSessionEvent } from "./protocol.ts";

/** 一次工具调用的参数（`tool/call` 的 `arguments` 是 **JSON 字符串**）。 */
export type ToolArgs = Record<string, unknown>;

/**
 * dsh 事件翻译器（**每个会话一个** —— 它要记住工具名与参数，好把 `tool/result`
 * 与 `approval/request` 对上号）。
 */
export class DshEventTranslator {
	/** `callId` ⇒ 工具名（`tool/result` 不带工具名 ⇒ 靠 `tool/call` 记）。 */
	readonly #toolNames = new Map<string, string>();
	/** `callId` ⇒ 参数（审批载荷里没有参数 ⇒ 靠 `tool/call` 记）。 */
	readonly #toolArgs = new Map<string, ToolArgs>();

	/**
	 * 翻译一条 dsh 事件。
	 *
	 * @returns 我们的事件（不用外发的返回空数组）。
	 */
	translate(event: DshSessionEvent): AgentSessionEvent[] {
		switch (event.type) {
			case DSH_EVENTS.ASSISTANT_MESSAGE:
				return this.#assistantMessage(event);
			case DSH_EVENTS.TOOL_CALL:
				return this.#toolCall(event);
			case DSH_EVENTS.TOOL_RESULT:
				return this.#toolResult(event);
			case DSH_EVENTS.TURN_END:
				return [{ type: "agent_settled", aborted: false }];
			default:
				return [];
		}
	}

	/** 这次工具调用的参数（审批要用）。 */
	argsOf(callId: string | undefined): ToolArgs | undefined {
		if (callId === undefined) {
			return undefined;
		}
		return this.#toolArgs.get(callId);
	}

	/** 这次工具调用的名字（审批要用）。 */
	nameOf(callId: string | undefined): string | undefined {
		if (callId === undefined) {
			return undefined;
		}
		return this.#toolNames.get(callId);
	}

	/** 助手消息 ⇒ 开始 / 增量 / 结束。 */
	#assistantMessage(event: DshSessionEvent): AgentSessionEvent[] {
		const data = asRecord(event.data);
		const message = asRecord(data?.["message"]);
		const text = textOf(message);
		if (text.length === 0) {
			// ⚠️ 这一轮只有工具调用、没有正文 ⇒ **不开泡**（与今天一致）
			return [];
		}
		const frames: AgentSessionEvent[] = [];
		frames.push({
			type: "message_start",
			message: emptyAssistantMessage(),
		} as unknown as AgentSessionEvent);
		for (const chunk of textChunksOf(data)) {
			if (chunk.length > 0) {
				frames.push({
					type: "message_update",
					message: emptyAssistantMessage(),
					assistantMessageEvent: { type: "text_delta", delta: chunk },
				} as unknown as AgentSessionEvent);
			}
		}
		frames.push({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text }],
			},
		} as unknown as AgentSessionEvent);
		return frames;
	}

	/** 工具调用 ⇒ 开始执行。 */
	#toolCall(event: DshSessionEvent): AgentSessionEvent[] {
		const data = asRecord(event.data);
		const callId = asString(data?.["callId"]) ?? "";
		const name = asString(data?.["name"]) ?? "";
		const args = parseArgs(data?.["arguments"]);
		this.#toolNames.set(callId, name);
		this.#toolArgs.set(callId, args);
		return [
			{
				type: "tool_execution_start",
				toolCallId: callId,
				toolName: name,
				args,
			},
		];
	}

	/** 工具结果 ⇒ 执行结束。 */
	#toolResult(event: DshSessionEvent): AgentSessionEvent[] {
		const data = asRecord(event.data);
		const message = asRecord(data?.["message"]);
		const callId = asString(message?.["toolCallId"]) ?? "";
		const name = this.#toolNames.get(callId) ?? "";
		const isError = message?.["isError"] === true || data?.["error"] !== undefined;
		const content = message?.["content"];
		const text = Array.isArray(content)
			? content
					.map((part) => asString(asRecord(part)?.["text"]) ?? "")
					.join("")
					.trim()
			: "";
		return [
			{
				type: "tool_execution_end",
				toolCallId: callId,
				toolName: name,
				result: { content: [{ type: "text", text }], details: { summary: text } },
				isError,
			},
		];
	}
}

/**
 * 一个**空的**助手消息（pi 的消息类型要一整套模型元信息 ⇒ 这里只借它的形状）。
 *
 * ⚠️ 运行时只读 `role` 与 `content`（见 `event-mapper.ts`）⇒ 够用。
 */
function emptyAssistantMessage(): unknown {
	return { role: "assistant", content: [] };
}

/** 助手消息里的正文（把多个 text 段拼起来）。 */
function textOf(message: Record<string, unknown> | undefined): string {
	const content = message?.["content"];
	if (!Array.isArray(content)) {
		return "";
	}
	const parts: string[] = [];
	for (const item of content) {
		const part = asRecord(item);
		if (part?.["type"] !== "text") {
			continue;
		}
		const text = asString(part["text"]);
		if (text !== undefined) {
			parts.push(text);
		}
	}
	return parts.join("");
}

/**
 * 模型流里的文本增量（`stream` 里的 `text-chunks`）。
 *
 * ⚠️ 拿不到就用消息正文整段当一个增量（**成批到达** ⇒ 前端照样能显示）。
 */
function textChunksOf(data: Record<string, unknown> | undefined): string[] {
	const stream = data?.["stream"];
	if (!Array.isArray(stream)) {
		return [];
	}
	const chunks: string[] = [];
	for (const record of stream) {
		const entry = asRecord(record);
		if (entry?.["type"] !== "text-chunks") {
			continue;
		}
		const texts = entry["texts"];
		if (!Array.isArray(texts)) {
			continue;
		}
		for (const text of texts) {
			const value = asString(text);
			if (value !== undefined) {
				chunks.push(value);
			}
		}
	}
	return chunks;
}

/** 工具参数（dsh 给的是 **JSON 字符串**；坏了就当空对象）。 */
function parseArgs(value: unknown): ToolArgs {
	const raw = asString(value);
	if (raw === undefined || raw.trim().length === 0) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return asRecord(parsed) ?? {};
	} catch {
		return {};
	}
}
