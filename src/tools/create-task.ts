/**
 * `create_task` —— 唯一的业务命令：在 AiAdmin 的项目下**新建一条任务**。
 *
 * ## 为什么这个工具是「安全的」
 *
 * 它只**新建**（`destructiveHint: false`）：建错了可以再改，也可以删掉
 * ⇒ 属于**可补偿**的操作，不需要先问用户「要不要真的建？」
 * （待确认队列属于完整版的 Task 7；这里的闸门形状先留好，见 `types.ts`）。
 *
 * ## 参数名用统一领域名
 *
 * 工具参数叫 `project_key` / `title` / `type` / `status` / `priority` ——
 * **不出现后端字段名**（`project_id` 之类）。后端字段名是适配层的事，
 * 模型看到它们只会写出「像后端」的参数，然后卡在校验上。
 * 统一名 → 适配层入参的映射**只在这个文件里发生**。
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { AuditWriter } from "../audit";
import { redactAuditArgs } from "../audit-redact";
import type { CreateTaskInput } from "../adapter/datasource";
import type { UnifiedTask } from "../adapter/model";
import { AdapterErrorException, isAdapterErrorException } from "../aadmin/errors";
import { ALLOW_ALL_GATE, type CommandGate, type CommandTool } from "./types";

/** 工具名（模型用它来调用）。 */
export const CREATE_TASK_TOOL_NAME = "create_task";

/** 建任务的最小接口 —— 真实现是 `AadminDataSource`，测试用假实现。 */
export interface TaskCreator {
	createTask(input: CreateTaskInput): Promise<UnifiedTask>;
}

/** 工具的依赖（由 agent 运行时注入）。 */
export interface CreateTaskToolDeps {
	/** 取本次调用的**调用方 token**（只在内存里，绝不落盘）。 */
	currentToken: () => string | undefined;
	/** 造一个带 token 的数据源（适配层入口）。 */
	createDataSource: (token: string) => TaskCreator;
	/** 取当前用户 id（任务要记报告人，后端这列 NOT NULL 且不自动回填）。 */
	resolveReporterId: (token: string) => Promise<number>;
	/** 审计去处（**每次写都要留一条 `ai_audit_log`**）。 */
	audit: AuditWriter;
	/** 模型标识（写进审计；拿不到就不写）。 */
	model?: string;
	/** 命令闸门（默认恒放行）。 */
	gate?: CommandGate;
}

/** 工具结果里的结构化详情（也给 SSE 的 `tool_result.details` 用）。 */
export interface CreateTaskDetails {
	/** 一句话结论。 */
	summary: string;
	/** 成功与否。 */
	ok: boolean;
	/** 建出来的任务 key（`task:321`）；失败时没有。 */
	taskKey?: string;
	/** 任务标题。 */
	title?: string;
	/** 所属项目 key（`project:45`）。 */
	projectKey?: string;
	/** 任务状态（统一名）。 */
	status?: string;
	/** 优先级（`P0`~`P3`）。 */
	priority?: string;
	/** 任务类型（统一名）。 */
	type?: string;
	/** 失败时的错误种类（`VALIDATION` / `NOT_FOUND` / …）。 */
	errorKind?: string;
}

