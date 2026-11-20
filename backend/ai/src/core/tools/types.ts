/**
 * 命令工具的类型 —— 本服务注册给模型宿主的**业务命令**。
 *
 * ## 工具类型是**我们自己的**（issue #123：拔掉 pi）
 *
 * 以前这里 import 的是 pi SDK 的 `AgentToolResult` / `ToolAnnotations` / … ⇒
 * 内核的类型直接长在 SDK 上 ⇒ 换宿主就得改内核。
 *
 * ⇒ 现在这些形状**我们自己声明**（`ToolResult` / `ToolAnnotations` / …）⇒
 * - 内核不依赖任何 SDK 的类型（拔 pi 只改这一个文件 + 它的引用点）；
 * - 适配层负责把我们的形状翻译成宿主的形状（见 `adapter/dsh/tools.ts`）。
 *
 * ## `execute` 的签名
 *
 * 五参 `(toolCallId, params, signal?, onUpdate?, ctx?)` —— 后三个**可省**
 * ⇒ 单元测试可以直接 `execute("id", params)` 调用，不用造上下文桩。
 */

import type { Static, TSchema } from "typebox";
import type { AuditWriter } from "../audit/audit.ts";

/**
 * 工具标注（只读？破坏性？幂等？）。
 *
 * ⚠️ **唯一事实源**：闸门与待确认队列都读它（`isDestructiveCommand`）。
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

/** 工具执行中的进度回调（**可省** ⇒ 单测不用造）。 */
export type ToolUpdateCallback<T = unknown> = (update: T) => void | Promise<void>;

/**
 * 工具执行时的上下文（**可省**）。
 *
 * ⚠️ **只放通用能力**（会话 id 之类）⇒ 业务需要的依赖由**插件自己闭包持有**。
 */
export type ToolContext = Record<string, unknown>;

/** 一个业务命令工具。 */
export interface CommandTool<TParams extends TSchema = TSchema, TDetails = unknown> {
	/** 工具名（模型用它来调用）。 */
	name: string;
	/** 人读的标签（SDK 必填）。 */
	label: string;
	/** 描述 —— **模型就是靠这段话决定用不用这个工具**，必须写清楚。 */
	description: string;
	/** 参数 schema（typebox）。 */
	parameters: TParams;
	/** 工具标注（只读？破坏性？幂等？）。 */
	annotations?: ToolAnnotations;
	/** 执行。 */
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal?: AbortSignal,
		onUpdate?: ToolUpdateCallback<unknown>,
		ctx?: ToolContext,
	): Promise<ToolResult<TDetails>>;
}

/**
 * 命令闸门 —— 决定一次命令要不要**先问人**。
 *
 * 本切片只有一个命令（`create_task`），它是**非破坏性**的（新建的东西可以补偿撤销），
 * 所以闸门恒放行。但**形状先留好**：完整版里破坏性命令（删除、改状态）要接
 * 「待确认队列」（`ai_pending_action` 表 + 适配层的审批缝），
 * 那时不用改工具本身。
 */
export interface CommandGate {
	/** 这个命令要不要先问人。 */
	requiresConfirmation(command: string, args: Record<string, unknown>): boolean;
	/** 等人的答复；返回 `true` = 放行执行。 */
	awaitConfirmation(command: string, args: Record<string, unknown>): Promise<boolean>;
}

/** 恒放行的闸门（非破坏性命令用）。 */
export const ALLOW_ALL_GATE: CommandGate = {
	requiresConfirmation: () => false,
	awaitConfirmation: async () => true,
};

/**
 * 造工具时内核给命令的上下文 —— **只有通用能力**。
 *
 * ⚠️ **这里不许出现业务字段**（任务 / 项目 / 里程碑……）⇒
 *    业务需要的依赖由**插件自己闭包持有**（插件造工具时把它传进去），
 *    内核只负责「与身份 / 审计 / 闸门有关」的那几样。
 */
export interface CommandContext {
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

/**
 * 一条命令的登记项 —— **由插件提供**（内核只认这个形状）。
 *
 * 加命令的步骤永远是这三步：
 * 1. 在插件里写一个工具（描述写清「什么时候用 / 什么时候别用 / 参数格式」）；
 * 2. 在插件里登记一条 `CommandDefinition`；
 * 3. （如果命令是破坏性的）在闸门 `CommandGate` 里加上「要先问人」的判断。
 */
export interface CommandDefinition {
	/** 命令名（= 工具名）。 */
	name: string;
	/** 人读的标签。 */
	label: string;
	/** 造出工具。 */
	build(context: CommandContext): CommandTool;
}
