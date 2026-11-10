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
import type { PiSessionOptions } from "./pi-session";
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
	/** 造 pi 会话时收到的参数（用来断言「历史有没有交给它」）。 */
	sessionOptions: PiSessionOptions[];
} {
	const calls: CreateTaskInput[] = [];
	const { store, appended } = fakeStore(fakeConversation());
	const audit = fakeAudit();
	const sessionOptions: PiSessionOptions[] = [];

	const runtime = new AgentRuntime({
		store,
		audit: audit.writer,
		maxTrackedCommands: options.maxTrackedCommands,
		// 假会话：一收到 prompt 就调工具（模拟模型调 create_task）
		createSession: async (options: PiSessionOptions) => {
			sessionOptions.push(options);
			const tools = options.tools;
			return {
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
			};
		},
		createDataSource: () => ({
			createTask: async (input: CreateTaskInput) => {
				calls.push(input);
				return fakeTask();
			},
		}),
		resolveUser: async () => ({ id: 2 }),
	});
	return { runtime, calls, appended, sessionOptions };
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

/* -------------------------------------------------- P0：会话上下文还原 */

/**
 * 场景：**进程重启后**（或通道被回收后），模型仍然记得之前聊过什么。
 *
 * ⇒ 验收标准：新建的 pi 会话拿到的 `history` 里**有**之前的对话。
 */
describe("运行时 · 会话上下文（P0）", () => {
	it("建 pi 会话时把会话 id 与历史交给它", async () => {
		const { runtime, sessionOptions } = makeRuntime();

		await runtime.submitCommand(command("cmd-1"));
		await waitFor(() => sessionOptions.length >= 1);

		expect(sessionOptions[0]?.conversationId).toBe("conv-1");
		// ⚠️ **当前这句不在历史里** —— 它随后由 `prompt()` 加进 pi 的消息列表，
		//    两边都放的话模型会看到同一句话两遍。
		expect(sessionOptions[0]?.history).toHaveLength(0);
	});

	it("当前这句不会既进历史又进 prompt（模型只看一遍）", async () => {
		const { runtime, sessionOptions } = makeRuntime();

		await runtime.submitCommand(command("cmd-1", "这句话别看两遍"));
		await waitFor(() => sessionOptions.length >= 1);

		expect(
			sessionOptions[0]?.history.some((row) => row.content === "这句话别看两遍"),
		).toBe(false);
	});

	it("⭐ 重启后新建的会话仍然带着之前的历史（模型不会失忆）", async () => {
		const { store, appended } = fakeStore(fakeConversation());
		const audit = fakeAudit();
		const sessionOptions: PiSessionOptions[] = [];

		// 第一个「进程」：聊了一轮（用户一句 + 助手一句）
		const first = new AgentRuntime({
			store,
			audit: audit.writer,
			createSession: async (options: PiSessionOptions) => {
				sessionOptions.push(options);
				return {
					prompt: async (): Promise<void> => {
						// 模拟助手回答落库
						await store.appendMessage("conv-1", "ASSISTANT", "好，建了", 2);
					},
					subscribe: () => () => {},
					dispose: () => {},
					isStreaming: false,
				};
			},
			createDataSource: () => ({
				createTask: async (input: CreateTaskInput) => {
					void input;
					return fakeTask();
				},
			}),
			resolveUser: async () => ({ id: 2 }),
		});
		await first.submitCommand(command("cmd-1"));
		await waitFor(() => appended.length >= 2);
		await first.closeAll();

		// 第二个「进程」：同一个 store（历史还在），新建一个运行时
		const second = new AgentRuntime({
			store,
			audit: audit.writer,
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
				createTask: async (input: CreateTaskInput) => {
					void input;
					return fakeTask();
				},
			}),
			resolveUser: async () => ({ id: 2 }),
		});
		await second.submitCommand(command("cmd-2"));
		await waitFor(() => sessionOptions.length >= 2);

		// ⚠️ 关键断言：新会话拿到的历史里**有**重启前的对话
		const restored = sessionOptions[1];
		expect(restored?.conversationId).toBe("conv-1");
		expect(restored?.history.map((row) => `${row.role}:${row.content}`)).toEqual([
			"USER:建个任务",
			"ASSISTANT:好，建了",
		]);
	});
});

/* ------------------------------------------- P1：pi 原生的排队语义 */

