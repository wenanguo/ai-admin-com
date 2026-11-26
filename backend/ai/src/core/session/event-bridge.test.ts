/**
 * 事件桥 —— **dsh 事件 → 我们的 SSE 词汇**（issue #175 · S4）。
 *
 * ## 钉住的事
 *
 * 1. **事件名与顺序一字不变**（前端契约）：写成功 ⇒ 先 `entity_updated`，
 *    再是映射器产出的帧；助手的话 ⇒ `message_end` 之后落库；
 * 2. **MCP 的写要补一条审计**（我们自己的工具自己写审计 ⇒ 别写两遍）；
 * 3. **工具名归一化**（`mcp__aiadmin__create_task` ⇒ `create_task`）；
 * 4. `agent_start` / `agent_settled` ⇒ 维护「正在流式输出吗」。
 */

import { describe, expect, it } from "vitest";
import { bridgeEvent, EventBridgeState, type EventBridgeHooks } from "./event-bridge.ts";
import type { AgentEvent } from "./agent-event.ts";
import { SSE_EVENTS, type SseEventName } from "./events.ts";
import type { ConversationChannel } from "./session-registry.ts";

/** 造一个通道（**只要桥要的那几样**）。 */
function makeChannel(): ConversationChannel {
	return {
		conversationId: "conv-1",
		dshSessionId: "conv-1",
		context: { token: undefined, userId: undefined, anchor: undefined, writeRules: undefined },
		bridge: new EventBridgeState(),
		subscribers: new Set(),
		backlog: { list: () => [], push: () => ({}) } as unknown as ConversationChannel["backlog"],
		session: undefined,
		unsubscribe: undefined,
		isStreaming: false,
		ended: false,
		lastUsedAt: 0,
		allocateSeq: () => 1,
	};
}

/** 造的钩子（**记录发生的一切**）。 */
function makeHooks(): {
	hooks: EventBridgeHooks;
	published: { event: SseEventName; payload: unknown }[];
	audits: { toolName: string; args: unknown }[];
	messages: string[];
} {
	const published: { event: SseEventName; payload: unknown }[] = [];
	const audits: { toolName: string; args: unknown }[] = [];
	const messages: string[] = [];
	return {
		published,
		audits,
		messages,
		hooks: {
			publish: (event, payload) => {
				published.push({ event, payload });
			},
			writeAudit: (write) => {
				audits.push({ toolName: write.toolName, args: write.args });
			},
			appendAssistantMessage: (text) => {
				messages.push(text);
			},
		},
	};
}

describe("事件桥 · 翻译", () => {
	it("工具名 ⇒ **给人看的名字**（剥掉 MCP 前缀）", () => {
		const channel = makeChannel();
		channel.bridge.mcpPrefixes = ["mcp__aiadmin__"];
		const { hooks, published } = makeHooks();

		bridgeEvent(
			channel,
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "mcp__aiadmin__create_task",
				args: {},
			},
			hooks,
		);

		const toolCall = published.find((item) => item.event === SSE_EVENTS.TOOL_CALL);
		const payload = toolCall?.payload as { toolName?: string } | undefined;
		expect(payload?.toolName).toBe("create_task");
	});

	it("写成功 ⇒ **先发 `entity_updated`**，再发映射器的帧（顺序是契约）", () => {
		const channel = makeChannel();
		const { hooks, published } = makeHooks();
		// ⚠️ **讨论上下文**（决定「改的是哪条」）
		channel.context.anchor = {
			scope: { type: "task", id: "6" },
			baseline: { title: "旧标题" },
			values: {},
			writableFields: ["title"],
		};
		channel.context.writeRules = [
			{ tool: "update_task", targetId: (anchor) => Number(anchor.scope.id) },
		];

		bridgeEvent(
			channel,
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "update_task",
				args: { task_id: 6, title: "新标题" },
			},
			hooks,
		);
		bridgeEvent(
			channel,
			{
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "update_task",
				result: { content: [{ type: "text", text: "好了" }] },
			},
			hooks,
		);

		const names = published.map((item) => item.event);
		expect(names.indexOf(SSE_EVENTS.ENTITY_UPDATED)).toBeGreaterThanOrEqual(0);
		// ⚠️ `entity_updated` **在 `tool_result` 之前**（前端先刷新列表，再看结果）
		expect(names.indexOf(SSE_EVENTS.ENTITY_UPDATED)).toBeLessThan(
			names.indexOf(SSE_EVENTS.TOOL_RESULT),
		);
	});

	it("**MCP 的写** ⇒ 补一条审计（我们自己的工具不补 ⇒ 别写两遍）", () => {
		const channel = makeChannel();
		channel.bridge.mcpPrefixes = ["mcp__aiadmin__"];
		const { hooks, audits } = makeHooks();

		bridgeEvent(
			channel,
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "mcp__aiadmin__update_task",
				args: { task_id: 6 },
			},
			hooks,
		);
		bridgeEvent(
			channel,
			{
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "mcp__aiadmin__update_task",
				result: { content: [{ type: "text", text: "好了" }] },
			},
			hooks,
		);

		expect(audits).toHaveLength(1);
		expect(audits[0]?.toolName).toBe("mcp__aiadmin__update_task");
	});

	it("**我们自己的工具**（`create_task`）⇒ 不补审计（它自己写）", () => {
		const channel = makeChannel();
		const { hooks, audits } = makeHooks();

		bridgeEvent(
			channel,
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "create_task",
				args: {},
			},
			hooks,
		);
		bridgeEvent(
			channel,
			{
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "create_task",
				result: { content: [{ type: "text", text: "好了" }] },
			},
			hooks,
		);

		expect(audits).toHaveLength(0);
	});

	it("助手的话 ⇒ **落库**（`ai_message` 的产品事实）", () => {
		const channel = makeChannel();
		const { hooks, messages } = makeHooks();

		bridgeEvent(
			channel,
			{
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text: "建好了" }] },
			},
			hooks,
		);

		expect(messages).toEqual(["建好了"]);
	});

	it("工具结果消息 ⇒ **不落库**（那是工具的回执，不是对话）", () => {
		const channel = makeChannel();
		const { hooks, messages } = makeHooks();

		bridgeEvent(
			channel,
			{
				type: "message_end",
				message: { role: "tool", content: [{ type: "text", text: "回执" }] },
			},
			hooks,
		);

		expect(messages).toEqual([]);
	});

	it("`agent_start` / `agent_settled` ⇒ 维护「正在流式输出吗」", () => {
		const channel = makeChannel();
		const { hooks } = makeHooks();

		bridgeEvent(channel, { type: "agent_start" }, hooks);
		expect(channel.isStreaming).toBe(true);

		bridgeEvent(channel, { type: "agent_settled" }, hooks);
		expect(channel.isStreaming).toBe(false);
	});
});
