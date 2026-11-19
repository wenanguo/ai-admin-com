/**
 * dsh 的**留痕层** —— dsh 事件 / 闸门决策 ⇒ **会话事件日志** + **审计**。
 *
 * ## 为什么要有这一层
 *
 * 迁移到 dsh 之后，「这一轮发生了什么」是**事件流**（模型调用 / 工具调用 / 审批 / 流），
 * 而我们对外要的是**能查的产品事实** ⇒ 需要一个**投影**：
 *
 * ```
 * dsh 事件 ──▶ ai_session_event（dsh 形状的追加式事件日志 · 新表）
 *          └─▶ ai_audit_log（审计 · 已有表 · 口径不变）
 * ```
 *
 * ⚠️ **审计表语义一个字不改**（仍是「已经发生的动作」的权威凭据）⇒
 *    这里只**补三类留痕**（模型调用 / 工具调用 / 闸门决策），
 *    写操作审计**一条不少**（还是那些工具自己写、运行时写）。
 *
 * ## 三类留痕
 *
 * | 留痕 | `command` | `actor_type` | 什么时候写 |
 * | ---- | --------- | ------------ | ---------- |
 * | 模型调用 | `model_call` | `AI` | 收到 `assistant/message` |
 * | 工具调用 | 工具名 | `AI` | 收到 `tool/result` 且**这次调用没有产生写审计** |
 * | 闸门决策 | 被闸的工具名 | `USER` | 人批准 / 拒绝的那一刻 |
 *
 * ⚠️ **为什么工具调用要「没有写审计才补」**：写工具自己已经写了一条写审计
 *    （带写前 / 写后快照）⇒ 再补一条就是同一件事记两遍。
 *    ⇒ 规则：**每个工具调用至少留一行**（写工具留更全的那条）。
 *
 * ## 边界（上游 spec §7）
 *
 * 本文件住在 `core/adapter/dsh/**` ⇒ **dsh 的类型不外泄**；
 * 这里只认 `protocol.ts` 里**我们自己写的** JSON 形状。
 */

import { redactAuditArgs } from "../../audit/audit-redact.ts";
import type { AuditWriter } from "../../audit/audit.ts";
import type { AuditTrail } from "../../audit/audit-trail.ts";
import { stripMcpToolPrefix } from "../../mcp/mcp.ts";
import type { SessionEventKind, SessionEventStore } from "../../store/session-events.ts";
import { DSH_EVENTS, asRecord, asString, type DshSessionEvent } from "./protocol.ts";

/** 载荷最大多少字节（**超了截断** ⇒ 模型流别把库撑爆）。 */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

/** 模型调用在审计里的命令名（**固定的** ⇒ 查得到、筛得出）。 */
export const MODEL_CALL_COMMAND = "model_call";

/** 闸门决策在事件日志里的事件名（**我们自己的** ⇒ 与 dsh 的事件名区分开）。 */
export const GATE_DECIDED_EVENT = "gate/decided";

/** 留痕层的参数。 */
export interface DshTracerOptions {
	/** 会话 id。 */
	conversationId: string;
	/** dsh 的 session id（**可空** ⇒ 迁移前的旧会话没有这个值）。 */
	dshSessionId?: string | undefined;
	/** 发起人 id（**没有就写不了审计** ⇒ 留痕只进事件日志）。 */
	userId?: string | undefined;
	/** 模型标识（写进模型调用那条审计）。 */
	model?: string | undefined;
	/** 事件日志的去处。 */
	events: SessionEventStore;
	/** 审计的去处。 */
	audit: AuditWriter;
	/** 审计留痕带（**用来判断「这次工具调用有没有自己写审计」**）。 */
	trail?: AuditTrail | undefined;
	/** MCP 工具名前缀（用来把 `mcp__x__y` 归一化回 `y`）。 */
	mcpPrefixes?: readonly string[] | undefined;
}