/** 造一个「正在流式输出」的运行时（假会话的 isStreaming 恒为 true）。 */
function makeStreamingRuntime(): {
	runtime: AgentRuntime;
	prompted: string[];
	followed: string[];
	steered: string[];
} {
	const { store } = fakeStore(fakeConversation());
	const audit = fakeAudit();
	const prompted: string[] = [];
	const followed: string[] = [];
	const steered: string[] = [];

	const runtime = new AgentRuntime({
		store,
		audit: audit.writer,
		createSession: async (options: PiSessionOptions) => ({
			prompt: async (text: string): Promise<void> => {
				prompted.push(text);
			},
			subscribe: () => () => {},
			dispose: () => {},
			isStreaming: true,
			followUp: async (text: string) => {
				followed.push(text);
				return "queued" as const;
			},
			steer: async (text: string) => {
				steered.push(text);
				return "queued" as const;
			},
		}),
		createDataSource: () => ({
			createTask: async (input: CreateTaskInput) => {
				void input;
				return fakeTask();
			},
		}),
		resolveUser: async () => ({ id: 2 }),
	});

	return { runtime, prompted, followed, steered };
}

describe("运行时 · 排队语义（P1）", () => {
	it("轮次在跑时，普通 prompt 走 followUp（排队，不打断）", async () => {
		const { runtime, prompted, followed } = makeStreamingRuntime();

		await runtime.submitCommand(command("cmd-1", "第一句"));
		await waitFor(() => followed.length >= 1);

		expect(followed).toEqual(["第一句"]);
		// ⚠️ 没有另起一轮（否则就是两个模型请求在抢）
		expect(prompted).toHaveLength(0);
	});

	it("轮次在跑时，prompt-steer 走 steer（打断当前轮）", async () => {
		const { runtime, followed, steered } = makeStreamingRuntime();

		await runtime.submitCommand({
			...command("cmd-1", "改主意了"),
			type: "prompt-steer",
		});
		await waitFor(() => steered.length >= 1);

		expect(steered).toEqual(["改主意了"]);
		expect(followed).toHaveLength(0);
	});

	it("轮次在跑时，prompt-followup 明确排队（不进 steer）", async () => {
		const { runtime, followed, steered } = makeStreamingRuntime();

		await runtime.submitCommand({
			...command("cmd-1", "排队这句"),
			type: "prompt-followup",
		});
		await waitFor(() => followed.length >= 1);

		expect(followed).toEqual(["排队这句"]);
		expect(steered).toHaveLength(0);
	});
});

/* ------------------------------------------------------------- P2：中止 */

/** 造一个能中止的运行时。 */
function makeAbortableRuntime(): {
	runtime: AgentRuntime;
	abortedCount: () => number;
} {
	const { store } = fakeStore(fakeConversation());
	const audit = fakeAudit();
	let aborted = 0;

	const runtime = new AgentRuntime({
		store,
		audit: audit.writer,
		createSession: async (options: PiSessionOptions) => ({
			prompt: async (): Promise<void> => {
				void options;
			},
			subscribe: () => () => {},
			dispose: () => {},
			isStreaming: true,
			abort: async (): Promise<void> => {
				aborted += 1;
			},
		}),
		createDataSource: () => ({
			createTask: async (input: CreateTaskInput) => {
				void input;
				return fakeTask();
			},
		}),
		resolveUser: async () => ({ id: 2 }),
	});

	return { runtime, abortedCount: () => aborted };
}

