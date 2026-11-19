/**
 * 运行时 · **dsh 路径**的工具名归一化（spec §5.3）。
 *
 * ## 钉住的事
 *
 * 1. **dsh 路径**：MCP 的工具在模型侧叫 `mcp__aiadmin__create_task`
 *    ⇒ **给人看的名字**是 `create_task`（界面 / 待确认 / 审计）；
 * 2. **模型侧的名字不变**（还是带前缀的）⇒ 技能正文里写的工具名依然对得上；
 * 3. **pi 路径不动**（保持今天的行为 ⇒ 不改现有产品的显示 ⇒ #123 拔 pi 时自然统一）。
 */
import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AgentRuntime } from "./runtime.ts";
import type { AgentSessionLike } from "./session-registry.ts";
import type { ConversationRecord, ConversationStore, MessageRecord } from "../store/store.ts";
import type { AgentConfig } from "../config/types.ts";

/** 假的会话记录。 */
function conversation(): ConversationRecord {
	return {
		conversationId: "conv-1",
		userId: "2",
		title: "冒烟",
		agentId: null,
		dshSessionId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

/** 假的会话存取（不碰数据库）。 */
function fakeStore(): ConversationStore {
	const appended: MessageRecord[] = [];
	return {
		create: async () => conversation(),
		get: async (conversationId: string) =>
			conversationId === "conv-1" ? conversation() : undefined,
		list: async () => [conversation()],
		appendMessage: async (
			conversationId: string,
			role: MessageRecord["role"],
			content: string,
			seq: number,
		): Promise<MessageRecord> => {
			const record: MessageRecord = {
				id: `msg-${appended.length + 1}`,
				conversationId,
				role,
				content,
				seq,
				createdAt: new Date(),
			};
			appended.push(record);
			return record;
		},
		listMessages: async () => appended,
		maxSeq: async () => appended.length,
		setDshSessionId: async () => {},
		touch: async () => {},
	};
}

/** 假的智能体配置（**技能 / MCP / 工具白名单**都按我们要的来）。 */
function agentConfig(): AgentConfig {
	return {
		id: "pm",
		name: "PM 助手",
		description: "测试用",
		systemPrompt: "你是助手。",
		skills: [],
		mcpServers: [{ name: "aiadmin", type: "http", exposure: "direct" }],
		tools: [],
		dir: "agents/pm",
		configPath: "agents/pm/agent.yaml",
	};
}

/** 假会话（**一说话就发一个工具调用事件**）。 */
function fakeSession(toolName: string): AgentSessionLike {
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	return {
		prompt: async () => {
			for (const listener of listeners) {
				listener({
					type: "tool_execution_start",
					toolCallId: "call-1",
					toolName,
					args: { title: "写文档" },
				} as unknown as AgentSessionEvent);
			}
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: () => undefined,
		isStreaming: false,
	};
}

/** 造一个运行时（**指定 runner**）。 */
function makeRuntime(runner: "pi" | "dsh"): AgentRuntime {
	return new AgentRuntime({
		store: fakeStore(),
		audit: { write: async () => {} },
		sessionEvents: { list: async () => [], append: async () => {} },
		runner,
		agents: {
			defaultAgentId: "pm",
			get: (id: string) => (id === "pm" ? agentConfig() : undefined),
			list: () => [agentConfig()],
		},
		// ⚠️ **dsh 会话是假的**（不起进程 ⇒ 单测快）。
		createDshSession: async () => fakeSession("mcp__aiadmin__create_task"),
		// ⚠️ **pi 路径**：假会话发同样的事件（用来验证 pi 路径不变）。
		createSession: async () => fakeSession("mcp__aiadmin__create_task"),
	});
}

describe("运行时 · dsh 路径的工具名归一化", () => {
	it("MCP 的工具名 ⇒ **给人看的名字**是我们的命令名", async () => {
		const runtime = makeRuntime("dsh");
		await runtime.createConversation("2");
		const frames: { event: string; data: string }[] = [];
		runtime.subscribe("conv-1", (frame) => {
			frames.push({ event: frame.event, data: frame.data });
		});
		await runtime.submitCommand({
			conversationId: "conv-1",
			token: "t",
			message: "建个任务",
			commandId: "cmd-1",
			userId: "2",
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		const toolCall = frames.find((frame) => frame.event === "tool_call");
		expect(toolCall).toBeDefined();
		const payload = JSON.parse(toolCall?.data ?? "{}") as { toolName?: string };
		expect(payload.toolName).toBe("create_task");
	});
});

describe("运行时 · pi 路径**不动**（不改现有产品的显示）", () => {
	it("pi 路径的工具名**原样**（还是带前缀的）", async () => {
		const runtime = makeRuntime("pi");
		await runtime.createConversation("2");
		const frames: { event: string; data: string }[] = [];
		runtime.subscribe("conv-1", (frame) => {
			frames.push({ event: frame.event, data: frame.data });
		});
		await runtime.submitCommand({
			conversationId: "conv-1",
			token: "t",
			message: "建个任务",
			commandId: "cmd-1",
			userId: "2",
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		const toolCall = frames.find((frame) => frame.event === "tool_call");
		expect(toolCall).toBeDefined();
		const payload = JSON.parse(toolCall?.data ?? "{}") as { toolName?: string };
		expect(payload.toolName).toBe("mcp__aiadmin__create_task");
	});
});
