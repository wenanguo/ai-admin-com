/**
 * dsh 会话工厂 —— **会话生命周期归 dsh**（issue #175 · S4）。
 *
 * ## 钉住的事
 *
 * 1. **装配全在适配层**：提示词 / 模型 / 技能目录 / 工具 / MCP / 闸门钩子 ⇒
 *    一股脑交给 `createSession`（**运行时只说「要什么」**）；
 * 2. **闸门上下文是动态的**（锚点会变 ⇒ 每次现取 ⇒ 不能在建会话时拍死）；
 * 3. **MCP 计划**：配置里的地址 ⇒ 插件给的 ⇒ 都没有就不挂；`null` ⇒ 显式不接；
 * 4. **恢复历史**（`resume`）由调用方决定（**默认关** ⇒ 行为变化由部署决定）。
 */

import { describe, expect, it } from "vitest";
import { openDshSession, planMcpServers } from "./session-factory.ts";
import type { CreateDshSessionOptions } from "./runner.ts";
import type { AgentSessionLike } from "./session.ts";
import type { McpToolContext } from "../../mcp/tool.ts";

/** 假的工具上下文。 */
function toolContext(): McpToolContext {
	return {
		currentToken: () => undefined,
		currentUserId: async () => 2,
		audit: { write: async () => {} },
		model: "test-model",
	};
}

/** 假的会话（**只认形状**）。 */
function fakeSession(): AgentSessionLike {
	return {
		prompt: async () => {},
		subscribe: () => () => {},
		dispose: () => {},
		isStreaming: false,
	};
}

describe("dsh 会话工厂 · 装配", () => {
	it("提示词 / 模型 / 技能目录 / 工具 / MCP ⇒ **一股脑交给 dsh**", async () => {
		let seen: CreateDshSessionOptions | undefined;
		await openDshSession({
			conversationId: "conv-1",
			systemPrompt: "你是助手。",
			model: "model-a",
			skillDirs: ["/srv/skills"],
			tools: [],
			toolContext: toolContext(),
			mcpServers: [{ name: "aiadmin", url: "http://mcp.test", token: "t" }],
			mcpPrefixes: ["mcp__aiadmin__"],
			events: { list: async () => [], append: async () => {} },
			audit: { write: async () => {} },
			gate: {
				userId: () => "2",
				anchor: () => undefined,
				writeRules: () => [],
				onPending: () => {},
			},
			resume: true,
			createSession: async (options) => {
				seen = options;
				return fakeSession();
			},
		});

		expect(seen?.conversationId).toBe("conv-1");
		expect(seen?.systemPrompt).toBe("你是助手。");
		expect(seen?.model).toBe("model-a");
		expect(seen?.skillDirs).toEqual(["/srv/skills"]);
		expect(seen?.mcpServers?.[0]?.url).toBe("http://mcp.test");
		expect(seen?.mcpPrefixes).toEqual(["mcp__aiadmin__"]);
		// ⚠️ **恢复历史**由调用方决定（默认关 ⇒ 行为变化由部署决定）
		expect(seen?.resume).toBe(true);
	});

	it("闸门上下文 ⇒ **每次现取**（锚点变了也能用）", async () => {
		let seen: CreateDshSessionOptions | undefined;
		let userId = "2";
		await openDshSession({
			conversationId: "conv-1",
			systemPrompt: "你是助手。",
			tools: [],
			toolContext: toolContext(),
			events: { list: async () => [], append: async () => {} },
			audit: { write: async () => {} },
			gate: {
				userId: () => userId,
				anchor: () => undefined,
				writeRules: () => [],
				onPending: () => {},
			},
			createSession: async (options) => {
				seen = options;
				return fakeSession();
			},
		});

		const gate = seen?.gate?.();
		expect(gate?.userId).toBe("2");
		userId = "3";
		expect(seen?.gate?.().userId).toBe("3");
	});
});

describe("MCP 挂载计划", () => {
	const servers = [{ name: "aiadmin", type: "http" as const, exposure: "direct" as const }];

	it("配置里没写地址 ⇒ 用**插件给的**默认地址", () => {
		const plan = planMcpServers({
			servers,
			url: undefined,
			fallbackUrl: "http://plugin.test/mcp",
			token: "t",
		});
		expect(plan.servers[0]?.url).toBe("http://plugin.test/mcp");
	});

	it("都没有 ⇒ **不挂**（后端没上线时不连）", () => {
		const plan = planMcpServers({
			servers,
			url: undefined,
			fallbackUrl: undefined,
			token: "t",
		});
		expect(plan.servers).toEqual([]);
	});

	it("`null` ⇒ **显式不接**（测试里不被环境变量带偏）", () => {
		const plan = planMcpServers({
			servers,
			url: null,
			fallbackUrl: "http://plugin.test/mcp",
			token: "t",
		});
		expect(plan.servers).toEqual([]);
	});

	it("token ⇒ **每个会话一份**（MCP 靠它做权限校验）", () => {
		const plan = planMcpServers({
			servers,
			url: "http://mcp.test",
			fallbackUrl: undefined,
			token: "token-a",
		});
		expect(plan.servers[0]?.token).toBe("token-a");
	});
});
