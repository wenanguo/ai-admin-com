import { describe, expect, it } from "vitest";
import { AdapterErrorException } from "../aadmin/errors";
import { entityKey, parseEntityKey, tryParseEntityKey, tryParseNumericId } from "./keys";

/** 抓住 parseEntityKey 抛出的错误。 */
function catchError(fn: () => unknown): AdapterErrorException {
	try {
		fn();
	} catch (error) {
		if (error instanceof AdapterErrorException) {
			return error;
		}
		throw error;
	}
	throw new Error("期望抛 AdapterErrorException，但没有抛");
}

describe("实体 key", () => {
	it("key 是 `<实体>:<id>`", () => {
		expect(entityKey("task", 123)).toBe("task:123");
		expect(entityKey("project", 45)).toBe("project:45");
		expect(entityKey("user", 7)).toBe("user:7");
	});

	it("能解析回来", () => {
		expect(tryParseEntityKey("task:123")).toEqual({ kind: "task", id: 123 });
		expect(tryParseEntityKey("project:45")).toEqual({ kind: "project", id: 45 });
	});

	it("不合法的一律不认（不猜）", () => {
		expect(tryParseEntityKey("task:")).toBeUndefined();
		expect(tryParseEntityKey("task:abc")).toBeUndefined();
		expect(tryParseEntityKey("task:0")).toBeUndefined();
		expect(tryParseEntityKey("task:-1")).toBeUndefined();
		expect(tryParseEntityKey("unknown:1")).toBeUndefined();
		expect(tryParseEntityKey("45")).toBeUndefined();
		expect(tryParseEntityKey("")).toBeUndefined();
	});

	it("纯数字 id 单独解析", () => {
		expect(tryParseNumericId("45")).toBe(45);
		expect(tryParseNumericId(" 45 ")).toBe(45);
		expect(tryParseNumericId("0")).toBeUndefined();
		expect(tryParseNumericId("4.5")).toBeUndefined();
		expect(tryParseNumericId("abc")).toBeUndefined();
	});

	it("parseEntityKey 遇到坏 key 抛 VALIDATION，并把正确写法说清楚", () => {
		const error = catchError(() => parseEntityKey("瞎写的"));
		expect(error.kind).toBe("VALIDATION");
		expect(error.message).toContain("task:123");
	});

	it("种类对不上也报错（别把 project:45 当任务用）", () => {
		const error = catchError(() => parseEntityKey("project:45", "task"));
		expect(error.message).toContain("task");
	});
});
