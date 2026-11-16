/**
 * `POST /api/agent/conversations` —— **会话与智能体的绑定**。
 *
 * ⚠️ 这个端点**要 token**（与其它业务端点一致）。
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** 建会话时用到的智能体 id（记下来断言用）。 */
const created: { userId: string; title?: string; agentId?: string }[] = [];

vi.mock("../agent/runtime.ts", () => ({
	AgentError: class AgentError extends Error {
		readonly kind: string;
		constructor(kind: string, message: string) {
			super(message);
			this.name = "AgentError";
			this.kind = kind;
		}
	},
	agentRuntime: {
		resolveCurrentUser: async () => ({ id: 2, name: "测试用户" }),
		createConversation: async (
			userId: string,
			title?: string,
			agentId?: string,
		) => {
			created.push({ userId, title, agentId });
			if (agentId === "nope") {
				const error = new Error("智能体 nope 不存在");
				error.name = "AgentError";
				(error as { kind?: string }).kind = "NOT_FOUND";
				throw error;
			}
			return {
				conversationId: `${agentId ?? "pm"}_abc123`,
				title: title ?? "新会话",
				createdAt: new Date("2026-01-02T03:04:05.000Z"),
			};
		},
	},
}));

import { createApp } from "../server.ts";

let server: Server;
let base: string;

beforeAll(async () => {
	server = createApp().listen(0);
	await new Promise<void>((resolve) => server.once("listening", () => resolve()));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/agent/conversations（会话↔智能体）", () => {
	it("缺 token ⇒ 401", async () => {
		const response = await fetch(`${base}/api/agent/conversations`, {
			method: "POST",
		});
		expect(response.status).toBe(401);
	});

	it("不传 agentId ⇒ 用默认智能体（服务端回落）", async () => {
		created.length = 0;
		const response = await fetch(`${base}/api/agent/conversations`, {
			method: "POST",
			headers: {
				authorization: "Bearer test-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({ title: "标题" }),
		});
		expect(response.status).toBe(200);
		expect(created[0]?.agentId).toBeUndefined();
		expect(created[0]?.title).toBe("标题");
	});

	it("传了 agentId ⇒ 会话绑到这个智能体", async () => {
		created.length = 0;
		const response = await fetch(`${base}/api/agent/conversations`, {
			method: "POST",
			headers: {
				authorization: "Bearer test-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({ agentId: "qa" }),
		});
		expect(response.status).toBe(200);
		expect(created[0]?.agentId).toBe("qa");

		const payload = (await response.json()) as {
			data?: { conversationId?: string };
		};
		// ⚠️ 会话 id 里带着智能体 id ⇒ 绑定跟着会话走
		expect(payload.data?.conversationId?.startsWith("qa_")).toBe(true);
	});

	it("智能体不存在 ⇒ 404（不建一个“不知道用什么提示词”的会话）", async () => {
		const response = await fetch(`${base}/api/agent/conversations`, {
			method: "POST",
			headers: {
				authorization: "Bearer test-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({ agentId: "nope" }),
		});
		expect(response.status).toBe(404);
	});
});
