/**
 * **现状固化测试** —— 把 9 个 JSON 端点**今天**的行为钉住。
 *
 * ## 这是迁移的第一道保险
 *
 * HTTP 层要从 Next.js 换到 Express。如果不先把现状钉住，换完之后
 * 「行为变了」这件事没人会发现 —— 直到前端在生产上坏掉。
 *
 * ⇒ 这里对着**现在的 Next 实现**跑 `src/routes/contract.ts` 的契约表。
 * 下一站（`src/routes/contract.test.ts`）让**新的 Express 实现**跑同一张表。
 * 两边必须一模一样。
 *
 * ⚠️ 本文件是**临时**的：Task 7 删 `src/app/**` 时它一起消失。
 *    契约表本体在 `src/routes/contract.ts`（跟着新实现活下来）。
 */

import { describe, expect, it, vi } from "vitest";

import { BAD_TOKEN, JSON_CONTRACT, MISSING_CONVERSATION, type ContractCase } from "../../routes/contract";

// ── 把运行时与数据层换成假的（不碰真数据库、不打真模型） ────────────────────

vi.mock("../../agent/runtime", () => ({
	// `src/http/errors.ts` 用 `instanceof AgentError` 判定运行时自己的错误
	// ⇒ mock 必须把这个类也带出来（否则 errors.ts 会在判定时抛错）。
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

vi.mock("../../pending-write", () => ({
	resolvePendingAction: async (id: string) => id !== "already-handled",
}));

vi.mock("../../pending-query", () => ({
	parsePendingFilters: () => ({ status: "PENDING", limit: 50 }),
	prismaPendingReader: () => ({}),
	queryPendingActions: async () => [
		{ id: "p-1", conversationId: "conv-1", toolName: "update_task", status: "PENDING" },
	],
}));

vi.mock("../../audit-query", () => ({
	parseAuditFilters: () => ({}),
	prismaAuditReader: () => ({}),
	queryAuditLog: async () => ({ total: 0, items: [] }),
}));

vi.mock("../../db", () => ({ prisma: {} }));

vi.mock("../../agent/pending-waiters", () => ({
	pendingWaiters: { decide: vi.fn() },
}));

// ── 现在的 Next 路由 ──────────────────────────────────────────────────────

import {
	GET as conversationsGET,
	POST as conversationsPOST,
	OPTIONS as conversationsOPTIONS,
} from "./agent/conversations/route";
import {
	POST as approvePOST,
	OPTIONS as approveOPTIONS,
} from "./agent/pending/[id]/approve/route";
import { POST as rejectPOST, OPTIONS as rejectOPTIONS } from "./agent/pending/[id]/reject/route";
import {
	POST as commandPOST,
	OPTIONS as commandOPTIONS,
} from "./agent/[conversationId]/command/route";
import { GET as stateGET, OPTIONS as stateOPTIONS } from "./agent/[conversationId]/state/route";
import {
	POST as abortPOST,
	OPTIONS as abortOPTIONS,
} from "./agent/[conversationId]/abort/route";
import { GET as pendingGET, OPTIONS as pendingOPTIONS } from "./pending/route";
import { GET as auditGET, OPTIONS as auditOPTIONS } from "./audit/route";

type Handler = (
	request: Request,
	context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

interface RouteEntry {
	segments: string[];
	get?: Handler;
	post?: Handler;
	options?: Handler;
}

/**
 * 路由表（**顺序敏感**）：具体的放前面 ——
 * `/api/agent/pending/:id/approve` 必须先于 `/api/agent/:conversationId/*`。
 */
const ROUTES: RouteEntry[] = [
	{
		segments: ["api", "agent", "conversations"],
		get: conversationsGET,
		post: conversationsPOST,
		options: conversationsOPTIONS,
	},
	{
		segments: ["api", "agent", "pending", ":id", "approve"],
		post: approvePOST as unknown as Handler,
		options: approveOPTIONS as unknown as Handler,
	},
	{
		segments: ["api", "agent", "pending", ":id", "reject"],
		post: rejectPOST as unknown as Handler,
		options: rejectOPTIONS as unknown as Handler,
	},
	{
		segments: ["api", "agent", ":conversationId", "command"],
		post: commandPOST as unknown as Handler,
		options: commandOPTIONS as unknown as Handler,
	},
	{
		segments: ["api", "agent", ":conversationId", "state"],
		get: stateGET as unknown as Handler,
		options: stateOPTIONS as unknown as Handler,
	},
	{
		segments: ["api", "agent", ":conversationId", "abort"],
		post: abortPOST as unknown as Handler,
		options: abortOPTIONS as unknown as Handler,
	},
	{ segments: ["api", "pending"], get: pendingGET, options: pendingOPTIONS },
	{ segments: ["api", "audit"], get: auditGET, options: auditOPTIONS },
];

/** 找出匹配的路由与路径参数。 */
function match(path: string): { entry: RouteEntry; params: Record<string, string> } | undefined {
	const parts = path.split("/").filter((part) => part.length > 0);
	for (const entry of ROUTES) {
		if (entry.segments.length !== parts.length) {
			continue;
		}
		const params: Record<string, string> = {};
		let matched = true;
		for (const [index, segment] of entry.segments.entries()) {
			const actual = parts[index] ?? "";
			if (segment.startsWith(":")) {
				params[segment.slice(1)] = actual;
			} else if (segment !== actual) {
				matched = false;
				break;
			}
		}
		if (matched) {
			return { entry, params };
		}
	}
	return undefined;
}

/** 按契约用例造一个 Web `Request`。 */
function buildRequest(testCase: ContractCase): Request {
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
	return new Request(`http://ai.test${testCase.path}`, {
		method: testCase.method,
		headers,
		...(body === undefined ? {} : { body }),
	});
}

describe("现状固化：契约表对现在的 Next 实现", () => {
	it.each(JSON_CONTRACT.map((testCase) => [testCase.name, testCase] as const))(
		"%s",
		async (_name, testCase) => {
			if (testCase.method === "OPTIONS") {
				// 预检由各路由的 OPTIONS 导出处理（行为一样，单独断言头）
				const route = match(testCase.path);
				expect(route).toBeDefined();
				const handler = route?.entry.options;
				expect(handler).toBeDefined();
				const response = await handler?.(buildRequest(testCase), {
					params: Promise.resolve(route?.params ?? {}),
				});
				expect(response?.status).toBe(testCase.status);
				return;
			}

			const route = match(testCase.path);
			expect(route).toBeDefined();
			const handler =
				testCase.method === "GET" ? route?.entry.get : route?.entry.post;
			expect(handler).toBeDefined();

			const response = await handler?.(buildRequest(testCase), {
				params: Promise.resolve(route?.params ?? {}),
			});
			expect(response).toBeDefined();
			expect(response?.status).toBe(testCase.status);

			const payload = (await response?.json()) as {
				code?: number;
				msg?: string;
				data?: unknown;
			};
			if (testCase.code !== undefined) {
				expect(payload.code).toBe(testCase.code);
			}
			if (testCase.msg !== undefined) {
				expect(payload.msg).toBe(testCase.msg);
			}
			if (testCase.checkData) {
				testCase.checkData(payload.data);
			}
		},
	);
});
