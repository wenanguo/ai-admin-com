/**
 * 上下文锚点 —— **内核的通用机制**（不含任何业务字段）。
 *
 * ⚠️ 这里的规则都是**假的** ⇒ 内核的测试不依赖任何业务插件。
 */

import { describe, expect, it } from "vitest";
import {
	blockedWriteReason,
	changedFields,
	narrowWriteArgs,
	stripNullishArgs,
	writeTargetId,
	type ContextAnchor,
	type WriteToolRule,
} from "./anchor.ts";

/** 假的锚点（一条「被讨论的东西」）。 */
function anchor(overrides?: Partial<ContextAnchor>): ContextAnchor {
	return {
		scope: { type: "thing", id: "123" },
		baseline: { id: 123, title: "原来的标题", owner_id: 7, state: "open" },
		values: {},
		writableFields: ["state", "note"],
		...overrides,
	};
}

/** 假的写规则：整对象 PUT 型 + 自己拼型 + 一个「不许用」的工具。 */
const rules: readonly WriteToolRule[] = [
	{
		tool: "update_thing",
		wholeObject: true,
		baseline: (a) => a.baseline,
		requiredFields: ["id", "title", "state"],
		anchorFields: ["id"],
		targetId: (a) => Number(a.scope.id),
		missingFieldMessage: (field) => `回填失败：缺少必填字段 ${field}`,
	},
	{
		tool: "patch_thing",
		anchorValues: (a) => ({ ids: [Number(a.scope.id)] }),
		fromModel: ["status"],
		targetId: (a) => Number(a.scope.id),
	},
	{
		tool: "forbidden_thing",
		blocked: { reason: "这个工具在这个 scope 里不许用" },
	},
];

describe("narrowWriteArgs", () => {
	it("没有锚点 ⇒ 原样放行", () => {
		const args = { id: 1, title: "随便改" };
		const result = narrowWriteArgs("update_thing", args, null, rules);
		expect(result.args).toBe(args);
		expect(result.stripped).toEqual([]);
	});

	it("不是写操作的工具 ⇒ 原样放行", () => {
		const args = { title: "新东西" };
		const result = narrowWriteArgs("create_thing", args, anchor(), rules);
		expect(result.args).toBe(args);
		expect(result.stripped).toEqual([]);
	});

	it("整对象 PUT：基线全带 + 只让模型改白名单里的字段", () => {
		const result = narrowWriteArgs(
			"update_thing",
			{ id: 999, title: "模型想改的标题", state: "done", note: "做完了", owner_id: 42 },
			anchor(),
			rules,
		);
		// 白名单里的字段生效
		expect(result.args["state"]).toBe("done");
		expect(result.args["note"]).toBe("做完了");
		// 白名单外的字段被丢掉（保持基线原值）
		expect(result.args["title"]).toBe("原来的标题");
		expect(result.args["owner_id"]).toBe(7);
		expect(result.stripped).toContain("title");
		expect(result.stripped).toContain("owner_id");
		// 必填字段一个都不能少
		expect(result.args).toHaveProperty("id");
		expect(result.args).toHaveProperty("title");
		expect(result.args).toHaveProperty("state");
	});

	it("由锚点决定的字段 ⇒ 模型改不动（且不算「被改」）", () => {
		const result = narrowWriteArgs(
			"update_thing",
			{ id: 999, state: "done" },
			anchor(),
			rules,
		);
		expect(result.args["id"]).toBe(123);
		expect(result.stripped).not.toContain("id");
	});

	it("基线里的空值**整个键去掉**", () => {
		const result = narrowWriteArgs(
			"update_thing",
			{ state: "done" },
			anchor({ baseline: { id: 1, title: "t", state: "open", note: null } }),
			rules,
		);
		for (const [key, value] of Object.entries(result.args)) {
			expect(value, `字段 ${key} 不该是 null`).not.toBeNull();
			expect(value, `字段 ${key} 不该是 undefined`).not.toBeUndefined();
		}
		// 基线里本来就是空的字段 ⇒ 不传（后端 exclude_unset ⇒ 原值不变）
		expect(result.args).not.toHaveProperty("note");
		// 白名单里的字段照旧生效
		expect(result.args["state"]).toBe("done");
	});

	it("基线缺必填字段 ⇒ 明确报错（不放一个会 422 的 PUT 出去）", () => {
		expect(() =>
			narrowWriteArgs(
				"update_thing",
				{ state: "done" },
				anchor({ baseline: { id: 1 } }),
				rules,
			),
		).toThrow(/title/);
	});

	it("自己拼型：锚点给的字段 + 从模型收下的字段；其余**都算「被改」**", () => {
		const result = narrowWriteArgs(
			"patch_thing",
			{ ids: [7, 8], status: "done", extra: 1 },
			anchor(),
			rules,
		);
		expect(result.args["ids"]).toEqual([123]);
		expect(result.args["status"]).toBe("done");
		expect(result.stripped).toContain("ids");
		expect(result.stripped).toContain("extra");
	});
});

describe("blockedWriteReason", () => {
	it("插件说这个工具不许用 ⇒ 给原因", () => {
		expect(blockedWriteReason("forbidden_thing", anchor(), rules)).toBe(
			"这个工具在这个 scope 里不许用",
		);
	});

	it("没有锚点 / 没有这条规则 ⇒ undefined", () => {
		expect(blockedWriteReason("forbidden_thing", null, rules)).toBeUndefined();
		expect(blockedWriteReason("update_thing", anchor(), rules)).toBeUndefined();
	});
});

describe("writeTargetId", () => {
	it("写操作 ⇒ 这次动的是哪条实体", () => {
		expect(writeTargetId("update_thing", anchor(), rules)).toBe(123);
	});

	it("别的工具或没有锚点 ⇒ undefined", () => {
		expect(writeTargetId("create_thing", anchor(), rules)).toBeUndefined();
		expect(writeTargetId("update_thing", null, rules)).toBeUndefined();
	});
});

describe("changedFields", () => {
	it("只报**白名单里**真变了的字段", () => {
		const fields = changedFields(
			{ id: 123, title: "原来的标题", state: "done", note: "做完了" },
			{ id: 123, title: "原来的标题", state: "open", note: "做完了" },
			["state", "note"],
		);
		expect(fields).toEqual(["state"]);
	});

	it("参数里没有的字段不算（整对象 PUT 的基线字段不该被报成「改了」）", () => {
		const fields = changedFields(
			{ id: 123 },
			{ id: 123, state: "open" },
			["state", "note"],
		);
		expect(fields).toEqual([]);
	});
});

describe("stripNullishArgs", () => {
	it("null / undefined 的键整个去掉（其余原样）", () => {
		expect(stripNullishArgs({ a: 1, b: null, c: undefined, d: "" })).toEqual({ a: 1, d: "" });
	});
});
