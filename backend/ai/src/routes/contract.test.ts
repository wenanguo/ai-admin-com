/**
 * **契约表对新的 Express 实现** —— 与迁移前跑的是同一张表。
 *
 * `src/app/api/contract.test.ts`（临时）跑的是**旧的 Next 实现**；
 * 这里跑的是**新的 Express 实现** ⇒ 两边必须一模一样。
 *
 * ⚠️ mock 的模块路径与 Next 那份不同（相对深度不同），但被 mock 的**模块本身**
 *    是同一个 ⇒ 行为可比。
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BAD_TOKEN, JSON_CONTRACT, MISSING_CONVERSATION } from "./contract.ts";

// ── 把运行时与数据层换成假的（不碰真数据库、不打真模型） ────────────────────

vi.mock("../agent/runtime", () => ({
	AgentError: class AgentError extends Error {
		readonly kind: string;
		constructor(kind: string, message: string) {
			super(message);
			this.name = "AgentError";
			this.kind = kind;
		}
	},
	agentRuntime: {
		resolveCurrentUser: async (token: string) => {
			if (token === BAD_TOKEN) {
				const error = new Error("凭证已失效");
				error.name = "AdapterErrorException";
				(error as { kind?: string }).kind = "AUTH_EXPIRED";
				throw error;
			}
			return { id: 2, name: "测试用户" };
		},
		listConversations: async () => [
			{
				conversationId: "conv-1",
				title: "第一个会话",
				updatedAt: new Date("2026-01-02T03:04:05.000Z"),
			},
		],
		createConversation: async (_userId: string, title?: string) => ({
			conversationId: "conv-new",
			title: title ?? "新会话",
			createdAt: new Date("2026-01-02T03:04:05.000Z"),
		}),
		submitCommand: async (request: { commandId: string }) => ({
			id: request.commandId,
			type: "response" as const,
			success: true,
		}),
		readState: async (conversationId: string) => {
			if (conversationId === MISSING_CONVERSATION) {
				const error = new Error("会话不存在");
				error.name = "AgentError";
				(error as { kind?: string }).kind = "NOT_FOUND";
				throw error;
			}
			return {
				conversationId,
				messages: [
					{
						id: "m-1",
						role: "user",
						content: "你好",
						seq: 1,
						createdAt: new Date("2026-01-02T03:04:05.000Z"),
					},
				],
				isStreaming: false,
				model: "test-model",
			};
		},
		abort: async () => undefined,
		getChannel: () => undefined,
		subscribe: () => () => undefined,
	},
}));

vi.mock("../pending-write", () => ({
	resolvePendingAction: async (id: string) => id !== "already-handled",
}));

vi.mock("../pending-query", () => ({
	parsePendingFilters: () => ({ status: "PENDING", limit: 50 }),
	prismaPendingReader: () => ({}),
	queryPendingActions: async () => [
		{ id: "p-1", conversationId: "conv-1", toolName: "update_task", status: "PENDING" },
	],
}));

vi.mock("../audit-query", () => ({
	parseAuditFilters: () => ({}),
	prismaAuditReader: () => ({}),
	queryAuditLog: async () => ({ total: 0, items: [] }),
}));

vi.mock("../db", () => ({ prisma: {} }));

vi.mock("../agent/pending-waiters", () => ({
	pendingWaiters: { decide: vi.fn() },
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

describe("契约表对新的 Express 实现", () => {
	it.each(JSON_CONTRACT.map((testCase) => [testCase.name, testCase] as const))(
		"%s",
		async (_name, testCase) => {
			const headers: Record<string, string> = {
				authorization: "Bearer test-token",
				...(testCase.headers ?? {}),
			};
			let body: string | undefined;
			if (typeof testCase.body === "string") {
				body = testCase.body;
			} else if (testCase.body !== undefined) {
				body = JSON.stringify(testCase.body);
			}
			if (body !== undefined) {
				headers["content-type"] = "application/json";
			}

			const response = await fetch(`${base}${testCase.path}`, {
				method: testCase.method,
				headers,
				...(body === undefined ? {} : { body }),
			});

			expect(response.status).toBe(testCase.status);

			if (testCase.code === undefined) {
				// 预检：没有 body
				return;
			}

			const payload = (await response.json()) as {
				code?: number;
				msg?: string;
				data?: unknown;
			};
			expect(payload.code).toBe(testCase.code);
			if (testCase.msg !== undefined) {
				expect(payload.msg).toBe(testCase.msg);
			}
			if (testCase.checkData) {
				testCase.checkData(payload.data);
			}
		},
	);
});
