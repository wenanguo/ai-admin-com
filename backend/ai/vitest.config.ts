import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [
			"src/**/*.test.ts",
			"examples/**/*.test.ts",
			// ⚠️ **dsh 侧插件的测试**（issue #120）：那个包是**纯 JS**
			//    （跑在 dsh 运行时进程里 ⇒ 不走 TS 编译）⇒ 单独一个 include。
			"dsh-plugin/**/*.test.js",
		],
		// 测试用环境变量：值是假的，只为让模块级的 env 校验能通过。
		// 真值在 .env（不入库）。
		env: {
			MINIMAX_CN_API_KEY: "test-api-key",
			AI_MODEL: "minimax-cn/MiniMax-M3.1-Flash",
			AIADMIN_BASE_URL: "http://aiadmin.test/api/v1",
			DATABASE_URL: "mysql://test@127.0.0.1:3306/aipm",
			ALLOWED_ORIGINS: "http://localhost:8000,http://127.0.0.1:8000",
		},
	},
});
