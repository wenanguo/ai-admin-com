/**
 * 命令目录 —— 本服务注册给模型的全部业务命令。
 *
 * 现在只有一个（`create_task`）。完整版会有 ~40 个（项目 / 里程碑 / 任务 / 风险的读写）。
 * 加命令的步骤永远是这三步：
 * 1. 在 `src/tools/` 下写一个工具（描述写清「什么时候用 / 什么时候别用 / 参数格式」）；
 * 2. 在这里登记一条 `CommandDefinition`；
 * 3. （如果命令是破坏性的）在闸门 `CommandGate` 里加上「要先问人」的判断。
 *
 * ⚠️ 工具**只注册业务命令**，pi 自带的 coding 工具（read/bash/edit/write）一律不启用
 * （`noTools: "builtin"`）—— 它们能在服务器上乱跑。
 */

import type { AuditWriter } from "../audit";
import { createCreateTaskTool, CREATE_TASK_TOOL_NAME, type TaskCreator } from "./create-task";
import type { CommandGate, CommandTool } from "./types";

/** 造工具时需要的上下文。 */
export interface CommandContext {
	/** 取本次调用的调用方 token（只在内存）。 */
	currentToken: () => string | undefined;
	/** 造一个带 token 的数据源（适配层入口）。 */
	createDataSource: (token: string) => TaskCreator;
	/** 取当前用户 id（任务要记报告人）。 */
	resolveReporterId: (token: string) => Promise<number>;
	/** 审计去处（**每次写都要留一条 `ai_audit_log`**）。 */
	audit: AuditWriter;
	/** 模型标识（写进审计）。 */
	model?: string;
	/** 命令闸门（默认恒放行）。 */
	gate?: CommandGate;
}

/** 一条命令的登记项。 */
export interface CommandDefinition {
	/** 命令名（= 工具名）。 */
	name: string;
	/** 人读的标签。 */
	label: string;
	/** 造出工具。 */
	build(context: CommandContext): CommandTool;
}

/**
 * 这个命令是不是**破坏性**的。
 *
 * ## 唯一事实源：工具自己的 `annotations.destructiveHint`
 *
 * 之前这里还有一个手写的 `destructive: boolean` 字段，与工具里的
 * `annotations.destructiveHint` **各说各的** ⇒ 改一处忘另一处 ⇒
 * 「破坏性命令要不要先问人」这个判断就不可信了。
 *
 * ⇒ 现在只有一个事实源：**工具的 annotations**（SDK 的 `ToolAnnotations`）。
 * 闸门（`CommandGate`）与待确认队列都读它。
 *
 * ⚠️ 没标 `destructiveHint` 的工具按**非破坏性**处理（新建类命令可补偿撤销）。
 */
export function isDestructiveCommand(command: CommandTool): boolean {
	return command.annotations?.destructiveHint === true;
}

/** 全部命令。 */
export const COMMAND_CATALOG: readonly CommandDefinition[] = [
	{
		name: CREATE_TASK_TOOL_NAME,
		label: "创建任务",
		// ⚠️ 破坏性不在这儿写 —— 它由**工具自己的 annotations** 决定
		//（`destructiveHint: false`：新建是可补偿的 ⇒ 非破坏性 ⇒ 不需要待确认）。
		build: (context) =>
			createCreateTaskTool({
				currentToken: context.currentToken,
				createDataSource: context.createDataSource,
				resolveReporterId: context.resolveReporterId,
				audit: context.audit,
				model: context.model,
				gate: context.gate,
			}),
	},
];

/** 按目录造出全部工具。 */
export function buildCommandTools(context: CommandContext): CommandTool[] {
	return COMMAND_CATALOG.map((command) => command.build(context));
}
