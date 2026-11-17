/**
 * 命令工具的**机制** —— 怎么把「命令目录」变成 pi 能用的工具。
 *
 * ⚠️ **这里没有命令目录** —— 内核不知道「任务 / 项目 / 里程碑」这些业务概念。
 *    命令目录在**插件**里（`plugins/pm/**`）⇒ 由插件注册表送进来。
 *
 * 加命令的步骤永远是这三步：
 * 1. 在插件里写一个工具（描述写清「什么时候用 / 什么时候别用 / 参数格式」）；
 * 2. 在插件里登记一条 `CommandDefinition`；
 * 3. （如果命令是破坏性的）在闸门 `CommandGate` 里加上「要先问人」的判断。
 *
 * ⚠️ 工具**只注册业务命令**，pi 自带的 coding 工具（read/bash/edit/write）一律不启用
 * （`noTools: "builtin"`）—— 它们能在服务器上乱跑。
 */

import type { CommandContext, CommandDefinition, CommandTool } from "./types.ts";

export type { CommandContext, CommandDefinition } from "./types.ts";

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

/**
 * 按命令目录造出全部工具。
 *
 * @param commands 命令目录（**来自插件注册表** —— 内核自己不带业务命令）。
 * @param context 工具要用的上下文（只有通用能力）。
 * @param options `only` = **工具白名单**（智能体配置里的 `tools`）
 *   ⇒ 不在名单里的工具**不注册**（模型看不到它）。
 *   不给 `only` ⇒ 全部注册（老行为）。
 */
export function buildCommandTools(
	commands: readonly CommandDefinition[],
	context: CommandContext,
	options?: { only?: readonly string[] },
): CommandTool[] {
	const only = options?.only;
	return commands
		.filter((command) => only === undefined || only.includes(command.name))
		.map((command) => command.build(context));
}
