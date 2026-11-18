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
	it("能力摘要 = 模型 + 插件 + 技能数 + MCP 数 + 工具数", () => {
		const summary = toAgentSummary(
			config({
				model: "minimax-cn/MiniMax-M3.1-Flash",
				skills: ["/tmp/pm/skills"],
				mcpServers: [{ name: "aiadmin", type: "http", exposure: "direct" }],
				tools: ["create_task", "update_task"],
				plugin: "pm",
			}),
		);

		expect(summary).toEqual({
			id: "pm",
			name: "PM 助手",
			description: "拆需求、管里程碑",
			capabilities: {
				model: "minimax-cn/MiniMax-M3.1-Flash",
				// ⚠️ **插件要报出来**（界面据此知道这个智能体有哪些业务能力）
				plugins: ["pm"],
				skillCount: 1,
				mcpServerCount: 1,
				toolCount: 2,
			},
		});
	});

	it("配置没写插件 ⇒ 按**默认插件**算（与运行时同一口径）", () => {
		// ⚠️ 没写 `plugin:` 的智能体挂的是默认插件 ⇒ 摘要不能空着
		const summary = toAgentSummary(config(), "pm");
		expect(summary.capabilities.plugins).toEqual(["pm"]);
	});

	it("既没写插件、也没有默认插件 ⇒ 空数组（不编造）", () => {
		const summary = toAgentSummary(config(), undefined);
		expect(summary.capabilities.plugins).toEqual([]);
	});

	it("配置里写了插件 ⇒ 默认插件**不算**（写明的优先）", () => {
		const summary = toAgentSummary(config({ plugin: "other" }), "pm");
		expect(summary.capabilities.plugins).toEqual(["other"]);
	});

	it("配置没写模型 ⇒ 用全局默认", () => {
		const summary = toAgentSummary(config());
		expect(summary.capabilities.model).toBe("minimax-cn/MiniMax-M3.1-Flash");
	});
});