/** 一次工具调用（**等它的结果** ⇒ 才知道要不要补审计）。 */
interface PendingToolCall {
	/** 工具名（原始的，可能带 MCP 前缀）。 */
	name: string;
	/** 参数（脱敏前）。 */
	args: Record<string, unknown>;
	/** 发起时刻（毫秒时间戳）⇒ 判「有没有自己写审计」的起点。 */
	at: number;
}

/** 闸门决策的结果。 */
export type GateDecision = "approved" | "rejected";

/**
 * dsh 的留痕层（**每个会话一个**）。
 *
 * ⚠️ **写失败不许影响对话**（表还没迁移 / 库连不上）⇒ 失败只记一条日志。
 */
export class DshTracer {
	readonly #options: DshTracerOptions;
	/** `callId` ⇒ 这次工具调用（`tool/result` 不带工具名 ⇒ 靠 `tool/call` 记）。 */
	readonly #pending = new Map<string, PendingToolCall>();

	constructor(options: DshTracerOptions) {
		this.#options = options;
	}

	/**
	 * 处理一条 dsh 事件。
	 *
	 * @param event dsh 事件（**我们自己声明的 JSON 形状**）。
	 */
	async handleEvent(event: DshSessionEvent): Promise<void> {
		const kind = kindOf(event.type);
		await this.#appendEvent(kind, event.type, event.data);
		switch (event.type) {
			case DSH_EVENTS.ASSISTANT_MESSAGE:
				await this.#auditModelCall(event);
				return;
			case DSH_EVENTS.TOOL_CALL:
				this.#rememberToolCall(event);
				return;
			case DSH_EVENTS.TOOL_RESULT:
				await this.#auditToolCall(event);
				return;
			default:
				return;
		}
	}

	/**
	 * 处理一次**闸门决策**（人批准 / 拒绝）。
	 *
	 * @param input 决策的内容。
	 */
	async handleGateDecision(input: {
		command: string;
		args: Record<string, unknown>;
		decision: GateDecision;
	}): Promise<void> {
		const command = this.#normalize(input.command);
		await this.#appendEvent("gate_decided", GATE_DECIDED_EVENT, {
			command,
			decision: input.decision,
			args: input.args,
		});
		await this.#writeAudit({
			actorType: "USER",
			command,
			args: { decision: input.decision, ...redactAuditArgs(input.args) },
		});
	}

	/* ------------------------------------------------------------ 内部 */

	/** 记一条事件（**失败只记日志**）。 */
	async #appendEvent(kind: SessionEventKind, eventName: string, payload: unknown): Promise<void> {
		try {
			await this.#options.events.append({
				conversationId: this.#options.conversationId,
				dshSessionId: this.#options.dshSessionId,
				kind,
				eventName,
				payload: truncatePayload(payload),
			});
		} catch (error) {
			console.error("[dsh] 会话事件落库失败（不影响对话）", error);
		}
	}

	/** 模型调用 ⇒ 一条审计（`command = model_call`）。 */
	async #auditModelCall(event: DshSessionEvent): Promise<void> {
		const usage = usageOf(event.data);
		await this.#writeAudit({
			actorType: "AI",
			command: MODEL_CALL_COMMAND,
			args: {
				model: this.#options.model ?? null,
				...(usage.tokens === undefined ? {} : { tokens: usage.tokens }),
			},
			model: this.#options.model,
			tokens: usage.tokens,
		});
	}

	/** 记住这次工具调用（**等结果 ⇒ 才知道要不要补审计**）。 */
	#rememberToolCall(event: DshSessionEvent): void {
		const data = asRecord(event.data);
		const callId = asString(data?.["callId"]) ?? "";
		const name = asString(data?.["name"]) ?? "";
		const args = parseArgs(data?.["arguments"]);
		this.#pending.set(callId, { name, args, at: Date.now() });
	}

	/** 工具结果 ⇒ 决定要不要补一条「工具调用」审计。 */
	async #auditToolCall(event: DshSessionEvent): Promise<void> {
		const data = asRecord(event.data);
		const message = asRecord(data?.["message"]);
		const callId = asString(message?.["toolCallId"]) ?? "";
		const pending = this.#pending.get(callId);
		this.#pending.delete(callId);
		if (pending === undefined || pending.name.length === 0) {
			return;
		}
		// ⚠️ **写工具自己写过审计了 ⇒ 不再补一条**（同一件事不记两遍）。
		//    ⚠️ 写审计里的命令名是**归一化后**的 ⇒ 两种名字都要看。
		const normalized = this.#normalize(pending.name);
		const trail = this.#options.trail;
		if (
			trail?.wroteSince(pending.name, pending.at) === true ||
			trail?.wroteSince(normalized, pending.at) === true
		) {
			return;
		}
		await this.#writeAudit({
			actorType: "AI",
			command: normalized,
			args: redactAuditArgs(pending.args),
		});
	}

	/** 写一条审计（**没有用户 ⇒ 写不了** ⇒ 只记事件日志）。 */
	async #writeAudit(entry: {
		actorType: "USER" | "AI";
		command: string;
		args: Record<string, unknown>;
		model?: string | undefined;
		tokens?: number | undefined;
	}): Promise<void> {
		const userId = this.#options.userId;
		if (userId === undefined || userId.length === 0) {
			return;
		}
		try {
			await this.#options.audit.write({
				actorType: entry.actorType,
				command: entry.command,
				args: entry.args,
				before: null,
				after: null,
				userId,
				...(entry.model === undefined ? {} : { model: entry.model }),
				...(entry.tokens === undefined ? {} : { tokens: entry.tokens }),
			});
		} catch (error) {
			// ⚠️ **写审计失败不许把已经发生的事弄丢** ⇒ 只记一条日志。
			console.error("[dsh] 写 ai_audit_log 失败（不要重试）", error);
		}
	}

	/** 工具名归一化（`mcp__<server>__<tool>` ⇒ `<tool>` ⇒ 界面 / 审计里看到的是同一个名字）。 */
	#normalize(name: string): string {
		return stripMcpToolPrefix(name, this.#options.mcpPrefixes ?? []);
	}
}

