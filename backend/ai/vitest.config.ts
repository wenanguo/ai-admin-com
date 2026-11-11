import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
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
