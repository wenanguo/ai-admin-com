/**
 * 端到端验收（issue #122 · #153）：**技能 / MCP / 插件三层在 dsh 上的形状**（**运行时**版）。
 *
 * ## 它证明什么
 *
 * 真起一个 **dsh 运行时**（不是静态断言）⇒ 钉住这四件事：
 *
 * 1. **技能**：dsh 的技能子系统发现的技能**进了模型上下文**
 *    （目录作为**用户消息**发进去 ⇒ 不是我们自己拼的系统提示词段）；
 * 2. **MCP 闸门**：MCP 的**写**操作也要人点头 ⇒ 拒绝 ⇒ **服务端一次都没被叫**；
 * 3. **批准**：点了「同意」⇒ MCP 服务器**真的**收到了写调用；
 * 4. **工具名归一化**：模型侧 `mcp__aiadmin__create_task` ⇒ 界面看到 `create_task`。
 *
 * ## 为什么不需要模型凭据 / 不连数据库
 *
 * ⚠️ 脚本自己起一个**假模型服务**（OpenAI 兼容的 SSE）⇒ **不花钱、不外网**；
 *    也不连数据库（只读技能目录 + 起本地子进程）。
 *
 * ## 前置
 *
 * - **Node ≥ 24.9**（dsh 的 engines 要求）；
 * - **pnpm**（dsh 的 profile 是个独立的 pnpm 工程 ⇒ 我们的插件要装进去）
 *   —— CI 里装的是 `pnpm@11.22.0`（与 `backend/ai/Dockerfile` 里那个**同版本**）；
 * - 依赖装好（`cd backend/ai && npm ci`）。
 *
 * ## 用法（**在仓根跑**）
 *
 * ```bash
 * node scripts/e2e/dsh-skills-mcp-plugins.runtime.cjs
 * ```
 *
 * ⚠️ **第一次跑要装 profile 的依赖**（pnpm 装 ⇒ 慢）⇒ 脚本自己会**先预热**
 *    （见 `backend/ai/scripts/e2e/dsh-skills-mcp-plugins.ts` 的「冷启动预热」）
 *    ⇒ **第一次跑也是绿的**。
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** 仓根。 */
const ROOT = path.resolve(__dirname, "..", "..");
/** AI 服务目录（依赖与 TS 代码都在这儿）。 */
const BACKEND = path.join(ROOT, "backend", "ai");
/** 真正的验收脚本（**TS**：要用我们的适配层代码 ⇒ 走 tsx）。 */
const SCRIPT = path.join(BACKEND, "scripts", "e2e", "dsh-skills-mcp-plugins.ts");

console.log("技能 / MCP / 插件的运行时验收（真起 dsh 运行时 + 真挂一个 MCP 服务器）…");
console.log("⚠️ 需要 Node ≥ 24.9 与 pnpm（第一次跑要装 profile 的依赖 ⇒ 慢一点）。\n");

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

const result = spawnSync(process.execPath, [tsxCli, SCRIPT], {
	// ⚠️ **在 backend/ai 下跑** ⇒ 内核里那些「cwd 相对」的路径（`.pi/skills` 等）才对
	cwd: BACKEND,
	stdio: "inherit",
	env: {
		...process.env,
		DSH_E2E: "1",
		// ⚠️ 内核的环境变量校验是**模块级**的（import 即校验）⇒ 这里给**假值**
		//    （真值在 .env；验收脚本不连库、不连真模型、不连 AiAdmin）。
		MINIMAX_CN_API_KEY: process.env.MINIMAX_CN_API_KEY || "e2e-fake-key",
		AI_MODEL: process.env.AI_MODEL || "minimax-cn/MiniMax-M3.1-Flash",
		ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "http://localhost:8000",
		DATABASE_URL: process.env.DATABASE_URL || "mysql://e2e@127.0.0.1:3306/e2e",
	},
});

if (result.error) {
	console.error(`❌ 跑不起来：${result.error.message}`);
	console.error("   （tsx 在 backend/ai 里 ⇒ 先 `cd backend/ai && npm ci`）");
	process.exit(1);
}
if (result.signal !== null) {
	console.error(`❌ 验收脚本被 ${result.signal} 打断了`);
	process.exit(1);
}
process.exit(result.status ?? 1);