/* ------------------------------------------------------------ 内部 */

/** dsh 事件名 ⇒ 事件种类。 */
export function kindOf(eventName: string): SessionEventKind {
	switch (eventName) {
		case DSH_EVENTS.ASSISTANT_MESSAGE:
			return "model_call";
		case DSH_EVENTS.TOOL_CALL:
			return "tool_call";
		case DSH_EVENTS.TOOL_RESULT:
			return "tool_result";
		case DSH_EVENTS.APPROVAL_ASKED:
			return "gate_asked";
		case DSH_EVENTS.APPROVAL_DECIDED:
			return "gate_decided";
		case DSH_EVENTS.TURN_END:
			return "turn_end";
		default:
			return "other";
	}
}

/** 载荷截断（**超了只留前面一段** ⇒ 一条事件不会把库撑爆）。 */
export function truncatePayload(payload: unknown): unknown {
	if (payload === undefined || payload === null) {
		return {};
	}
	let text: string;
	try {
		text = JSON.stringify(payload);
	} catch {
		return { unserializable: true };
	}
	if (text === undefined) {
		return {};
	}
	if (text.length <= MAX_PAYLOAD_BYTES) {
		return payload;
	}
	return {
		truncated: true,
		bytes: text.length,
		preview: text.slice(0, MAX_PAYLOAD_BYTES),
	};
}

/** 工具参数（dsh 给的是 **JSON 字符串**；坏了就当空对象）。 */
function parseArgs(value: unknown): Record<string, unknown> {
	const raw = asString(value);
	if (raw === undefined || raw.trim().length === 0) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return asRecord(parsed) ?? {};
	} catch {
		return {};
	}
}

/** 这次模型调用用了多少 token（**拿不到就不知道** ⇒ 不写）。 */
function usageOf(data: unknown): { tokens?: number } {
	const record = asRecord(data);
	const usage = asRecord(record?.["usage"]);
	if (usage === undefined) {
		return {};
	}
	for (const key of ["totalTokens", "total_tokens", "tokens"]) {
		const value = usage[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return { tokens: value };
		}
	}
	return {};
}
