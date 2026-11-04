import { describe, expect, it } from "vitest";
import { env, parseEnv, type EnvSource } from "./env";

/** 一份齐全的（假的）环境变量。 */
const FULL: EnvSource = {
	MINIMAX_CN_API_KEY: "test-api-key",
	AI_MODEL: "minimax-cn/MiniMax-M3.1-Flash",
	AIADMIN_BASE_URL: "http://aiadmin.test/api/v1",
	DATABASE_URL: "mysql://test@127.0.0.1:3306/aipm",
	ALLOWED_ORIGINS: "http://localhost:8000,http://127.0.0.1:8000",
};

/** 抓住 parseEnv 抛出的错误消息。 */
function catchMessage(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("期望抛错，但没有抛");
}

describe("parseEnv", () => {
	it("缺变量时启动即失败，并点名缺哪个", () => {
		expect(catchMessage(() => parseEnv({ ...FULL, AI_MODEL: undefined }))).toContain("AI_MODEL");

		// 缺好几个时，每一个都要被点名
		const message = catchMessage(() => parseEnv({}));
		expect(message).toContain("MINIMAX_CN_API_KEY");
		expect(message).toContain("AI_MODEL");
		expect(message).toContain("AIADMIN_BASE_URL");
		expect(message).toContain("DATABASE_URL");
		expect(message).toContain("ALLOWED_ORIGINS");
	});

	it("变量齐时解析成功", () => {
		const parsed = parseEnv(FULL);
		expect(parsed.MINIMAX_CN_API_KEY).toBe("test-api-key");
		expect(parsed.AI_MODEL).toBe("minimax-cn/MiniMax-M3.1-Flash");
		expect(parsed.AIADMIN_BASE_URL).toBe("http://aiadmin.test/api/v1");
		expect(parsed.DATABASE_URL).toBe("mysql://test@127.0.0.1:3306/aipm");
		expect(parsed.PORT).toBe(3100);
	});

	it("ALLOWED_ORIGINS 被切成数组", () => {
		expect(parseEnv(FULL).ALLOWED_ORIGINS).toEqual([
			"http://localhost:8000",
			"http://127.0.0.1:8000",
		]);
		// 逗号前后有空格、有空段，都不该留下脏数据
		expect(
			parseEnv({ ...FULL, ALLOWED_ORIGINS: " http://a.test , ,http://b.test " }).ALLOWED_ORIGINS,
		).toEqual(["http://a.test", "http://b.test"]);
		// 空值等于没配 CORS 源 —— 属于配置错误，启动即失败
		expect(catchMessage(() => parseEnv({ ...FULL, ALLOWED_ORIGINS: "" }))).toContain(
			"ALLOWED_ORIGINS",
		);
	});

	it("PORT 缺省用默认端口，给错则报错", () => {
		expect(parseEnv({ ...FULL, PORT: "8080" }).PORT).toBe(8080);
		expect(catchMessage(() => parseEnv({ ...FULL, PORT: "abc" }))).toContain("PORT");
	});
});

describe("env", () => {
	it("模块级 env 来自进程环境变量", () => {
		expect(env.PORT).toBe(3100);
		expect(env.ALLOWED_ORIGINS).toEqual([
			"http://localhost:8000",
			"http://127.0.0.1:8000",
		]);
	});
});
