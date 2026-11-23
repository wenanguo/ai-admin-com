#!/usr/bin/env node
/**
 * 端到端验收（issue #158）：**profile 里那份插件拷贝会跟着插件变**。
 *
 * ## 为什么要有它
 *
 * 旧判据是「**依赖已经是这个路径 ⇒ 直接跳过**」⇒ `pnpm add file:` 拷进去的
 * 永远是旧拷贝 ⇒ 插件改了不生效 ⇒ 派活直接报
 * `dsh: NO_ADAPTER: no adapter registered for provider "minimax"`。
 *
 * ⇒ 这件事**很容易退回去**（谁写个「路径一样就跳过」的快捷判断就又踩一遍）
 * ⇒ 把它钉成一条**可执行的断言**（任何机器 / CI 都能跑）：
 * **改一次插件内容 ⇒ profile 里的拷贝跟着变**。
 *
 * ## 用法（**在仓根跑**）
 *
 * ```bash
 * node scripts/e2e/dsh-profile-refresh.cjs
 * ```
 *
 * 退出码：0 = 全过；1 = 有违规（打印原因）。
 *
 * ⚠️ **不需要模型凭据、不连数据库**；第一段用「假 pnpm」⇒ **不联网**；
 *    第二段用**真 pnpm**（机器上有才跑 ⇒ 证明 pnpm 会把 `file:` 目录重新打包）。
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

/** 仓根。 */
const ROOT = path.resolve(__dirname, '..', '..');
/** 真正的验收脚本（**TS**：要用我们的适配层代码 ⇒ 走 tsx）。 */
const SCRIPT = path.join(ROOT, 'backend', 'ai', 'scripts', 'e2e', 'dsh-profile-refresh.ts');

console.log('dsh profile 插件刷新验收（issue #158）…');
console.log('⚠️ 不需要模型凭据、不联网（假 pnpm）。\n');

const result = spawnSync(
  process.execPath,
  [require.resolve('tsx/cli', { paths: [path.join(ROOT, 'backend', 'ai')] }), SCRIPT],
  {
    cwd: path.join(ROOT, 'backend', 'ai'),
    stdio: 'inherit',
    env: { ...process.env },
  },
);

if (result.error) {
  console.error(`❌ 跑不起来：${result.error.message}`);
  console.error('   （tsx 在 backend/ai 里 ⇒ 先 `cd backend/ai && npm ci`）');
  process.exit(1);
}
process.exit(result.status ?? 1);
