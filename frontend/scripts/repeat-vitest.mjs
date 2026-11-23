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
 * ```
 *
 * - 第一个参数：vitest 的测试文件路径（相对 `frontend/`）
 * - 第二个参数：连跑次数（默认 20）
 * - 额外参数：原样透传给 vitest（例如 `--coverage`）
 *
 * **行为**：任一次失败就**立刻停**并把那次失败的输出打出来 ⇒ 不用等跑完 20 次。
 * 退出码：全绿 0，有失败 1。
 *
 * ⚠️ **这不是 sleep**：脚本只是把同一条命令重复执行；
 *    每次跑的都是真测试（断言没变）。
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const [, , file, countArg, ...rest] = process.argv;

if (!file) {
  console.error(
    '用法：node scripts/repeat-vitest.mjs <测试文件> [次数] [透传给 vitest 的参数…]',
  );
  process.exit(2);
}

const times = Number.parseInt(countArg ?? '20', 10);
if (!Number.isInteger(times) || times < 1) {
  console.error(`次数不合法：${countArg}`);
  process.exit(2);
}

const vitestBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

let failed = 0;

for (let i = 1; i <= times; i++) {
  const started = Date.now();
  const result = spawnSync(
    vitestBin,
    ['vitest', 'run', file, ...rest],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (result.status !== 0) {
    failed = i;
    console.error(
      `\n❌ 第 ${i}/${times} 次跑挂了（用时 ${seconds}s）⇒ flaky 复现成功。`,
    );
    process.exit(1);
  }

  console.log(`✅ 第 ${i}/${times} 次通过（用时 ${seconds}s）`);
}

console.log(`\n✅ 连跑 ${times} 次全绿。`);
