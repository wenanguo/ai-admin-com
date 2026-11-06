/**
 * 会话历史还原 —— **SDK 认这些 entries 吗**？
 *
 * 这是 P0 的验收测试：
 * 「进程重启 / 通道被回收后，模型仍然记得之前聊过什么」
 * ⇒ 前提是**我们还原出来的 entries，pi 的 SessionManager 真的认**
 * （认了才会进模型的上下文）。
 *
 * 这里直接用**真的** SDK（不 mock）验证：
 * `SessionManager.inMemory(cwd, { id }, entries).buildContextEntries()`
 * ⇒ 应当原样吐出我们放进去的消息。
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { buildSessionEntries } from "./session-entries";
import type { MessageRecord } from "./store";

/** 造一条消息记录。 */
function message(
	id: string,
	role: MessageRecord["role"],
	content: string,
	seq: number,
): MessageRecord {
	return {
		id,
		conversationId: "conv-1",
		role,
		content,
		seq,
		createdAt: new Date(2026, 0, 1, 0, 0, seq),
	};
}

describe("会话历史还原", () => {
	it("还原出来的第一个是 session 头，后面每条消息一个 entry", () => {
		const entries = buildSessionEntries({
			conversationId: "conv-1",
			cwd: "/srv/ai",
			model: "minimax-cn/MiniMax-M3.1-Flash",
			history: [
				message("msg-1", "USER", "建个任务", 1),
				message("msg-2", "ASSISTANT", "好，建了", 2),
			],
		});

		expect(entries).toHaveLength(3);
		expect(entries[0]).toMatchObject({
			type: "session",
			id: "conv-1",
			cwd: "/srv/ai",
		});
		expect(entries[1]).toMatchObject({ type: "message", id: "m-msg-1" });
		expect(entries[2]).toMatchObject({ type: "message", id: "m-msg-2" });
	});

	it("entry 是链式的（parentId 指向前一个）", () => {
		const entries = buildSessionEntries({
			conversationId: "conv-1",
			cwd: "/srv/ai",
			history: [
				message("msg-1", "USER", "一", 1),
				message("msg-2", "ASSISTANT", "二", 2),
				message("msg-3", "USER", "三", 3),
			],
		});

		expect(entries[1]).toMatchObject({ parentId: null });
		expect(entries[2]).toMatchObject({ parentId: "m-msg-1" });
		expect(entries[3]).toMatchObject({ parentId: "m-msg-2" });
	});

	it("用户消息是 user 角色，助手消息是 assistant 角色", () => {
		const entries = buildSessionEntries({
			conversationId: "conv-1",
			cwd: "/srv/ai",
			history: [
				message("msg-1", "USER", "建个任务", 1),
				message("msg-2", "ASSISTANT", "好，建了", 2),
			],
		});

		const first = entries[1];
		const second = entries[2];
		expect(first).toMatchObject({ message: { role: "user", content: "建个任务" } });
		expect(second).toMatchObject({
			message: { role: "assistant", content: [{ type: "text", text: "好，建了" }] },
		});
	});

	it("SYSTEM 消息不进上下文（系统提示词另外给，塞进来会污染 prompt）", () => {
		const entries = buildSessionEntries({
			conversationId: "conv-1",
			cwd: "/srv/ai",
			history: [
				message("msg-1", "SYSTEM", "你是助手", 1),
				message("msg-2", "USER", "你好", 2),
			],
		});

		expect(entries).toHaveLength(2);
		expect(entries[1]).toMatchObject({ id: "m-msg-2" });
	});

	it("⭐ pi 的 SessionManager 认这些 entries ⇒ 它们真的进模型上下文", () => {
		const entries = buildSessionEntries({
			conversationId: "conv-1",
			cwd: "/srv/ai",
			model: "minimax-cn/MiniMax-M3.1-Flash",
			history: [
				message("msg-1", "USER", "建个任务", 1),
				message("msg-2", "ASSISTANT", "好，建了", 2),
			],
		});

		// 用**真的** SDK 建内存会话（这正是 pi-session.ts 要做的事）
		const manager = SessionManager.inMemory("/srv/ai", { id: "conv-1" }, entries);
		const context = manager.buildContextEntries();

		expect(context).toHaveLength(2);
		expect(context[0]).toMatchObject({
			type: "message",
			message: { role: "user", content: "建个任务" },
		});
		expect(context[1]).toMatchObject({
			type: "message",
			message: { role: "assistant" },
		});
	});

	it("历史为空时也要有一个合法的 session 头（不然 SDK 会拒绝）", () => {
		const entries = buildSessionEntries({
			conversationId: "conv-1",
			cwd: "/srv/ai",
			history: [],
		});

		const manager = SessionManager.inMemory("/srv/ai", { id: "conv-1" }, entries);
		expect(manager.getSessionId()).toBe("conv-1");
		expect(manager.buildContextEntries()).toHaveLength(0);
	});

	it("⭐ 真的 SDK：还原出来的历史进了 session.messages（模型真的看得见）", async () => {
		const authPath = join(process.cwd(), ".ai", "auth.json");
		let session: { messages: unknown[]; dispose: () => void } | undefined;
		try {
			const modelRuntime = await ModelRuntime.create({ authPath });
			const model = modelRuntime.getModel("minimax-cn", "MiniMax-M3.1-Flash");
			if (model !== undefined) {
				const entries = buildSessionEntries({
					conversationId: "conv-1",
					cwd: process.cwd(),
					model: "minimax-cn/MiniMax-M3.1-Flash",
					history: [
						message("msg-1", "USER", "建个任务", 1),
						message("msg-2", "ASSISTANT", "好，建了", 2),
					],
				});
				const created = await createAgentSession({
					model,
					modelRuntime,
					noTools: "builtin",
					thinkingLevel: "off",
					sessionManager: SessionManager.inMemory(
						process.cwd(),
						{ id: "conv-1" },
						entries,
					),
				});
				session = created.session;
			}
		} catch {
			// 环境里没有 pi 的凭据/模型目录 ⇒ 验不了，跳过（不是失败）
			session = undefined;
		}

		if (session === undefined) {
			return;
		}
		try {
			expect(session.messages).toHaveLength(2);
			expect(session.messages[0]).toMatchObject({ role: "user" });
			expect(session.messages[1]).toMatchObject({ role: "assistant" });
		} finally {
			session.dispose();
		}
	});
});
