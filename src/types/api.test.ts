import { describe, expect, it } from "vitest";
import { isSuccess, SUCCESS_CODES } from "./api";

describe("isSuccess", () => {
	it("接受 code 0 与 200", () => {
		expect(isSuccess({ code: 0, msg: "成功", data: null })).toBe(true);
		expect(isSuccess({ code: 200, msg: "操作成功", data: null })).toBe(true);
	});

	it("拒绝其他业务码与非信封", () => {
		expect(isSuccess({ code: 400, msg: "参数错误", data: null })).toBe(false);
		expect(isSuccess({ code: 10401, msg: "业务错误", data: null })).toBe(false);
		expect(isSuccess({ msg: "没有 code" })).toBe(false);
		expect(isSuccess(null)).toBe(false);
		expect(isSuccess("200")).toBe(false);
	});

	it("SUCCESS_CODES 就是 AiAdmin 的成功业务码", () => {
		expect([...SUCCESS_CODES]).toEqual([0, 200]);
	});
});
