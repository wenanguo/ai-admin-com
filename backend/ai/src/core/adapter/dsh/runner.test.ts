/**
 * dsh runner 的配置（**双跑开关 + 环境变量**）。
 */

import { describe, expect, it } from "vitest";
import { bridgeSecret, dshRunnerConfig } from "./runner.ts";
import { runnerFromEnv } from "../../session/runtime.ts";

describe("双跑开关", () => {
	it("缺省是 pi（**不配就是今天的行为**）", () => {
		expect(runnerFromEnv({})).toBe("pi");
		expect(runnerFromEnv({ AI_RUNNER: "pi" })).toBe("pi");
	});

	it("`AI_RUNNER=dsh` ⇒ 走 dsh（**切回 pi 不用改代码**）", () => {
		expect(runnerFromEnv({ AI_RUNNER: "dsh" })).toBe("dsh");
	});

	it("不认识的值 ⇒ 落回 pi（**不猜**）", () => {
		expect(runnerFromEnv({ AI_RUNNER: "别的" })).toBe("pi");
	});
});

describe("dsh runner 的配置", () => {
	it("缺省值（**官方 DeepSeek 路由 + 官方 key 的环境变量**）", () => {
		const config = dshRunnerConfig({});
		expect(config.provider).toBe("deepseek-direct");
		expect(config.model).toBe("deepseek-chat");
		expect(config.baseURL).toBe("https://api.deepseek.com/v1");
		expect(config.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
		expect(config.profile).toBe("sdk");
		expect(config.bridgeUrl).toContain("/internal/dsh/commands");
	});

	it("环境变量覆盖（**换厂商只改配置**）", () => {
		const config = dshRunnerConfig({
			DSH_PROVIDER: "minimax-direct",
			DSH_MODEL: "MiniMax-M3.1-Flash",
			DSH_BASE_URL: "https://api.minimaxi.com/v1",
			DSH_API_KEY_ENV: "MINIMAX_CN_API_KEY",
			DSH_MAX_TOKENS: "4096",
			PORT: "3999",
		});
		expect(config.provider).toBe("minimax-direct");
		expect(config.model).toBe("MiniMax-M3.1-Flash");
		expect(config.baseURL).toBe("https://api.minimaxi.com/v1");
		expect(config.apiKeyEnv).toBe("MINIMAX_CN_API_KEY");
		expect(config.maxTokens).toBe(4096);
		expect(config.bridgeUrl).toBe("http://127.0.0.1:3999/internal/dsh/commands");
	});

	it("命令桥的密钥：**进程内稳定**（起 dsh 与挂路由用的是同一个）", () => {
		expect(bridgeSecret()).toBe(bridgeSecret());
		expect(bridgeSecret()).toMatch(/^[0-9a-f]{48}$/);
	});
});
