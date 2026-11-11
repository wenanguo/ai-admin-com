/**
 * SSE 事件流（Express 版）的行为验收。
 *
 * 帧的顺序（与迁移前一字不差）：
 * 1. `connected`（第一帧）；
 * 2. **回放**：会话之前发生过的帧；
 * 3. **增量**：往后实时推。
 * 心跳：每 15 秒一个 SSE 注释行。
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
		resolveCurrentUser: async () => ({ id: 2, name: "测试用户" }),
		readState: async (conversationId: string) => ({
			conversationId,
			messages: [],
			isStreaming: false,
			model: "test-model",
		}),
		getChannel: () => ({
			isStreaming: false,
			backlog: { list: () => [] as unknown[] },
		}),
		subscribe: (_conversationId: string, onFrame: (frame: unknown) => void) => {
			// 真实运行时，增量帧是**异步**来的 ⇒ 这里也异步，顺序才对得上
			setTimeout(() => {
				onFrame({ seq: 1, event: "text_delta", data: '{"delta":"你好"}' });
			}, 0);
			return () => undefined;
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
	// SSE 的长连接会挂着 ⇒ 强制断开，别让关服等它
	server.closeAllConnections?.();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 读到指定事件为止，返回累计文本。 */
async function readUntil(
	url: string,
	needle: string,
	controller: AbortController,
): Promise<string> {
	const response = await fetch(url, {
		headers: { authorization: "Bearer test-token" },
		signal: controller.signal,
	});
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("没有响应体");
	}
	const decoder = new TextDecoder();
	let text = "";
	while (!text.includes(needle)) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		text += decoder.decode(value, { stream: true });
	}
	return text;
}

describe("SSE 事件流", () => {
	it("缺 token ⇒ 401（不是开一条永远没消息的流）", async () => {
		const response = await fetch(`${base}/api/agent/conv-1/events`);
		expect(response.status).toBe(401);
	});

	it("响应头是 SSE 的那一套", async () => {
		const controller = new AbortController();
		const response = await fetch(`${base}/api/agent/conv-1/events`, {
			headers: { authorization: "Bearer test-token" },
			signal: controller.signal,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("cache-control")).toContain("no-cache");
		expect(response.headers.get("cache-control")).toContain("no-transform");
		expect(response.headers.get("x-accel-buffering")).toBe("no");
		controller.abort();
	});

	it("首帧是 connected，随后是增量帧", async () => {
		const controller = new AbortController();
		const text = await readUntil(`${base}/api/agent/conv-1/events`, "event: text_delta", controller);
		expect(text.indexOf("event: connected")).toBe(0);
		expect(text).toContain("event: text_delta");
		expect(text).toContain("你好");
		controller.abort();
	});

	it("客户端断开 ⇒ 服务端不崩（还能继续服务别的请求）", async () => {
		const controller = new AbortController();
		await readUntil(`${base}/api/agent/conv-1/events`, "event: text_delta", controller);
		controller.abort();
		// 等一拍，让断连事件被处理
		await new Promise((resolve) => setTimeout(resolve, 50));
		const response = await fetch(`${base}/api/nope`);
		expect(response.status).toBe(404);
	});
});
