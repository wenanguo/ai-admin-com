/**
 * 审计 —— 每次 AI 写操作都留一条 `ai_audit_log`。
 *
 * ## 为什么必须有
 *
 * AI 会在**共享的生产库**里真的建东西（任务、里程碑……）。没有审计行，
 * 事后没人说得清「这条任务是 AI 建的还是人手建的」「参数是什么」「改前长什么样」。
 * 合并设计把 `ai_audit_log` 定成**权威**审计（验收口径：「每次 AI 写入都有 `ai_audit_log`」）。
 *
 * ## 写什么
 *
 * - `actor_type` = `AI`（本服务发起的写）；
 * - `command` = 命令名（如 `create_task`）；
 * - `args` = **脱敏后**的参数（绝不带 token / 口令）；
 * - `before_snapshot` / `after_snapshot` = 适配层算好的写前/写后快照
 *   （撤销层将来直接读它，不必回头改适配层的接口）；
 * - `user_id` = 当前的登录用户（后端 `sys_user.id`）。
 *
 * ## ⚠️ 写审计失败**不许**把已经建好的东西弄丢
 *
 * 写操作已经发生在 AiAdmin 那边了 —— 这时把结果报成「失败」只会诱使模型/前端**重试**
 * ⇒ 又建一个（这正是命令去重要挡的那类重复）。
 * 所以失败只记一条错误日志（见 `tools/create-task.ts`），结果照常算成功。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./db.ts";

/** 一条审计（写进 `ai_audit_log` 的一行）。 */
export interface AuditEntry {
	/** 发起方（本服务的写都是 `AI`）。 */
	actorType: "USER" | "AI";
	/** 命令名（如 `create_task`）。 */
	command: string;
	/** **脱敏后**的参数（不许出现 token / 口令）。 */
	args: Record<string, unknown>;
	/** 写前快照（新建 ⇒ null）。 */
	before: unknown;
	/** 写后快照。 */
	after: unknown;
	/** 触发人（后端 `sys_user.id`）。 */
	userId: string;
	/** 模型标识（拿得到就写）。 */
	model?: string;
	/** 本次消耗的 token（拿得到就写）。 */
	tokens?: number;
}

/** 审计的写入处（生产用 `PrismaAuditWriter`，测试用假实现）。 */
export interface AuditWriter {
	/** 写一条审计。 */
	write(entry: AuditEntry): Promise<void>;
}

/** 真的写进 `ai_audit_log`。 */
export class PrismaAuditWriter implements AuditWriter {
	async write(entry: AuditEntry): Promise<void> {
		await prisma.aiAuditLog.create({
			data: {
				userId: entry.userId,
				actorType: entry.actorType,
				command: entry.command,
				args: toJsonValue(entry.args),
				beforeSnapshot: toNullableJson(entry.before),
				afterSnapshot: toNullableJson(entry.after),
				model: entry.model ?? null,
				tokens: entry.tokens ?? null,
			},
		});
	}
}

/**
 * 任意值 → **必填**的 JSON 列。
 *
 * ⚠️ 必填列不能写 SQL NULL ⇒ 没值时写 JSON 的 `null`（`Prisma.JsonNull`）。
 */
function toJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
	if (value === null || value === undefined) {
		return Prisma.JsonNull;
	}
	const text = JSON.stringify(value);
	if (text === undefined) {
		return Prisma.JsonNull;
	}
	const parsed: unknown = JSON.parse(text);
	return parsed as Prisma.InputJsonValue;
}

/**
 * 任意值 → **可空**的 JSON 列。
 *
 * ⚠️ 没值写 **SQL NULL**（`Prisma.DbNull`），不是 JSON 的 `null` ——
 * 「这一列没有值」和「这一列的值是 JSON null」在审计里不是一回事。
 */
function toNullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
	if (value === null || value === undefined) {
		return Prisma.DbNull;
	}
	const text = JSON.stringify(value);
	if (text === undefined) {
		return Prisma.DbNull;
	}
	const parsed: unknown = JSON.parse(text);
	return parsed as Prisma.InputJsonValue;
}
