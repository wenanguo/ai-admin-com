/**
 * 验收脚本的**假环境变量**（**必须在其它 import 之前**加载）。
 *
 * ## 为什么需要
 *
 * AI 服务的 `core/env/env.ts` 在**模块加载时**就校验环境变量
 * ⇒ 验收脚本只要 import 到内核的任何一个模块 ⇒ 校验就会跑 ⇒ 没有变量就报错。
 *
 * ⚠️ 这里给的都是**假值**（验收脚本自带假模型服务 ⇒ **不花钱、不外网**）。
 */

const defaults: Record<string, string> = {
	MINIMAX_CN_API_KEY: "test-api-key",
	AI_MODEL: "minimax-cn/MiniMax-M3.1-Flash",
	AIADMIN_BASE_URL: "http://aiadmin.test/api/v1",
	DATABASE_URL: "mysql://test@127.0.0.1:3306/aipm",
	ALLOWED_ORIGINS: "http://localhost:8000,http://127.0.0.1:8000",
};

for (const [name, value] of Object.entries(defaults)) {
	process.env[name] ??= value;
}