describe("运行时 · 中止（P2）", () => {
	it("abort 会叫 pi 的 session.abort()", async () => {
		const { runtime, abortedCount } = makeAbortableRuntime();

		await runtime.submitCommand(command("cmd-1"));
		await waitFor(() => abortedCount() >= 0);
		await runtime.abort("conv-1", "2");

		expect(abortedCount()).toBe(1);
	});

	it("中止别人的会话 ⇒ 报「不存在」（不泄露会话是否存在）", async () => {
		const { runtime } = makeAbortableRuntime();

		await expect(runtime.abort("conv-1", "999")).rejects.toThrow(/不存在/);
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

/* ------------------------------------------- P4：token 轮换（MCP 身份） */

/**
 * 场景：同一个会话，调用方的 token 换了（重新登录 / token 轮换）。
 *
 * ⚠️ **越权风险**：老会话的 MCP 连接带着**旧 token** ⇒
 *    模型调 MCP 时用的还是上一个人的身份。
 */
describe("运行时 · token 轮换（P4）", () => {
	/** 造一个能记录 createSession 参数的运行时。 */
	function makeRuntimeWithMcp(mcpUrl: string | null): {
		runtime: AgentRuntime;
		created: PiSessionOptions[];
	} {
		const { store } = fakeStore(fakeConversation());
		const audit = fakeAudit();
		const created: PiSessionOptions[] = [];

		const runtime = new AgentRuntime({
			store,
			audit: audit.writer,
			mcpUrl,
			createSession: async (options: PiSessionOptions) => {
				created.push(options);
				return {
					prompt: async (): Promise<void> => {},
					subscribe: () => () => {},
					dispose: () => {},
					isStreaming: false,
				};
			},
			createDataSource: () => ({
				createTask: async (input: CreateTaskInput) => {
					void input;
					return fakeTask();
				},
			}),
			resolveUser: async () => ({ id: 2 }),
		});

		return { runtime, created };
	}

	it("token 变了 ⇒ 重建 pi 会话（老会话不能继续用旧 token 调 MCP）", async () => {
		const { runtime, created } = makeRuntimeWithMcp("http://aiadmin.test/api/v1/mcp");

		await runtime.submitCommand({ ...command("cmd-1"), token: "token-a" });
		await waitFor(() => created.length >= 1);
		expect(created[0]?.mcp?.token).toBe("token-a");

		// ⚠️ 同一个会话，但 token 换了
		await runtime.submitCommand({ ...command("cmd-2"), token: "token-b" });
		await waitFor(() => created.length >= 2);

		// ⇒ 重建了一个会话，带的是**新** token
		expect(created[1]?.mcp?.token).toBe("token-b");
	});

	it("token 没变 ⇒ 不重建会话（别每次都重连 MCP）", async () => {
		const { runtime, created } = makeRuntimeWithMcp("http://aiadmin.test/api/v1/mcp");

		await runtime.submitCommand({ ...command("cmd-1"), token: "token-a" });
		await waitFor(() => created.length >= 1);
		await runtime.submitCommand({ ...command("cmd-2"), token: "token-a" });
		await sleep(50);

		expect(created).toHaveLength(1);
	});

	it("没配 MCP 地址 ⇒ 不接 MCP（后端还没部署时零噪音）", async () => {
		// ⚠️ `null` = **显式不接**（不给会取环境变量，而 .env 里可能已经配了）
		const { runtime, created } = makeRuntimeWithMcp(null);

		await runtime.submitCommand({ ...command("cmd-1"), token: "token-a" });
		await waitFor(() => created.length >= 1);

		expect(created[0]?.mcp).toBeUndefined();
	});
});

/* ------------------------------------------------------------------ 讨论上下文 */

describe("运行时 · 讨论上下文（与 AI 讨论）", () => {
	/** 一个前端发来的上下文（任务 + 项目 + 里程碑）。 */
	const context = {
		task: {
			id: 6,
			project_id: 5,
			title: "测试333",
			type_code: "feature",
			status_code: "in_progress",
			priority_code: "P1",
		},
		labels: { in_progress: "进行中", P1: "高", feature: "功能" },
		project: { id: 5, name: "财务对账系统升级" },
		milestone: { id: 5, name: "M5 已延期" },
	};

	/** 造一个会**记下 prompt 文本**的运行时。 */
	function makeContextRuntime(): {
		runtime: AgentRuntime;
		prompts: string[];
		appended: MessageRecord[];
	} {
		const prompts: string[] = [];
		const { store, appended } = fakeStore(fakeConversation());
		const runtime = new AgentRuntime({
			store,
			audit: fakeAudit().writer,
			createSession: async () => ({
				prompt: async (message: string): Promise<void> => {
					prompts.push(message);
				},
				subscribe: () => () => {},
				dispose: () => {},
				isStreaming: false,
			}),
			createDataSource: () => ({
				createTask: async (input: CreateTaskInput) => {
					void input;
					return fakeTask();
				},
			}),
			resolveUser: async () => ({ id: 2 }),
		});
		return { runtime, prompts, appended };
	}

	it("给模型的话 = 上下文块 + 用户原话（模型得知道在聊哪条任务）", async () => {
		const { runtime, prompts } = makeContextRuntime();

		await runtime.submitCommand({
			...command("cmd-1", "这条做完了"),
			context,
		});
		await waitFor(() => prompts.length >= 1);

		const prompt = prompts[0] ?? "";
		expect(prompt).toContain("【当前讨论的任务】#6 测试333");
		expect(prompt).toContain("财务对账系统升级");
		expect(prompt).toContain("M5 已延期");
		// 用户那句**原样**在里面（上下文在前，用户的话在后）
		expect(prompt).toContain("这条做完了");
	});

	it("⭐ 库里存的仍是用户原话（界面里不能混进系统生成的上下文）", async () => {
		const { runtime, appended } = makeContextRuntime();

		await runtime.submitCommand({
			...command("cmd-1", "这条做完了"),
			context,
		});
		await waitFor(() => appended.length >= 1);

		const userMessage = appended.find((row) => row.role === "USER");
		expect(userMessage?.content).toBe("这条做完了");
		expect(userMessage?.content).not.toContain("【当前讨论的任务】");
	});

	it("没有上下文 ⇒ 给模型的就是用户原话（普通聊天）", async () => {
		const { runtime, prompts } = makeContextRuntime();

		await runtime.submitCommand(command("cmd-1", "你好"));
		await waitFor(() => prompts.length >= 1);

		expect(prompts[0]).toBe("你好");
	});
});
