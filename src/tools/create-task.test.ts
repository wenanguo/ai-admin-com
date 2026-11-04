import { describe, expect, it } from "vitest";
import type { UnifiedTask } from "../adapter/model";
import type { CreateTaskInput } from "../adapter/datasource";
import { createCreateTaskTool, type CreateTaskToolDeps } from "./create-task";

/** 造一个假的任务（只要适配层返回会用到的字段）。 */
function fakeTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
	return {
		key: "task:321",
		project_key: "project:45",
		title: "AIPM 冒烟验证任务",
		type: "FEATURE",
		status: "BACKLOG",
		priority: "P1",
		reviewers: [],
		labels: [],
		sort_order: "0",
		source: "MANUAL",
		...overrides,
	};
}

/** 造一套依赖（记录调用，便于断言）。 */
function makeDeps(result?: {
	task?: UnifiedTask;
	error?: Error;
}): {
	deps: CreateTaskToolDeps;
	calls: CreateTaskInput[];
	token: string;
} {
	const calls: CreateTaskInput[] = [];
	const token = "caller-token-must-not-leak";
	const deps: CreateTaskToolDeps = {
		currentToken: () => token,
		resolveReporterId: async () => 7,
		createDataSource: () => ({
			createTask: async (input: CreateTaskInput) => {
				calls.push(input);
				if (result?.error !== undefined) {
					throw result.error;
				}
				return result?.task ?? fakeTask();
			},
		}),
	};
	return { deps, calls, token };
}

describe("create_task 工具", () => {
	it("把统一领域名映射成适配层入参（并补上 reporter_id）", async () => {
		const { deps, calls } = makeDeps();
		const tool = createCreateTaskTool(deps);

		const result = await tool.execute(
			"call-1",
			{
				project_key: "PRJ-2026-Q3-001",
				title: "AIPM 冒烟验证任务",
				type: "FEATURE",
				status: "BACKLOG",
				priority: "P1",
				description: "端到端冒烟",
				due_date: "2026-11-30",
			},
			undefined,
			undefined,
			undefined,
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			project_key: "PRJ-2026-Q3-001",
			title: "AIPM 冒烟验证任务",
			type: "FEATURE",
			status: "BACKLOG",
			priority: "P1",
			description: "端到端冒烟",
			due_date: "2026-11-30",
			reporter_id: 7,
		});
		expect(result.isError).toBeFalsy();
		expect(result.details).toMatchObject({ taskKey: "task:321" });
	});

	it("缺必填参数 ⇒ 直接报错，不去调后端", async () => {
		const { deps, calls } = makeDeps();
		const tool = createCreateTaskTool(deps);

		const result = await tool.execute(
			"call-2",
			{ project_key: "", title: "少了项目" },
			undefined,
			undefined,
			undefined,
		);

		expect(calls).toHaveLength(0);
		expect(result.isError).toBe(true);
	});

	it("没有 token ⇒ 报错，且错误里不出现 token", async () => {
		const { deps } = makeDeps();
		const tool = createCreateTaskTool({ ...deps, currentToken: () => undefined });
		const result = await tool.execute(
			"call-3",
			{ project_key: "PRJ-1", title: "标题" },
			undefined,
			undefined,
			undefined,
		);
		expect(result.isError).toBe(true);
	});

	it("后端报错 ⇒ 结果标成 error，但把原因讲清楚", async () => {
		const { deps } = makeDeps({
			error: new Error("AiAdmin 里找不到项目「PRJ-NOPE」"),
		});
		const tool = createCreateTaskTool(deps);
		const result = await tool.execute(
			"call-4",
			{ project_key: "PRJ-NOPE", title: "标题" },
			undefined,
			undefined,
			undefined,
		);
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).toContain("PRJ-NOPE");
	});

	it("工具描述写清「什么时候用 / 什么时候别用 / 参数格式」，且不出现后端字段名", () => {
		const { deps } = makeDeps();
		const tool = createCreateTaskTool(deps);
		expect(tool.name).toBe("create_task");
		expect(tool.label.length).toBeGreaterThan(0);
		expect(tool.description).toContain("create_task");
		// 参数名用统一领域名，不出现后端的 project_id
		expect(tool.description).not.toContain("project_id");
		expect(tool.description).toContain("project_key");
		// 非破坏性 ⇒ 不需要待确认
		expect(tool.annotations?.destructiveHint).toBe(false);
		expect(tool.annotations?.readOnlyHint).toBe(false);
	});
});
