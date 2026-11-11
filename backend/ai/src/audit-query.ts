/**
 * 审计只读查询 —— 把 `ai_audit_log` 的行映射成前端要的形状。
 *
 * ## 为什么要有它
 *
 * AI 在**共享的生产库**里真的建东西（任务、里程碑……）⇒ `ai_audit_log` 是
 * 「谁做了什么」的唯一权威凭据。写侧已经有了（`src/audit.ts`），**读侧**缺一截：
 * 前端的「审计」页签要能看到这些行。
 *
 * ## 三条硬规矩
 *
 * 1. **只看自己的**：where 里永远带 `userId`（调用方的 AiAdmin user id）——
 *    别人的行**一条都不许**返回。
 * 2. **args 要脱敏**：读侧与写侧共用 `src/audit-redact.ts` 里那一份
 *    （凭据类键名的值换成「[已脱敏]」）—— 两边各写一份 ⇒ 迟早有一边漏。
 * 3. **名字只查一次**：审计行里只有 `userId`，没有名字 ⇒ 用**调用方自己的**
 *    身份解析（`src/agent/identity.ts`）拿一次，**不为每个行去查一次**。
 *
 * ## 依赖注入
 *
 * 读侧只依赖 `AuditLogReader`（`findMany` + `count`）——
 * 生产用 Prisma 的 `aiAuditLog`（`prismaAuditReader`），测试用假实现 ⇒
 * **测试不连库**（共享库里 `ai_audit_log` 有真实行，绝不能被测试写脏）。
 */

import type { PrismaClient } from "@prisma/client";
import { redactAuditArgs } from "./audit-redact.ts";

/** 发起方（与 `ai_audit_log.actor_type` 的枚举一致）。 */
export type AuditActorType = "AI" | "USER";

/** 审计表的一行（只列读侧用得到的列）。 */
export interface AuditRow {
	id: string;
	userId: string;
	actorType: AuditActorType;
	command: string;
	/** 参数（JSON 列；读出来是「原样」，脱敏在映射时做）。 */
	args: unknown;
	/** 写前快照（JSON 列，可空）。 */
	beforeSnapshot: unknown;
	/** 写后快照（JSON 列，可空）。 */
	afterSnapshot: unknown;
	undoOf: string | null;
	undoneAt: Date | null;
	adopted: boolean | null;
	model: string | null;
	tokens: number | null;
	latencyMs: number | null;
	traceId: string | null;
	error: string | null;
	createdAt: Date;
}

/** 读侧的 where（只用这几个字段 —— 够用，且好测）。 */
export interface AuditWhere {
	/** 只看这个用户的行（**永远带上**）。 */
	userId: string;
	/** 发起方筛选。 */
	actorType?: AuditActorType;
	/** 命令名筛选（精确匹配）。 */
	command?: string;
	/** 已撤销的行（`undone_at` 非空）。 */
	undoneAt?: { not: null };
}

/** `findMany` 的参数（我们只用这四个）。 */
export interface AuditFindArgs {
	where: AuditWhere;
	orderBy: { createdAt: "desc" };
	skip: number;
	take: number;
}

/** `count` 的参数。 */
export interface AuditCountArgs {
	where: AuditWhere;
}

/** 审计读侧的最小依赖（生产用 Prisma，测试用假实现）。 */
export interface AuditLogReader {
	/** 取一页行。 */
	findMany(args: AuditFindArgs): Promise<AuditRow[]>;
	/** 取符合条件的总行数。 */
	count(args: AuditCountArgs): Promise<number>;
}

/** 前端传来的筛选条件（只认这几个，其余参数**静默忽略**）。 */
export interface AuditFilters {
	/** 发起方（`AI` / `USER`）。 */
	actor?: AuditActorType;
	/** 命令名（精确匹配）。 */
	command?: string;
	/** 一页多少条（缺省 50，上限 200）。 */
	limit?: number;
	/** 从第几条开始（缺省 0）。 */
	offset?: number;
	/** 只看已撤销的（缺省 false = 全部）。 */
	undone?: boolean;
}

/** 一次审计查询的全部输入。 */
export interface AuditQueryInput extends AuditFilters {
	/** 只看这个用户的行。 */
	userId: string;
	/** 发起方名字（审计行里没有 ⇒ 取调用方自己的；取不到就用 `userId`）。 */
	actorName?: string;
}

/** 一条审计（前端按这个形状写）。 */
export interface AuditItem {
	/** 审计行 id（字符串，前端当不透明的 key 用）。 */
	id: string;
	/** 命令名。 */
	command: string;
	/** 发起方。 */
	actorType: AuditActorType;
	/** 发起方名字。 */
	actorName: string;
	/** **脱敏后**的参数。 */
	args: Record<string, unknown>;
	/** 写前快照（没有就是 null）。 */
	before: unknown;
	/** 写后快照（没有就是 null）。 */
	after: unknown;
	/** 撤销时指向的原审计行 id（没有就是 null）。 */
	undoOf: string | null;
	/** 撤销时间（没撤销就是 null）。 */
	undoneAt: string | null;
	/** 是否被采纳（没有就是 null）。 */
	adopted: boolean | null;
	/** 模型标识。 */
	model: string | null;
	/** 消耗的 token 数。 */
	tokens: number | null;
	/** 耗时（毫秒）。 */
	latencyMs: number | null;
	/** 链路追踪 id。 */
	traceId: string | null;
	/** 错误信息。 */
	error: string | null;
	/** 发生时间（ISO 字符串）。 */
	createdAt: string;
}

/** 一页审计（`GET /api/audit` 的 data）。 */
export interface AuditPage {
	/** 符合筛选条件的总行数（**不是**本页条数）。 */
	total: number;
	/** 本页的行（新的在前）。 */
	items: AuditItem[];
}