/** 参数 schema（typebox）。 */
export const CreateTaskParameters = Type.Object({
	project_key: Type.String({
		description:
			"所属项目的编码，形如 PRJ-2026-Q3-001（也可写 project:45）。必须是一个真实存在的项目；不知道就先问用户。",
	}),
	title: Type.String({
		description: "任务标题：一句话、动宾结构、不超过 60 字。",
	}),
	type: Type.Optional(
		Type.String({
			description:
				"任务类型：FEATURE（功能）/ BUG（缺陷）/ OPS（运维）/ RESEARCH（调研）/ SPIKE（探针）；默认 FEATURE。",
		}),
	),
	status: Type.Optional(
		Type.String({
			description:
				"任务状态：BACKLOG / TODO / IN_PROGRESS / REVIEW / DONE / BLOCKED / CANCELLED；默认 BACKLOG（新建的任务从待办开始）。",
		}),
	),
	priority: Type.Optional(
		Type.String({
			description: "优先级：P0（最高）/ P1 / P2 / P3；默认 P2。",
		}),
	),
	description: Type.Optional(
		Type.String({
			description: "任务描述（Markdown）：背景、范围、验收标准。",
		}),
	),
	start_date: Type.Optional(
		Type.String({ description: "计划开始日期，格式 YYYY-MM-DD。" }),
	),
	due_date: Type.Optional(
		Type.String({ description: "计划截止日期，格式 YYYY-MM-DD。" }),
	),
	estimate_hours: Type.Optional(
		Type.Number({ description: "预估工时，单位：小时（可以是小数，例如 2.5）。" }),
	),
});

/** 参数类型。 */
export type CreateTaskParams = Static<typeof CreateTaskParameters>;

/**
 * 工具描述 —— **模型全靠这段话决定用不用这个工具**
 * （MiniMax 的 `toolChoice` 只能是 `auto`，没有「强制调用」这一说）。
 *
 * 四件事必须写清楚：**什么时候用 / 什么时候别用 / 参数是什么 / 参数的格式与单位**。
 */
export const CREATE_TASK_DESCRIPTION = `在 AiAdmin 项目管理系统里**新建一条任务**（命令名 create_task）。

【什么时候用这个工具】
- 用户明确要「建任务 / 加个任务 / 新建一条任务 / 记一件事」；
- 用户给了任务标题，并且（从上下文或追问后）能确定属于哪个项目。

【什么时候不要用这个工具】
- 用户只是想**问**任务（有哪些任务、进度如何）—— 本切片没有查询命令，不要拿建任务去凑；
- 用户想**改**已有任务（改标题、改状态、改负责人）—— 那是更新，不是新建；
- 用户说的是里程碑、风险或项目本身 —— 本命令只建任务；
- 项目编码没告诉用户、或你不确定是哪个项目 —— **先问清楚**，绝不要凭空编一个项目编码。

【参数】
- project_key（必填）：所属项目的编码，形如 PRJ-2026-Q3-001（也可写 project:45），必须真实存在。
- title（必填）：任务标题，一句话，不超过 60 字。
- type（可选）：FEATURE / BUG / OPS / RESEARCH / SPIKE，默认 FEATURE。
- status（可选）：BACKLOG / TODO / IN_PROGRESS / REVIEW / DONE / BLOCKED / CANCELLED，默认 BACKLOG。
- priority（可选）：P0 / P1 / P2 / P3，P0 最高，默认 P2。
- description（可选）：Markdown 描述，写清背景与验收标准。
- start_date（可选）：计划开始日期，格式 YYYY-MM-DD。
- due_date（可选）：计划截止日期，格式 YYYY-MM-DD。
- estimate_hours（可选）：预估工时，**单位是小时**，可以是小数（例如 2.5）。

【注意】
- 报告人自动记为当前登录用户，不需要（也不应该）传。
- 本命令只新建、不改动已有数据，所以不必再向用户确认；但项目编码一定要先确认清楚。`;

/** 造一个失败结果。 */
function failure(message: string, errorKind?: string): AgentToolResult<CreateTaskDetails> {
	const details: CreateTaskDetails = { summary: message, ok: false };
	if (errorKind !== undefined) {
		details.errorKind = errorKind;
	}
	return {
		content: [{ type: "text", text: message }],
		details,
		isError: true,
	};
}

/**
 * 造 `create_task` 工具。
 *
 * @param deps 运行时的依赖（token、数据源、当前用户、闸门）。
 */
export function createCreateTaskTool(deps: CreateTaskToolDeps): CommandTool<
	typeof CreateTaskParameters,
	CreateTaskDetails
