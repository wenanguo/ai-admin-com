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

/** mock 的 loader 返回的技能（测试可改 ⇒ 验「没有技能」那条路）。 */
const skillsMock = vi.hoisted(() => ({
	value: [
		{
			name: "create-task",
			description: "在 AiAdmin 里建任务。",
			filePath: "/repo/.pi/skills/create-task/SKILL.md",
			baseDir: "/repo/.pi/skills/create-task",
			disableModelInvocation: false,
		},
	],
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	createAgentSession: vi.fn(async () => ({
		session: { dispose: () => {} },
		extensionsResult: {},
	})),
	DefaultResourceLoader: class {
		constructor(public readonly options: unknown) {}
		async reload(): Promise<void> {}
		getSkills() {
			return {
				skills: skillsMock.value,
				diagnostics: [],
			};
		}
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
	// 技能表回到默认（一两个用例会改成空）
	skillsMock.value = [
		{
			name: "create-task",
			description: "在 AiAdmin 里建任务。",
			filePath: "/repo/.pi/skills/create-task/SKILL.md",
			baseDir: "/repo/.pi/skills/create-task",
			disableModelInvocation: false,
		},
	];
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
		// 我们的命令 + `load_skill`（读技能文件）
		const names = (options?.customTools ?? []).map((tool) => tool.name);
		expect(names).toEqual(["create_task", "load_skill"]);
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
		// 基础提示词在，技能段接在后面（见下面那条用例）
		expect(loader.options?.systemPrompt).toContain("你是助手");
		// 也不要 pi 的扩展 / 上下文文件
		const loaderOptions = loader.options as Record<string, unknown>;
		expect(loaderOptions["noExtensions"]).toBe(true);
		expect(loaderOptions["noContextFiles"]).toBe(true);
		// ⚠️ **技能要开着**（noSkills: false）—— 让 pi 自己去发现 `.pi/skills/`，
		//    我们只读它发现的结果（不自己再扫一遍目录）。
		//    注意：这**不等于**放开 pi 的 read/bash 工具（那仍然关着），
		//    读技能文件靠我们自己的 `load_skill`（只读技能目录）。
		expect(loaderOptions["noSkills"]).toBe(false);
	});

	it("把技能段拼进系统提示词", async () => {
		await createPiSession({
			tools: [fakeTool],
			systemPrompt: "你是助手。",
			conversationId: "conv-1",
			history: [],
			model: "minimax-cn/MiniMax-M3.1-Flash",
		});

		const options = vi.mocked(createAgentSession).mock.calls[0]?.[0];
		const loader = options?.resourceLoader as { options?: { systemPrompt?: string } };
		expect(loader.options?.systemPrompt).toContain("<available_skills>");
		expect(loader.options?.systemPrompt).toContain("<name>create-task</name>");
	});

	it("customTools 里含 load_skill", async () => {
		await createPiSession({
			tools: [fakeTool],
			systemPrompt: "你是助手。",
			conversationId: "conv-1",
			history: [],
			model: "minimax-cn/MiniMax-M3.1-Flash",
		});

		const options = vi.mocked(createAgentSession).mock.calls[0]?.[0];
		const names = (options?.customTools ?? []).map((tool) => tool.name);
		expect(names).toContain("load_skill");
		// 业务命令也要还在
		expect(names).toContain("create_task");
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

describe("pi 会话 · 没有技能时", () => {
	it("不注册 load_skill（没有技能可加载 ⇒ 别给模型一个必然失败的工具）", async () => {
		skillsMock.value = [];

		await createPiSession({
			tools: [fakeTool],
			systemPrompt: "你是助手。",
			conversationId: "conv-1",
			history: [],
			model: "minimax-cn/MiniMax-M3.1-Flash",
		});

		const options = vi.mocked(createAgentSession).mock.calls[0]?.[0];
		const names = (options?.customTools ?? []).map((tool) => tool.name);
		expect(names).not.toContain("load_skill");
		// 业务命令还在
		expect(names).toContain("create_task");
	});
});
