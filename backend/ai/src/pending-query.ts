/**
 * 待确认只读查询 —— 把 `ai_pending_action` 的行映射成前端要的形状。
 *
 * ## 为什么要有它
 *
 * 破坏性命令（批量改、删除、升级风险等级）**不能**直接执行 ⇒ AI 先把它写成
 * 一行「待人决定」（`ai_pending_action`），等人点头才执行。
 * 前端的「待确认」页签要能看到这些行 —— 写侧（挂起/恢复）属完整版 Task 7，
 * **读侧**是本文件。
 *
 * ## 四条硬规矩
 *
 * 1. **只看自己的**：where 里永远带 `userId`（调用方的 AiAdmin user id）——
 *    别人的待确认行**一条都不许**返回。
 * 2. **status 缺省 PENDING**：缺省参数（或非法值）只看「还等着人点头」的行；
 *    已被确认/拒绝/执行掉的行不该再出现在待确认页签里。
 * 3. **preview 原样透出**：它本来就是 JSON 列（`{title, hits[], warning}`），
 *    前端要按原样渲染 ⇒ **不加工**（连脱敏都不做 —— 它是给人看的摘要）。
 * 4. **args 要脱敏**：与审计读侧**共用同一份** `src/audit-redact.ts`
 *    （凭据类键名的值换成「[已脱敏]」）—— 两边各写一份 ⇒ 迟早有一边漏。
 *
 * ## 依赖注入
 *
 * 读侧只依赖 `PendingActionReader`（一个 `findMany`）——
 * 生产用 Prisma 的 `aiPendingAction`（`prismaPendingReader`），测试用假实现 ⇒
 * **测试不连库**（`ai_pending_action` 在共享生产库里，绝不能被测试写脏）。
 */

import type { PrismaClient } from "@prisma/client";
import { redactAuditArgs } from "./audit-redact.ts";

/** 待确认动作的状态（与 `ai_pending_action.status` 的枚举一致）。 */
export type PendingStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "EXPIRED" | "EXECUTED";

/** 所有合法状态（解析参数时只认这些）。 */
export const PENDING_STATUSES: readonly PendingStatus[] = [
	"PENDING",
	"CONFIRMED",
	"REJECTED",
	"EXPIRED",
	"EXECUTED",
];

/** 缺省状态：只看待确认（还等人点头）。 */
export const DEFAULT_PENDING_STATUS: PendingStatus = "PENDING";

/** 待确认表的一行（只列读侧用得到的列）。 */
export interface PendingRow {
	/**
	 * 行 id。
	 *
	 * ⚠️ 库里现在这列是 `varchar(64)` 的 cuid（实测过），
	 * 但前端只当**不透明的 key** 用 ⇒ 读侧一律转成字符串输出；
	 * 行类型同时容忍整型 id（万一哪天换成自增整型 ⇒ 不用改读侧代码）。
	 */
	id: string | number;
	/** 所属会话（没有就是 null）。 */
	conversationId: string | null;
	/** 发起人（**永远**用它做作用域过滤）。 */
	userId: string;
	/** 命令名。 */
	command: string;
	/** 参数（JSON 列）。 */
	args: unknown;
	/** 预览摘要（JSON 列；前端原样渲染）。 */
	preview: unknown;
	/** 状态。 */
	status: PendingStatus;
	/** 过期时间。 */
	expiresAt: Date;
	/** 创建时间。 */
	createdAt: Date;
}

/** 读侧的 where（只用这几个字段 —— 够用，且好测）。 */
export interface PendingWhere {
	/** 只看这个用户的行（**永远带上**）。 */
	userId: string;
	/** 状态筛选（缺省 `PENDING`）。 */
	status: PendingStatus;
}

/** `findMany` 的参数（我们只用这三个）。 */
export interface PendingFindArgs {
	where: PendingWhere;
	orderBy: { createdAt: "desc" };
	take: number;
}

/** 待确认读侧的最小依赖（生产用 Prisma，测试用假实现）。 */
export interface PendingActionReader {
	/** 取待确认的行（新的在前）。 */
	findMany(args: PendingFindArgs): Promise<PendingRow[]>;
}

/** 前端传来的筛选条件（只认这几个，其余参数**静默忽略**）。 */
export interface PendingFilters {
	/** 状态筛选（缺省 `PENDING`）。 */
	status?: PendingStatus;
	/** 一页多少条（缺省 50，上限 200）。 */
	limit?: number;
}

