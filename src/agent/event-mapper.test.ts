import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AgentEventMapper } from "./event-mapper";

const CID = "conv-1";

/** 造一条助手消息（可带文本段与工具调用段）。 */
function assistantMessage(text?: string): unknown {
	const content: unknown[] = [];
	if (text !== undefined) {
		content.push({ type: "text", text });
	}
	content.push({ type: "toolCall", id: "call-1", name: "create_task", arguments: {} });
	return { role: "assistant", content };
}

/** 造一个 message_update（文本增量）事件。 */
function textDelta(delta: string): AgentSessionEvent {
	return {
		type: "message_update",
		message: assistantMessage(),
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta,
			partial: { role: "assistant", content: [] },
		},
	} as unknown as AgentSessionEvent;
}

describe("事件映射", () => {
	it("只带工具调用、没有正文的那一轮 ⇒ 一个气泡都不开", () => {
		const mapper = new AgentEventMapper();
		const frames = mapper.map(CID, {
			type: "message_start",
			message: assistantMessage(),
		} as unknown as AgentSessionEvent);
		expect(frames).toEqual([]);

		const endFrames = mapper.map(CID, {
			type: "message_end",
			message: assistantMessage(),
		} as unknown as AgentSessionEvent);
		expect(endFrames).toEqual([]);
	});

	it("有正文的那一轮 ⇒ message_start → text_delta* → message_end", () => {
		const mapper = new AgentEventMapper();
		const first = mapper.map(CID, textDelta("你好"));
		expect(first.map((frame) => frame.event)).toEqual(["message_start", "text_delta"]);

		const second = mapper.map(CID, textDelta("，世界"));
		expect(second.map((frame) => frame.event)).toEqual(["text_delta"]);

		const end = mapper.map(CID, {
			type: "message_end",
			message: assistantMessage("你好，世界"),
		} as unknown as AgentSessionEvent);
		expect(end.map((frame) => frame.event)).toEqual(["message_end"]);
		expect(end[0]?.payload).toMatchObject({ text: "你好，世界" });
	});

	it("工具调用 ⇒ tool_call；工具结果 ⇒ tool_result", () => {
		const mapper = new AgentEventMapper();
		const call = mapper.map(CID, {
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "create_task",
			args: { project_key: "PRJ-1", title: "标题" },
		} as unknown as AgentSessionEvent);
		expect(call[0]?.event).toBe("tool_call");
		expect(call[0]?.payload).toMatchObject({
			toolName: "create_task",
			args: { project_key: "PRJ-1", title: "标题" },
		});

		const done = mapper.map(CID, {
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "create_task",
			isError: false,
			result: { content: [{ type: "text", text: "好了" }], details: { summary: "已创建任务 task:1" } },
		} as unknown as AgentSessionEvent);
		expect(done[0]?.event).toBe("tool_result");
		expect(done[0]?.payload).toMatchObject({
			toolName: "create_task",
			status: "ok",
			summary: "已创建任务 task:1",
		});
	});

	it("工具失败 ⇒ status 是 error", () => {
		const mapper = new AgentEventMapper();
		const frames = mapper.map(CID, {
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "create_task",
			isError: true,
			result: { content: [{ type: "text", text: "炸了" }], details: {} },
		} as unknown as AgentSessionEvent);
		expect(frames[0]?.payload).toMatchObject({ status: "error" });
	});

	it("agent_settled ⇒ agent_settled", () => {
		const mapper = new AgentEventMapper();
		const frames = mapper.map(CID, { type: "agent_settled", aborted: false } as unknown as AgentSessionEvent);
		expect(frames[0]?.event).toBe("agent_settled");
	});
});
