/**
 * pi 会话构造 —— **上下文真的交给 pi 了吗**。
 *
 * 这里 mock 掉 SDK，只验三件事：
 * 1. `SessionManager` 拿到的是**我们还原出来的 entries**（⇒ 模型有上下文）；
 * 2. `noTools: "builtin"` —— pi 的 coding 内置工具（read/bash/edit/write）必须关掉；
 * 3. `customTools` 是我们自己的业务命令（不是 pi 的内置工具）。
 *
 * ⚠️ 「entries 本身对不对」由 `session-entries.test.ts` 用**真的** SDK 验。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createPiSession } from "./pi-session";
import type { MessageRecord } from "./store";
import type { CommandTool } from "../tools/types";

vi.mock("@earendil-works/pi-coding-agent", () => ({
	createAgentSession: vi.fn(async () => ({
		session: { dispose: () => {} },
		extensionsResult: {},
	})),
	DefaultResourceLoader: class {
		constructor(public readonly options: unknown) {}
		async reload(): Promise<void> {}
	},
	ModelRuntime: {
		create: vi.fn(async () => ({
			getModel: () => ({ id: "fake-model" }),
		})),
	},
	SessionManager: {
		inMemory: vi.fn(
			(cwd: string, options?: { id?: string }, entries?: unknown[]) => ({
				cwd,
				options,
				entries,
			}),
		),
	},
}));

/** 造一条历史消息。 */
function message(id: string, role: MessageRecord["role"], content: string): MessageRecord {
	return {
		id,
		conversationId: "conv-1",
		role,
		content,
		seq: 1,
		createdAt: new Date(),
	};
}

/** 一个假的业务命令工具。 */
const fakeTool = {
	name: "create_task",
	label: "创建任务",
	description: "建一条任务",
	parameters: {},
	execute: async () => ({ content: [] }),
} as unknown as CommandTool;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("pi 会话构造", () => {
	it("把历史还原成 entries 交给 SessionManager（模型才有上下文）", async () => {
		await createPiSession({
			tools: [fakeTool],
			systemPrompt: "你是助手",
			conversationId: "conv-1",
			history: [
				message("msg-1", "USER", "建个任务"),
				message("msg-2", "ASSISTANT", "好，建了"),
			],
			model: "minimax-cn/MiniMax-M3.1-Flash",
		});

		const inMemory = vi.mocked(SessionManager.inMemory);
		expect(inMemory).toHaveBeenCalledTimes(1);
		const [cwd, options, entries] = inMemory.mock.calls[0] ?? [];
		expect(cwd).toBe(process.cwd());
		expect(options).toEqual({ id: "conv-1" });
		// entries：session 头 + 两条消息
		expect(entries).toHaveLength(3);
		expect(entries?.[0]).toMatchObject({ type: "session", id: "conv-1" });
	});

	it("关掉 pi 的 coding 内置工具，只留我们自己的命令", async () => {
		await createPiSession({
			tools: [fakeTool],
			systemPrompt: "你是助手",
			conversationId: "conv-1",
			history: [],
			model: "minimax-cn/MiniMax-M3.1-Flash",
		});

		const options = vi.mocked(createAgentSession).mock.calls[0]?.[0];
		expect(options?.noTools).toBe("builtin");
		expect(options?.customTools).toEqual([fakeTool]);
	});

	it("系统提示词走 resourceLoader（不在 createAgentSession 的选项里）", async () => {
		await createPiSession({
			tools: [fakeTool],
			systemPrompt: "你是助手",
			conversationId: "conv-1",
			history: [],
			model: "minimax-cn/MiniMax-M3.1-Flash",
		});

		const options = vi.mocked(createAgentSession).mock.calls[0]?.[0];
		const loader = options?.resourceLoader as { options?: { systemPrompt?: string } };
		expect(loader.options?.systemPrompt).toBe("你是助手");
		// 也不要 pi 的扩展 / 技能 / 上下文文件
		const loaderOptions = loader.options as Record<string, unknown>;
		expect(loaderOptions["noExtensions"]).toBe(true);
		expect(loaderOptions["noSkills"]).toBe(true);
		expect(loaderOptions["noContextFiles"]).toBe(true);
	});

	it("模型标识不是 provider/model 形式 ⇒ 直接报错（别猜）", async () => {
		await expect(
			createPiSession({
				tools: [fakeTool],
				systemPrompt: "你是助手",
				conversationId: "conv-1",
				history: [],
				model: "MiniMax-M3.1-Flash",
			}),
		).rejects.toThrow(/provider\/model/);
	});
});
