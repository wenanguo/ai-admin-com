/**
 * 智能体清单（能力摘要）—— 前端直接按这个形状消费。
 */

import { describe, expect, it } from "vitest";
import { toAgentSummary } from "./catalog.ts";
import type { AgentConfig } from "./types.ts";

/** 造一份配置。 */
function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		id: "pm",
		name: "PM 助手",
		description: "拆需求、管里程碑",
		systemPrompt: "你是 PM 助手",
		skills: [],
		mcpServers: [],
		tools: [],
		dir: "/tmp/pm",
		configPath: "/tmp/pm/agent.yaml",
		...overrides,
	};
}

describe("toAgentSummary", () => {
	it("能力摘要 = 模型 + 技能数 + MCP 数 + 工具数", () => {
		const summary = toAgentSummary(
			config({
				model: "minimax-cn/MiniMax-M3.1-Flash",
				skills: ["/tmp/pm/skills"],
				mcpServers: [{ name: "aiadmin" }],
				tools: ["create_task", "update_task"],
			}),
		);

		expect(summary).toEqual({
			id: "pm",
			name: "PM 助手",
			description: "拆需求、管里程碑",
			capabilities: {
				model: "minimax-cn/MiniMax-M3.1-Flash",
				skillCount: 1,
				mcpServerCount: 1,
				toolCount: 2,
			},
		});
	});

	it("配置没写模型 ⇒ 用全局默认", () => {
		const summary = toAgentSummary(config());
		expect(summary.capabilities.model).toBe("minimax-cn/MiniMax-M3.1-Flash");
	});
});
