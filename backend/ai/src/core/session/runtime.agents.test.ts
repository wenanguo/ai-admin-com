/**
 * 运行时 · **按智能体配置装配会话**。
 *
 * ## 钉住的事
 *
 * 1. 两个智能体（PM 助手 / 通用问答）⇒ **提示词、模型、技能、MCP、工具全不一样**；
 * 2. **会话与智能体绑定**（会话 id 里带着智能体 id）⇒ 重建会话仍是同一个智能体；
 * 3. 老会话（id 里没有智能体）⇒ 回落**默认智能体**（行为不变）；
 * 4. 不认识的智能体 ⇒ **直接报错**（不建一个“不知道用什么提示词”的会话）。
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../store/db.ts";
import type { AgentConfig } from "../config/types.ts";
import type { AgentProvider } from "../config/registry.ts";
import { agentIdOfConversation } from "../config/registry.ts";
import type { PiSessionOptions } from "./pi-session.ts";
import { AgentError, AgentRuntime } from "./runtime.ts";
import type { ConversationRecord, ConversationStore, MessageRecord } from "../store/store.ts";
import { PluginRegistry, type AiPlugin } from "../plugins.ts";
import type { CommandTool } from "../tools/types.ts";

/**
 * 假插件 —— 提供一个 `create_task` 命令（**本用例不该真的建任务**）。
 *
 * ⚠️ **命令目录来自插件**（内核不认业务）⇒ 这里塞一个只装假插件的注册表。
 */
function fakePlugins(): PluginRegistry {
	const registry = new PluginRegistry();
	registry.register({
		// ⚠️ id 要跟**真实智能体配置**里写的一致（agents/pm/agent.yaml ⇒ plugin: pm）
		id: "pm",
		commands: [
			{
				name: "create_task",
				label: "创建任务",
				build: () =>
					({
						name: "create_task",
						label: "创建任务",
						description: "假的建任务命令（测试用）",
						parameters: {},
						annotations: {
							readOnlyHint: false,
							destructiveHint: false,
							idempotentHint: false,
						},
						execute: async () => {
							throw new Error("本用例不该真的建任务");
						},
					}) as unknown as CommandTool,
			},
		],
	});
	return registry;
}

/* ------------------------------------------------------------------ 假实现 */

/** PM 助手的配置（等价于仓里的 `agents/pm/agent.yaml`）。 */
function pmConfig(): AgentConfig {
	return {
		id: "pm",
		name: "PM 助手",
		description: "项目管理助手",
		model: "minimax-cn/MiniMax-M3.1-Flash",
		systemPrompt: "你是 PM 助手",
		skills: ["/srv/ai/.pi/skills"],
		mcpServers: [{ name: "aiadmin", type: "http", exposure: "direct" }],
		tools: ["create_task"],
		dir: "/srv/ai/agents/pm",
		configPath: "/srv/ai/agents/pm/agent.yaml",
	};
}

/** 通用问答的配置（没有工具、没有 MCP、没有技能）。 */
function qaConfig(): AgentConfig {
	return {
		id: "qa",
		name: "通用问答",
		description: "只会聊天",
		systemPrompt: "你是通用问答助手",
		skills: [],
		mcpServers: [],
		tools: [],
		dir: "/srv/ai/agents/qa",
		configPath: "/srv/ai/agents/qa/agent.yaml",
	};
}

/** 假的智能体来源。 */
function fakeAgents(): AgentProvider {
	const configs = [pmConfig(), qaConfig()];
	return {
		defaultAgentId: "pm",
		get: (agentId) => configs.find((config) => config.id === agentId),
		list: () => configs,
	};
}

