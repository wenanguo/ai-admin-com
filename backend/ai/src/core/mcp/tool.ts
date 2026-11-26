/**
 * MCP 工具形状 —— **我们注册给模型的业务命令**。
 *
 * ## 为什么改成「MCP 工具形状」（issue #169 · S3）
 *
 * 以前我们自造了一套「命令工具」机制（`core/tools/**`）：
 * `CommandDefinition`（工厂）→ `CommandTool`（工具）+ typebox 的参数 schema
 * + `buildCommandTools`（装配）⇒ 这一整套是**框架里的机制**。
 *
 * ⇒ 而 dsh、MCP、AiAdmin 后端用的都是**同一种形状**
 *    （`name` + `description` + `inputSchema`（JSON Schema）+ `execute`）
 * ⇒ 我们的命令**改成同一种形状** ⇒ 那套机制**整块删掉**（连同 typebox 这个依赖）
 *    ⇒ **只留业务定义**（命令做什么、闸门口径、审计怎么写）。
 *
 * ## 形状（**与 MCP 一致**）
 *
 * | 字段 | 含义 |
 * | ---- | ---- |
 * | `name` | 工具名（模型用它调用） |
 * | `label` | 人读的标签（界面上显示） |
 * | `description` | **模型全靠这段话决定用不用它** ⇒ 必须写清楚 |
 * | `inputSchema` | **JSON Schema**（MCP 的参数形状 ⇒ 直接给 dsh / 模型） |
 * | `annotations` | 只读？破坏性？幂等？（闸门与审计都读它） |
 * | `execute` | 执行（**上下文在调用时给** ⇒ 一份定义可复用给所有会话） |
 *
 * ## ⚠️ `execute` 的上下文是**参数**，不是构造时的闭包
 *
 * token / 审计去处 / 闸门**每个会话都不一样** ⇒ 工具定义本身**不该**持有它们
 * ⇒ 由调用方（运行时）在**调用时**传进来 ⇒ 插件里的工具定义是**纯静态**的。
 */

import type { AuditWriter } from "../audit/audit.ts";
import type { CommandGate } from "../gate/gate.ts";

/**
 * **JSON Schema**（MCP 的参数形状）。
 *
 * ⚠️ **不是 typebox**：MCP 的形状就是 JSON Schema ⇒ 直接手写（依赖更少、形状更通用）。
 */
export interface JsonSchema {
	/** 类型（`object` / `string` / `number` / `integer` / `boolean` / `array`）。 */
	type?: string;
	/** 说明（模型靠它理解参数）。 */
	description?: string;
	/** 子属性。 */
	properties?: Record<string, JsonSchema>;
	/** 必填的属性名。 */
	required?: string[];
	/** 数组的元素形状。 */
	items?: JsonSchema;
	/** 枚举值。 */
	enum?: unknown[];
	/** 允许多余字段？（MCP 工具默认**不许**）。 */
	additionalProperties?: boolean;
}

/**
 * 工具标注（只读？破坏性？幂等？）。
 *
 * ⚠️ **唯一事实源**：闸门与待确认队列都读它。
 */
export interface ToolAnnotations {
	/** 只读（不改数据）。 */
	readOnlyHint?: boolean;
	/** 破坏性（改坏了就回不来 ⇒ 要先问人）。 */
	destructiveHint?: boolean;
	/** 幂等（跑两遍结果一样）。 */
	idempotentHint?: boolean;
}

/** 工具回给模型的一段内容（**我们只发文本**）。 */
export interface ToolContentPart {
	/** 段类型（`text`）。 */
	type: "text";
	/** 正文。 */
	text: string;
}

/** 工具的执行结果（**我们的形状** ⇒ 宿主无关）。 */
export interface ToolResult<TDetails = unknown> {
	/** 回给模型的内容。 */
	content: ToolContentPart[];
	/** 结构化详情（界面 / 审计用）。 */
	details?: TDetails;
	/** 这次执行是不是失败了（**失败也要返回结果，不要抛异常**）。 */
	isError?: boolean;
}

/**
 * 工具执行时的上下文（**只有通用能力**）。
 *
 * ⚠️ **不许出现业务字段**（任务 / 项目 / 里程碑……）
 *    ⇒ 业务需要的依赖由**插件自己闭包持有**。
 */
export interface McpToolContext {
	/** 取本次调用的调用方 token（只在内存）。 */
	currentToken: () => string | undefined;
	/** 取当前用户 id（会话主人；插件按业务语义解释它 —— 比如「报告人」）。 */
	currentUserId: (token: string) => Promise<number>;
	/** 审计去处（**每次写都要留一条 `ai_audit_log`**）。 */
	audit: AuditWriter;
	/** 模型标识（写进审计）。 */
	model?: string;
	/** 命令闸门（默认恒放行）。 */
	gate?: CommandGate;
}

/** 一个业务工具（MCP 形状）。 */
export interface McpToolDefinition<TDetails = unknown> {
	/** 工具名（模型用它来调用）。 */
	name: string;
	/** 人读的标签（界面上显示）。 */
	label: string;
	/** 描述 —— **模型就是靠这段话决定用不用这个工具**，必须写清楚。 */
	description: string;
	/** 参数 schema（**JSON Schema** ⇒ MCP 的形状）。 */
	inputSchema: JsonSchema;
	/** 工具标注（只读？破坏性？幂等？）。 */
	annotations?: ToolAnnotations;
	/** 执行（**上下文在调用时给**）。 */
	execute(
		args: Record<string, unknown>,
		context: McpToolContext,
	): Promise<ToolResult<TDetails>>;
}
