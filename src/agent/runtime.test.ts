/**
 * 运行时 —— **命令去重**（Idempotency-Key）与**告警去处**。
 *
 * 这两条都是对外的契约：
 *
 * 1. **同一个 `commandId` 再来一次 ⇒ 回上次那个 ack，不再跑一遍。**
 *    本切片唯一的命令是**写**（建任务）⇒ 重跑一次就是多建一个任务，
 *    而且是**静默**的（前端只看到「成功」）。客户端重试、双击、代理重发
 *    都会撞上这个窗口 ⇒ 去重必须做在运行时这一层。
 *
 * 2. **枚举归一遇到不认识的线上码 ⇒ 要看得见。**
 *    机制本来就有（`enums.ts` 的 sink），但没人注入 ⇒ 告警落进一个模块数组、
 *    然后被丢掉 ⇒ 「不猜语义」的承诺是**不可观测**的。
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { taskStatusToUnified } from "../adapter/enums";
import type { CreateTaskInput } from "../adapter/datasource";
import type { UnifiedTask } from "../adapter/model";
import { prisma } from "../db";
import { AgentRuntime } from "./runtime";
import type { ConversationRecord, ConversationStore, MessageRecord } from "./store";
import type { CommandTool } from "../tools/types";

/* ------------------------------------------------------------------ 假实现 */

/** 审计条目（测试自己声明形状：运行时只把它当「不透明的一条记录」用）。 */
interface AuditRecord {
	actorType: string;
	command: string;
	args: Record<string, unknown>;
	before: unknown;
	after: unknown;
	userId: string;
}

/** 假的审计去处（只记，不落库）。 */
function fakeAudit(): {
	writer: { write: (entry: AuditRecord) => Promise<void> };
	entries: AuditRecord[];
} {
	const entries: AuditRecord[] = [];
	return {
		entries,
		writer: {
			write: async (entry: AuditRecord): Promise<void> => {
				entries.push(entry);
			},
		},
	};
}

/** 假的任务（带写快照 —— 真实数据源自带）。 */
function fakeTask(): UnifiedTask {
	const entity: UnifiedTask = {
		key: "task:321",
		project_key: "project:45",
		title: "标题",
		type: "FEATURE",
		status: "BACKLOG",
		priority: "P2",
		reviewers: [],
		labels: [],
		sort_order: "0",
		source: "NL_CHAT",
	};
	return { ...entity, snapshot: { op: "create", before: null, after: entity } };
}

