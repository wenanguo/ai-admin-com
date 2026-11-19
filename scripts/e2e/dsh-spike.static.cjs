/**
 * dsh 底座摸底（issue #119）—— **静态断言**（不需要装 dsh、不需要模型、不需要网络）。
 *
 * ## 为什么要有它
 *
 * 真正的尖峰脚本（`backend/ai/spike/dsh/scripts/01-toy-task.mjs`）要装 dsh、要模型凭据、
 * 要网络 ⇒ CI 与普通开发机都跑不了。
 * 这个脚本只读文件，断言「issue #119 的验收标准在**配置与文档层面**成立」：
 *   - 版本锁是**精确版本**、且同一条发布线（npm 的 latest dist-tag 在 dsh 上是坏的）
 *   - spike 装的就是锁里的版本（不会悄悄漂移）
 *   - profile 补丁引用的是锁里的包
 *   - 玩具工具真的实现了闸门接缝（approval seam）
 *   - 玩具 MCP server 真的注册了工具
 *   - spec 里八问都有结论 + 有「留 / 改 / 删」清单 + 有版本升级策略
 *
 * 用法：
 *   node scripts/e2e/dsh-spike.static.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

/** 仓根（脚本在 `<root>/scripts/e2e/`）。 */
const ROOT = path.resolve(__dirname, '..', '..');

/** 读文件（不存在 ⇒ 抛错，由顶层统一报错退出）。 */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const failures = [];
let passed = 0;

