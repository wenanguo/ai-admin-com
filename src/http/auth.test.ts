/**
 * 鉴权取值 —— 只做「把 Bearer token 从头里取出来」，不解析、不校验。
 *
 * 本服务**不认** token：AiAdmin 才是权威。这里唯一的职责是
 * 「没有 token 就别打后端，直接 401」。
 */

import { describe, expect, it } from "vitest";
import { extractBearerToken } from "./auth.ts";

describe("extractBearerToken", () => {
	it("没有 Authorization 头 ⇒ undefined", () => {
		expect(extractBearerToken(undefined)).toBeUndefined();
	});

	it("空串 / 纯空白 ⇒ undefined", () => {
		expect(extractBearerToken("")).toBeUndefined();
		expect(extractBearerToken("   ")).toBeUndefined();
	});

	it("Bearer 方案 ⇒ token 本身", () => {
		expect(extractBearerToken("Bearer abc.def")).toBe("abc.def");
	});

	it("方案名大小写不敏感（RFC 7235）", () => {
		expect(extractBearerToken("bearer abc")).toBe("abc");
		expect(extractBearerToken("BEARER abc")).toBe("abc");
	});

	it("token 两边的空白要吃掉", () => {
		expect(extractBearerToken("Bearer   abc  ")).toBe("abc");
	});

	it("别的方案 ⇒ undefined", () => {
		expect(extractBearerToken("Basic abc")).toBeUndefined();
		expect(extractBearerToken("Token abc")).toBeUndefined();
	});

	it("只有方案名、没有 token ⇒ undefined", () => {
		expect(extractBearerToken("Bearer")).toBeUndefined();
		expect(extractBearerToken("Bearer   ")).toBeUndefined();
	});
});
