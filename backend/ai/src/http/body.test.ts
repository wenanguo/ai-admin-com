/**
 * 读 JSON 请求体 —— 语义必须与「今天」逐字一致。
 *
 * 关键点：**没有 body** 与 **body 坏了** 都要能被路由区分开吗？
 * ⇒ 不能：今天两者都报「请求体不是合法的 JSON」⇒ 这里都返回 `ok: false`。
 */

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, readJsonBody } from "./body.ts";

/** 造一个带 body 的请求源。 */
function source(text: string): Readable & { headers?: Record<string, string> } {
	const stream = Readable.from([Buffer.from(text, "utf8")]) as Readable & {
		headers?: Record<string, string>;
	};
	stream.headers = { "content-type": "application/json" };
	return stream;
}

describe("readJsonBody", () => {
	it("合法 JSON 对象 ⇒ 拿到对象", async () => {
		const result = await readJsonBody(source('{"id":"cmd-1"}'));
		expect(result).toEqual({ ok: true, value: { id: "cmd-1" } });
	});

	it("合法 JSON 数字 ⇒ 拿到数字（不是对象！）", async () => {
		const result = await readJsonBody(source("5"));
		expect(result).toEqual({ ok: true, value: 5 });
	});

	it("合法 JSON 数组 ⇒ 拿到数组", async () => {
		const result = await readJsonBody(source("[1,2]"));
		expect(result).toEqual({ ok: true, value: [1, 2] });
	});

	it("没有 body ⇒ empty", async () => {
		const result = await readJsonBody(source(""));
		expect(result).toEqual({ ok: false, reason: "empty" });
	});

	it("body 是坏的 ⇒ invalid", async () => {
		const result = await readJsonBody(source("{不是 json"));
		expect(result).toEqual({ ok: false, reason: "invalid" });
	});

	it("超过 1MB ⇒ too-large", async () => {
		const big = `{"a":"${"x".repeat(MAX_BODY_BYTES)}"}`;
		const result = await readJsonBody(source(big));
		expect(result).toEqual({ ok: false, reason: "too-large" });
	});
});
