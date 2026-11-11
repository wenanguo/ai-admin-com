/**
 * 待确认动作的**写侧**（`ai_pending_action` 表）。
 *
 * ⚠️ 读侧在 `pending-query.ts`；这里补上写侧 —— 「挂起」「批准」「拒绝」。
 *
 * ⚠️ **这不是恢复挂起的地方**：挂起是进程内存里的一个 await
 * （见 `agent/pending-waiters.ts`）⇒ 这张表是**给人看的记录**
 * （谁提的、什么时候、批没批、什么时候过期）。
 */

import { prisma } from "./db.ts";

/** 默认多久算过期（毫秒）。 */
export const DEFAULT_PENDING_TTL_MS = 5 * 60 * 1000;

/** 建一条待确认。 */
export async function createPendingAction(input: {
	id?: string;
	conversationId?: string;
	userId: string;
	/** 命令（工具）名。 */
	command: string;
	/** 参数（原样存；脱敏由调用方负责）。 */
	args: Record<string, unknown>;
	/** 给人看的摘要。 */
	preview?: Record<string, unknown>;
	/** 多久算过期（毫秒）。 */
	ttlMs?: number;
}): Promise<{ id: string; expiresAt: Date }> {
	const expiresAt = new Date(
		Date.now() + (input.ttlMs ?? DEFAULT_PENDING_TTL_MS),
	);
	const row = await prisma.aiPendingAction.create({
		data: {
			...(input.id === undefined ? {} : { id: input.id }),
			conversationId: input.conversationId ?? null,
			userId: input.userId,
			command: input.command,
			args: input.args as never,
			preview: (input.preview ?? {}) as never,
			status: "PENDING",
			expiresAt,
		},
	});
	return { id: row.id, expiresAt };
}

/**
 * 把一条待确认落定（批准 / 拒绝）。
 *
 * ⚠️ **只改 PENDING 的行** ⇒ 重复批准改不到行 ⇒ 返回 false
 * ⇒ 调用方据此**不重复执行**。
 *
 * @returns 真的改到了一行 ⇒ true。
 */
export async function resolvePendingAction(
	id: string,
	status: "CONFIRMED" | "REJECTED",
	resolvedBy: string,
): Promise<boolean> {
	const result = await prisma.aiPendingAction.updateMany({
		where: { id, status: "PENDING" },
		data: { status, resolvedBy, resolvedAt: new Date() },
	});
	return result.count > 0;
}
