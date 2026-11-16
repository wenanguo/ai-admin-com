/**
 * 智能体注册表 —— 「按 id 取配置」与「会话 id ↔ 智能体」的绑定。
 */

import { describe, expect, it } from "vitest";
import {
	agentIdOfConversation,
	conversationIdFor,
	createFileAgentProvider,
} from "./registry.ts";

describe("会话 id ↔ 智能体的绑定", () => {
	it("造的会话 id 里带着智能体 id ⇒ 能反查回来", () => {
		const conversationId = conversationIdFor("pm");
		expect(conversationId.startsWith("pm_")).toBe(true);
		expect(agentIdOfConversation(conversationId)).toBe("pm");
	});

	it("智能体 id 里可以有连字符（反查不受影响）", () => {
		const conversationId = conversationIdFor("pm-assistant");
		expect(agentIdOfConversation(conversationId)).toBe("pm-assistant");
	});

	it("老会话（id 里没有分隔符）⇒ 认不出来（调用方回落默认智能体）", () => {
		expect(agentIdOfConversation("ckq1234567890")).toBeUndefined();
		expect(agentIdOfConversation("")).toBeUndefined();
	});

	it("前缀不是合法智能体 id ⇒ 认不出来", () => {
		expect(agentIdOfConversation("PM_abc")).toBeUndefined();
		expect(agentIdOfConversation("pm_assistant_abc")).toBeUndefined();
	});

	it("会话 id 不超过 64 位（`ai_conversation.id` 的列宽）", () => {
		const conversationId = conversationIdFor("a".repeat(30));
		expect(conversationId.length).toBeLessThanOrEqual(64);
	});
});

describe("文件来源的智能体", () => {
	it("读 `agents/` 目录 ⇒ 能按 id 取到配置", () => {
		const provider = createFileAgentProvider("agents", "pm");
		expect(provider.defaultAgentId).toBe("pm");
		expect(provider.get("pm")?.name).toBe("PM 助手");
		expect(provider.get("qa")?.name).toBe("通用问答");
		expect(provider.get("nope")).toBeUndefined();
	});

	it("目录里没有配置 ⇒ 一个智能体都没有（不是故障）", () => {
		const provider = createFileAgentProvider("agents-not-exist", "pm");
		expect(provider.list()).toEqual([]);
		expect(provider.get("pm")).toBeUndefined();
	});
});
