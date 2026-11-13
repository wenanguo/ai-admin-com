/**
 * `GET /api/agent/skills` —— 可用技能清单。
 *
 * ⚠️ 这个端点**读真目录**（不 mock 技能加载）⇒ 顺带证明「技能是文件、不是配置」。
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

describe("GET /api/agent/skills", () => {
	it("缺 token ⇒ 401", async () => {
		const response = await fetch(`${base}/api/agent/skills`);
		expect(response.status).toBe(401);
	});

	it("返回技能清单（每项有名字与说明）", async () => {
		const response = await fetch(`${base}/api/agent/skills`, {
			headers: { authorization: "Bearer test-token" },
		});
		expect(response.status).toBe(200);

		const payload = (await response.json()) as {
			code?: number;
			data?: Array<{ name: string; description: string }>;
		};
		expect(payload.code).toBe(0);
		expect(Array.isArray(payload.data)).toBe(true);
		for (const skill of payload.data ?? []) {
			expect(typeof skill.name).toBe("string");
			expect(typeof skill.description).toBe("string");
		}
	});

	it("读的是**真目录** ⇒ 仓里的样板技能能被列出来", async () => {
		const response = await fetch(`${base}/api/agent/skills`, {
			headers: { authorization: "Bearer test-token" },
		});
		const payload = (await response.json()) as {
			data?: Array<{ name: string }>;
		};
		const names = (payload.data ?? []).map((skill) => skill.name);
		expect(names).toContain("create-task");
	});
});