/** 一次待确认查询的全部输入。 */
export interface PendingQueryInput extends PendingFilters {
	/** 只看这个用户的行。 */
	userId: string;
}

/** 一条待确认（前端按这个形状写）。 */
export interface PendingItem {
	/** 待确认行 id（字符串，前端当不透明的 key 用）。 */
	id: string;
	/** 所属会话（没有就是 null）。 */
	conversationId: string | null;
	/** 命令名。 */
	command: string;
	/** 参数（与审计读侧同一份脱敏）。 */
	args: Record<string, unknown>;
	/** 预览摘要（JSON 列**原样透出**）。 */
	preview: unknown;
	/** 状态。 */
	status: PendingStatus;
	/** 过期时间（ISO 字符串）。 */
	expiresAt: string;
	/** 创建时间（ISO 字符串）。 */
	createdAt: string;
}

/** 一页默认多少条。 */
export const DEFAULT_PENDING_LIMIT = 50;

/** 一页最多多少条（再多会把响应撑大，前端也用不完）。 */
export const MAX_PENDING_LIMIT = 200;

/**
 * 解析 query 参数。
 *
 * ⚠️ **不认识的参数静默忽略**（前端会多传 `from` / `to` 等本轮不做的参数）——
 * 因为不认识的参数就报错 ⇒ 前端每加一个筛选就得改服务端。
 */
export function parsePendingFilters(search: URLSearchParams): PendingFilters {
	const filters: PendingFilters = {};
	const status = readStatus(search.get("status"));
	if (status !== undefined) {
		filters.status = status;
	}
	const limit = readInt(search.get("limit"));
	if (limit !== undefined) {
		filters.limit = limit;
	}
	return filters;
}

/**
 * 查待确认列表（当前用户的，新的在前）。
 *
 * @param reader 读侧依赖（生产用 `prismaPendingReader(prisma)`，测试用假实现）。
 * @param input 查询条件（`userId` 必填 —— 作用域靠它）。
 */
export async function queryPendingActions(
	reader: PendingActionReader,
	input: PendingQueryInput,
): Promise<PendingItem[]> {
	const where = buildWhere(input);
	const take = clampLimit(input.limit);
	const rows = await reader.findMany({ where, orderBy: { createdAt: "desc" }, take });
	return rows.map((row) => toItem(row));
}

/**
 * 把 Prisma 的 `aiPendingAction` 适配成读侧依赖（生产用）。
 *
 * ⚠️ 这里**只**取 `findMany` 一个方法 ⇒ 读侧不依赖 Prisma 的其它形状，
 * 测试才能用假实现替身。
 */
export function prismaPendingReader(client: PrismaClient): PendingActionReader {
	return {
		findMany: (args) => client.aiPendingAction.findMany(args),
	};
}

/* ------------------------------------------------------------ 内部 */

/** 拼 where（`userId` 永远带上 —— 别人的行一条都不许返回；`status` 缺省 PENDING）。 */
function buildWhere(input: PendingQueryInput): PendingWhere {
	return {
		userId: input.userId,
		status: input.status ?? DEFAULT_PENDING_STATUS,
	};
}

/** 一页条数：缺省 50，上限 200（非法值当缺省）。 */
function clampLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit)) {
		return DEFAULT_PENDING_LIMIT;
	}
	const rounded = Math.floor(limit);
	if (rounded < 1) {
		return DEFAULT_PENDING_LIMIT;
	}
	return Math.min(rounded, MAX_PENDING_LIMIT);
}

/** 一行 → 前端要的形状。 */
function toItem(row: PendingRow): PendingItem {
	return {
		id: String(row.id),
		conversationId: row.conversationId,
		command: row.command,
		// ⚠️ 参数是模型给的、运行时来的 ⇒ 可能夹带凭据 ⇒ 与审计读侧共用同一份脱敏
		args: redactAuditArgs(row.args),
		// ⚠️ preview 是给人看的摘要 ⇒ 原样透出（不加工、不脱敏）
		preview: row.preview,
		status: row.status,
		expiresAt: row.expiresAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
	};
}

/** `status` 参数（认得枚举里的值；别的值当没传）。 */
function readStatus(raw: string | null): PendingStatus | undefined {
	if (raw === null) {
		return undefined;
	}
	const normalized = raw.trim().toUpperCase();
	return PENDING_STATUSES.find((status) => status === normalized);
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
