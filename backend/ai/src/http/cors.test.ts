/**
 * CORS —— 回**具体的**已登记源，绝不用 `*`。
 *
 * 为什么不能用 `*`：请求带 `Authorization` 头，而带凭证的请求在
 * `Access-Control-Allow-Origin: *` 下会被浏览器直接拒绝（就算加了
 * `Allow-Credentials` 也不行 —— 规范不允许 `*` 与凭证同用）。
 * ⇒ 回白名单里的**原值**，让浏览器认得出是哪个源。
 *
 * 白名单来自 `env.ALLOWED_ORIGINS`（启动时校验过，非空）。
 *
 * ⚠️ 本模块**不接收 Web `Request`/`Response`**，只接收原始头值 ⇒ 与框架无关。
 */

import { describe, expect, it } from "vitest";
import {
	ALLOWED_REQUEST_HEADERS,
	PREFLIGHT_MAX_AGE_SECONDS,
	buildCorsHeaders,
	isPreflightRequest,
	originOf,
} from "./cors.ts";

const ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"];

describe("CORS", () => {
	it("源在白名单里 ⇒ 回具体的源（绝不是 *）", () => {
		const headers = buildCorsHeaders("http://localhost:8000", ORIGINS);
		expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:8000");
		expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
	});

	it("源不在白名单里 ⇒ 不回 Allow-Origin", () => {
		const headers = buildCorsHeaders("http://evil.example.com", ORIGINS);
		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
		// 但要带上 Vary，别让缓存把一个源的响应喂给另一个源
		expect(headers["Vary"]).toContain("Origin");
	});

	it("没有 Origin 头 ⇒ 不回 Allow-Origin", () => {
		const headers = buildCorsHeaders(undefined, ORIGINS);
		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
	});

	it("预检请求 ⇒ 回 Allow-Headers 与 Max-Age（≤ 300 秒）", () => {
		expect(isPreflightRequest("OPTIONS", "http://localhost:8000")).toBe(true);

		const headers = buildCorsHeaders("http://localhost:8000", ORIGINS, true);
		expect(headers["Access-Control-Allow-Headers"]).toBe(ALLOWED_REQUEST_HEADERS);
		expect(headers["Access-Control-Allow-Headers"]).toContain("authorization");
		expect(headers["Access-Control-Allow-Headers"]).toContain("content-type");
		expect(Number(headers["Access-Control-Max-Age"])).toBeLessThanOrEqual(300);
		expect(Number(headers["Access-Control-Max-Age"])).toBe(PREFLIGHT_MAX_AGE_SECONDS);
		expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
	});

	it("非预检的普通请求不带 Max-Age", () => {
		const headers = buildCorsHeaders("http://localhost:8000", ORIGINS);
		expect(headers["Access-Control-Max-Age"]).toBeUndefined();
		expect(isPreflightRequest("GET", "http://localhost:8000")).toBe(false);
	});

	it("originOf 只认真正的 Origin 头", () => {
		expect(originOf("http://localhost:8000")).toBe("http://localhost:8000");
		expect(originOf(undefined)).toBeUndefined();
		expect(originOf("")).toBeUndefined();
		expect(originOf("   ")).toBeUndefined();
	});

	it("不是 OPTIONS 的请求不算预检", () => {
		expect(isPreflightRequest("POST", "http://localhost:8000")).toBe(false);
		expect(isPreflightRequest("OPTIONS", undefined)).toBe(false);
	});
});
