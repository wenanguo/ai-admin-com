/**
 * `GET /api/agents` —— 可用智能体清单。
 *
 * ⚠️ 这个端点**读真目录**（不 mock 装载器）⇒ 顺带证明「智能体是文件、不是数据库里的东西」。
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../session/runtime.ts", () => ({
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
	},
}));

import { createApp } from "../../server.ts";

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

describe("GET /api/agents", () => {
	it("缺 token ⇒ 401", async () => {
		const response = await fetch(`${base}/api/agents`);
		expect(response.status).toBe(401);
	});

	it("返回清单（每项有 id / name / description / 能力摘要）", async () => {
		const response = await fetch(`${base}/api/agents`, {
			headers: { authorization: "Bearer test-token" },
		});
		expect(response.status).toBe(200);

		const payload = (await response.json()) as {
			code?: number;
			data?: Array<{
				id: string;
				name: string;
				description: string;
				capabilities: {
					model: string;
					plugins: string[];
					skillCount: number;
					mcpServerCount: number;
					toolCount: number;
				};
			}>;
		};
		expect(payload.code).toBe(0);
		expect(Array.isArray(payload.data)).toBe(true);
		expect(payload.data?.length).toBeGreaterThan(0);
		for (const agent of payload.data ?? []) {
			expect(typeof agent.id).toBe("string");
			expect(typeof agent.name).toBe("string");
			expect(typeof agent.description).toBe("string");
			expect(typeof agent.capabilities.model).toBe("string");
			// ⚠️ **插件要报出来**（界面据此知道这个智能体有哪些业务能力）
			expect(Array.isArray(agent.capabilities.plugins)).toBe(true);
			for (const plugin of agent.capabilities.plugins) {
				expect(typeof plugin).toBe("string");
			}
			expect(typeof agent.capabilities.skillCount).toBe("number");
			expect(typeof agent.capabilities.mcpServerCount).toBe("number");
			expect(typeof agent.capabilities.toolCount).toBe("number");
		}
	});

	it("能力摘要里报出**挂了哪个插件**（没显式写 plugin: ⇒ 默认插件）", async () => {
		const response = await fetch(`${base}/api/agents`, {
			headers: { authorization: "Bearer test-token" },
		});
		const payload = (await response.json()) as {
			data?: Array<{ id: string; capabilities: { plugins: string[] } }>;
		};
		const byId = new Map((payload.data ?? []).map((agent) => [agent.id, agent]));

		// ① 显式写了 `plugin: pm` 的
		expect(byId.get("pm")?.capabilities.plugins).toEqual(["pm"]);
		// ② 没写 `plugin:` 的 ⇒ 按**默认插件**算（与运行时同一口径）
		expect(byId.get("qa")?.capabilities.plugins).toEqual(["pm"]);
	});

	it("读的是**真目录** ⇒ 仓里的示例智能体能被列出来", async () => {
		const response = await fetch(`${base}/api/agents`, {
			headers: { authorization: "Bearer test-token" },
		});
		const payload = (await response.json()) as { data?: Array<{ id: string }> };
		const ids = (payload.data ?? []).map((agent) => agent.id);
		expect(ids).toContain("sample");
	});
});
