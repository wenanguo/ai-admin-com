/**
 * dsh runner 的配置（**环境变量**）。
 *
 * ⚠️ issue #123 拔掉 pi 之后**没有「双跑开关」了** ⇒ dsh 是唯一的执行层。
 */

import { describe, expect, it } from "vitest";
import { bridgeSecret, buildChildEnv, dshRunnerConfig } from "./runner.ts";
import { PendingWaiterRegistry } from "../../gate/pending-waiters.ts";

describe("dsh runner 的配置", () => {
	it("缺省值（**官方 DeepSeek 路由 + 官方 key 的环境变量**）", () => {
		const config = dshRunnerConfig({});
		expect(config.provider).toBe("deepseek-direct");
		expect(config.model).toBe("deepseek-chat");
		expect(config.baseURL).toBe("https://api.deepseek.com/v1");
		expect(config.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
		expect(config.profile).toBe("sdk");
		expect(config.bridgeUrl).toContain("/internal/dsh/commands");
	});

	it("环境变量覆盖（**换厂商只改配置**）", () => {
		const config = dshRunnerConfig({
			DSH_PROVIDER: "minimax-direct",
			DSH_MODEL: "MiniMax-M3.1-Flash",
			DSH_BASE_URL: "https://api.minimaxi.com/v1",
			DSH_API_KEY_ENV: "MINIMAX_CN_API_KEY",
			DSH_MAX_TOKENS: "4096",
			PORT: "3999",
		});
		expect(config.provider).toBe("minimax-direct");
		expect(config.model).toBe("MiniMax-M3.1-Flash");
		expect(config.baseURL).toBe("https://api.minimaxi.com/v1");
		expect(config.apiKeyEnv).toBe("MINIMAX_CN_API_KEY");
		expect(config.maxTokens).toBe(4096);
		expect(config.bridgeUrl).toBe("http://127.0.0.1:3999/internal/dsh/commands");
	});

	it("命令桥的密钥：**进程内稳定**（起 dsh 与挂路由用的是同一个）", () => {
		expect(bridgeSecret()).toBe(bridgeSecret());
		expect(bridgeSecret()).toMatch(/^[0-9a-f]{48}$/);
	});
});

describe("dsh runner · MCP 服务器", () => {
	/** 造一份配置（测试用）。 */
	const config = {
		profile: "sdk",
		dshHome: "C:/tmp/dsh-home",
		dshBin: "C:/tmp/dsh",
		patches: [],
		provider: "deepseek-direct",
		model: "deepseek-chat",
		baseURL: "http://127.0.0.1:1/v1",
		apiKeyEnv: "DSH_AI_API_KEY",
		contextWindow: 1024,
		maxTokens: 256,
		bridgeUrl: "http://127.0.0.1:1/internal/dsh/commands",
	};

	it("MCP 服务器 ⇒ 翻译成 dsh 的客户端配置（**token 只在环境变量里**）", () => {
		const env = buildChildEnv({
			options: {
				conversationId: "conv-1",
				tools: [],
				systemPrompt: "你是助手。",
				mcpServers: [{ name: "aiadmin", url: "https://a.test/mcp", token: "jwt" }],
				gate: () => ({
					conversationId: "conv-1",
					userId: "1",
					onPending: () => undefined,
					waiters: new PendingWaiterRegistry(),
					createPending: async () => ({ id: "p-1" }),
					timeoutMs: 1000,
				}),
			},
			config,
			source: {},
			apiKey: "fake",
		});
		const servers = JSON.parse(
			Buffer.from(env.DSH_AI_MCP_SERVERS ?? "", "base64").toString("utf8"),
		) as Array<Record<string, unknown>>;
		expect(servers).toHaveLength(1);
		expect(servers[0]?.["serverName"]).toBe("aiadmin");
		expect(servers[0]?.["transport"]).toBe("streamable-http");
		expect(servers[0]?.["headers"]).toEqual({ Authorization: "Bearer jwt" });
	});

	it("没配 MCP ⇒ 空清单（**不是异常**）", () => {
		const env = buildChildEnv({
			options: {
				conversationId: "conv-1",
				tools: [],
				systemPrompt: "你是助手。",
				gate: () => ({
					conversationId: "conv-1",
					userId: "1",
					onPending: () => undefined,
					waiters: new PendingWaiterRegistry(),
					createPending: async () => ({ id: "p-1" }),
					timeoutMs: 1000,
				}),
			},
			config,
			source: {},
			apiKey: "fake",
		});
		const servers = JSON.parse(
			Buffer.from(env.DSH_AI_MCP_SERVERS ?? "", "base64").toString("utf8"),
		) as unknown[];
		expect(servers).toEqual([]);
	});
});
