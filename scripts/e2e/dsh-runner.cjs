/**
 * 端到端验收（issue #120）：**dsh runner 下的会话与闸门**。
 *
 * ## 它证明什么
 *
 * 1. **会话**：我们的自写 provider（`dsh-llm` seam，**不依赖 pi-ai**）真的被 dsh 调用，
 *    dsh 的事件翻译成**我们的事件词汇** ⇒ **对外契约不变**；
 * 2. **闸门**：`approval/request` **走到我们的进程** ⇒ 等人点头 ⇒
 *    批准 ⇒ 工具真的执行；拒绝 ⇒ 工具**没有**执行。
 *
 * ## 为什么不需要模型凭据
 *
 * ⚠️ 脚本自己起一个**假模型服务**（OpenAI 兼容的 SSE）⇒
 *    测的是「**我们的 provider 与闸门接线**」⇒ **不花钱、不外网**。
 *
 * ## 前置
 *
 * - **Node ≥ 24.9**（dsh 的 engines 要求）；
 * - **pnpm**（dsh 的 profile 是个 pnpm 工程 ⇒ 我们的插件要装进去）；
 * - 依赖装好（`cd backend/ai && npm ci`）。
 *
 * 用法（**在仓根跑**）：
 *
 * ```bash
 * node scripts/e2e/dsh-runner.cjs
 * ```
 *
 * ⚠️ 第一次跑要建 dsh profile（`pnpm add` 我们的插件）⇒ **慢一点**；
 *    之后的跑会复用临时目录（每次都是新的临时目录 ⇒ 每次都会重装一次插件）。
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

/** 仓根。 */
const ROOT = path.resolve(__dirname, '..', '..');
/** 真正的验收脚本（**TS**：要用我们的适配层代码 ⇒ 走 tsx）。 */
const SCRIPT = path.join(ROOT, 'backend', 'ai', 'scripts', 'e2e', 'dsh-runner.ts');

console.log('dsh runner 端到端验收（会话 + 闸门）…');
console.log('⚠️ 需要 Node ≥ 24.9 与 pnpm（第一次跑要建 dsh profile）。\n');

const result = spawnSync(
  process.execPath,
  [require.resolve('tsx/cli', { paths: [path.join(ROOT, 'backend', 'ai')] }), SCRIPT],
  {
    cwd: path.join(ROOT, 'backend', 'ai'),
    stdio: 'inherit',
    env: {
      ...process.env,
      DSH_E2E: '1',
      // ⚠️ 内核的环境变量校验是**模块级**的（import 即校验）⇒ 这里给**假值**
      //    （真值在 .env；验收脚本不连库、不连真模型）。
      MINIMAX_CN_API_KEY: process.env.MINIMAX_CN_API_KEY || 'e2e-fake-key',
      AI_MODEL: process.env.AI_MODEL || 'minimax-cn/MiniMax-M3.1-Flash',
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:8000',
      DATABASE_URL: process.env.DATABASE_URL || 'mysql://e2e@127.0.0.1:3306/e2e',
    },
  },
);

if (result.error) {
  console.error(`❌ 跑不起来：${result.error.message}`);
  console.error('   （tsx 在 backend/ai 里 ⇒ 先 `cd backend/ai && npm ci`）');
  process.exit(1);
}
process.exit(result.status ?? 1);
