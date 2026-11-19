/**
 * dsh 事件 ⇒ 我们的事件词汇（**映射表的可执行断言**）。
 *
 * ⚠️ 这些样本是**尖峰实测**的事件形状（spec §5.2 的映射表）。
 */

import { describe, expect, it } from "vitest";
import { DshEventTranslator } from "./events.ts";

describe("dsh 事件翻译", () => {
	it("助手消息 ⇒ 开始 / 增量 / 结束（**正文为空就不开泡**）", () => {
		const translator = new DshEventTranslator();
		const frames = translator.translate({
			type: "assistant/message",
			data: {
				message: { role: "assistant", content: [{ type: "text", text: "你好" }] },
				stream: [{ type: "text-chunks", texts: ["你", "好"] }],
			},
		});
		expect(frames.map((frame) => frame.type)).toEqual([
			"message_start",
			"message_update",
			"message_update",
			"message_end",
		]);
		const end = frames[frames.length - 1];
		expect(end).toMatchObject({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "你好" }] },
		});
	});

	it("只有工具调用、没有正文 ⇒ **不开泡**（与今天一致）", () => {
		const translator = new DshEventTranslator();
		const frames = translator.translate({
			type: "assistant/message",
			data: { message: { role: "assistant", content: [] }, stream: [] },
		});
		expect(frames).toEqual([]);
	});

	it("工具调用 ⇒ 开始执行；工具结果 ⇒ 结束（**工具名靠 callId 对上**）", () => {
		const translator = new DshEventTranslator();
		const start = translator.translate({
			type: "tool/call",
			data: { callId: "call-1", name: "create_task", arguments: '{"title":"写文档"}' },
		});
		expect(start).toEqual([
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "create_task",
				args: { title: "写文档" },
			},
		]);

		const end = translator.translate({
			type: "tool/result",
			data: {
				message: {
					role: "tool",
					toolCallId: "call-1",
					content: [{ type: "text", text: "建好了" }],
				},
			},
		});
		expect(end[0]).toMatchObject({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "create_task",
			isError: false,
		});
	});

	it("工具失败 ⇒ `isError` 为真", () => {
		const translator = new DshEventTranslator();
		translator.translate({
			type: "tool/call",
			data: { callId: "call-2", name: "update_task", arguments: "{}" },
		});
		const end = translator.translate({
			type: "tool/result",
			data: {
				message: { role: "tool", toolCallId: "call-2", content: [], isError: true },
				error: { name: "X", code: "Y" },
			},
		});
		expect(end[0]).toMatchObject({ type: "tool_execution_end", isError: true });
	});

	it("一轮结束 ⇒ 会话闲置（前端输入框解禁）", () => {
		const translator = new DshEventTranslator();
		expect(translator.translate({ type: "turn/end", data: {} })).toEqual([
			{ type: "agent_settled", aborted: false },
		]);
	});

	it("审批的载荷没有参数 ⇒ **靠 callId 关联 `tool/call`**", () => {
		const translator = new DshEventTranslator();
		translator.translate({
			type: "tool/call",
			data: { callId: "call-3", name: "update_task", arguments: '{"title":"新标题"}' },
		});
		expect(translator.argsOf("call-3")).toEqual({ title: "新标题" });
		expect(translator.nameOf("call-3")).toBe("update_task");
		expect(translator.argsOf("不存在的")).toBeUndefined();
	});

	it("参数不是合法 JSON ⇒ **当空对象**（不许炸）", () => {
		const translator = new DshEventTranslator();
		const frames = translator.translate({
			type: "tool/call",
			data: { callId: "call-4", name: "create_task", arguments: "不是 JSON" },
		});
		expect(frames[0]).toMatchObject({ args: {} });
	});
});
