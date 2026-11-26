/**
 * 会话装配的解析器 —— **「哪个智能体 / 插件 / 上下文 / MCP 计划」**（issue #175 · S4）。
 *
 * ## 钉住的事
 *
 * 1. 认不出的智能体 ⇒ **直接报错**（说清有哪些可用）；
 * 2. 老会话（`agent_id` 是空的）⇒ 看会话 id 的前缀 ⇒ 再没有就**默认智能体**；
 * 3. 没写 `plugin:` ⇒ **默认插件**；
 * 4. MCP 地址：配置里的 ⇒ 插件给的 ⇒ **都不给就不挂**（`null` ⇒ 显式不接）。
 */

import { describe, expect, it } from "vitest";
import { AgentResolver } from "./agent-resolver.ts";
import type { AgentProvider } from "../config/registry.ts";
import type { AgentConfig } from "../config/types.ts";
import { PluginRegistry, type AiPlugin } from "../plugins.ts";
import type { ConversationStore } from "../store/store.ts";

/** 假的智能体配置。 */
function agent(id: string, extra: Partial<AgentConfig> = {}): AgentConfig {
	return {
		id,
		name: id,
		description: "测试用",
		systemPrompt: "你是助手。",
		skills: [],
		mcpServers: [],
		tools: [],
		dir: `agents/${id}`,
		configPath: `agents/${id}/agent.yaml`,
		...extra,
	};
}

/** 假的智能体来源。 */
function agents(items: AgentConfig[]): AgentProvider {
	return {
		defaultAgentId: items[0]?.id ?? "pm",
		get: (id: string) => items.find((item) => item.id === id),
		list: () => items,
	};
}

/** 假的存取（**只读 `agent_id`**）。 */
function store(agentId: string | null): ConversationStore {
	return {
		get: async (conversationId: string) => ({
			conversationId,
			userId: "2",
			title: null,
			agentId,
			dshSessionId: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
	} as unknown as ConversationStore;
}

/** 假的插件（**只给默认插件**）。 */
function plugins(): { registry: PluginRegistry; plugin: AiPlugin } {
	const registry = new PluginRegistry();
	const plugin: AiPlugin = {
		id: "pm",
		commands: [],
		context: undefined,
		mcpDefaultUrl: "http://plugin.test/mcp",
	};
	registry.register(plugin);
	return { registry, plugin };
}

describe("会话装配的解析器", () => {
	it("认不出的智能体 ⇒ **直接报错**（说清有哪些可用）", () => {
		const resolver = new AgentResolver({
			agents: agents([agent("pm")]),
			plugins: plugins().registry,
			store: store(null),
			mcpUrl: undefined,
		});

		expect(() => resolver.requireAgent("nope")).toThrow(/不存在/);
		expect(() => resolver.requireAgent("nope")).toThrow(/pm/);
	});

	it("会话的智能体 ⇒ **以库里的 `agent_id` 为准**", async () => {
		const resolver = new AgentResolver({
			agents: agents([agent("pm"), agent("qa")]),
			plugins: plugins().registry,
			store: store("qa"),
			mcpUrl: undefined,
		});

		expect((await resolver.agentOf("conv-1")).id).toBe("qa");
	});

	it("老会话（`agent_id` 为空）⇒ **默认智能体**", async () => {
		const resolver = new AgentResolver({
			agents: agents([agent("pm"), agent("qa")]),
			plugins: plugins().registry,
			store: store(null),
			mcpUrl: undefined,
		});

		expect((await resolver.agentOf("conv-legacy")).id).toBe("pm");
	});

	it("没写 `plugin:` ⇒ **默认插件**", () => {
		const { registry } = plugins();
		const resolver = new AgentResolver({
			agents: agents([agent("pm")]),
			plugins: registry,
			store: store(null),
			mcpUrl: undefined,
		});

		expect(resolver.pluginOf(agent("pm"))?.id).toBe("pm");
	});

	it("MCP 地址：配置里的 ⇒ 插件给的 ⇒ **都没有就不挂**", () => {
		const { registry } = plugins();
		const withServer = agent("pm", {
			mcpServers: [{ name: "aiadmin", type: "http", exposure: "direct" }],
		});

		// ① 配置里写了地址 ⇒ 用它
		const configured = new AgentResolver({
			agents: agents([withServer]),
			plugins: registry,
			store: store(null),
			mcpUrl: "http://global.test/mcp",
		});
		expect(configured.mcpPlanOf(withServer, "t").servers[0]?.url).toBe(
			"http://global.test/mcp",
		);

		// ② 配置里没写 ⇒ 用插件给的
		const fallback = new AgentResolver({
			agents: agents([withServer]),
			plugins: registry,
			store: store(null),
			mcpUrl: undefined,
		});
		expect(fallback.mcpPlanOf(withServer, "t").servers[0]?.url).toBe(
			"http://plugin.test/mcp",
		);

		// ③ 都没有 ⇒ **不挂**（后端没上线时不连）
		const none = new AgentResolver({
			agents: agents([withServer]),
			plugins: new PluginRegistry(),
			store: store(null),
			mcpUrl: undefined,
		});
		expect(none.mcpPlanOf(withServer, "t").servers).toEqual([]);
	});

	it("`null` ⇒ **显式不接 MCP**（不被环境变量带偏）", () => {
		const { registry } = plugins();
		const withServer = agent("pm", {
			mcpServers: [{ name: "aiadmin", type: "http", exposure: "direct" }],
		});
		const resolver = new AgentResolver({
			agents: agents([withServer]),
			plugins: registry,
			store: store(null),
			mcpUrl: null,
		});

		expect(resolver.mcpPlanOf(withServer, "t").servers).toEqual([]);
	});

	it("工具名前缀 ⇒ **按服务器名算**（多服务器不互相盖名）", () => {
		const { registry } = plugins();
		const twoServers = agent("pm", {
			mcpServers: [
				{ name: "aiadmin", type: "http", exposure: "direct" },
				{ name: "other", type: "http", exposure: "direct" },
			],
		});
		const resolver = new AgentResolver({
			agents: agents([twoServers]),
			plugins: registry,
			store: store(null),
			mcpUrl: "http://global.test/mcp",
		});

		expect(resolver.mcpPlanOf(twoServers, "t").prefixes).toEqual([
			"mcp__aiadmin__",
			"mcp__other__",
		]);
	});
});
