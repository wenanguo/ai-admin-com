import { describe, expect, it } from "vitest";
import {
	ALLOWED_REQUEST_HEADERS,
	PREFLIGHT_MAX_AGE_SECONDS,
	buildCorsHeaders,
	isPreflightRequest,
	originOf,
} from "./cors";

const ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"];

/** 造一个带 Origin 头的请求。 */
function requestWithOrigin(origin: string, method = "GET"): Request {
	return new Request("http://localhost:3100/api/agent/conversations", {
		method,
		headers: { Origin: origin },
	});
}

describe("CORS", () => {
	it("源在白名单里 ⇒ 回具体的源（绝不是 *）", () => {
		const headers = buildCorsHeaders(requestWithOrigin("http://localhost:8000"), ORIGINS);
		expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:8000");
		expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
	});

	it("源不在白名单里 ⇒ 不回 Allow-Origin", () => {
		const headers = buildCorsHeaders(requestWithOrigin("http://evil.example.com"), ORIGINS);
		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
		// 但要带上 Vary，别让缓存把一个源的响应喂给另一个源
		expect(headers["Vary"]).toContain("Origin");
	});

	it("没有 Origin 头 ⇒ 不回 Allow-Origin", () => {
		const headers = buildCorsHeaders(
			new Request("http://localhost:3100/api/agent/conversations"),
			ORIGINS,
		);
		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
	});

	it("预检请求 ⇒ 回 Allow-Headers 与 Max-Age（≤ 300 秒）", () => {
		const request = requestWithOrigin("http://localhost:8000", "OPTIONS");
		expect(isPreflightRequest(request)).toBe(true);

		const headers = buildCorsHeaders(request, ORIGINS);
		expect(headers["Access-Control-Allow-Headers"]).toBe(ALLOWED_REQUEST_HEADERS);
		expect(headers["Access-Control-Allow-Headers"]).toContain("authorization");
		expect(headers["Access-Control-Allow-Headers"]).toContain("content-type");
		expect(Number(headers["Access-Control-Max-Age"])).toBeLessThanOrEqual(300);
		expect(Number(headers["Access-Control-Max-Age"])).toBe(PREFLIGHT_MAX_AGE_SECONDS);
		expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
	});

	it("非预检的普通请求不带 Max-Age", () => {
		const headers = buildCorsHeaders(requestWithOrigin("http://localhost:8000"), ORIGINS);
		expect(headers["Access-Control-Max-Age"]).toBeUndefined();
		expect(isPreflightRequest(requestWithOrigin("http://localhost:8000"))).toBe(false);
	});

	it("originOf 只认真正的 Origin 头", () => {
		expect(originOf(requestWithOrigin("http://localhost:8000"))).toBe("http://localhost:8000");
		expect(originOf(new Request("http://localhost:3100/"))).toBeUndefined();
	});
});
