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
			AI_DSH_PROVIDER: "minimax-direct",
			AI_DSH_MODEL: "MiniMax-M3.1-Flash",
			AI_DSH_BASE_URL: "https://api.minimaxi.com/v1",
			AI_DSH_API_KEY_ENV: "MINIMAX_CN_API_KEY",
			AI_DSH_MAX_TOKENS: "4096",
			PORT: "3999",
		});
		expect(config.provider).toBe("minimax-direct");
		expect(config.model).toBe("MiniMax-M3.1-Flash");
		expect(config.baseURL).toBe("https://api.minimaxi.com/v1");
		expect(config.apiKeyEnv).toBe("MINIMAX_CN_API_KEY");
		expect(config.maxTokens).toBe(4096);
		expect(config.bridgeUrl).toBe("http://127.0.0.1:3999/internal/dsh/commands");
	});

	it("**旧的 `DSH_*` 名字不再被读**（issue #124 的真 bug：dsh 拒收 .env 里的 DSH_*）", () => {
		// ⚠️ 行为口径变了 ⇒ 有人照旧配 DSH_MODEL **不会**生效（会被忽略、走缺省）。
		//    这条测试把这个口径钉住：别为了「兼容」把 DSH_ 前缀又读回来
		//    （读回来 = 又教人去 .env 里写 DSH_* = dsh 拒绝启动）。
		const config = dshRunnerConfig({
			DSH_MODEL: "旧的模型名",
			DSH_BASE_URL: "https://old.test/v1",
			DSH_PROVIDER: "old-route",
			DSH_HOME: "C:/old/home",
			DSH_PROFILE: "old-profile",
			DSH_CONTEXT_WINDOW: "7",
			DSH_API_KEY_ENV: "OLD_KEY",
		});
		expect(config.model).toBe("deepseek-chat");
		expect(config.baseURL).toBe("https://api.deepseek.com/v1");
		expect(config.provider).toBe("deepseek-direct");
		expect(config.profile).toBe("sdk");
		expect(config.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
		// `dshHome` 的缺省是 cwd 相对 ⇒ 断言它**不是**旧变量给的那个值。
		expect(config.dshHome).not.toBe("C:/old/home");
	});

	it("给 dsh 子进程的环境里：**dsh 自己认的 DSH_HOME 照原样**、我们插件的变量是 AI_DSH_*", () => {
		const env = buildChildEnv({
			options: {
				conversationId: "conv-env",
				tools: [],
				systemPrompt: "你是助手。",
				gate: () => ({
					conversationId: "conv-env",
					userId: "1",
					onPending: () => undefined,
					waiters: new PendingWaiterRegistry(),
					createPending: async () => ({ id: "p-1" }),
					timeoutMs: 1000,
				}),
			},
			config: {
				profile: "sdk",
				dshHome: "C:/tmp/dsh-home",
				dshBin: "C:/tmp/dsh",
				patches: [],
				provider: "deepseek-direct",
				model: "deepseek-chat",
				baseURL: "http://127.0.0.1:1/v1",
				apiKeyEnv: "DEEPSEEK_API_KEY",
				contextWindow: 1024,
				maxTokens: 256,
				bridgeUrl: "http://127.0.0.1:1/internal/dsh/commands",
			},
			source: {},
			apiKey: "fake",
		});
		// ⚠️ **进程环境是合法的**（dsh 禁的是 `.env` **文件**里的 DSH_*）
		expect(env.DSH_HOME).toBe("C:/tmp/dsh-home");
		// ⚠️ 我们插件读的一律是 AI_DSH_*（与 dsh 的命名空间分开）
		expect(env.AI_DSH_PROVIDER).toBe("deepseek-direct");
		expect(env.AI_DSH_API_KEY).toBe("fake");
		const ourKeys = Object.keys(env).filter((name) => name.startsWith("DSH_"));
		expect(ourKeys).toEqual(["DSH_HOME"]);
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
		apiKeyEnv: "AI_DSH_API_KEY",
		contextWindow: 1024,
		maxTokens: 256,
		bridgeUrl: "http://127.0.0.1:1/internal/dsh/commands",
	};

	it("MCP 服务器 ⇒ 翻译成 dsh 管理面的登记（**token 只在环境变量里**）", () => {
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
			Buffer.from(env.AI_DSH_MCP_SERVERS ?? "", "base64").toString("utf8"),
		) as Array<{ name?: string; entry?: Record<string, unknown> }>;
		expect(servers).toHaveLength(1);
		// ⚠️ **名字是键**（也是工具名的前缀 `mcp__<name>__`）。
		expect(servers[0]?.name).toBe("aiadmin");
		expect(servers[0]?.entry?.["transport"]).toBe("streamable-http");
		expect(servers[0]?.entry?.["url"]).toBe("https://a.test/mcp");
		expect(servers[0]?.entry?.["headers"]).toEqual({ Authorization: "Bearer jwt" });
	});

	it("技能目录 ⇒ 交给 dsh（**环境变量；每个会话一份**）", () => {
		const env = buildChildEnv({
			options: {
				conversationId: "conv-1",
				tools: [],
				systemPrompt: "你是助手。",
				skillDirs: ["C:/srv/ai/.pi/skills"],
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
		const dirs = JSON.parse(
			Buffer.from(env.AI_DSH_SKILL_DIRS ?? "", "base64").toString("utf8"),
		) as string[];
		expect(dirs).toEqual(["C:/srv/ai/.pi/skills"]);
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
			Buffer.from(env.AI_DSH_MCP_SERVERS ?? "", "base64").toString("utf8"),
		) as unknown[];
		expect(servers).toEqual([]);
	});
});
