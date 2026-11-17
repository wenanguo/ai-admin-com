/**
 * 信封构造 —— **框架无关**。
 *
 * 信封形状与 AiAdmin 一致：`{code, msg, data}`。
 * 成功 `code === 0`；失败 `code` 是 HTTP 语义码。
 */

import { describe, expect, it } from "vitest";
import { SUCCESS_CODE, errorBody, okBody } from "./respond.ts";

describe("okBody", () => {
	it("成功信封：code=0、默认 msg、data 原样", () => {
		const body = okBody({ id: 7 });
		expect(body).toEqual({ code: 0, msg: "成功", data: { id: 7 } });
		expect(SUCCESS_CODE).toBe(0);
	});

	it("可以自定义 msg", () => {
		expect(okBody(null, "已受理").msg).toBe("已受理");
	});

	it("data 是数组时也原样带着", () => {
		expect(okBody([1, 2]).data).toEqual([1, 2]);
	});
});

describe("errorBody", () => {
	it("失败信封：code 是业务码、data 为 null", () => {
		expect(errorBody(401, "缺少 Authorization")).toEqual({
			code: 401,
			msg: "缺少 Authorization",
			data: null,
		});
	});
});