/** 假的会话记录。 */
function fakeConversation(): ConversationRecord {
	return {
		conversationId: "conv-1",
		userId: "2",
		title: "冒烟",
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

/** 假的会话存取（不碰数据库）。 */
function fakeStore(conversation: ConversationRecord): {
	store: ConversationStore;
	appended: MessageRecord[];
} {
	const appended: MessageRecord[] = [];
	const store: ConversationStore = {
		create: async () => conversation,
		get: async (conversationId: string) =>
			conversationId === conversation.conversationId ? conversation : undefined,
		list: async () => [conversation],
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
		touch: async () => {},
	};
	return { store, appended };
}

/** 造一个运行时（工具一被调用就真的调数据源 ⇒ 能数出「跑了几遍」）。 */
function makeRuntime(options: { maxTrackedCommands?: number } = {}): {
	runtime: AgentRuntime;
	calls: CreateTaskInput[];
	appended: MessageRecord[];
} {
	const calls: CreateTaskInput[] = [];
	const { store, appended } = fakeStore(fakeConversation());
	const audit = fakeAudit();

	const runtime = new AgentRuntime({
		store,
		audit: audit.writer,
		maxTrackedCommands: options.maxTrackedCommands,
		// 假会话：一收到 prompt 就调工具（模拟模型调 create_task）
		createSession: async (tools: CommandTool[]) => ({
			prompt: async (): Promise<void> => {
				const tool = tools[0];
				if (tool === undefined) {
					throw new Error("一个工具都没注册");
				}
				await tool.execute("call-1", { project_key: "PRJ-1", title: "标题" });
			},
			subscribe: () => () => {},
			dispose: () => {},
			isStreaming: false,
		}),
		createDataSource: () => ({
			createTask: async (input: CreateTaskInput) => {
				calls.push(input);
				return fakeTask();
			},
		}),
		resolveUser: async () => ({ id: 2 }),
	});
	return { runtime, calls, appended };
}

/** 等条件成立（最多 timeoutMs 毫秒）。 */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("等待超时（条件一直没成立）");
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/** 睡一小会儿（用来确认「没有第二轮」）。 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一条命令的请求体。 */
function command(commandId: string, message = "建个任务"): {
	conversationId: string;
	token: string;
	message: string;
	commandId: string;
	userId: string;
} {
	return {
		conversationId: "conv-1",
		token: "caller-token-must-not-leak",
		message,
		commandId,
		userId: "2",
	};
}

afterAll(async () => {
	// 关掉 Prisma 的连接引擎（测试不查库，但模块级单例已经建好了）
	await prisma.$disconnect();
});

/* ------------------------------------------------------------------ 用例 */

describe("运行时 · 命令去重（Idempotency-Key）", () => {
	it("同一个 commandId 提交两次 ⇒ 工具只跑了一次，两次拿到同一个 ack", async () => {
		const { runtime, calls } = makeRuntime();

		const first = await runtime.submitCommand(command("cmd-1"));
		await waitFor(() => calls.length >= 1);

		const second = await runtime.submitCommand(command("cmd-1"));
		await sleep(50);

		// ⚠️ 关键断言：**只跑了一次**（否则就是两个任务）
		expect(calls).toHaveLength(1);
		// 两次拿到的是同一个 ack
		expect(second).toEqual(first);
		expect(second.id).toBe("cmd-1");
		expect(second.success).toBe(true);
	});

	it("重复的 commandId 不会把用户那句话再落一次库", async () => {
		const { runtime, calls, appended } = makeRuntime();

		await runtime.submitCommand(command("cmd-1"));
		await waitFor(() => calls.length >= 1);
		await runtime.submitCommand(command("cmd-1"));
		await sleep(50);

		expect(appended).toHaveLength(1);
	});

	it("不同的 commandId ⇒ 各自都跑（不会误吞）", async () => {
		const { runtime, calls } = makeRuntime();

		await runtime.submitCommand(command("cmd-1"));
		await waitFor(() => calls.length >= 1);
		await runtime.submitCommand(command("cmd-2"));
		await waitFor(() => calls.length >= 2);
		await sleep(50);

		expect(calls).toHaveLength(2);
	});

	it("命令 id 记满上限 ⇒ 最老的那条被淘汰（再来一次会重新跑）", async () => {
		const { runtime, calls } = makeRuntime({ maxTrackedCommands: 2 });

		await runtime.submitCommand(command("cmd-a"));
		await waitFor(() => calls.length >= 1);
		await runtime.submitCommand(command("cmd-b"));
		await waitFor(() => calls.length >= 2);
		await runtime.submitCommand(command("cmd-c"));
		await waitFor(() => calls.length >= 3);

		// cmd-a 已被淘汰 ⇒ 再发一次会**重新跑**（而不是被当成重复）
		await runtime.submitCommand(command("cmd-a"));
		await waitFor(() => calls.length >= 4);

		expect(calls).toHaveLength(4);
	});
});

describe("运行时 · 告警去处", () => {
	it("未识别的枚举值会打日志（告警不再被悄悄丢掉）", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			// 构造运行时 = 装上告警去处
			makeRuntime();
			taskStatusToUnified("瞎写的状态");

			expect(warn).toHaveBeenCalled();
			const text = warn.mock.calls.map((call) => String(call[0])).join("\n");
			expect(text).toContain("瞎写的状态");
			// 日志里不许出现凭据
			expect(text).not.toContain("caller-token-must-not-leak");
		} finally {
			warn.mockRestore();
		}
	});
});
