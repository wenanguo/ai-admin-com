/**
 * 命令工具的类型 —— 本服务注册给 pi 的**业务命令**。
 *
 * ## 与 SDK 的 `ToolDefinition` 的差别（只有一个）
 *
 * SDK 的 `execute` 是五参 `(toolCallId, params, signal, onUpdate, ctx)`，
 * 后三个是**必填**（可以是 `undefined`）。我们把自己的形状放宽成
 * `signal? / onUpdate? / ctx?` —— 这样单元测试可以直接 `execute("id", params)`
 * 调用，不用造 SDK 上下文桩。
 *
 * 放宽后仍然可以直接交给 SDK 的 `customTools`（方法参数是双变的，
 * 且 `onUpdate` 一律用 `AgentToolUpdateCallback<unknown>`，避免逆变不兼容）。
 */

import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionToolContext,
	ToolAnnotations,
} from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import type { AuditWriter } from "../../audit.ts";

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
		onUpdate?: AgentToolUpdateCallback<unknown>,
		ctx?: ExtensionToolContext,
	): Promise<AgentToolResult<TDetails>>;
}

/**
 * 命令闸门 —— 决定一次命令要不要**先问人**。
 *
 * 本切片只有一个命令（`create_task`），它是**非破坏性**的（新建的东西可以补偿撤销），
 * 所以闸门恒放行。但**形状先留好**：完整版里破坏性命令（删除、改状态）要接
 * 「待确认队列」（`ai_pending_action` 表 + `pi.on("tool_call")` 的 `block`），
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
