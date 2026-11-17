/**
 * PM 的讨论上下文 —— **业务语义**（解析 / 渲染 / 写规则）。
 *
 * ⚠️ 这些断言是**从 `src/agent/context.test.ts` 逐条搬过来的**（issue #82 阶段 2）
 *    ⇒ 「白名单字段不变」「渲染不变」这两条回归**不许弱化**。
 */

import { describe, expect, it } from "vitest";
import { narrowWriteArgs, writeTargetId } from "../../../core/context/anchor.ts";
import { PM_WRITE_RULES, parsePmContext, renderPmContext } from "./pm-context.ts";

/** 一个合法的上下文（前端发过来的样子）。 */
function makeContext(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {
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

describe("parsePmContext", () => {
	it("认得合法的上下文", () => {
		const anchor = parsePmContext(makeContext());
		expect(anchor).not.toBeNull();
		expect(anchor?.scope.type).toBe("task");
		expect(anchor?.scope.id).toBe("123");
		expect(anchor?.baseline?.["id"]).toBe(123);
		expect((anchor?.values as { project?: { name?: string } })?.project?.name).toBe(
			"财务对账系统升级",
		);
	});

	it("没有任务或 id 不合法 ⇒ null（不是抛错）", () => {
		expect(parsePmContext(undefined)).toBeNull();
		expect(parsePmContext({})).toBeNull();
		expect(parsePmContext({ task: {} })).toBeNull();
		expect(parsePmContext({ task: { id: 0 } })).toBeNull();
		expect(parsePmContext({ task: { id: "123" } })).toBeNull();
		expect(parsePmContext({ task: { id: 1.5 } })).toBeNull();
	});

	it("不是对象 ⇒ null", () => {
		expect(parsePmContext("任务 123")).toBeNull();
		expect(parsePmContext([{ task: { id: 1 } }])).toBeNull();
	});

	it("只有项目 ⇒ 项目作用域（没有基线）", () => {
		const anchor = parsePmContext({ project: { id: 6, name: "财务对账系统升级" } });
		expect(anchor?.scope.type).toBe("project");
		expect(anchor?.baseline).toBeUndefined();
	});
});

describe("renderPmContext", () => {
	it("给的是中文 + 线上码两样（模型照抄线上码就不会写错状态）", () => {
		const anchor = parsePmContext(makeContext());
		const text = renderPmContext(anchor!);
		expect(text).toContain("【当前讨论的任务】#123 支付回调联调");
		expect(text).toContain("in_progress（进行中）");
		expect(text).toContain("P0（紧急）");
		expect(text).toContain("张三 / 李四");
		expect(text).toContain("2026-11-01 ~ 2026-11-10");
		expect(text).toContain("财务对账系统升级");
		expect(text).toContain("M1 需求");
	});

	it("写明只允许回填三个字段", () => {
		const anchor = parsePmContext(makeContext());
		const text = renderPmContext(anchor!);
		expect(text).toContain("status_code");
		expect(text).toContain("actual_hours");
		expect(text).toContain("description");
	});
});

describe("收窄写参数（按白名单）", () => {
	it("update_task：基线全带 + 只让模型改那三个字段", () => {
		const anchor = parsePmContext(makeContext());
		const result = narrowWriteArgs(
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
			anchor,
			PM_WRITE_RULES,
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
		const anchor = parsePmContext(makeContext());
		const result = narrowWriteArgs(
			"update_task",
			{ id: 123, description: "做完了" },
			anchor,
			PM_WRITE_RULES,
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
		const task = context["task"] as Record<string, unknown>;
		delete task["project_id"];
		const anchor = parsePmContext(context);
		expect(() =>
			narrowWriteArgs("update_task", { id: 123 }, anchor, PM_WRITE_RULES),
		).toThrow(/project_id/);
	});

	it("模型想把 id 改成别的 ⇒ 强制回当前任务", () => {
		const anchor = parsePmContext(makeContext());
		const result = narrowWriteArgs(
			"update_task",
			{ id: 999, status_code: "done" },
			anchor,
			PM_WRITE_RULES,
		);
		expect(result.args["id"]).toBe(123);
	});

	it("patch_task_status：ids 强制为当前任务，只留 status", () => {
		const anchor = parsePmContext(makeContext());
		const result = narrowWriteArgs(
			"mcp__aiadmin__patch_task_status",
			{ ids: [7, 8], status: "done", extra: 1 },
			anchor,
			PM_WRITE_RULES,
		);
		expect(result.args["ids"]).toEqual([123]);
		expect(result.args["status"]).toBe("done");
		expect(result.stripped).toContain("ids");
		expect(result.stripped).toContain("extra");
	});

	it("没有上下文 ⇒ 原样放行（那不是「讨论某条任务」的场景）", () => {
		const args = { id: 1, title: "随便改" };
		const result = narrowWriteArgs("update_task", args, null, PM_WRITE_RULES);
		expect(result.args).toBe(args);
		expect(result.stripped).toEqual([]);
	});

	it("别的工具不动（create_task 之类）", () => {
		const anchor = parsePmContext(makeContext());
		const args = { title: "新任务" };
		const result = narrowWriteArgs("create_task", args, anchor, PM_WRITE_RULES);
		expect(result.args).toBe(args);
	});
});

describe("writeTargetId", () => {
	it("任务写操作 ⇒ 当前任务 id", () => {
		const anchor = parsePmContext(makeContext());
		expect(writeTargetId("update_task", anchor, PM_WRITE_RULES)).toBe(123);
		expect(writeTargetId("patch_task_status", anchor, PM_WRITE_RULES)).toBe(123);
	});

	it("别的工具或没有上下文 ⇒ undefined", () => {
		const anchor = parsePmContext(makeContext());
		expect(writeTargetId("create_task", anchor, PM_WRITE_RULES)).toBeUndefined();
		expect(writeTargetId("update_task", null, PM_WRITE_RULES)).toBeUndefined();
	});
});

describe("PM 的写规则", () => {
	it("patch_task_status 是「改可用状态」的工具 ⇒ 讨论时拦住", () => {
		const rule = PM_WRITE_RULES.find((item) => item.tool === "patch_task_status");
		expect(rule?.blocked?.reason).toContain("是否可用");
		expect(rule?.blocked?.reason).toContain("update_task");
	});

	it("可写字段就是那三个（用户定的口径）", () => {
		const anchor = parsePmContext(makeContext());
		expect(anchor?.writableFields).toEqual(["status_code", "actual_hours", "description"]);
	});
});
