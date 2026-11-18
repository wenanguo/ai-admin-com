/**
 * PM 插件的环境变量（**插件声明自己要什么** ⇒ 内核的 env 不认识业务变量）。
 */

import { describe, expect, it } from "vitest";
import { parsePmEnv, type EnvSource } from "./env.ts";

/** 一份齐全的（假的）环境变量。 */
const FULL: EnvSource = {
	AIADMIN_BASE_URL: "http://aiadmin.test/api/v1",
};

/** 抓住 parsePmEnv 抛出的错误消息。 */
function catchMessage(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("期望抛错，但没有抛");
}

describe("插件的环境变量", () => {
	it("变量齐时解析成功", () => {
		const parsed = parsePmEnv(FULL);
		expect(parsed.AIADMIN_BASE_URL).toBe("http://aiadmin.test/api/v1");
		expect(parsed.AIADMIN_MCP_URL).toBeUndefined();
	});

	it("缺变量 ⇒ 启动即失败，并点名缺哪个", () => {
		expect(catchMessage(() => parsePmEnv({}))).toContain("AIADMIN_BASE_URL");
	});

	it("地址不合法 ⇒ 报错说清", () => {
		expect(
			catchMessage(() => parsePmEnv({ ...FULL, AIADMIN_BASE_URL: "不是地址" })),
		).toContain("http(s)");
	});

	it("⚠️ **变量名一个字没改**（现有部署不用改配置）", () => {
		expect(parsePmEnv(FULL).AIADMIN_BASE_URL).toContain("aiadmin.test");
	});
});
