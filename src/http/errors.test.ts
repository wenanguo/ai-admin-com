/**
 * 错误 → HTTP 信封的映射。
 *
 * ## 为什么要测「不是本模块造出来的错误」
 *
 * Next 的打包器可能把同一个模块在不同的 chunk 里**各实例化一次**
 * ⇒ 跨 chunk 的 `instanceof` 是 false。
 *
 * ⚠️ 实测踩过：命令路由里 AiAdmin 的「凭证已失效」（本该 401）被降级成 **500**
 *    ⇒ 前端拿不到 401 ⇒ **不会去刷新 token** ⇒ 用户被卡在「服务内部错误」上。
 *
 * ⇒ 判定必须**结构化**（看 `name`），不能只看 `instanceof`。
 * 下面的「另一个 chunk 造出来的错误」用例就是这个场景的复现。
 */

import { describe, expect, it } from "vitest";
import { AdapterErrorException } from "../aadmin/errors";
import { AgentError } from "../agent/runtime";
import { errorResponse } from "./errors";

/** 一个请求（CORS 头要 origin）。 */
function request(): Request {
	return new Request("http://localhost/x", {
		headers: { Origin: "http://localhost:8000" },
	});
}

/** 读信封。 */
async function body(response: Response): Promise<{ code: number; msg: string }> {
	return (await response.json()) as { code: number; msg: string };
}

describe("错误 → 信封", () => {
	it("适配层的 AUTH_EXPIRED ⇒ 401（前端据此刷新 token）", async () => {
		const response = errorResponse(
			request(),
			new AdapterErrorException("AUTH_EXPIRED", "AiAdmin 凭证已失效"),
		);

		expect(response.status).toBe(401);
		expect((await body(response)).code).toBe(401);
	});

	it("⭐ 另一个 chunk 造出来的适配层错误 ⇒ 仍然是 401（不是 500）", async () => {
		// 模拟「同一个模块被实例化了两次」：结构一样，但不是本模块的实例
		const fromAnotherChunk = {
			name: "AdapterErrorException",
			kind: "AUTH_EXPIRED",
			message: "AiAdmin 凭证已失效",
			stack: "…",
		};

		const response = errorResponse(request(), fromAnotherChunk);

		expect(response.status).toBe(401);
		expect((await body(response)).msg).toContain("凭证已失效");
	});

	it("运行时的 NOT_FOUND ⇒ 404", async () => {
		const response = errorResponse(request(), new AgentError("NOT_FOUND", "会话不存在"));

		expect(response.status).toBe(404);
	});

	it("另一个 chunk 造出来的运行时错误 ⇒ 仍然是 404", async () => {
		const fromAnotherChunk = {
			name: "AgentError",
			kind: "NOT_FOUND",
			message: "会话不存在",
			stack: "…",
		};

		expect(errorResponse(request(), fromAnotherChunk).status).toBe(404);
	});

	it("不认识的东西 ⇒ 500", () => {
		expect(errorResponse(request(), new Error("炸了")).status).toBe(500);
	});
});
