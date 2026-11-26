/**
 * dsh 会话工厂 —— **会话生命周期归 dsh**（issue #175 · S4）。
 *
 * 以前「造一个 dsh 会话」散在运行时里（工具 / MCP / 闸门 / 留痕各拼各的）
 * ⇒ 内核知道了太多 **dsh 的接线细节**。
 * ⇒ 现在**装配全在这里**（适配层）⇒ 运行时只说「要什么」。
 *
 * ⚠️ **闸门口径一个字没改**（判定仍在 `core/gate/decision.ts`）⇒ 这里只做接线。
 * ⚠️ **凭据不落盘**：MCP 清单（含 token）只进**子进程的环境变量**。
 */

import type { AuditTrail } from "../../audit/audit-trail.ts";
import type { AuditWriter } from "../../audit/audit.ts";
import type { AgentMcpServer } from "../../config/types.ts";
import type { ContextAnchor, WriteToolRule } from "../../context/anchor.ts";
import { DEFAULT_GATE_TIMEOUT_MS } from "../../gate/gate.ts";
import { createPendingAction } from "../../gate/pending-write.ts";
import { pendingWaiters } from "../../gate/pending-waiters.ts";
import type { McpServerSpec } from "../../mcp/mcp.ts";
import { mcpToolPrefix } from "../../mcp/tool-names.ts";
import type { McpToolContext, McpToolDefinition } from "../../mcp/tool.ts";
import type { SessionEventStore } from "../../store/session-events.ts";
import { DshTracer } from "./persistence.ts";
import { createDshSession, type CreateDshSessionOptions, type DshRunnerConfig } from "./runner.ts";
import type { AgentSessionLike } from "./session.ts";

/** 闸门要的那些**动态**东西（**每次调用时取** ⇒ 锚点变了也能用）。 ·  */
export interface DshGateHooks {
	/** 发起人 id（**没有 ⇒ 写不了审计**）。 */
	userId: () => string | undefined;
	/** 当前讨论的锚点（**没有 ⇒ 不收窄字段**）。 */
	anchor: () => ContextAnchor | undefined;
	/** 写规则（**插件给的** ⇒ 闸门不写死工具名 / 字段名）。 */
	writeRules: () => readonly WriteToolRule[] | undefined;
	/** 挂起后通知外界（推 SSE `pending` ⇒ 前端「待确认」页签）。 */
	onPending: (row: { id: string; command: string; args: Record<string, unknown> }) => void;
}

/** 造 dsh 会话的业务输入。 */
export interface DshSessionSpec {
	/** 会话 id（**同时是 dsh 的 session id** ⇒ 重建后还是同一个会话）。 */
	conversationId: string;
	/** dsh 的 session id（**默认等于会话 id**）。 */
	dshSessionId?: string | undefined;
	/** 系统提示词（**含技能段**）。 */
	systemPrompt: string;
	/** 模型 id（智能体配置可以覆盖全局默认）。 */
	model?: string | undefined;
	/** 技能目录（**绝对路径**；来自智能体配置的 `skills`）。 */
	skillDirs?: readonly string[];
	/** 我们的命令（**MCP 工具形状**；已按白名单过滤）。 */
	tools: readonly McpToolDefinition[];
	/** 工具执行时的上下文（token / 审计 ⇒ **每个会话一份**）。 */
	toolContext: McpToolContext;
	/** 要挂的 MCP 服务器（**可以 0 / 1 / N 个**）。 */
	mcpServers?: readonly McpServerSpec[];
	/** MCP 工具名前缀（`mcp__<server>__`）。 */
	mcpPrefixes?: readonly string[];
	/** 事件日志的去处（**产品事实**）。 */
	events: SessionEventStore;
	/** 审计的去处（**产品事实**）。 */
	audit: AuditWriter;
	/** 审计留痕带（**用来判断「这次工具调用有没有自己写审计」**）。 */
	trail?: AuditTrail | undefined;
	/** 闸门钩子（**动态**）。 */
	gate: DshGateHooks;
	/** 要不要恢复 dsh 侧的历史（`session/resume` ⇒ dsh 的会话持久化）。 */
	resume?: boolean | undefined;
	/** 底层工厂（**测试可注入**；不给 ⇒ 用真的）。 */
	createSession?:
		| ((options: CreateDshSessionOptions) => Promise<AgentSessionLike>)
		| undefined;
	/** dsh runner 的配置（**测试可注入**）。 */
	config?: DshRunnerConfig | undefined;
	/** 环境变量来源（**测试可注入**）。 */
	env?: NodeJS.ProcessEnv | undefined;
}

