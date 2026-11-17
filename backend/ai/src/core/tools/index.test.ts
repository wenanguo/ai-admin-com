/**
 * 命令工具的**机制** —— 内核不认业务，只认「命令目录 + 上下文」。
 *
 * ## 钉住的事
 *
 * 1. **破坏性由工具自己的 annotations 决定**（之前目录里还有一个手写的
 *    `destructive: boolean`，与 `annotations.destructiveHint` 各说各的
 *    ⇒ 「要不要先问人」不可信）。
 * 2. **工具白名单**（智能体配置里的 `tools`）真的挡住了别的工具。
 * 3. ⚠️ **内核不 import 插件** ⇒ 这里用的命令是**假的**（内核自造的），
 *    真的命令目录在插件里（`plugins/pm/**`）。
 */

import { describe, expect, it } from "vitest";
import type { AuditWriter } from "../audit/audit.ts";
import { buildCommandTools, isDestructiveCommand } from "./index.ts";
import type { CommandContext, CommandDefinition, CommandTool } from "./types.ts";

/** 审计去处（测试不需要真的落库）。 */
const audit: AuditWriter = {
	write: async () => undefined,
};

/** 造命令工具时的上下文（只有通用能力）。 */
function context(): CommandContext {
	return {
		currentToken: () => "token",
		currentUserId: async () => 2,
		audit,
	};
}

/** 一条**假的**命令（内核不关心它到底干什么）。 */
function fakeCommand(name: string, destructive = false): CommandDefinition {
	return {
		name,
		label: `假命令 ${name}`,
		build: () =>
			({
				name,
				label: `假命令 ${name}`,
				description: "假的",
				parameters: {},
				annotations: {
					readOnlyHint: false,
					destructiveHint: destructive,
					idempotentHint: false,
				},
				execute: async () => ({ content: [] }),
			}) as unknown as CommandTool,
	};
}

describe("命令工具的机制", () => {
	it("造出来的工具都带 annotations（模型与闸门都靠它）", () => {
		const tools = buildCommandTools([fakeCommand("create_task")], context());
		expect(tools).toHaveLength(1);
		expect(tools[0]?.annotations).toBeDefined();
	});

	it("工具白名单（智能体配置里的 tools）真的挡住了别的工具", () => {
		const tools = buildCommandTools(
			[fakeCommand("create_task"), fakeCommand("delete_task")],
			context(),
			{ only: ["create_task"] },
		);
		expect(tools.map((tool) => tool.name)).toEqual(["create_task"]);
	});

	it("不给白名单 ⇒ 全部注册（老行为）", () => {
		const tools = buildCommandTools(
			[fakeCommand("create_task"), fakeCommand("delete_task")],
			context(),
		);
		expect(tools.map((tool) => tool.name)).toEqual(["create_task", "delete_task"]);
	});

	it("没标 destructiveHint 的工具按非破坏性处理", () => {
		const plain = {
			name: "list_tasks",
			label: "查任务",
			description: "列出任务",
			parameters: {},
			execute: async () => ({ content: [] }),
		} as unknown as CommandTool;

		expect(isDestructiveCommand(plain)).toBe(false);
	});
});

describe("破坏性判定", () => {
	it("标了 destructiveHint 的工具才算破坏性", () => {
		const tools = buildCommandTools([fakeCommand("delete_task", true)], context());
		expect(isDestructiveCommand(tools[0] as CommandTool)).toBe(true);
	});

	it("没标 destructiveHint 的工具按非破坏性处理（新建可补偿撤销）", () => {
		const tools = buildCommandTools([fakeCommand("create_task")], context());
		expect(isDestructiveCommand(tools[0] as CommandTool)).toBe(false);
	});
});
