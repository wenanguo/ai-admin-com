import { describe, expect, it, vi } from "vitest";
import type { UnifiedTask } from "../adapter/model.ts";
import type { CreateTaskInput } from "../adapter/datasource.ts";
import { createPmCreateTaskTool, type PmCreateTaskToolDeps } from "./pm-create-task.ts";
import type { McpToolContext } from "../../../core/mcp/tool.ts";

/** 审计条目（测试自己声明形状：工具只把它当「不透明的一条记录」用）。 */
interface AuditRecord {
	actorType: string;
	command: string;
	args: Record<string, unknown>;
	before: unknown;
	after: unknown;
	userId: string;
}

/** 造一个假的任务（只要适配层返回会用到的字段）。 */
function fakeTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
	const entity: UnifiedTask = {
		key: "task:321",
		project_key: "project:45",
		title: "AIPM 冒烟验证任务",
		type: "FEATURE",
		status: "BACKLOG",
		priority: "P1",
		reviewers: [],
		labels: [],
		sort_order: "0",
		source: "NL_CHAT",
	};
	// 真实数据源自带写快照（审计层要的就是它）
	const task: UnifiedTask = { ...entity, ...overrides };
	return {
		...task,
		snapshot: task.snapshot ?? { op: "create", before: null, after: task },
	};
}

