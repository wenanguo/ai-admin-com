/**
 * 内核 HTTP 装配的验收（issue #116：外部系统要能**只靠公开入口**起一个服务）。
 *
 * 用 Node 内置 `fetch` + `app.listen(0)`（不引 supertest）。
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCoreApp } from "./app.ts";

let server: Server;
let base: string;

beforeAll(async () => {
	server = createCoreApp().listen(0);
	await new Promise<void>((resolve) => server.once("listening", () => resolve()));
	const address = server.address() as AddressInfo;
	base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("内核的 HTTP 装配", () => {
	it("健康检查恒 200（依赖挂了也是 200）", async () => {
		const response = await fetch(`${base}/health`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { status?: string; checks?: unknown };
		expect(typeof body.status).toBe("string");
		expect(body.checks).toBeDefined();
	});

	it("未知路径 ⇒ JSON 404（不是 HTML）", async () => {
		const response = await fetch(`${base}/api/nope`);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		const body = (await response.json()) as { code: number };
		expect(body.code).toBe(404);
	});

	it("业务路由照常挂载（无 token ⇒ 401）", async () => {
		const response = await fetch(`${base}/api/agent/conversations`);
		expect(response.status).toBe(401);
	});
});

describe("外部系统挂自己的端点", () => {
	it("`configure` 回调挂的端点够得着（在内核的 404 之前）", async () => {
		const custom = createCoreApp({
			configure: (app) => {
				app.get("/api/notes", (_req, res) => {
					res.json({ code: 0, msg: "成功", data: [] });
				});
			},
		});
		const customServer = custom.listen(0);
		await new Promise<void>((resolve) => customServer.once("listening", () => resolve()));
		const address = customServer.address() as AddressInfo;
		try {
			const response = await fetch(`http://127.0.0.1:${address.port}/api/notes`);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { code: number; data: unknown[] };
			expect(body.code).toBe(0);
			expect(body.data).toEqual([]);
		} finally {
			await new Promise<void>((resolve) => customServer.close(() => resolve()));
		}
	});
});
