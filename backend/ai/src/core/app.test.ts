/**
 * 内核 HTTP 装配的验收（issue #116：外部系统要能**只靠公开入口**起一个服务）。
 *
 * 用 Node 内置 `fetch` + `app.listen(0)`（不引 supertest）。
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Buffer } from "node:buffer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCoreApp } from "./app.ts";
import { createDshAdminProxy } from "./adapter/dsh-admin/proxy.ts";

/** 造一个 JWT 形状的 token（**只验载荷** ⇒ 测试够用）。 */
function fakeJwt(claims: Record<string, unknown>): string {
	const encode = (value: object): string =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

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

describe("AI 管理面（dsh 的 Web UI 反代）", () => {
	it("**没给** `dshAdmin` ⇒ 没有 `/dsh-admin` 路由（缺省关）", async () => {
		const response = await fetch(`${base}/dsh-admin/`);
		expect(response.status).toBe(404);
	});

	it("给了 `dshAdmin` ⇒ 挂在 `/dsh-admin`（**普通用户 403**）", async () => {
		const app = createCoreApp({
			dshAdmin: createDshAdminProxy({
				port: 1,
				authCookie: "dsh-auth-x=y",
				// ⚠️ 判定器**问权威系统** ⇒ 只有 `admin-token` 是 admin
				isAdmin: async (token) => token === "admin-token",
			}),
		});
		const customServer = app.listen(0);
		await new Promise<void>((resolve) => customServer.once("listening", () => resolve()));
		const address = customServer.address() as AddressInfo;
		try {
			// 判定器不认这个 token ⇒ 403（**进代理之前**就拦住了）
			const response = await fetch(`http://127.0.0.1:${address.port}/dsh-admin/`, {
				headers: { authorization: `Bearer ${fakeJwt({ access: "user" })}` },
			});
			expect(response.status).toBe(403);
		} finally {
			await new Promise<void>((resolve) => customServer.close(() => resolve()));
		}
	});

	it("⚠️ **伪造 `access: 'admin'` 的载荷 ⇒ 403**（解载荷提不了权）", async () => {
		const app = createCoreApp({
			dshAdmin: createDshAdminProxy({
				port: 1,
				authCookie: "dsh-auth-x=y",
				isAdmin: async (token) => token === "admin-token",
			}),
		});
		const customServer = app.listen(0);
		await new Promise<void>((resolve) => customServer.once("listening", () => resolve()));
		const address = customServer.address() as AddressInfo;
		try {
			const forged = fakeJwt({ access: "admin" });
			const response = await fetch(`http://127.0.0.1:${address.port}/dsh-admin/`, {
				headers: { authorization: `Bearer ${forged}` },
			});
			expect(response.status).toBe(403);
		} finally {
			await new Promise<void>((resolve) => customServer.close(() => resolve()));
		}
	});

	it("⚠️ **没注入判定器 ⇒ 503**（fail closed：默认拒绝）", async () => {
		const app = createCoreApp({
			dshAdmin: createDshAdminProxy({ port: 1, authCookie: "dsh-auth-x=y" }),
		});
		const customServer = app.listen(0);
		await new Promise<void>((resolve) => customServer.once("listening", () => resolve()));
		const address = customServer.address() as AddressInfo;
		try {
			const response = await fetch(`http://127.0.0.1:${address.port}/dsh-admin/`, {
				headers: { authorization: "Bearer admin-token" },
			});
			expect(response.status).toBe(503);
		} finally {
			await new Promise<void>((resolve) => customServer.close(() => resolve()));
		}
	});
});