/** 假的会话存取（**记下建会话时用的 id**）。 */
function fakeStore(): {
	store: ConversationStore;
	created: ConversationRecord[];
} {
	const created: ConversationRecord[] = [];
	const messages: MessageRecord[] = [];
	const store: ConversationStore = {
		create: async (
			userId: string,
			title: string | null,
			id?: string,
			agentId?: string,
		) => {
			const record: ConversationRecord = {
				conversationId: id ?? `conv-${created.length + 1}`,
				userId,
				title,
				agentId: agentId ?? null,
				dshSessionId: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			created.push(record);
			return record;
		},
		get: async (conversationId: string) =>
			created.find((record) => record.conversationId === conversationId),
		list: async () => created,
		appendMessage: async (
			conversationId: string,
			role: MessageRecord["role"],
			content: string,
			seq: number,
		): Promise<MessageRecord> => {
			const record: MessageRecord = {
				id: `msg-${messages.length + 1}`,
				conversationId,
				role,
				content,
				seq,
				createdAt: new Date(),
			};
			messages.push(record);
			return record;
		},
		listMessages: async (conversationId: string) =>
			messages.filter((row) => row.conversationId === conversationId),
		maxSeq: async (conversationId: string) =>
			messages.filter((row) => row.conversationId === conversationId).length,
		setDshSessionId: async () => {},
		touch: async () => {},
	};
	return { store, created };
}

/** 造一个运行时（记下每次建 pi 会话拿到的参数）。 */
function makeRuntime(store: ConversationStore): {
	runtime: AgentRuntime;
	sessionOptions: PiSessionOptions[];
} {
	const sessionOptions: PiSessionOptions[] = [];
	const runtime = new AgentRuntime({
		store,
		agents: fakeAgents(),
		// ⚠️ **MCP 地址写死**（不依赖环境变量 ⇒ 断言稳定）
		mcpUrl: "http://aiadmin.test/mcp",
		audit: {
			write: async () => {},
		},
		createSession: async (options: PiSessionOptions) => {
			sessionOptions.push(options);
			return {
				prompt: async (): Promise<void> => {},
				subscribe: () => () => {},
				dispose: () => {},
				isStreaming: false,
			};
		},
		plugins: fakePlugins(),
		resolveUser: async () => ({ id: 2, name: "测试用户" }),
	});
	return { runtime, sessionOptions };
}

/** 发一条命令（把会话跑起来 ⇒ 触发建 pi 会话）。 */
async function talk(runtime: AgentRuntime, conversationId: string, commandId: string): Promise<void> {
	await runtime.submitCommand({
		conversationId,
		token: "test-token",
		message: "你好",
		commandId,
		userId: "2",
	});
}

/** 等条件成立。 */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("等待超时");
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

afterAll(async () => {
	await prisma.$disconnect();
});

/* ------------------------------------------------------------------ 用例 */

describe("运行时 · 按智能体配置装配会话", () => {
	it("两个智能体 ⇒ 提示词 / 工具 / MCP / 技能全不一样", async () => {
		const { store } = fakeStore();
		const { runtime, sessionOptions } = makeRuntime(store);

		const pm = await runtime.createConversation("2", "PM 会话", "pm");
		const qa = await runtime.createConversation("2", "问答会话", "qa");

		await talk(runtime, pm.conversationId, "cmd-1");
		await talk(runtime, qa.conversationId, "cmd-2");
		await waitFor(() => sessionOptions.length >= 2);

		const pmOptions = sessionOptions.find(
			(options) => options.conversationId === pm.conversationId,
		);
		const qaOptions = sessionOptions.find(
			(options) => options.conversationId === qa.conversationId,
		);

		// ① 提示词各是各的
		expect(pmOptions?.systemPrompt).toBe("你是 PM 助手");
		expect(qaOptions?.systemPrompt).toBe("你是通用问答助手");

		// ② **工具白名单**：PM 有 create_task，问答一个都没有
		expect(pmOptions?.tools.map((tool) => tool.name)).toEqual(["create_task"]);
		expect(qaOptions?.tools).toEqual([]);

		// ③ MCP：PM 接（地址取全局默认），问答不接
		expect(pmOptions?.mcpServers?.[0]?.url).toBe("http://aiadmin.test/mcp");
		expect(qaOptions?.mcpServers).toEqual([]);

		// ④ 技能目录：PM 有，问答没有
		expect(pmOptions?.skillsDirs).toEqual(["/srv/ai/.pi/skills"]);
		expect(qaOptions?.skillsDirs).toEqual([]);

		// ⑤ 模型：配置里写死的那个（不是全局默认）
		expect(pmOptions?.model).toBe("minimax-cn/MiniMax-M3.1-Flash");
	});

	it("会话 id 里带着智能体 id ⇒ 重建会话仍是同一个智能体", async () => {
		const { store, created } = fakeStore();
		const { runtime } = makeRuntime(store);

		const qa = await runtime.createConversation("2", "问答会话", "qa");
		// ⚠️ **绑定跟着会话走**（不靠内存里的映射 ⇒ 进程重启也还在）
		expect(agentIdOfConversation(qa.conversationId)).toBe("qa");
		expect(qa.conversationId.startsWith("qa_")).toBe(true);
		expect(created[0]?.conversationId).toBe(qa.conversationId);
	});

	it("老会话（id 里没有智能体）⇒ 用默认智能体（行为不变）", async () => {
		const { store } = fakeStore();
		const { runtime, sessionOptions } = makeRuntime(store);

		// 假装这是一个「本条之前建的」会话（id 里没有智能体）
		const legacy = await runtime.createConversation("2", "老会话");
		expect(agentIdOfConversation(legacy.conversationId)).toBe("pm");

		await talk(runtime, legacy.conversationId, "cmd-1");
		await waitFor(() => sessionOptions.length >= 1);
		expect(sessionOptions[0]?.systemPrompt).toBe("你是 PM 助手");
	});

	it("不认识的智能体 ⇒ 直接报错（不建会话）", async () => {
		const { store, created } = fakeStore();
		const { runtime } = makeRuntime(store);

		await expect(
			runtime.createConversation("2", "会话", "nope"),
		).rejects.toBeInstanceOf(AgentError);
		expect(created).toHaveLength(0);
	});

	it("没指定智能体 ⇒ 用默认智能体", async () => {
		const { store } = fakeStore();
		const { runtime } = makeRuntime(store);

		const conversation = await runtime.createConversation("2", "会话");
		expect(agentIdOfConversation(conversation.conversationId)).toBe("pm");
	});

	it("⚠️ **智能体维度入库**（`ai_conversation.agent_id`）", async () => {
		const { store, created } = fakeStore();
		const { runtime } = makeRuntime(store);

		const conversation = await runtime.createConversation("2", "会话", "qa");

		// ⚠️ **库里有这一列**（不靠会话 id 猜）
		expect(created[0]?.agentId).toBe("qa");
		expect(conversation.agentId).toBe("qa");
	});

	it("⚠️ 库里记的智能体**优先于**会话 id 的前缀", async () => {
		const { store, created } = fakeStore();
		const { runtime, sessionOptions } = makeRuntime(store);

		// 建一个会话：id 前缀是 `qa_`，库里记的也是 qa
		const conversation = await runtime.createConversation("2", "会话", "qa");
		// ⚠️ 事后把**库里的**改成 pm（模拟“改了配置/迁了数据”）
		//    ⇒ 重建会话时**听库的**（不是听 id 前缀）
		const record = created[0];
		if (record) {
			record.agentId = "pm";
		}
		await talk(runtime, conversation.conversationId, "cmd-1");
		await waitFor(() => sessionOptions.length >= 1);

		expect(sessionOptions[0]?.systemPrompt).toBe("你是 PM 助手");
	});
});

describe("运行时 · 插件按智能体（阶段 4 的接线）", () => {
	/** 造一个只提供某条命令的假插件。 */
	function pluginWith(id: string, command: string): AiPlugin {
		return {
			id,
			commands: [
				{
					name: command,
					label: command,
					build: () =>
						({
							name: command,
							label: command,
							description: "假的命令",
							parameters: {},
							annotations: { readOnlyHint: true },
							execute: async () => ({ content: [] }),
						}) as unknown as CommandTool,
				},
			],
		};
	}

	/** 两个智能体各挂一个插件 ⇒ 各自的能力**明显不同**。 */
	it("两个智能体 ⇒ 各自拿自己插件的命令", async () => {
		const registry = new PluginRegistry();
		registry.register(pluginWith("alpha", "cmd_alpha"));
		registry.register(pluginWith("beta", "cmd_beta"));

		const providers: AgentProvider[] = [
			{
				defaultAgentId: "alpha",
				get: (agentId) =>
					agentId === "alpha"
						? { ...pmConfig(), id: "alpha", plugin: "alpha", tools: ["cmd_alpha"] }
						: { ...qaConfig(), id: "beta", plugin: "beta", tools: ["cmd_beta"] },
				list: () => [{ ...pmConfig(), id: "alpha" }, { ...qaConfig(), id: "beta" }],
			},
		];
		const { store } = fakeStore();
		const sessionOptions: PiSessionOptions[] = [];
		const runtime = new AgentRuntime({
			store,
			agents: providers[0]!,
			plugins: registry,
			mcpUrl: null,
			audit: { write: async () => {} },
			createSession: async (options: PiSessionOptions) => {
				sessionOptions.push(options);
				return {
					prompt: async (): Promise<void> => {},
					subscribe: () => () => {},
					dispose: () => {},
					isStreaming: false,
				};
			},
			resolveUser: async () => ({ id: 2 }),
		});

		const alpha = await runtime.createConversation("2", "会话", "alpha");
		const beta = await runtime.createConversation("2", "会话", "beta");
		await talk(runtime, alpha.conversationId, "cmd-1");
		await talk(runtime, beta.conversationId, "cmd-2");
		await waitFor(() => sessionOptions.length >= 2);

		const alphaOptions = sessionOptions.find((o) => o.conversationId === alpha.conversationId);
		const betaOptions = sessionOptions.find((o) => o.conversationId === beta.conversationId);
		// ⚠️ 各自的插件给各自的命令（**不串**）
		expect(alphaOptions?.tools.map((tool) => tool.name)).toEqual(["cmd_alpha"]);
		expect(betaOptions?.tools.map((tool) => tool.name)).toEqual(["cmd_beta"]);
	});

	it("配置里写了没注册的插件 ⇒ **启动即失败**（不静默降级）", () => {
		const registry = new PluginRegistry();
		registry.register(pluginWith("alpha", "cmd_alpha"));
		const providers: AgentProvider[] = [
			{
				defaultAgentId: "alpha",
				get: () => ({ ...pmConfig(), id: "alpha", plugin: "没注册过的插件" }),
				list: () => [{ ...pmConfig(), id: "alpha", plugin: "没注册过的插件" }],
			},
		];
		const runtime = new AgentRuntime({
			store: fakeStore().store,
			agents: providers[0]!,
			plugins: registry,
			mcpUrl: null,
			audit: { write: async () => {} },
		});
		// ⚠️ 入口（server.ts 的 createApp）会调它 ⇒ 拼错插件名**服务起不来**
		expect(() => runtime.validatePlugins()).toThrow(/没注册/);
	});
});

describe("运行时 · 技能按智能体", () => {
	/** 造一个技能目录（放一个技能）。 */
	function makeSkillsDir(name: string): string {
		const dir = mkdtempSync(join(tmpdir(), "runtime-agent-skills-"));
		mkdirSync(join(dir, name), { recursive: true });
		writeFileSync(
			join(dir, name, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${name} 的说明。\n---\n`,
			"utf8",
		);
		return dir;
	}

	it("各智能体只看到**自己**的技能（没配就是没有）", async () => {
		const pmSkills = makeSkillsDir("create-task");
		const providers: AgentProvider[] = [
			{
				defaultAgentId: "pm",
				get: (agentId) =>
					agentId === "pm"
						? { ...pmConfig(), skills: [pmSkills] }
						: agentId === "qa"
							? qaConfig()
							: undefined,
				list: () => [pmConfig(), qaConfig()],
			},
		];
		const { store } = fakeStore();
		const runtime = new AgentRuntime({
			store,
			agents: providers[0]!,
			audit: { write: async () => {} },
		});

		// ① PM 助手看得到自己的技能
		expect((await runtime.listAgentSkills("pm")).map((s) => s.name)).toEqual([
			"create-task",
		]);
		// ② 通用问答没配技能 ⇒ 空列表（**不是异常**）
		expect(await runtime.listAgentSkills("qa")).toEqual([]);
		// ③ 不给智能体 ⇒ 默认智能体（PM 助手）
		expect((await runtime.listAgentSkills()).map((s) => s.name)).toEqual(["create-task"]);
		// ④ 不认识的智能体 ⇒ 报错
		await expect(runtime.listAgentSkills("nope")).rejects.toThrowError(/不存在/);
	});
});

describe("运行时 · MCP 服务器（0 / 1 / N 个）", () => {
	/** 造一个带 N 台服务器的智能体来源。 */
	function agentsWith(count: number): AgentProvider {
		const servers = Array.from({ length: count }, (_, index) => ({
			name: `srv${index + 1}`,
			url: `http://srv${index + 1}.test/mcp`,
			type: "http" as const,
			exposure: "direct" as const,
		}));
		const config: AgentConfig = {
			id: "multi",
			name: "多服务器",
			description: "说明",
			systemPrompt: "你是多服务器助手",
			skills: [],
			mcpServers: servers,
			tools: [],
			dir: "/srv/ai/agents/multi",
			configPath: "/srv/ai/agents/multi/agent.yaml",
		};
		return {
			defaultAgentId: "multi",
			get: (agentId) => (agentId === "multi" ? config : undefined),
			list: () => [config],
		};
	}

	/** 造一个运行时（用指定的智能体来源）。 */
	function makeRuntime(agents: AgentProvider): {
		runtime: AgentRuntime;
		sessionOptions: PiSessionOptions[];
	} {
		const { store } = fakeStore();
		const sessionOptions: PiSessionOptions[] = [];
		const runtime = new AgentRuntime({
			store,
			agents,
			mcpUrl: null,
			audit: { write: async () => {} },
			createSession: async (options: PiSessionOptions) => {
				sessionOptions.push(options);
				return {
					prompt: async (): Promise<void> => {},
					subscribe: () => () => {},
					dispose: () => {},
					isStreaming: false,
				};
			},
			plugins: fakePlugins(),
			resolveUser: async () => ({ id: 2, name: "测试用户" }),
		});
		return { runtime, sessionOptions };
	}

	it("0 个 ⇒ 不挂任何 MCP", async () => {
		const { runtime, sessionOptions } = makeRuntime(agentsWith(0));
		const conversation = await runtime.createConversation("2", "会话");
		await talk(runtime, conversation.conversationId, "cmd-1");
		await waitFor(() => sessionOptions.length >= 1);

		expect(sessionOptions[0]?.mcpServers).toEqual([]);
	});

	it("1 个 ⇒ 挂一台（名字与地址都来自配置）", async () => {
		const { runtime, sessionOptions } = makeRuntime(agentsWith(1));
		const conversation = await runtime.createConversation("2", "会话");
		await talk(runtime, conversation.conversationId, "cmd-1");
		await waitFor(() => sessionOptions.length >= 1);

		expect(sessionOptions[0]?.mcpServers?.map((server) => server.name)).toEqual([
			"srv1",
		]);
		expect(sessionOptions[0]?.mcpServers?.[0]?.url).toBe("http://srv1.test/mcp");
	});

	it("N 个 ⇒ 全都挂上（名字决定工具名前缀）", async () => {
		const { runtime, sessionOptions } = makeRuntime(agentsWith(3));
		const conversation = await runtime.createConversation("2", "会话");
		await talk(runtime, conversation.conversationId, "cmd-1");
		await waitFor(() => sessionOptions.length >= 1);

		expect(sessionOptions[0]?.mcpServers?.map((server) => server.name)).toEqual([
			"srv1",
			"srv2",
			"srv3",
		]);
	});

	it("配置里没写地址、也没全局默认 ⇒ 那台不挂", async () => {
		const { runtime, sessionOptions } = makeRuntime({
			...agentsWith(1),
			get: () => ({
				id: "multi",
				name: "多服务器",
				description: "说明",
				systemPrompt: "你是助手",
				skills: [],
				mcpServers: [
					{ name: "srv1", type: "http", exposure: "direct" },
				],
				tools: [],
				dir: "/srv/ai/agents/multi",
				configPath: "/srv/ai/agents/multi/agent.yaml",
			}),
		});
		const conversation = await runtime.createConversation("2", "会话");
		await talk(runtime, conversation.conversationId, "cmd-1");
		await waitFor(() => sessionOptions.length >= 1);

		expect(sessionOptions[0]?.mcpServers).toEqual([]);
	});
});
