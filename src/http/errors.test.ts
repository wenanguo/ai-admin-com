/**
 * 错误 → HTTP 信封的映射。
 *
 * ## 为什么要测「不是本模块造出来的错误」
 *
 * 打包器/转译可能把同一个模块在不同的 chunk 里**各实例化一次**
 * ⇒ 跨 chunk 的 `instanceof` 是 false。
 *
 * ⚠️ 实测踩过：命令路由里 AiAdmin 的「凭证已失效」（本该 401）被降级成 **500**
 *    ⇒ 前端拿不到 401 ⇒ **不会去刷新 token** ⇒ 用户被卡在「服务内部错误」上。
 *
 * ⇒ 判定必须**结构化**（看 `name`），不能只看 `instanceof`。
 * 下面的「另一个 chunk 造出来的错误」用例就是这个场景的复现。
 */

import { describe, expect, it } from "vitest";
import { AdapterErrorException } from "../aadmin/errors.ts";
import { AgentError } from "../agent/runtime.ts";
import { toErrorEnvelope } from "./errors.ts";

describe("错误 → 信封", () => {
	it("适配层的 AUTH_EXPIRED ⇒ 401（前端据此刷新 token）", () => {
		const result = toErrorEnvelope(new AdapterErrorException("AUTH_EXPIRED", "AiAdmin 凭证已失效"));
		expect(result.status).toBe(401);
		expect(result.body.code).toBe(401);
	});

	it("⭐ 另一个 chunk 造出来的适配层错误 ⇒ 仍然是 401（不是 500）", () => {
		// 模拟「同一个模块被实例化了两次」：结构一样，但不是本模块的实例
		const fromAnotherChunk = {
			name: "AdapterErrorException",
			kind: "AUTH_EXPIRED",
			message: "AiAdmin 凭证已失效",
			stack: "…",
		};

		const result = toErrorEnvelope(fromAnotherChunk);
		expect(result.status).toBe(401);
		expect(result.body.msg).toContain("凭证已失效");
	});

	it("运行时的 NOT_FOUND ⇒ 404", () => {
		expect(toErrorEnvelope(new AgentError("NOT_FOUND", "会话不存在")).status).toBe(404);
	});

	it("另一个 chunk 造出来的运行时错误 ⇒ 仍然是 404", () => {
		const fromAnotherChunk = {
			name: "AgentError",
			kind: "NOT_FOUND",
			message: "会话不存在",
			stack: "…",
		};

		expect(toErrorEnvelope(fromAnotherChunk).status).toBe(404);
	});

	it("不认识的东西 ⇒ 500", () => {
		expect(toErrorEnvelope(new Error("炸了")).status).toBe(500);
	});

	it("信封体是 {code, msg, data:null}（前端只认这一种形状）", () => {
		const result = toErrorEnvelope(new AgentError("NOT_FOUND", "会话不存在"));
		expect(result.body).toEqual({ code: 404, msg: "会话不存在", data: null });
	});

	it("各种 kind ⇒ 各自的语义码", () => {
		const cases: Array<[string, number]> = [
			["NOT_FOUND", 404],
			["VALIDATION", 400],
			["AUTH_EXPIRED", 401],
			["CONFLICT", 409],
			["RATE_LIMIT", 429],
			["UNSUPPORTED", 400],
			["UPSTREAM", 502],
		];
		for (const [kind, expected] of cases) {
			expect(toErrorEnvelope(new AgentError(kind as never, "x")).status).toBe(expected);
		}
	});
});
