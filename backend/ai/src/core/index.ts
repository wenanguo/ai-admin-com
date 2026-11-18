/**
 * 内核的**公开入口** —— 外部（别的系统、别的仓）**只从这里 import**。
 *
 * ## 为什么要有这个文件
 *
 * 内核要被「拿出来复用」（设计 §⑧：将来真要独立成包/独立仓时**不用再拆一次**）⇒
 * 需要一个**稳定的对外表面**：
 *
 * - 外部只从这里 import ⇒ 内核内部的搬家/重构**不破坏**外部；
 * - 依赖**不外泄** ⇒ 内核只依赖通用件（pi SDK / express / prisma / zod / typebox / yaml），
 *   **不依赖**任何业务系统（见 `index.test.ts` 的依赖断言）。
 *
 * ## 表面清单（**改这里 = 改对外契约** ⇒ 要慎重）
 *
 * | 能力 | 谁用 |
 * | ---- | ---- |
 * | 智能体配置（装载 / 清单 / 类型） | 外部要读智能体配置时 |
 * | 插件契约与注册表 | 外部要写自己的插件时 |
 * | 会话运行时 | 外部要起自己的服务时 |
 * | 上下文锚点 / 命令工具的类型 | 外部要写插件时 |
 * | 当前用户的形状与契约 | 外部要接自己的身份系统时 |
 */

export {
	agentIdOfConversation,
	conversationIdFor,
	createFileAgentProvider,
	type AgentProvider,
} from "./config/registry.ts";
export { listAgentSummaries, toAgentSummary } from "./config/catalog.ts";
export { agentsRoot, loadAgentConfigs } from "./config/loader.ts";
export { AgentConfigError } from "./config/errors.ts";
export type {
	AgentCapabilities,
	AgentConfig,
	AgentMcpServer,
	AgentSummary,
} from "./config/types.ts";
export {
	blockedWriteReason,
	changedFields,
	narrowWriteArgs,
	stripNullishArgs,
	writeTargetId,
	type ContextAnchor,
	type ContextProvider,
	type ContextScope,
	type NarrowedWrite,
	type WriteToolRule,
} from "./context/anchor.ts";
export { pluginRegistry, PluginRegistry, type AiPlugin } from "./plugins.ts";
export {
	CachedCurrentUserResolver,
	type CurrentUser,
	type CurrentUserResolver,
} from "./session/identity.ts";
export { AgentError, AgentRuntime, type AgentRuntimeOptions } from "./session/runtime.ts";
export { buildCommandTools, isDestructiveCommand } from "./tools/index.ts";
export type { CommandContext, CommandDefinition, CommandGate, CommandTool } from "./tools/types.ts";
export type { ApiResponse } from "./types/api.ts";
