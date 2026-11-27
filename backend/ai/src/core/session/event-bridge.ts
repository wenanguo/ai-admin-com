/**
 * 事件桥 —— **dsh 事件 → 我们的 SSE 词汇**（**唯一的翻译层**，issue #175 · S4）。
 *
 * - **SSE 词汇一个字不改**（`core/session/events.ts` ⇒ 前端契约）；
 * - **事件名与顺序一字不改**（本文件的顺序 = 以前运行时的顺序）。
 *
 * 顺序即契约：① 工具开始 ⇒ 记住「这次是写」；② 工具成功 ⇒ 补审计 + 发 `entity_updated`；
 * ③ `agent_start`/`agent_settled` ⇒ 更新「在流式输出吗」；④ 映射器的帧按序发出；
 * ⑤ `message_end`（助手的话）⇒ 落库（产品事实）。
 */

import { changedFields, writeTargetId } from "../context/anchor.ts";
import { stripMcpToolPrefix } from "../mcp/tool-names.ts";
import type { AgentEvent } from "./agent-event.ts";
import { type SseEventName, type SsePayload, SSE_EVENTS } from "./events.ts";
import { AgentEventMapper, extractAssistantText, isAssistantMessage } from "./event-mapper.ts";
import type { ConversationChannel } from "./session-registry.ts";

/** 事件翻译的中间状态（**每个会话一份**）。 */
export class EventBridgeState {
	/** 这个会话用到的 **MCP 工具名前缀**（`mcp__<server>__`）。 ·  */
	mcpPrefixes: readonly string[] = [];

	/** 事件映射器（它要记住「这一轮助手消息开过头没有」）。 */
	readonly mapper: AgentEventMapper;

	/** 最近一次**写操作**（成功后用来发 `entity_updated`）。 */
	lastWrite: { toolName: string; entityId: number; fields: string[] } | undefined;

	/** 最近一次 **MCP 写操作**的参数（用来写审计行）。 ·  */
	lastMcpWrite: { toolName: string; args: Record<string, unknown> } | undefined;

	constructor() {
		// ⚠️ **工具名一律归一化**：MCP 的工具在模型侧叫 `mcp__<server>__<tool>`
		//    ⇒ 界面上要显示**我们自己的命令名**（`create_task`）；模型侧看到的名字不变。
		this.mapper = new AgentEventMapper({
			normalizeToolName: (toolName) => stripMcpToolPrefix(toolName, this.mcpPrefixes),
		});
	}
}

/** 事件桥要谁配合（**运行时给**）。 */
export interface EventBridgeHooks {
	/** 发布一帧 SSE（**顺序 = 契约**）。 */
	publish(event: SseEventName, payload: SsePayload): void;
	/** MCP 写成功 ⇒ 落一条审计（`ai_audit_log`）。 */
	writeAudit(
		write: { toolName: string; args: Record<string, unknown> },
		event: { result?: unknown },
	): void;
	/** 助手说的话落库（**产品事实**：`ai_message`）。 */
	appendAssistantMessage(text: string): void;
}

// 翻译一条 dsh 事件（**并做那一层「翻译之外」的副作用**）。
// @param channel 会话通道（**进程内的视图**）。
// @param event dsh 事件（**我们自己的词汇**）。
// @param hooks 运行时的配合（发布 / 审计 / 落库）。
export function bridgeEvent(
	channel: ConversationChannel,
	event: AgentEvent,
	hooks: EventBridgeHooks,
): void {
	const { context, bridge } = channel;

	// ⚠️ **写回成功 ⇒ 告诉前端「哪条任务变了」**（前端据此刷新列表并高亮）。
	//    ⚠️ 参数在闸门里被**就地改写过**（收窄成允许回填的字段）⇒ 这里读到的就是**真正写下去的那份**。
	if (event.type === "tool_execution_start") {
		const args = (event.args ?? {}) as Record<string, unknown>;
		// ⚠️ **MCP 的写也要留审计**（我们自己的工具自己写审计）⇒ 这里记一份参数。
		if (isMcpWriteTool(event.toolName, bridge.mcpPrefixes)) {
			bridge.lastMcpWrite = { toolName: event.toolName, args };
		}
		const entityId = writeTargetId(event.toolName, context.anchor ?? null, context.writeRules ?? []);
		if (entityId !== undefined) {
			bridge.lastWrite = {
				toolName: event.toolName,
				entityId,
				fields: changedFields(
					args,
					context.anchor?.baseline ?? {},
					context.anchor?.writableFields ?? [],
				),
			};
		}
	}
	if (event.type === "tool_execution_end" && event.isError !== true) {
		const write = bridge.lastWrite;
		// ⚠️ **MCP 写成功 ⇒ 落一条审计**（写前快照用讨论上下文里的基线）
		const mcpWrite = bridge.lastMcpWrite;
		if (mcpWrite !== undefined && mcpWrite.toolName === event.toolName) {
			bridge.lastMcpWrite = undefined;
			hooks.writeAudit(mcpWrite, event);
		}
		if (write !== undefined && write.toolName === event.toolName) {
			bridge.lastWrite = undefined;
			hooks.publish(SSE_EVENTS.ENTITY_UPDATED, {
				conversationId: channel.conversationId,
				entityType: "task",
				entityId: write.entityId,
				fields: write.fields,
			});
		}
	}
	if (event.type === "agent_start") {
		channel.isStreaming = true;
	}
	if (event.type === "agent_settled") {
		channel.isStreaming = false;
	}
	for (const mapped of bridge.mapper.map(channel.conversationId, event)) {
		hooks.publish(mapped.event, mapped.payload);
	}
	if (event.type === "message_end" && isAssistantMessage(event.message)) {
		// ⚠️ **只存助手的话**：用户那句话运行时自己存（role USER）；
		// 工具结果消息（role=toolResult）也不是对话内容 —— 存进来会把界面弄乱。
		const text = extractAssistantText(event.message);
		if (text.trim().length > 0) {
			hooks.appendAssistantMessage(text);
		}
	}
}

/** 这个工具是不是「**MCP 的写**」（会改数据的那种）。 ·  */
function isMcpWriteTool(toolName: string, prefixes: readonly string[]): boolean {
	if (!toolName.startsWith("mcp__")) {
		return false;
	}
	const bare = stripMcpToolPrefix(toolName, prefixes);
	return bare.startsWith("create_") || bare.startsWith("update_") || bare.startsWith("patch_");
}