/** 一页默认多少条。 */
export const DEFAULT_AUDIT_LIMIT = 50;

/** 一页最多多少条（再多会把响应撑大，前端也用不完）。 */
export const MAX_AUDIT_LIMIT = 200;

/**
 * 解析 query 参数。
 *
 * ⚠️ **不认识的参数静默忽略**（前端会多传 `from` / `to` 等本轮不做的参数）——
 * 因为不认识的参数就报错 ⇒ 前端每加一个筛选就得改服务端。
 */
export function parseAuditFilters(search: URLSearchParams): AuditFilters {
	const filters: AuditFilters = {};
	const actor = readActor(search.get("actor"));
	if (actor !== undefined) {
		filters.actor = actor;
	}
	const command = readCommand(search.get("command"));
	if (command !== undefined) {
		filters.command = command;
	}
	const limit = readInt(search.get("limit"));
	if (limit !== undefined) {
		filters.limit = limit;
	}
	const offset = readInt(search.get("offset"));
	if (offset !== undefined) {
		filters.offset = offset;
	}
	filters.undone = readUndone(search.get("undone"));
	return filters;
}

/**
 * 查一页审计流水。
 *
 * @param reader 读侧依赖（生产用 `prismaAuditReader(prisma)`，测试用假实现）。
 * @param input 查询条件（`userId` 必填 —— 作用域靠它）。
 */
export async function queryAuditLog(
	reader: AuditLogReader,
	input: AuditQueryInput,
): Promise<AuditPage> {
	const where = buildWhere(input);
	const take = clampLimit(input.limit);
	const skip = clampOffset(input.offset);
	// ⚠️ count 与列表用**同一个** where ⇒ total 与列表口径一致
	const [rows, total] = await Promise.all([
		reader.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
		reader.count({ where }),
	]);
	const actorName = input.actorName ?? input.userId;
	return { total, items: rows.map((row) => toItem(row, actorName)) };
}

/**
 * 把 Prisma 的 `aiAuditLog` 适配成读侧依赖（生产用）。
 *
 * ⚠️ 这里**只**取 `findMany` / `count` 两个方法 ⇒ 读侧不依赖 Prisma 的其它形状，
 * 测试才能用假实现替身。
 */
export function prismaAuditReader(client: PrismaClient): AuditLogReader {
	return {
		findMany: (args) => client.aiAuditLog.findMany(args),
		count: (args) => client.aiAuditLog.count(args),
	};
}

/* ------------------------------------------------------------ 内部 */

/** 拼 where（`userId` 永远带上 —— 别人的行一条都不许返回）。 */
function buildWhere(input: AuditQueryInput): AuditWhere {
	const where: AuditWhere = { userId: input.userId };
	if (input.actor !== undefined) {
		where.actorType = input.actor;
	}
	if (input.command !== undefined && input.command.length > 0) {
		where.command = input.command;
	}
	if (input.undone === true) {
		where.undoneAt = { not: null };
	}
	return where;
}

/** 一页条数：缺省 50，上限 200（非法值当缺省）。 */
function clampLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit)) {
		return DEFAULT_AUDIT_LIMIT;
	}
	const rounded = Math.floor(limit);
	if (rounded < 1) {
		return DEFAULT_AUDIT_LIMIT;
	}
	return Math.min(rounded, MAX_AUDIT_LIMIT);
}

/** 偏移：缺省 0，负数当 0。 */
function clampOffset(offset: number | undefined): number {
	if (offset === undefined || !Number.isFinite(offset)) {
		return 0;
	}
	const rounded = Math.floor(offset);
	return rounded > 0 ? rounded : 0;
}

/** 一行 → 前端要的形状。 */
function toItem(row: AuditRow, actorName: string): AuditItem {
	return {
		id: String(row.id),
		command: row.command,
		actorType: row.actorType,
		actorName,
		// ⚠️ 读侧也必须脱敏（与写侧同一份实现）
		args: redactAuditArgs(row.args),
		before: toJsonOrNull(row.beforeSnapshot),
		after: toJsonOrNull(row.afterSnapshot),
		undoOf: row.undoOf,
		undoneAt: row.undoneAt === null ? null : row.undoneAt.toISOString(),
		adopted: row.adopted,
		model: row.model,
		tokens: row.tokens,
		latencyMs: row.latencyMs,
		traceId: row.traceId,
		error: row.error,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * JSON 列 → 响应里的值。
 *
 * ⚠️ 写侧分得清「这一列没有值」（SQL NULL，`Prisma.DbNull`）与「这一列的值是
 * JSON null」（`Prisma.JsonNull`）；读侧从 Prisma 拿到的都是 `null` ⇒ 两者
 * 在响应里都表现为 `null`。非空的值**原样透出**。
 */
function toJsonOrNull(value: unknown): unknown {
	return value === null || value === undefined ? null : value;
}

/** `actor` 参数（`AI` / `USER`；别的值当没传）。 */
function readActor(raw: string | null): AuditActorType | undefined {
	if (raw === null) {
		return undefined;
	}
	const normalized = raw.trim().toUpperCase();
	return normalized === "AI" || normalized === "USER" ? normalized : undefined;
}

/** `command` 参数（空串当没传）。 */
function readCommand(raw: string | null): string | undefined {
	if (raw === null) {
		return undefined;
	}
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** 整数参数（解析不出来当没传）。 */
function readInt(raw: string | null): number | undefined {
	if (raw === null) {
		return undefined;
	}
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}

/** `undone` 参数（`true` / `1` = 只看已撤销的）。 */
function readUndone(raw: string | null): boolean {
	if (raw === null) {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return normalized === "true" || normalized === "1";
}