/** MCP 的挂载计划（**服务器清单 + 工具名前缀**）。 ·  */
export interface McpPlan {
	/** 要挂的服务器（**0 / 1 / N 个**）。 */
	servers: McpServerSpec[];
	/** 工具名前缀（`mcp__<server>__`）。 */
	prefixes: string[];
}

// 按智能体配置算出「挂哪些 MCP 服务器」。
// ⚠️ 配置里没写 `url` ⇒ 用**插件给的默认地址**（内核不认识业务系统的地址 ⇒ 由插件给）；
//    插件也没给 ⇒ **这台不挂**（保持老行为：后端没上线时不连）。
export function planMcpServers(input: {
	/** 智能体配置里的服务器清单。 */
	servers: readonly AgentMcpServer[];
	/** 全局默认地址（`null` ⇒ **显式不接**）。 */
	url: string | null | undefined;
	/** 插件给的默认地址。 */
	fallbackUrl: string | undefined;
	/** 调用方的 token（每个会话一份 ⇒ MCP 靠它做权限校验）。 */
	token: string;
}): McpPlan {
	const servers: McpServerSpec[] = [];
	for (const server of input.servers) {
		const url =
			server.url ?? (input.url === null ? undefined : (input.url ?? input.fallbackUrl));
		if (url === undefined) {
			continue;
		}
		servers.push({
			name: server.name,
			url,
			type: server.type,
			exposure: server.exposure,
			token: input.token,
		});
	}
	return {
		servers,
		prefixes: input.servers.map((server) => mcpToolPrefix(server.name)),
	};
}

// 开一个 dsh 会话（**懒起进程**：第一次说话时才起 dsh 运行时）。
// @param spec 会话的业务输入。
// @returns dsh 会话句柄（内核只认 `AgentSessionLike`）。
export async function openDshSession(spec: DshSessionSpec): Promise<AgentSessionLike> {
	// ⚠️ **留痕层每个会话一个**（它要记住「这次工具调用有没有自己写审计」）。
	const tracer = new DshTracer({
		conversationId: spec.conversationId,
		dshSessionId: spec.dshSessionId ?? spec.conversationId,
		userId: spec.gate.userId(),
		model: spec.model,
		events: spec.events,
		audit: spec.audit,
		trail: spec.trail,
		mcpPrefixes: spec.mcpPrefixes,
	});

	return (spec.createSession ?? createDshSession)({
		conversationId: spec.conversationId,
		tools: spec.tools,
		toolContext: spec.toolContext,
		systemPrompt: spec.systemPrompt,
		model: spec.model,
		mcpPrefixes: spec.mcpPrefixes,
		mcpServers: spec.mcpServers,
		skillDirs: spec.skillDirs,
		// ⚠️ **闸门上下文每次现取**（锚点 / 用户会变 ⇒ 不能在建会话时拍死）。
		gate: () => ({
			conversationId: spec.conversationId,
			userId: spec.gate.userId() ?? "",
			anchor: spec.gate.anchor(),
			writeRules: spec.gate.writeRules(),
			onPending: spec.gate.onPending,
			waiters: pendingWaiters,
			createPending: createPendingAction,
			timeoutMs: DEFAULT_GATE_TIMEOUT_MS,
			// ⚠️ **人做的决定 ⇒ 留痕**（审计 + 事件日志）；失败不许影响放行 / 拒绝。
			onDecision: (decision) => {
				void tracer.handleGateDecision(decision);
			},
		}),
		tracer,
		resume: spec.resume,
		config: spec.config,
		env: spec.env,
	});
}
