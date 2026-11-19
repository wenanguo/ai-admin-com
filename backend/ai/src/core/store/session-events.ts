/**
 * 会话事件日志（**dsh 形状**：追加式事件流）—— 落在 `ai_session_event` 表。
 *
 * ## 为什么有这张表
 *
 * dsh 把「这一轮发生了什么」记成**追加式事件日志**（模型调用 / 工具调用 / 审批 / 流）；
 * 我们以前只有**关系型行**（会话 / 消息 / 待确认 / 审计）⇒ **运行细节查不到**
 * （「上周那轮 AI 到底调了哪些工具？」只能靠猜）。
 *
 * ⇒ 这张表就是 **dsh 形状的会话持久化**：一行 = 一个事件，**只追加**（没有 UPDATE / DELETE 的语义）。
 *
 * ## 为什么落在同一个 MySQL（而不是 dsh 自己的 JSONL）
 *
 * - **查得到**：SQL 能按会话 / 序号查、能和审计表一起 join；
 * - **不丢**：容器本地磁盘（`dshHome`）随容器一起没 ⇒ 事件日志进库才留得住；
 * - **只加不改**：共享库的规矩（只许加表 / 加列 ⇒ 这张表是**新增**的，老表一个字没动）。
 *
 * ⚠️ **dsh 侧那份 JSONL 仍然存在**（dsh 自己写的）⇒ 我们这份是**可查询的那份**
 *    （执行痕迹的真相源在 dsh 那边，我们这份是它的投影）。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./db.ts";

/**
 * 事件种类。
 *
 * ⚠️ **不是枚举**（数据库里是 `VARCHAR`）⇒ 以后加新种类**不用改表**（只加不改）。
 */
export type SessionEventKind =
	| "model_call"
	| "tool_call"
	| "tool_result"
	| "gate_asked"
	| "gate_decided"
	| "turn_end"
	| "other";

/** 一条会话事件。 */
export interface SessionEventRecord {
	id: string;
	conversationId: string;
	dshSessionId: string | null;
	seq: number;
	kind: SessionEventKind;
	eventName: string;
	payload: unknown;
	createdAt: Date;
}

/** 要追加的一条事件。 */
export interface SessionEventInput {
	conversationId: string;
	dshSessionId?: string | undefined;
	kind: SessionEventKind;
	eventName: string;
	payload: unknown;
}

/** 会话事件日志的存取（**测试用假实现** ⇒ 适配层不连库也能测）。 */
export interface SessionEventStore {
	/** 追加一条事件（**只增**）。 */
	append(input: SessionEventInput): Promise<void>;
	/** 列某个会话的事件（**按序号升序**；缺省最多 200 条 ⇒ 最新的在最后）。 */
	list(conversationId: string, limit?: number): Promise<SessionEventRecord[]>;
}

/** 真的写进 `ai_session_event`。 */
export class PrismaSessionEventStore implements SessionEventStore {
	async append(input: SessionEventInput): Promise<void> {
		const seq = await this.nextSeq(input.conversationId);
		await prisma.aiSessionEvent.create({
			data: {
				conversationId: input.conversationId,
				dshSessionId: input.dshSessionId ?? null,
				seq,
				kind: input.kind,
				eventName: input.eventName,
				payload: toJsonValue(input.payload),
			},
		});
	}

	async list(conversationId: string, limit = 200): Promise<SessionEventRecord[]> {
		const rows = await prisma.aiSessionEvent.findMany({
			where: { conversationId },
			orderBy: { seq: "asc" },
			take: limit,
		});
		return rows.map(toRecord);
	}

	/** 这个会话现有的最大序号（新的事件从它 +1 开始）。 */
	async nextSeq(conversationId: string): Promise<number> {
		const row = await prisma.aiSessionEvent.aggregate({
			where: { conversationId },
			_max: { seq: true },
		});
		return (row._max.seq ?? 0) + 1;
	}
}

/* ------------------------------------------------------------ 内部 */

/**
 * 一条事件的**折叠摘要**（给快照端点用）。
 *
 * ⚠️ **只留一句话**（不把整个载荷端出去）⇒ 快照还是轻的。
 */
export interface SessionEventSummary {
	/** 会话内的序号。 */
	seq: number;
	/** 事件种类。 */
	kind: SessionEventKind;
	/** 事件名（dsh 的事件名）。 */
	eventName: string;
	/** 发生时间（ISO 字符串）。 */
	at: string;
	/** 一句话摘要（工具名 / 命令名 / 决策……；没有就空串）。 */
	detail: string;
}

/**
 * 一条事件 ⇒ 折叠摘要。
 *
 * @param record 事件行。
 */
export function summarizeSessionEvent(record: SessionEventRecord): SessionEventSummary {
	return {
		seq: record.seq,
		kind: record.kind,
		eventName: record.eventName,
		at: record.createdAt.toISOString(),
		detail: detailOf(record.payload),
	};
}

/** 载荷里的一句话摘要（**按约定取这几个键**；没有就空串）。 */
function detailOf(payload: unknown): string {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		return "";
	}
	const record = payload as Record<string, unknown>;
	for (const key of ["command", "name", "toolName", "decision"]) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return "";
}

/** Prisma 行 → 我们的形状。 */
function toRecord(row: {
	id: string;
	conversationId: string;
	dshSessionId: string | null;
	seq: number;
	kind: string;
	eventName: string;
	payload: unknown;
	createdAt: Date;
}): SessionEventRecord {
	return {
		id: row.id,
		conversationId: row.conversationId,
		dshSessionId: row.dshSessionId,
		seq: row.seq,
		kind: row.kind as SessionEventKind,
		eventName: row.eventName,
		payload: row.payload,
		createdAt: row.createdAt,
	};
}

/**
 * 任意值 → **必填**的 JSON 列。
 *
 * ⚠️ 必填列不能写 SQL NULL ⇒ 没值时写 JSON 的 `null`（`Prisma.JsonNull`）。
 */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
	if (value === null || value === undefined) {
		return {};
	}
	const text = JSON.stringify(value);
	if (text === undefined) {
		return {};
	}
	const parsed: unknown = JSON.parse(text);
	return parsed === null ? {} : (parsed as Prisma.InputJsonValue);
}
