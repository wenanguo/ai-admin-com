import { describe, expect, it } from "vitest";
import { env, parseEnv, type EnvSource } from "./env.ts";

/** 一份齐全的（假的）环境变量。 */
const FULL: EnvSource = {
	MINIMAX_CN_API_KEY: "test-api-key",
	AI_MODEL: "minimax-cn/MiniMax-M3.1-Flash",
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
		expect(message).toContain("ALLOWED_ORIGINS");
	});

	it("⚠️ 两个库连接串都没配 ⇒ 启动即失败（点名 DATABASE_URL）", () => {
		const message = catchMessage(() =>
			parseEnv({ ...FULL, DATABASE_URL: undefined }),
		);
		expect(message).toContain("DATABASE_URL");
		expect(message).toContain("AI_DATABASE_URL");
	});

	it("本服务自己的库（AI_DATABASE_URL）优先", () => {
		const parsed = parseEnv({
			...FULL,
			AI_DATABASE_URL: "mysql://test@127.0.0.1:3306/ai_own",
		});
		expect(parsed.databaseUrl).toBe("mysql://test@127.0.0.1:3306/ai_own");
		// ⚠️ 共享库的连接串**仍然留着**（别的代码可能要读它）
		expect(parsed.DATABASE_URL).toBe("mysql://test@127.0.0.1:3306/aipm");
	});

	it("没配自己的库 ⇒ 用共享库的（今天的行为不变）", () => {
		expect(parseEnv(FULL).databaseUrl).toBe("mysql://test@127.0.0.1:3306/aipm");
	});

	it("空串 ⇒ 当没配（compose 未设置时就是这个）", () => {
		const parsed = parseEnv({ ...FULL, AI_DATABASE_URL: "  " });
		expect(parsed.AI_DATABASE_URL).toBeUndefined();
		expect(parsed.databaseUrl).toBe("mysql://test@127.0.0.1:3306/aipm");
	});

	it("只配自己的库 ⇒ 不用别人的库（可复用到别的系统）", () => {
		const parsed = parseEnv({
			...FULL,
			DATABASE_URL: undefined,
			AI_DATABASE_URL: "mysql://x@db:3306/ai_own",
		});
		expect(parsed.databaseUrl).toBe("mysql://x@db:3306/ai_own");
	});

	it("变量齐时解析成功", () => {
		const parsed = parseEnv(FULL);
		expect(parsed.MINIMAX_CN_API_KEY).toBe("test-api-key");
		expect(parsed.AI_MODEL).toBe("minimax-cn/MiniMax-M3.1-Flash");
		expect(parsed.DATABASE_URL).toBe("mysql://test@127.0.0.1:3306/aipm");
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
		// 纯空白也一样：切完一个源都不剩，等于没配 —— 必须启动即失败，且要点名变量、说清要求
		const blankMessage = catchMessage(() => parseEnv({ ...FULL, ALLOWED_ORIGINS: " " }));
		expect(blankMessage).toContain("ALLOWED_ORIGINS");
		expect(blankMessage).toContain("至少要有一个源");
		// 只有空段（逗号 + 空白）同理
		expect(catchMessage(() => parseEnv({ ...FULL, ALLOWED_ORIGINS: " , , " }))).toContain(
			"ALLOWED_ORIGINS",
		);
	});
});

describe("env", () => {
	it("模块级 env 来自进程环境变量", () => {
		expect(env.ALLOWED_ORIGINS).toEqual([
			"http://localhost:8000",
			"http://127.0.0.1:8000",
		]);
	});
});
