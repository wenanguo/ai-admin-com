/**
 * 会话与消息的持久化 —— 落在本服务自己的 `ai_*` 表里
 * （`ai_conversation` / `ai_message`，单租户，没有 tenant_id）。
 *
 * ⚠️ **只存 AI 侧必需的元数据**：会话、消息、角色、序号。
 * 业务事实（任务、项目……）仍然只在 AiAdmin 那边，本服务不复制。
 *
 * ⚠️ **不存 token**：`ai_conversation` 里没有 token 列，token 只在内存里
 * （见 `session-registry.ts`）。token 落盘 = 凭据落盘，绝不能。
 */

import { prisma } from "../db";

/** 消息角色（与 `ai_message.role` 的枚举一致）。 */
export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM";

/** 一个会话。 */
export interface ConversationRecord {
	conversationId: string;
	userId: string;
	title: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** 一条消息。 */
export interface MessageRecord {
	id: string;
	conversationId: string;
	role: MessageRole;
	content: string;
	seq: number;
	createdAt: Date;
}

/** 会话的存取。 */
export class ConversationStore {
	/** 建一个会话。 */
	async create(userId: string, title: string | null): Promise<ConversationRecord> {
		const row = await prisma.aiConversation.create({
			data: { userId, title, channel: "WEB" },
		});
		return toConversation(row);
	}

	/** 按 id 取会话；没有返回 undefined。 */
	async get(conversationId: string): Promise<ConversationRecord | undefined> {
		const row = await prisma.aiConversation.findUnique({ where: { id: conversationId } });
		return row === null ? undefined : toConversation(row);
	}

	/** 列某个用户的会话（最近更新的在前）。 */
	async list(userId: string, limit = 50): Promise<ConversationRecord[]> {
		const rows = await prisma.aiConversation.findMany({
			where: { userId },
			orderBy: { updatedAt: "desc" },
			take: limit,
		});
		return rows.map(toConversation);
	}

	/** 追加一条消息。 */
	async appendMessage(
		conversationId: string,
		role: MessageRole,
		content: string,
		seq: number,
	): Promise<MessageRecord> {
		const row = await prisma.aiMessage.create({
			data: { conversationId, role, content, seq },
		});
		return toMessage(row);
	}

	/** 列会话里的消息（按序号升序）。 */
	async listMessages(conversationId: string): Promise<MessageRecord[]> {
		const rows = await prisma.aiMessage.findMany({
			where: { conversationId },
			orderBy: { seq: "asc" },
		});
		return rows.map(toMessage);
	}

	/** 会话里现有的最大序号（新建消息的序号从它 +1 开始）。 */
	async maxSeq(conversationId: string): Promise<number> {
		const row = await prisma.aiMessage.aggregate({
			where: { conversationId },
			_max: { seq: true },
		});
		return row._max.seq ?? 0;
	}

	/** 摸一下会话的更新时间（列表按它排序）。 */
	async touch(conversationId: string, title?: string): Promise<void> {
		await prisma.aiConversation.update({
			where: { id: conversationId },
			data: title === undefined ? { updatedAt: new Date() } : { updatedAt: new Date(), title },
		});
	}
}

/** Prisma 行 → 我们的形状。 */
function toConversation(row: {
	id: string;
	userId: string;
	title: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ConversationRecord {
	return {
		conversationId: row.id,
		userId: row.userId,
		title: row.title,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/** Prisma 行 → 我们的形状。 */
function toMessage(row: {
	id: string;
	conversationId: string;
	role: string;
	content: string;
	seq: number;
	createdAt: Date;
}): MessageRecord {
	return {
		id: row.id,
		conversationId: row.conversationId,
		role: row.role as MessageRole,
		content: row.content,
		seq: row.seq,
		createdAt: row.createdAt,
	};
}
