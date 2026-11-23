#!/usr/bin/env node
/**
 * 「连跑 N 次」抗 flaky 复现脚本。
 *
 * **为什么要有它**：CI 上偶发红的测试（flaky）没法靠「跑一次绿了」证明修好了 ——
 * 只能靠**连跑很多次**。这个脚本就是把那件事变成一条命令，
 * 谁都能复现、谁都能验收（CI 慢 ⇒ 本地要跑更多次）。
 *
 * **用法**（在 `frontend/` 下）：
 *
 * ```bash
 * node scripts/repeat-vitest.mjs src/pages/module_system/role/PermissionModal.test.tsx 20
 * node scripts/repeat-vitest.mjs 20        # 不给文件名 ⇒ 连跑整仓
 * node scripts/repeat-vitest.mjs            # 不给文件名也不给次数 ⇒ 默认 20 次整仓
 * ```
 *
 * - 第一个参数：vitest 的测试文件路径（相对 `frontend/`）；**不给 ⇒ 跑整仓**
 * - 第二个参数：连跑次数（默认 20）
 * - 额外参数：原样透传给 vitest（例如 `--coverage`）
 *
 * **行为**：任一次失败就**立刻停**并把那次失败的输出打出来 ⇒ 不用等跑完 20 次。
 * 退出码：全绿 0，有失败 1，参数错 2。
 *
 * ⚠️ **这不是 sleep**：脚本只是把同一条命令重复执行；
 *    每次跑的都是真测试（断言没变）。
 *
 * ⚠️ **有些 flaky 只在「整仓一起跑」时才红**（浏览器被别的测试文件抢走 ⇒
 *    机器慢 ⇒ 窗口不够）⇒ 验收随机红请用**整仓**模式，别只跑单文件。
 *
 * ⚠️ **「一个测试文件都没跑到」算失败**：vitest 匹配不到文件时会打印
 *    `No test files found, exiting with code 0` 并**退出 0** ——
 *    不拦的话，这个脚本会把「啥都没跑」报成「全绿」。
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const argv = process.argv.slice(2);
const isCount = (value) => /^\d+$/.test(value ?? '');

let file;
let countArg;
if (isCount(argv[0])) {
  countArg = argv[0];
} else {
  file = argv[0];
  countArg = argv[1];
}
const rest = argv.slice(file ? 2 : 1);

if (file === undefined && countArg !== undefined && !isCount(countArg)) {
  console.error(
    '用法：node scripts/repeat-vitest.mjs [测试文件] [次数] [透传给 vitest 的参数…]\n' +
      '      不给测试文件 ⇒ 跑整仓。',
  );
  process.exit(2);
}

const times = Number.parseInt(countArg ?? '20', 10);
if (!Number.isInteger(times) || times < 1) {
  console.error(`次数不合法：${countArg}`);
  process.exit(2);
}

// ⚠️ **直接用 node 跑 vitest 的入口**，不要 `npx` ——
//    `npx` 在 Windows 上要开 shell（Node 会告警 DEP0190），
//    而且会多一层进程 ⇒ 每次多几十毫秒。
const vitestBin = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);
const target = file ? [file] : [];

for (let i = 1; i <= times; i++) {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [vitestBin, 'run', ...target, ...rest],
    { stdio: ['inherit', 'pipe', 'inherit'] },
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const stdout = result.stdout?.toString() ?? '';
  process.stdout.write(stdout);

  if (result.status !== 0) {
    console.error(
      `\n❌ 第 ${i}/${times} 次跑挂了（用时 ${seconds}s）⇒ flaky 复现成功。`,
    );
    process.exit(1);
  }

  // ⚠️ vitest 匹配不到测试文件时**退出 0** ⇒ 必须自己拦
  if (stdout.includes('No test files found')) {
    console.error(
      `\n❌ 第 ${i}/${times} 次**一个测试文件都没跑到**（路径写错了？）` +
        `${file ? `：${file}` : ''} ⇒ 不能算「全绿」。`,
    );
    process.exit(1);
  }

  console.log(`✅ 第 ${i}/${times} 次通过（用时 ${seconds}s）`);
}

console.log(`\n✅ 连跑 ${times} 次全绿。`);