/** 造一套依赖（记录调用，便于断言）。 */
function makeDeps(result?: {
	task?: UnifiedTask;
	error?: Error;
	auditError?: Error;
}): {
	deps: PmCreateTaskToolDeps;
	context: McpToolContext;
	calls: CreateTaskInput[];
	token: string;
	audit: AuditRecord[];
} {
	const calls: CreateTaskInput[] = [];
	const audit: AuditRecord[] = [];
	const token = "caller-token-must-not-leak";
	const deps: PmCreateTaskToolDeps = {
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
	// ⚠️ **通用能力在调用时给**（token / 审计 / 闸门）⇒ 工具定义本身是纯静态的。
	const context: McpToolContext = {
		currentToken: () => token,
		currentUserId: async () => 7,
		// 审计去处（测试里只记，不落库）
		audit: {
			write: async (entry: AuditRecord): Promise<void> => {
				if (result?.auditError !== undefined) {
					throw result.auditError;
				}
				audit.push(entry);
			},
		},
	};
	return { deps, context, calls, token, audit };
}

describe("pm_create_task 工具", () => {
	it("把统一领域名映射成适配层入参（并补上 reporter_id）", async () => {
		const { deps, context, calls } = makeDeps();
		const tool = createPmCreateTaskTool(deps);

		const result = await tool.execute(
			{
				project_key: "PRJ-2026-Q3-001",
				title: "AIPM 冒烟验证任务",
				type: "FEATURE",
				status: "BACKLOG",
				priority: "P1",
				description: "端到端冒烟",
				due_date: "2026-11-30",
			},
			context,
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
		const { deps, context, calls } = makeDeps();
		const tool = createPmCreateTaskTool(deps);

		const result = await tool.execute({ project_key: "", title: "少了项目" }, context);

		expect(calls).toHaveLength(0);
		expect(result.isError).toBe(true);
	});

	it("没有 token ⇒ 报错，且错误里不出现 token", async () => {
		const { deps, context } = makeDeps();
		const tool = createPmCreateTaskTool(deps);
		const result = await tool.execute(
			{ project_key: "PRJ-1", title: "标题" },
			{ ...context, currentToken: () => undefined },
		);
		expect(result.isError).toBe(true);
	});

	it("后端报错 ⇒ 结果标成 error，但把原因讲清楚", async () => {
		const { deps, context } = makeDeps({
			error: new Error("AiAdmin 里找不到项目「PRJ-NOPE」"),
		});
		const tool = createPmCreateTaskTool(deps);
		const result = await tool.execute({ project_key: "PRJ-NOPE", title: "标题" }, context);
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).toContain("PRJ-NOPE");
	});

	it("工具描述写清「什么时候用 / 什么时候别用 / 参数格式」，且不出现后端字段名", () => {
		const { deps } = makeDeps();
		const tool = createPmCreateTaskTool(deps);
		// ⚠️ **裸名不许再叫 `create_task`**（那是 MCP 那个的）⇒ 同名两义（issue #182）
		expect(tool.name).toBe("pm_create_task");
		expect(tool.label.length).toBeGreaterThan(0);
		expect(tool.description).toContain("pm_create_task");
		// 参数名用统一领域名，不出现后端的 project_id
		expect(tool.description).not.toContain("project_id");
		expect(tool.description).toContain("project_key");
		// ⚠️ 描述里要**点名** MCP 那个 ⇒ 模型不会混
		expect(tool.description).toContain("mcp__aiadmin__create_task");
		// 非破坏性 ⇒ 不需要待确认
		expect(tool.annotations?.destructiveHint).toBe(false);
		expect(tool.annotations?.readOnlyHint).toBe(false);
	});

	it("参数 schema 是 **JSON Schema**（MCP 的形状 ⇒ 直接给 dsh / 模型）", () => {
		const { deps } = makeDeps();
		const tool = createPmCreateTaskTool(deps);
		expect(tool.inputSchema.type).toBe("object");
		expect(tool.inputSchema.required).toEqual(["project_key", "title"]);
		expect(Object.keys(tool.inputSchema.properties ?? {})).toContain("estimate_hours");
	});
});

/**
 * 审计 —— **每次 AI 写入都要有一条 `ai_audit_log`**。
 *
 * 这是本服务唯一的「谁做了什么」的凭据：任务建在共享库里，
 * 没有这一行就没人说得清那条任务是 AI 建的还是人手建的。
 */
describe("pm_create_task 工具 · 审计", () => {
	it("建任务成功 ⇒ 写一条审计（actor=AI、命令=pm_create_task、调用方、前后快照）", async () => {
		const { deps, context, audit } = makeDeps();
		const tool = createPmCreateTaskTool(deps);

		await tool.execute(
			{ project_key: "PRJ-2026-Q3-001", title: "AIPM 冒烟验证任务", priority: "P1" },
			context,
		);

		expect(audit).toHaveLength(1);
		const entry = audit[0];
		expect(entry?.actorType).toBe("AI");
		expect(entry?.command).toBe("pm_create_task");
		expect(entry?.userId).toBe("7");
		// 参数（脱敏后）
		expect(entry?.args).toMatchObject({
			project_key: "PRJ-2026-Q3-001",
			title: "AIPM 冒烟验证任务",
		});
		// 快照：新建 ⇒ before 为 null，after 是落库后的实体
		expect(entry?.before).toBeNull();
		expect(entry?.after).toMatchObject({ key: "task:321" });
	});

	it("建任务失败 ⇒ 不写审计（没发生的事不记账）", async () => {
		const { deps, context, audit } = makeDeps({ error: new Error("AiAdmin 里找不到项目") });
		const tool = createPmCreateTaskTool(deps);

		await tool.execute({ project_key: "PRJ-NOPE", title: "标题" }, context);

		expect(audit).toHaveLength(0);
	});

	it("审计写失败 ⇒ 任务仍然算成功（不能把已经建好的任务弄丢）+ 记一条错误日志", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { deps, context, calls } = makeDeps({ auditError: new Error("审计表写不进去") });
			const tool = createPmCreateTaskTool(deps);

			const result = await tool.execute({ project_key: "PRJ-1", title: "标题" }, context);

			// 任务真的建出来了
			expect(calls).toHaveLength(1);
			// ⚠️ 不能报成失败 —— 那会诱使模型重试 ⇒ 又建一个任务
			expect(result.isError).toBeFalsy();
			// 但失败必须**看得见**
			expect(errorLog).toHaveBeenCalled();
		} finally {
			errorLog.mockRestore();
		}
	});

	it("审计的 args 脱敏（不带 token / 口令）", async () => {
		const { deps, context, audit } = makeDeps();
		const tool = createPmCreateTaskTool(deps);

		// 模型理论上只会传 schema 里的字段，但参数是运行时来的 —— 脱敏不能靠「它不会出现」
		await tool.execute(
			{
				project_key: "PRJ-1",
				title: "标题",
				token: "secret-token-must-not-leak",
				password: "secret-password",
			},
			context,
		);

		const text = JSON.stringify(audit);
		expect(text).not.toContain("secret-token-must-not-leak");
		expect(text).not.toContain("secret-password");
	});
});
