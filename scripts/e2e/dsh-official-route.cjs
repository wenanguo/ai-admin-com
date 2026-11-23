/**
 * 端到端验收（issue #124 · **D3：官方 DeepSeek 路由**）—— 仓根入口。
 *
 * 真正的脚本在 `backend/ai/scripts/e2e/dsh-official-route.ts`（**TS**：要用我们的适配层代码
 * ⇒ 走 tsx）。这里只负责：找 tsx、补上内核 import 时就校验的环境变量、把退出码传出去。
 *
 * ⚠️ **没有 `DEEPSEEK_API_KEY` ⇒ 跳过并 exit 0**（⇒ CI 里没有 key 也不会红）。
 * ⚠️ 会**真的调官方 API**（花钱）⇒ 只在本地/带 key 的环境里跑。
 *
 * 用法（**在仓根跑**）：
 *
 * ```bash
 * node scripts/e2e/dsh-official-route.cjs
 * ```
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

/** 仓根。 */
const ROOT = path.resolve(__dirname, "..", "..");
/** 真正的验收脚本（TS）。 */
const SCRIPT = path.join(ROOT, "backend", "ai", "scripts", "e2e", "dsh-official-route.ts");
/** AI 服务的目录（tsx 与 .env 都在这儿）。 */
const AI_DIR = path.join(ROOT, "backend", "ai");

/**
 * 读 `DEEPSEEK_API_KEY`（先环境变量，再 `backend/ai/.env`）。
 *
 * ⚠️ **不回显 key**（只说有没有）。
 */
function resolveKey() {
	if ((process.env.DEEPSEEK_API_KEY ?? "").trim().length > 0) {
		return process.env.DEEPSEEK_API_KEY.trim();
	}
	try {
		const text = fs.readFileSync(path.join(AI_DIR, ".env"), "utf8");
		for (const line of text.split(/\r?\n/)) {
			const match = /^\s*DEEPSEEK_API_KEY\s*=\s*(.*)$/.exec(line);
			if (match !== null) {
				return match[1].trim().replace(/^["']|["']$/g, "");
			}
		}
	} catch {
		// 没有 .env ⇒ 当没配
	}
	return "";
}

const key = resolveKey();
if (key.length === 0) {
	console.log("⚠️ 没有 DEEPSEEK_API_KEY（环境变量与 backend/ai/.env 都没有）⇒ 跳过 D3 验收");
	process.exit(0);
}

console.log("dsh 官方路由端到端验收（D3）…");
console.log("⚠️ 会真的调官方 DeepSeek API（花钱）· 需要 Node ≥ 24.9 与 pnpm。\n");

const result = spawnSync(
	process.execPath,
	[require.resolve("tsx/cli", { paths: [AI_DIR] }), SCRIPT],
	{
		cwd: AI_DIR,
		stdio: "inherit",
		env: {
			...process.env,
			DSH_E2E: "1",
			// ⚠️ 内核的环境变量校验是**模块级**的（import 即校验）⇒ 这里给**假值**
			//    （验收脚本不连库、不连我们的服务）。
			DEEPSEEK_API_KEY: key,
			AI_MODEL: process.env.AI_MODEL || "minimax-cn/MiniMax-M3.1-Flash",
			ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "http://localhost:8000",
			DATABASE_URL: process.env.DATABASE_URL || "mysql://e2e@127.0.0.1:3306/e2e",
		},
	},
);

if (result.error) {
	console.error(`❌ 跑不起来：${result.error.message}`);
	console.error("   （tsx 在 backend/ai 里 ⇒ 先 `cd backend/ai && npm ci`）");
	process.exit(1);
}
process.exit(result.status ?? 1);
