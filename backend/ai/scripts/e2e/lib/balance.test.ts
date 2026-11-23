/**
 * 「官方账户没余额」的判定（issue #124 阶段三 · D3 收尾）—— **不联网也能测**。
 *
 * ⚠️ 这些是**验收脚本的口径** ⇒ 口径错了 ⇒ D3 会在「账户没余额」时误判成红，
 *    或者在真出错时误判成绿 ⇒ 所以要有单测钉住。
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { looksLikeNoBalance, probeOfficialRoute } from "./balance.ts";

/** 起一个假的服务端（回固定的状态码与正文）。 */
async function fakeRoute(status: number, body: string): Promise<{ url: string; close: () => void }> {
	const server: Server = createServer((_req, res) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}/v1`,
		close: () => {
			server.close();
		},
	};
}

/** 已经起好的假服务端（测试结束要关）。 */
const opened: Array<() => void> = [];

afterEach(() => {
	for (const close of opened.splice(0)) {
		close();
	}
});

describe("「账户没余额」的判定", () => {
	it("认 DeepSeek 的错误码（insufficient_balance）", () => {
		expect(looksLikeNoBalance('{"error":{"code":"insufficient_balance"}}')).toBe(true);
	});

	it("认错误文案（insufficient balance / Insufficient Balance）", () => {
		expect(looksLikeNoBalance("Insufficient Balance")).toBe(true);
		expect(looksLikeNoBalance("insufficient balance")).toBe(true);
	});

	it("认我们 provider 抛的那句话（HTTP 402 + 正文）", () => {
		const message =
			"模型请求失败：HTTP 402 {\"error\":{\"message\":\"Insufficient Balance\",\"code\":\"insufficient_balance\"}}";
		expect(looksLikeNoBalance(message)).toBe(true);
	});

	it("**别的错误不认**（key 失效 / 限流 / 服务端故障 ⇒ 必须红）", () => {
		expect(looksLikeNoBalance("模型请求失败：HTTP 401 Authentication Fails")).toBe(false);
		expect(looksLikeNoBalance("模型请求失败：HTTP 429 Rate Limit")).toBe(false);
		expect(looksLikeNoBalance("模型请求失败：HTTP 500 Internal Server Error")).toBe(false);
		expect(looksLikeNoBalance("工具 get_time 执行失败")).toBe(false);
		expect(looksLikeNoBalance("")).toBe(false);
	});
});

describe("余额探针", () => {
	it("官方回 **402** ⇒ 没余额（该跳过）", async () => {
		const route = await fakeRoute(402, '{"error":{"code":"insufficient_balance"}}');
		opened.push(route.close);
		expect(await probeOfficialRoute({ baseUrl: route.url, apiKey: "k", model: "deepseek-chat" })).toBe(
			"no-balance",
		);
	});

	it("官方回 **200** 但正文说没余额（MiniMax 那种形态）⇒ 没余额", async () => {
		const route = await fakeRoute(200, '{"base_resp":{"status_code":2013,"status_msg":"insufficient balance"}}');
		opened.push(route.close);
		expect(await probeOfficialRoute({ baseUrl: route.url, apiKey: "k", model: "deepseek-chat" })).toBe(
			"no-balance",
		);
	});

	it("官方回 **200** ⇒ 路由正常（继续跑验收）", async () => {
		const route = await fakeRoute(200, '{"choices":[{"message":{"content":"pong"}}]}');
		opened.push(route.close);
		expect(await probeOfficialRoute({ baseUrl: route.url, apiKey: "k", model: "deepseek-chat" })).toBe("ok");
	});

	it("官方回 **401 / 500** ⇒ 看不出来（**不许跳过** ⇒ 真错误要红）", async () => {
		const unauthorized = await fakeRoute(401, '{"error":{"message":"Authentication Fails"}}');
		opened.push(unauthorized.close);
		expect(
			await probeOfficialRoute({ baseUrl: unauthorized.url, apiKey: "k", model: "deepseek-chat" }),
		).toBe("unknown");

		const broken = await fakeRoute(500, "boom");
		opened.push(broken.close);
		expect(await probeOfficialRoute({ baseUrl: broken.url, apiKey: "k", model: "deepseek-chat" })).toBe(
			"unknown",
		);
	});

	it("连不上 ⇒ 看不出来（**不许跳过**）", async () => {
		// ⚠️ 端口 1 上没人听 ⇒ 连接被拒。
		expect(
			await probeOfficialRoute({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", model: "deepseek-chat" }),
		).toBe("unknown");
	});
});
