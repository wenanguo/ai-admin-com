/**
 * Express 骨架的验收：预检、404、错误信封、CORS 头。
 *
 * 用 Node 内置 `fetch` + `app.listen(0)`（不引 supertest）。
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MISSING_TOKEN_MESSAGE, NOT_FOUND_MESSAGE, createApp, errorHandler } from "./server.ts";

let server: Server;
let base: string;

beforeAll(async () => {
	server = createApp().listen(0);
	await new Promise<void>((resolve) => server.once("listening", () => resolve()));
	const address = server.address() as AddressInfo;
	base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Express 骨架", () => {
	it("预检 ⇒ 204 + 具体源（绝不是 *）", async () => {
		const response = await fetch(`${base}/api/pending`, {
			method: "OPTIONS",
			headers: { origin: "http://localhost:8000" },
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:8000");
		expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
		expect(response.headers.get("access-control-allow-methods")).toContain("POST");
		expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
	});

	it("预检不带 Origin ⇒ 也是 204（与迁移前一致）", async () => {
		const response = await fetch(`${base}/api/pending`, { method: "OPTIONS" });
		expect(response.status).toBe(204);
	});

	it("源不在白名单 ⇒ 不回 Allow-Origin，但回 Vary", async () => {
		const response = await fetch(`${base}/api/pending`, {
			method: "OPTIONS",
			headers: { origin: "http://evil.example.com" },
		});
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(response.headers.get("vary")).toContain("Origin");
	});

	it("未知路径 ⇒ JSON 404（不是 HTML）", async () => {
		const response = await fetch(`${base}/api/nope`);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		const body = (await response.json()) as { code: number; msg: string; data: unknown };
		expect(body.code).toBe(404);
		expect(body.msg).toBe(NOT_FOUND_MESSAGE);
		expect(body.data).toBeNull();
	});

	it("普通响应也带 CORS 头", async () => {
		const response = await fetch(`${base}/api/nope`, {
			headers: { origin: "http://localhost:8000" },
		});
		expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:8000");
	});

	it("错误中间件 ⇒ 统一信封", async () => {
		const app = express();
		app.get("/boom", () => {
			throw new Error("炸了");
		});
		app.use(errorHandler);
		const scratch = app.listen(0);
		await new Promise<void>((resolve) => scratch.once("listening", () => resolve()));
		const port = (scratch.address() as AddressInfo).port;

		const response = await fetch(`http://127.0.0.1:${port}/boom`);
		expect(response.status).toBe(500);
		const body = (await response.json()) as { code: number; msg: string; data: unknown };
		expect(body.code).toBe(500);
		expect(body.msg).toContain("服务内部错误");
		expect(body.data).toBeNull();

		await new Promise<void>((resolve) => scratch.close(() => resolve()));
	});

	it("缺 token 的文案是统一的那一句", () => {
		expect(MISSING_TOKEN_MESSAGE).toBe(
			"缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）",
		);
	});
});