> {
	return {
		name: CREATE_TASK_TOOL_NAME,
		label: "创建任务",
		description: CREATE_TASK_DESCRIPTION,
		parameters: CreateTaskParameters,
		annotations: {
			// 只新建、不改已有数据 ⇒ 不是只读；但可补偿撤销 ⇒ 不是破坏性操作。
			readOnlyHint: false,
			destructiveHint: false,
			// 同一句话建两次会建出两条任务 ⇒ 不幂等。
			idempotentHint: false,
		},
		// 实测签名：execute(toolCallId, params, signal, onUpdate, ctx)
		execute: async (_toolCallId, params) => {
			const token = deps.currentToken();
			if (token === undefined || token.length === 0) {
				return failure("拿不到调用方的登录凭证，没法在 AiAdmin 上建任务");
			}

			const projectKey = (params.project_key ?? "").trim();
			const title = (params.title ?? "").trim();
			if (projectKey.length === 0 || title.length === 0) {
				return failure("project_key 与 title 都是必填的，不能为空", "VALIDATION");
			}

			const gate = deps.gate ?? ALLOW_ALL_GATE;
			const args: Record<string, unknown> = { ...params, project_key: projectKey, title };
			if (gate.requiresConfirmation(CREATE_TASK_TOOL_NAME, args)) {
				const allowed = await gate.awaitConfirmation(CREATE_TASK_TOOL_NAME, args);
				if (!allowed) {
					return failure("用户没有确认，这次没有创建任务");
				}
			}

			try {
				const reporterId = await deps.resolveReporterId(token);
				const datasource = deps.createDataSource(token);
				const task = await datasource.createTask({
					project_key: projectKey,
					title,
					reporter_id: reporterId,
					type: params.type,
					status: params.status,
					priority: params.priority,
					description: params.description,
					start_date: params.start_date,
					due_date: params.due_date,
					estimate_hours: params.estimate_hours,
				});

				// ⚠️ 审计：**先记账，再回成功**（记账失败也不能把任务弄丢，见 writeAudit）
				await writeAudit(deps, task, args, reporterId);

				const summary = `已创建任务 ${task.key}「${task.title}」（项目 ${task.project_key}，类型 ${task.type}，状态 ${task.status}，优先级 ${task.priority}）`;
				const details: CreateTaskDetails = {
					summary,
					ok: true,
					taskKey: task.key,
					title: task.title,
					projectKey: task.project_key,
					status: task.status,
					priority: task.priority,
					type: task.type,
				};
				return {
					content: [{ type: "text", text: summary }],
					details,
				};
			} catch (error) {
				if (isAdapterErrorException(error)) {
					return failure(error.message, error.kind);
				}
				const message = error instanceof Error ? error.message : String(error);
				return failure(`建任务失败：${message}`, "UPSTREAM");
			}
		},
	};
}

/**
 * 写一条审计（`ai_audit_log`）。
 *
 * ⚠️ **失败只记日志，不把已经建好的任务弄丢**：
 * 任务已经落在 AiAdmin 那边了 ⇒ 这里报失败只会诱使模型**重试** ⇒ 又建一个。
 * 所以错误必须**看得见**（console.error），但结果照常算成功。
 */
async function writeAudit(
	deps: CreateTaskToolDeps,
	task: UnifiedTask,
	args: Record<string, unknown>,
	reporterId: number,
): Promise<void> {
	try {
		await deps.audit.write({
			actorType: "AI",
			command: CREATE_TASK_TOOL_NAME,
			args: redactAuditArgs(args),
			// 快照：新建 ⇒ before 为 null（此前不存在），after 是落库后的实体
			before: task.snapshot?.before ?? null,
			after: task.snapshot?.after ?? task,
			userId: String(reporterId),
			model: deps.model,
		});
	} catch (error) {
		console.error("[audit] 写 ai_audit_log 失败（任务已创建，不要重试）", error);
	}
}
