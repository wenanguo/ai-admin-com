/**
 * 命令回执的存取 —— **幂等的事实源**（issue #175 · S4）。
 *
 * 以前命令 id 记在**进程内的 Map** ⇒ 进程一重启就忘了 ⇒ 客户端重试会**重跑一遍**
 * （本仓的命令是**写** ⇒ 多建一条任务）；记忆还有上限 ⇒ 淘汰后再来一次也会重跑。
 * ⇒ 落成 `ai_command_ack` 表 ⇒ **跨进程也去重** ⇒ 幂等成为**事实**。
 *
 * ⚠️ **事实源只有一份**：别的地方**不许**再记一份命令 id（记两份 ⇒ 会漂 ⇒ 去重会漏）。
 * ⚠️ **表还不存在时（老库没迁移）不许把命令搞挂** ⇒ 运行时那边兜住异常。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./db.ts";

/** 命令的受理结果（前端拿它对 Idempotency-Key）。 */
export interface CommandAck {
	/** 回显请求里的命令 id。 */
	id: string;
	/** 固定 "response"。 */
	type: "response";
	/** 已受理并排队。 */
	success: boolean;
}

/** 命令回执的存取（**产品事实**）。 */
export interface CommandAckStore {
	/** 取上次这个命令 id 的回执（没有 ⇒ `undefined`）。 */
	recall(conversationId: string, commandId: string): Promise<CommandAck | undefined>;
	/** 记下「这个命令 id 已经受理过」（**同一个 id 再来 ⇒ 回上次那个**）。 */
	remember(conversationId: string, commandId: string, ack: CommandAck): Promise<void>;
}

/** Prisma 实现（**产品事实表** `ai_command_ack`）。 */
export class PrismaCommandAckStore implements CommandAckStore {
	/** 取上次这个命令 id 的回执。 */
	async recall(conversationId: string, commandId: string): Promise<CommandAck | undefined> {
		const row = await prisma.aiCommandAck.findUnique({
			where: { conversationId_commandId: { conversationId, commandId } },
		});
		if (row === null) {
			return undefined;
		}
		return ackOf(row.ack, commandId);
	}

	/** 记下「这个命令 id 已经受理过」（**重记不报错** ⇒ 幂等）。 */
	async remember(conversationId: string, commandId: string, ack: CommandAck): Promise<void> {
		await prisma.aiCommandAck.upsert({
			where: { conversationId_commandId: { conversationId, commandId } },
			create: { conversationId, commandId, ack: toJsonValue(ack) },
			update: { ack: toJsonValue(ack) },
		});
	}
}

/** 任意值 → **必填**的 JSON 列（没值时写空对象 ⇒ 不写 SQL NULL）。 */
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

// 从库里读出来的回执（**容错**：形状不对 ⇒ 当没有 ⇒ 宁可重跑也别回错）。
// @param stored 库里的 JSON。
// @param commandId 命令 id（回执里没有就补上）。
function ackOf(stored: unknown, commandId: string): CommandAck {
	if (typeof stored !== "object" || stored === null) {
		return { id: commandId, type: "response", success: true };
	}
	const record = stored as { id?: unknown; type?: unknown; success?: unknown };
	return {
		id: typeof record.id === "string" ? record.id : commandId,
		type: "response",
		success: record.success !== false,
	};
}
