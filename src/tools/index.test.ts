/**
 * 命令目录 —— **破坏性由工具自己的 annotations 决定**。
 *
 * 之前目录里有一个手写的 `destructive: boolean`，与工具里的
 * `annotations.destructiveHint` 各说各的 ⇒ 「要不要先问人」不可信。
 * 现在只有一个事实源：工具的 annotations（SDK 的 `ToolAnnotations`）。
 */

import { describe, expect, it } from "vitest";
import type { CommandTool } from "./types.ts";
import { buildCommandTools, isDestructiveCommand } from "./index.ts";
import type { AuditWriter } from "../audit.ts";
import type { CreateTaskInput } from "../adapter/datasource.ts";
import type { UnifiedTask } from "../adapter/model.ts";

/** 审计去处（测试不需要真的落库）。 */
const audit: AuditWriter = {
	write: async () => undefined,
};

/** 假的任务（工具执行时返回它）。 */
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

/** 造命令目录的上下文。 */
function context() {
	return {
		currentToken: () => "token",
		createDataSource: () => ({
			createTask: async (_input: CreateTaskInput) => fakeTask(),
		}),
		resolveReporterId: async () => 2,
		audit,
	};
}

describe("命令目录", () => {
	it("造出来的工具都带 annotations（模型与闸门都靠它）", () => {
		const tools = buildCommandTools(context());
		expect(tools).toHaveLength(1);
		expect(tools[0]?.annotations).toBeDefined();
	});

	it("create_task 是非破坏性的（新建可补偿撤销）", () => {
		const tools = buildCommandTools(context());
		expect(isDestructiveCommand(tools[0] as CommandTool)).toBe(false);
	});

	it("标了 destructiveHint 的工具才算破坏性", () => {
		const destructive = {
			name: "delete_task",
			label: "删任务",
			description: "删掉一条任务",
			parameters: {},
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
			execute: async () => ({ content: [] }),
		} as unknown as CommandTool;

		expect(isDestructiveCommand(destructive)).toBe(true);
	});

	it("没标 annotations 的工具按非破坏性处理", () => {
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
