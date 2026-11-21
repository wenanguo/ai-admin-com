/**
 * PM 插件 —— **命令目录 + 身份查询 + 告警去处**。
 *
 * ## 钉住的事
 *
 * 1. **命令目录在插件里**（内核不认业务）⇒ `create_task` 由插件登记；
 * 2. **告警要有去处** —— 枚举归一遇到不认识的线上码 ⇒ 要打日志
 *    （机制本来就有，但没人注入 ⇒ 告警会被悄悄丢掉 ⇒ 「不猜语义」不可观测）；
 * 3. **身份查询可以注入** ⇒ 单测不打 AiAdmin。
 */

import { describe, expect, it, vi } from "vitest";
import { taskStatusToUnified } from "./adapter/enums.ts";
import { createPmCommands, createPmPlugin, PM_PLUGIN_ID } from "./index.ts";
import type { TaskCreator } from "./tools/create-task.ts";
import type { CommandContext } from "../../core/tools/types.ts";
import type { AuditWriter } from "../../core/audit/audit.ts";

/** 审计去处（测试不需要真的落库）。 */
const audit: AuditWriter = {
	write: async () => undefined,
};

/** 造工具时的上下文（只有通用能力）。 */
function context(): CommandContext {
	return {
		currentToken: () => "token",
		currentUserId: async () => 2,
		audit,
	};
}

/** 假的数据源（记下建任务的入参）。 */
function fakeDataSource(calls: unknown[]): () => TaskCreator {
	return () => ({
		createTask: async (input: unknown) => {
			calls.push(input);
			return {
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
		},
	}) as unknown as TaskCreator;
}

describe("PM 插件 · 命令目录", () => {
	it("插件提供 create_task（命令目录在插件侧）", () => {
		const plugin = createPmPlugin({ createDataSource: fakeDataSource([]) });
		expect(plugin.id).toBe(PM_PLUGIN_ID);
		expect(plugin.commands?.map((command) => command.name)).toEqual(["create_task"]);
	});

	it("造出来的工具带 annotations（非破坏性 ⇒ 不需要先问人）", () => {
		const calls: unknown[] = [];
		const commands = createPmCommands({ createDataSource: fakeDataSource(calls) });
		const tool = commands[0]?.build(context());
		expect(tool?.annotations?.destructiveHint).toBe(false);
	});

	it("工具跑起来会用插件给的数据源（token 透传）", async () => {
		const calls: unknown[] = [];
		const commands = createPmCommands({ createDataSource: fakeDataSource(calls) });
		const tool = commands[0]?.build(context());
		await tool?.execute("call-1", { project_key: "PRJ-1", title: "标题" });
		expect(calls).toHaveLength(1);
	});
});

describe("PM 插件 · 告警去处", () => {
	it("未识别的枚举值会打日志（告警不再被悄悄丢掉）", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			// 造插件 = 装上告警去处
			createPmPlugin({ createDataSource: fakeDataSource([]) });
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

describe("PM 插件 · 身份查询", () => {
	it("可以注入假的当前用户解析器（单测不打 AiAdmin）", async () => {
		const plugin = createPmPlugin({
			createDataSource: fakeDataSource([]),
			currentUser: { resolve: async () => ({ id: 7, name: "测试用户" }) },
		});
		const user = await plugin.currentUser?.resolve("token");
		expect(user?.id).toBe(7);
	});
});

describe("PM 插件 · admin 判定", () => {
	it("⚠️ **admin 判定 = 问权威系统**（不是解 token 载荷）", async () => {
		const plugin = createPmPlugin({
			createDataSource: fakeDataSource([]),
			// 权威系统说：这个人**不是**超级管理员
			currentUser: { resolve: async () => ({ id: 8 }) },
		});
		expect(plugin.adminJudge).toBeDefined();
		// ⚠️ **载荷里写着 admin 也判不出来**（判定器只看权威系统的回答）
		expect(await plugin.adminJudge?.("anything")).toBe(false);
	});

	it("权威系统说 `isSuperuser: true` ⇒ 是 admin", async () => {
		const plugin = createPmPlugin({
			createDataSource: fakeDataSource([]),
			currentUser: { resolve: async () => ({ id: 9, isSuperuser: true }) },
		});
		expect(await plugin.adminJudge?.("token")).toBe(true);
	});

	it("可以注入假的 admin 判定器（单测不打 AiAdmin）", async () => {
		const plugin = createPmPlugin({
			createDataSource: fakeDataSource([]),
			adminJudge: async () => true,
		});
		expect(await plugin.adminJudge?.("token")).toBe(true);
	});
});
