/**
 * AI 管理面「浏览器这一层」的**运行时验收**（issue #181 · 入口）。
 *
 * ## 它是什么
 *
 * issue #124 的运行时验收（[`dsh-admin-runtime.cjs`](./dsh-admin-runtime.cjs)）验的是
 * **反代那一层**（AI 服务 ⇄ dsh web）。本脚本验的是**浏览器这一层**：
 *
 * ```
 *   浏览器 ──▶ ① 前端 dev 代理（**真的那条规则**）──▶ ② AI 服务（**真的反代**）──▶ ③ dsh web（**真二进制**）
 * ```
 *
 * ⚠️ 这一层以前**没人验过** ⇒ 前端 dev 代理与 nginx 模板都没有 `/dsh-admin/`
 * ⇒ 页面与菜单都在、后端那条反代也在 ⇒ **iframe 就是打不通**（空白）。
 *
 * ## 为什么这个文件只是入口
 *
 * 真正的实现在 [`backend/ai/scripts/e2e/dsh-admin-proxy-chain.ts`](../../backend/ai/scripts/e2e/dsh-admin-proxy-chain.ts)
 * ⇒ 因为它要 **import 我们的 TypeScript 反代** ⇒ 走 **tsx**（与
 * [`dsh-admin-runtime.cjs`](./dsh-admin-runtime.cjs) 一个路子）。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/e2e/dsh-admin-proxy-chain.cjs     # 在仓根跑
 * ```
 *
 * ⚠️ 需要 **Node ≥ 24.9**（dsh 的 engines 要求）+ 依赖装好（`cd backend/ai && npm ci`）。
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** 仓根。 */
const ROOT = path.resolve(__dirname, "..", "..");
/** AI 服务目录（依赖与 TS 代码都在这儿）。 */
const BACKEND = path.join(ROOT, "backend", "ai");
/** 真正的验收脚本（**TS**：要用我们的反代实现 ⇒ 走 tsx）。 */
const SCRIPT = path.join(BACKEND, "scripts", "e2e", "dsh-admin-proxy-chain.ts");

console.log("AI 管理面「浏览器这一层」的运行时验收（真起 dsh web + 真挂前端代理）…\n");

if (!fs.existsSync(path.join(BACKEND, "node_modules", "@deepseek-ai", "dsh"))) {
	console.error("❌ 找不到 dsh 的运行时（backend/ai/node_modules/@deepseek-ai/dsh）。");
	console.error("   先装依赖：cd backend/ai && npm ci");
	process.exit(1);
}

/** tsx 的 CLI（**在 backend/ai 里** ⇒ 根目录没有 node_modules）。 */
let tsxCli;
try {
	tsxCli = require.resolve("tsx/cli", { paths: [BACKEND] });
} catch {
	console.error("❌ 找不到 tsx（backend/ai/node_modules/tsx）。");
	console.error("   先装依赖：cd backend/ai && npm ci");
	process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, SCRIPT], {
	// ⚠️ **在 backend/ai 下跑** ⇒ 内核里那些「cwd 相对」的路径（`.pi/skills` 等）才对
	cwd: BACKEND,
	stdio: "inherit",
	env: {
		...process.env,
		// ⚠️ 内核的环境变量校验是**模块级**的（import 即校验）⇒ 这里给**假值**
		//    （真值在 .env；验收脚本不连库、不连真模型、不连 AiAdmin）。
		MINIMAX_CN_API_KEY: process.env.MINIMAX_CN_API_KEY || "e2e-fake-key",
		AI_MODEL: process.env.AI_MODEL || "minimax-cn/MiniMax-M3.1-Flash",
		ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "http://localhost:8000",
		DATABASE_URL: process.env.DATABASE_URL || "mysql://e2e@127.0.0.1:3306/e2e",
	},
});

child.on("error", (error) => {
	console.error(`❌ 跑不起来：${error.message}`);
	console.error("   （tsx 在 backend/ai 里 ⇒ 先 `cd backend/ai && npm ci`）");
	process.exit(1);
});

child.on("exit", (code, signal) => {
	// ⚠️ 被信号打死 ⇒ 退出码是 null ⇒ 换个说法（别让 CI 以为「成功」）
	if (signal !== null) {
		console.error(`❌ 验收脚本被 ${signal} 打断了`);
		process.exit(1);
	}
	process.exit(code ?? 1);
});