/** 断言：条件为真。 */
function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failures.push(detail ? `${label} —— ${detail}` : label);
  console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`);
}

/** 断言：文本里包含所有给定片段。 */
function containsAll(text, needles, label) {
  const missing = needles.filter((n) => !text.includes(n));
  check(label, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : '');
}

// ───────────────────────────── 版本锁 ─────────────────────────────
console.log('\ndsh 版本锁（backend/ai/spike/dsh/dsh-versions.lock.json）');
const lock = JSON.parse(read('backend/ai/spike/dsh/dsh-versions.lock.json'));
check('有发布线（releaseLine）', typeof lock.releaseLine === 'string' && lock.releaseLine.length > 0);
check(
  '锁的是同一条发布线（0.2.2-rc.5）',
  lock.releaseLine === '0.2.2-rc.5',
  `实际 ${lock.releaseLine}`,
);
const lockedEntries = Object.entries(lock.packages || {});
check('锁了至少 20 个包', lockedEntries.length >= 20, `实际 ${lockedEntries.length}`);
const notExact = lockedEntries.filter(([, v]) => !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v));
check(
  '全部是**精确版本**（没有 ^ / ~）',
  notExact.length === 0,
  notExact.map(([k, v]) => `${k}@${v}`).join(' / '),
);
const wrongLine = lockedEntries.filter(([, v]) => !v.startsWith(lock.releaseLine));
check(
  '没有混进别的发布线（latest 标签是两条线混的 ⇒ 装不上）',
  wrongLine.length === 0,
  wrongLine.map(([k, v]) => `${k}@${v}`).join(' / '),
);
check('写明了已知缺口', typeof lock.knownGaps === 'object' && Object.keys(lock.knownGaps).length > 0);
check('写明了升级策略（改动要同步 spec）', JSON.stringify(lock).includes('升级'));

// ───────────────────────────── spike 包 ─────────────────────────────
console.log('\nspike 的依赖（不许漂移）');
const spikePkg = JSON.parse(read('backend/ai/spike/dsh/package.json'));
const spikeDeps = { ...(spikePkg.dependencies || {}), ...(spikePkg.devDependencies || {}) };
for (const [name, version] of Object.entries(spikeDeps)) {
  // 只管 dsh 家族（其余是玩具 MCP server 的依赖，由 npm/pnpm 自己锁）
  if (!name.startsWith('@deepseek-ai/')) continue;
  const locked = lock.packages?.[name];
  check(
    `${name} 装的就是锁里的版本`,
    locked === version,
    `spike=${version} / lock=${locked ?? '(没锁)'}`,
  );
}
// ⚠️ **issue #120 之后**：AI 服务**要**依赖 dsh 的 **SDK 客户端**
//    （`@deepseek-ai/dsh-sdk-client` —— 子进程 + stdio JSON-RPC 的那一个）
//    ⇒ 但**只允许这一个**（其余 dsh 包只许在 dsh 侧插件包里 ⇒ 由
//    `scripts/check-dsh-boundary.cjs` 盯住）。
const serviceDeps = Object.keys(
  JSON.parse(read('backend/ai/package.json')).dependencies ?? {},
).filter((name) => name.startsWith('@deepseek-ai/'));
check(
  'AI 服务只依赖 dsh 的 SDK 客户端（spike 的沙盒不进生产依赖）',
  serviceDeps.length === 1 && serviceDeps[0] === '@deepseek-ai/dsh-sdk-client',
  `实际：${serviceDeps.join('、') || '(没有)'}`,
);

// ───────────────────────────── profile 补丁 ─────────────────────────────
console.log('\nprofile 补丁（backend/ai/spike/dsh/patch-pi-ai.yml）');
const patch = read('backend/ai/spike/dsh/patch-pi-ai.yml');
containsAll(
  patch,
  [
    '@deepseek-ai/dsh-llm-pi-ai',
    '@deepseek-ai/dsh-mcp-client',
    '- insert:',
    'apiKeyEnv:',
  ],
  '挂了 LLM 路由 + MCP client，且用「加插件」的正确写法（insert）',
);
check(
  '补丁里引用的 dsh 包都在版本锁里',
  [...patch.matchAll(/@deepseek-ai\/dsh-[a-z-]+/g)]
    .map((m) => m[0])
    .every((name) => name in (lock.packages || {})),
);

// ───────────────────────────── 玩具工具（= 我们的工具怎么挂 + 闸门怎么挂）──
console.log('\n玩具工具（backend/ai/spike/dsh/toy-tool/src/index.js）');
const toyTool = read('backend/ai/spike/dsh/toy-tool/src/index.js');
containsAll(
  toyTool,
  [
    "from '@deepseek-ai/dsh-tools'",
    'ctx.tools.register',
    'defineTool',
    "ctx.get('approval')",
    'approval.request(',
    'allowed-once',
  ],
  '注册进了 dsh 的 tool registry + 走了 dsh 的审批缝（approval seam）',
);

// ───────────────────────────── 玩具 MCP ─────────────────────────────
console.log('\n玩具 MCP server（backend/ai/spike/dsh/toy-mcp/server.mjs）');
const toyMcp = read('backend/ai/spike/dsh/toy-mcp/server.mjs');
containsAll(
  toyMcp,
  ['McpServer', 'StdioServerTransport', 'registerTool'],
  '是个真的 stdio MCP server，且注册了工具',
);

// ───────────────────────────── spec ─────────────────────────────
console.log('\nspec（docs/superpowers/specs/2026-11-19-dsh-底座摸底-目标架构-design.md）');
const spec = read('docs/superpowers/specs/2026-11-19-dsh-底座摸底-目标架构-design.md');
const questions = [
  '模型',
  'MiniMax',
  '工具',
  '事件',
  '审批',
  'MCP',
  '存储',
  '子代理',
];
for (const q of questions) {
  check(`八问里有「${q}」的结论`, spec.includes(`### 2.${questions.indexOf(q) + 1}`) && spec.includes(q));
}
containsAll(
  spec,
  ['留', '改', '删', '版本锁', '升级策略', 'MCP 怎么挂', '类型不外泄'],
  '有逐文件留/改/删清单、版本锁与升级策略、MCP 专章、类型边界',
);

// ───────────────────────────── 结果 ─────────────────────────────
console.log('');
if (failures.length > 0) {
  console.error(`✗ 静态断言失败 ${failures.length} 条（通过 ${passed} 条）：`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✓ 静态断言全部通过（${passed} 条）`);
