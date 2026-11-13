/**
 * 健康检查的验收：口径（**恒 200**）、自检结果、缓存。
 *
 * ⚠️ 用**假的探针**（不真连数据库、不真连 AiAdmin）⇒ 这套测试离线可跑。
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildHealthReport,
	collectHealthReport,
	createHealthCache,
	createHealthRouter,
	type DependencyCheck,
} from "./health.ts";
import { parseMysqlTarget } from "./health-probes.ts";
import { createApp } from "../server.ts";

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

/** 起一个只挂健康检查的 app（用注入的探针）。 */
async function withRouter(
	probes: Record<string, () => Promise<DependencyCheck>>,
	now: () => number = () => 1_000,
): Promise<{ url: string; close: () => Promise<void> }> {
	const router = createHealthRouter({ probes, now, startedAt: 0, ttlMs: 0 });
	const app = express();
	app.use(router);
	const listener = app.listen(0);
	await new Promise<void>((resolve) => listener.once("listening", () => resolve()));
	const port = (listener.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => listener.close(() => resolve())),
	};
}

describe("健康检查：口径", () => {
	it("GET /health ⇒ 200 + JSON（含 status）", async () => {
		const response = await fetch(`${base}/health`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		const body = (await response.json()) as { status: string; checks: unknown };
		expect(typeof body.status).toBe("string");
		expect(body.checks).toBeTruthy();
	});

	it("**不要 token** ⇒ 匿名也能调（编排系统没有用户 token）", async () => {
		const response = await fetch(`${base}/health`);
		expect(response.status).toBe(200);
	});

	it("依赖全好 ⇒ status = ok", () => {
		const report = buildHealthReport(
			{
				database: { status: "up", detail: "可达" },
				aiadmin: { status: "up", detail: "可达" },
			},
			12,
		);
		expect(report.status).toBe("ok");
		expect(report.uptimeSeconds).toBe(12);
	});

	it("有依赖 down ⇒ status = degraded（但 HTTP 码仍是 200）", () => {
		const report = buildHealthReport(
			{
				database: { status: "down", detail: "连不上" },
				aiadmin: { status: "up", detail: "可达" },
			},
			12,
		);
		expect(report.status).toBe("degraded");
	});

	it("skipped 不算 degraded（没配不是故障）", () => {
		const report = buildHealthReport(
			{ aiadmin: { status: "skipped", detail: "没配" } },
			1,
		);
		expect(report.status).toBe("ok");
	});
});

describe("健康检查：探针", () => {
	it("探针返回 down ⇒ 仍然 200 + degraded", async () => {
		const app = await withRouter({
			database: async () => ({ status: "down", detail: "连不上" }),
			aiadmin: async () => ({ status: "up", detail: "可达" }),
		});
		try {
			const response = await fetch(`${app.url}/`);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { status: string; checks: Record<string, DependencyCheck> };
			expect(body.status).toBe("degraded");
			expect(body.checks.database.status).toBe("down");
		} finally {
			await app.close();
		}
	});

	it("探针抛异常 ⇒ 记成 down，**不许把请求搞挂**", async () => {
		const app = await withRouter({
			database: async () => {
				throw new Error("炸了");
			},
		});
		try {
			const response = await fetch(`${app.url}/`);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { status: string; checks: Record<string, DependencyCheck> };
			expect(body.status).toBe("degraded");
			expect(body.checks.database.status).toBe("down");
			expect(body.checks.database.detail).toContain("炸了");
		} finally {
			await app.close();
		}
	});

	it("探针并行跑（不是串行）", async () => {
		let running = 0;
		let maxParallel = 0;
		const probe = async (): Promise<DependencyCheck> => {
			running += 1;
			maxParallel = Math.max(maxParallel, running);
			await new Promise((resolve) => setTimeout(resolve, 30));
			running -= 1;
			return { status: "up", detail: "可达" };
		};
		const app = await withRouter({ a: probe, b: probe, c: probe });
		try {
			await fetch(`${app.url}/`);
			expect(maxParallel).toBe(3);
		} finally {
			await app.close();
		}
	});

	it("结果缓存：TTL 内只跑一次探针", async () => {
		let calls = 0;
		let clock = 1_000;
		const cache = createHealthCache();
		const deps = {
			probes: {
				database: async (): Promise<DependencyCheck> => {
					calls += 1;
					return { status: "up", detail: "可达" };
				},
			},
			now: () => clock,
			startedAt: 0,
			ttlMs: 5_000,
		};
		await collectHealthReport(deps, cache);
		await collectHealthReport(deps, cache);
		expect(calls).toBe(1);
		// 缓存过了 ⇒ 再跑一次
		clock += 5_001;
		await collectHealthReport(deps, cache);
		expect(calls).toBe(2);
	});
});

describe("健康检查：数据库地址解析", () => {
	it("能取出主机与端口", () => {
		expect(parseMysqlTarget("mysql://user:pw@db.internal:3307/aipm")).toEqual({
			host: "db.internal",
			port: 3307,
		});
	});

	it("没写端口 ⇒ 用 3306", () => {
		expect(parseMysqlTarget("mysql://user:pw@db.internal/aipm")).toEqual({
			host: "db.internal",
			port: 3306,
		});
	});

	it("解析不了 ⇒ undefined（探针记 skipped，不炸）", () => {
		expect(parseMysqlTarget("不是地址")).toBeUndefined();
	});
});
