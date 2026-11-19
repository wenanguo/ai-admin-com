/**
 * 工具装配 —— typebox → dsh 的 schema DSL · 工具名归一化 · 「要不要点头」的口径。
 */

import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { buildToolCatalog, normalizeToolName, toDshParameters } from "./tools.ts";
import type { CommandTool } from "../../tools/types.ts";

/** 造一个我们的命令工具（**只需要目录里关心的那几个字段**）。 */
function toolOf(name: string, parameters: unknown): CommandTool {
	return {
		name,
		label: name,
		description: `工具 ${name}`,
		parameters: parameters as never,
		execute: async () => ({
			content: [{ type: "text", text: "" }],
			details: { ok: true },
		}),
	};
}

describe("typebox → dsh 的参数 schema", () => {
	it("必填的写在属性上（dsh 的 DSL）", () => {
		const schema = Type.Object({
			title: Type.String({ description: "标题" }),
			count: Type.Optional(Type.Number()),
		});
		expect(toDshParameters(schema)).toEqual({
			title: { type: "string", description: "标题", required: true },
			count: { type: "number" },
		});
	});

	it("嵌套对象 ⇒ 递归转换（**对象必须显式写开闭**）", () => {
		const schema = Type.Object({
			detail: Type.Object({ note: Type.String() }),
		});
		expect(toDshParameters(schema)).toEqual({
			detail: {
				type: "object",
				additionalProperties: false,
				required: true,
				properties: { note: { type: "string", required: true } },
			},
		});
	});

	it("数组 ⇒ `items` 递归", () => {
		const schema = Type.Object({ tags: Type.Array(Type.String()) });
		expect(toDshParameters(schema)).toEqual({
			tags: { type: "array", items: { type: "string" }, required: true },
		});
	});

	it("不认识的类型 ⇒ 降级成 `json`（**不悄悄丢约束**）", () => {
		expect(toDshParameters(Type.Object({ x: Type.Any() }))).toEqual({
			x: { type: "json", required: true },
		});
	});
});

describe("工具名归一化", () => {
	it("剥掉已知的 MCP 前缀（**界面显示的就是命令名**）", () => {
		expect(normalizeToolName("mcp__aiadmin__create_task", ["mcp__aiadmin__"])).toBe(
			"create_task",
		);
		expect(normalizeToolName("create_task", ["mcp__aiadmin__"])).toBe("create_task");
	});
});

describe("工具目录", () => {
	it("「新增放行、修改要点头」⇒ `confirm` 只给修改类工具", () => {
		const catalog = buildToolCatalog([
			toolOf("create_task", Type.Object({ title: Type.String() })),
			toolOf("update_task", Type.Object({ id: Type.Number() })),
			toolOf("patch_task_status", Type.Object({ id: Type.Number() })),
			toolOf("list_tasks", Type.Object({})),
		]);
		expect(catalog.map((item) => [item.name, item.confirm])).toEqual([
			["create_task", false],
			["update_task", true],
			["patch_task_status", true],
			["list_tasks", false],
		]);
	});

	it("工具名归一化后再进目录", () => {
		const catalog = buildToolCatalog([toolOf("mcp__aiadmin__create_task", Type.Object({}))], [
			"mcp__aiadmin__",
		]);
		expect(catalog[0]?.name).toBe("create_task");
	});
});
