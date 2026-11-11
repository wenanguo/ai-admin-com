import { describe, expect, it } from "vitest";
import {
	parseAiTaskContext,
	renderAiTaskContext,
	sanitizeWriteArgs,
	writeTargetId,
	type AiTaskContext,
} from "./context.ts";

/** 一个合法的上下文（前端发过来的样子）。 */
function makeContext(overrides?: Partial<AiTaskContext>): AiTaskContext {
	return {
		kind: "task",
		task: {
			id: 123,
			project_id: 6,
			milestone_id: 11,
			parent_id: null,
			title: "支付回调联调",
			description: "原来的描述",
			type_code: "feature",
			status_code: "in_progress",
			priority_code: "P0",
			estimate_hours: "8",
			actual_hours: "3",
			assignee_id: 1,
			start_date: "2026-11-01",
			due_date: "2026-11-10",
			actual_start_date: null,
			actual_end_date: null,
			labels: null,
			blocked_reason: null,
			reviewers: null,
		},
		labels: {
			in_progress: "进行中",
			P0: "紧急",
			feature: "功能",
		},
		names: { assignee: "张三", reporter: "李四" },
		project: { id: 6, name: "财务对账系统升级" },
		milestone: { id: 11, name: "M1 需求" },
		...overrides,
	};
}

describe("parseAiTaskContext", () => {
	it("认得合法的上下文", () => {
		const parsed = parseAiTaskContext(makeContext());
		expect(parsed).not.toBeNull();
		expect(parsed?.task?.id).toBe(123);
		expect(parsed?.project?.name).toBe("财务对账系统升级");
	});

	it("没有任务或 id 不合法 ⇒ null（不是抛错）", () => {
		expect(parseAiTaskContext(undefined)).toBeNull();
		expect(parseAiTaskContext({})).toBeNull();
		expect(parseAiTaskContext({ task: {} })).toBeNull();
		expect(parseAiTaskContext({ task: { id: 0 } })).toBeNull();
		expect(parseAiTaskContext({ task: { id: "123" } })).toBeNull();
		expect(parseAiTaskContext({ task: { id: 1.5 } })).toBeNull();
	});

	it("不是对象 ⇒ null", () => {
		expect(parseAiTaskContext("任务 123")).toBeNull();
		expect(parseAiTaskContext([{ task: { id: 1 } }])).toBeNull();
	});
});

describe("renderAiTaskContext", () => {
	it("给的是中文 + 线上码两样（模型照抄线上码就不会写错状态）", () => {
		const text = renderAiTaskContext(makeContext());
		expect(text).toContain("【当前讨论的任务】#123 支付回调联调");
		expect(text).toContain("in_progress（进行中）");
		expect(text).toContain("P0（紧急）");
		expect(text).toContain("张三 / 李四");
		expect(text).toContain("2026-11-01 ~ 2026-11-10");
		expect(text).toContain("财务对账系统升级");
		expect(text).toContain("M1 需求");
	});

	it("写明只允许回填三个字段", () => {
		const text = renderAiTaskContext(makeContext());
		expect(text).toContain("status_code");
		expect(text).toContain("actual_hours");
		expect(text).toContain("description");
	});
});

describe("sanitizeWriteArgs", () => {
	it("update_task：基线全带 + 只让模型改那三个字段", () => {
		const context = makeContext();
		const result = sanitizeWriteArgs(
			"mcp__aiadmin__update_task",
			{
				id: 123,
				title: "模型想改的标题",
				status_code: "done",
				actual_hours: "8",
				description: "做完了",
				assignee_id: 999,
				due_date: "2026-12-31",
			},
			context,
		);

		// 模型改的三个字段生效
		expect(result.args["status_code"]).toBe("done");
		expect(result.args["actual_hours"]).toBe("8");
		expect(result.args["description"]).toBe("做完了");

		// 白名单外的字段被丢掉（保持基线原值）
		expect(result.args["title"]).toBe("支付回调联调");
		expect(result.args["assignee_id"]).toBe(1);
		expect(result.args["due_date"]).toBe("2026-11-10");
		expect(result.stripped).toContain("title");
		expect(result.stripped).toContain("assignee_id");
		expect(result.stripped).toContain("due_date");

		// 整对象 PUT 的必填字段一个都不能少
		for (const key of [
			"project_id",
			"title",
			"type_code",
			"status_code",
			"priority_code",
		]) {
			expect(result.args).toHaveProperty(key);
		}
	});

	it("update_task：基线里的空值**整个键去掉**（MCP 入参校验不吃 null）", () => {
		const result = sanitizeWriteArgs(
			"update_task",
			{ id: 123, description: "做完了" },
			makeContext(),
		);
		// ⚠️ null 一律不能出现：传 null 会被 MCP 服务端拒
		//    （"Input validation error: None is not of type 'string'"）
		for (const [key, value] of Object.entries(result.args)) {
			expect(value, `字段 ${key} 不该是 null`).not.toBeNull();
			expect(value, `字段 ${key} 不该是 undefined`).not.toBeUndefined();
		}
		// 基线里本来就是空的字段 ⇒ 不传（后端 exclude_unset ⇒ 原值不变）
		expect(result.args).not.toHaveProperty("parent_id");
		expect(result.args).not.toHaveProperty("actual_start_date");
		expect(result.args).not.toHaveProperty("labels");
		expect(result.args).not.toHaveProperty("blocked_reason");
		// 有值的字段照旧带上
		expect(result.args["due_date"]).toBe("2026-11-10");
		expect(result.args["description"]).toBe("做完了");
	});

	it("update_task：基线缺必填字段 ⇒ 明确报错（不放一个会 422 的 PUT 出去）", () => {
		const context = makeContext();
		if (context.task) {
			delete context.task["project_id"];
		}
		expect(() =>
			sanitizeWriteArgs("update_task", { id: 123 }, context),
		).toThrow(/project_id/);
	});

	it("模型想把 id 改成别的 ⇒ 强制回当前任务", () => {
		const result = sanitizeWriteArgs(
			"update_task",
			{ id: 999, status_code: "done" },
			makeContext(),
		);
		expect(result.args["id"]).toBe(123);
	});

	it("patch_task_status：ids 强制为当前任务，只留 status", () => {
		const result = sanitizeWriteArgs(
			"mcp__aiadmin__patch_task_status",
			{ ids: [7, 8], status: "done", extra: 1 },
			makeContext(),
		);
		expect(result.args["ids"]).toEqual([123]);
		expect(result.args["status"]).toBe("done");
		expect(result.stripped).toContain("ids");
		expect(result.stripped).toContain("extra");
	});

	it("没有上下文 ⇒ 原样放行（那不是「讨论某条任务」的场景）", () => {
		const args = { id: 1, title: "随便改" };
		const result = sanitizeWriteArgs("update_task", args, null);
		expect(result.args).toBe(args);
		expect(result.stripped).toEqual([]);
	});

	it("别的工具不动（create_task 之类）", () => {
		const args = { title: "新任务" };
		const result = sanitizeWriteArgs("create_task", args, makeContext());
		expect(result.args).toBe(args);
	});
});

describe("writeTargetId", () => {
	it("任务写操作 ⇒ 当前任务 id", () => {
		expect(writeTargetId("update_task", {}, makeContext())).toBe(123);
		expect(writeTargetId("patch_task_status", {}, makeContext())).toBe(123);
	});

	it("别的工具或没有上下文 ⇒ undefined", () => {
		expect(writeTargetId("create_task", {}, makeContext())).toBeUndefined();
		expect(writeTargetId("update_task", {}, null)).toBeUndefined();
	});
});
