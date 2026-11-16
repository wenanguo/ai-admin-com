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

import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db.ts";
import type { AgentConfig } from "../core/config/types.ts";
import type { AgentProvider } from "../core/config/registry.ts";
import { agentIdOfConversation } from "../core/config/registry.ts";
import type { PiSessionOptions } from "./pi-session.ts";
import { AgentError, AgentRuntime } from "./runtime.ts";
import type { ConversationRecord, ConversationStore, MessageRecord } from "./store.ts";

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
		mcpServers: [{ name: "aiadmin" }],
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
		create: async (userId: string, title: string | null, id?: string) => {
			const record: ConversationRecord = {
				conversationId: id ?? `conv-${created.length + 1}`,
				userId,
				title,
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
		createDataSource: () => ({
			createTask: async () => {
				throw new Error("本用例不该真的建任务");
			},
		}),
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
		expect(pmOptions?.mcp?.url).toBe("http://aiadmin.test/mcp");
		expect(qaOptions?.mcp).toBeUndefined();

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
});
