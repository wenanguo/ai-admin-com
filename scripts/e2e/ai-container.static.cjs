/**
 * AI 服务镜像 —— **静态断言**（不需要 docker）。
 *
 * ## 为什么要有它
 *
 * `scripts/e2e/ai-container.cjs`（真起容器）需要 docker ⇒ 没 docker 的机器 / 人
 * 什么也验不了 ⇒ 配置写错了也没人拦。
 *
 * 这个脚本只读文件（Dockerfile / .dockerignore / 健康检查路由），
 * 断言「issue #39 的验收标准在配置层面成立」⇒ **任何机器都能跑**（CI 必跑）。
 *
 * 用法：
 *   node scripts/e2e/ai-container.static.cjs
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

/** 取出所有 COPY / ADD 指令行。 */
function copyLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(COPY|ADD)\s/i.test(l));
}

/**
 * 判断一条 .dockerignore 规则会不会排掉目标路径。
 *
 * ⚠️ **前缀也算**：规则 `backend/` 会连 `backend/ai` 一起排掉 ⇒ 光比「完全相等」会漏。
 */
function ruleExcludes(rule, target) {
  const cleaned = rule.replace(/\/+$/, '');
  const bare = cleaned.replace(/\*+$/, '').replace(/\/$/, '');
  if (bare.length === 0) {
    return false;
  }
  if (target === bare) {
    return true;
  }
  // `backend/ai/*` 这类：排掉目录下的一切
  if (cleaned.endsWith('*') && target.startsWith(`${bare}/`)) {
    return true;
  }
  // `backend/` 这类：排掉整棵子树
  if (!cleaned.includes('*') && target.startsWith(`${bare}/`)) {
    return true;
  }
  return false;
}

// ───────────────────────────── .dockerignore ─────────────────────────────
console.log('\n.dockerignore（构建上下文卫生）');
const dockerignore = read('.dockerignore');
containsAll(
  dockerignore,
  ['**/node_modules', '**/dist', '**/.env', '**/.ai', '**/auth.json', '.git'],
  '排除了依赖 / 旧产物 / 版本控制 / 凭据',
);
const ignoreRules = dockerignore
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
/** ⚠️ 反向断言：AI 镜像真正需要的文件不能被排掉 */
const mustKeep = [
  'backend/ai/package.json',
  'backend/ai/package-lock.json',
  'backend/ai/src',
  'backend/ai/prisma',
  'backend/ai/.pi',
];
const wronglyExcluded = mustKeep.filter((target) =>
  ignoreRules.some((rule) => ruleExcludes(rule, target)),
);
check('没有排除 AI 镜像必需的 backend/ai 文件', wronglyExcluded.length === 0, wronglyExcluded.join(' / '));

// ───────────────────────────── Dockerfile ─────────────────────────────
console.log('\nbackend/ai/Dockerfile（多阶段）');
const dockerfile = read('backend/ai/Dockerfile');
containsAll(
  dockerfile,
  [
    'AS builder',
    'AS runtime',
    'FROM node:${NODE_VERSION}-bookworm-slim',
    'WORKDIR /app',
    'npm ci --ignore-scripts',
    'npm run build',
    'prisma generate',
    'npm ci --omit=dev',
    'COPY --from=builder /app/dist ./dist',
    'COPY --from=builder /app/node_modules/.prisma',
    'COPY backend/ai/.pi ./.pi',
    'EXPOSE 3100',
    'HEALTHCHECK',
    '/health',
  ],
  '两阶段构建、tsc 编译、prisma 客户端、生产依赖、技能就位、健康检查',
);

// 运行时阶段：只有生产依赖（没有 devDependencies）
const runtimePart = dockerfile.split(/AS runtime/)[1] || '';
check(
  '运行时阶段用 --omit=dev（镜像里没有 devDependencies）',
  /npm ci[^\n]*--omit=dev/.test(runtimePart),
);
check(
  '构建阶段装了完整依赖（tsc / prisma CLI 要 devDependencies）',
  /npm ci[^\n]*--ignore-scripts/.test(dockerfile.split(/AS runtime/)[0] || ''),
);

check(
  '**prisma generate 在 tsc 之前**（@prisma/client 的类型从 .prisma/client re-export ⇒ 先生成才编得过）',
  dockerfile.indexOf('prisma generate') > -1 &&
    dockerfile.indexOf('prisma generate') < dockerfile.indexOf('npm run build'),
  'generate 必须在 build 之前',
);

// 凭据不能进镜像层
const credentialCopy = copyLines(dockerfile).filter((l) =>
  [/\.env\b/i, /\.ai\b/i, /auth\.json/i].some((re) => re.test(l)),
);
check('拷贝指令里没有凭据文件', credentialCopy.length === 0, credentialCopy.join(' | '));

// 技能是 cwd 相对 ⇒ WORKDIR 与 .pi 的相对位置必须吻合
check(
  '技能在 /app/.pi（与 WORKDIR /app 的相对关系一致）',
  /WORKDIR \/app/.test(dockerfile) && /COPY backend\/ai\/\.pi \.\/\.pi/.test(dockerfile),
);

// 容器里没有 .env ⇒ 启动命令不能用 --env-file（缺文件会直接退出）
check(
  '启动命令不依赖 .env 文件',
  !/CMD[^\n]*--env-file/.test(dockerfile),
);
check('启动命令是 node dist/main.js', /CMD \["node", "dist\/main\.js"\]/.test(dockerfile));

// ───────────────────────────── 健康检查路由 ─────────────────────────────
console.log('\nbackend/ai/src/routes/health.ts（健康检查）');
const health = read('backend/ai/src/routes/health.ts');
containsAll(
  health,
  ['buildHealthReport', 'createHealthRouter', 'res.status(200)'],
  '有报告构造、有路由、恒回 200',
);
check(
  '健康检查挂在根路径 /health（不在 /api/agent 下）',
  /app\.use\("\/health"/.test(read('backend/ai/src/server.ts')),
);
check(
  '健康检查**不要 token**（编排系统没有用户 token）',
  !/requireToken/.test(health),
);

// ───────────────────────────── SSE 不缓冲 ─────────────────────────────
console.log('\nbackend/ai/src/http/sse.ts（SSE 不缓冲）');
const sse = read('backend/ai/src/http/sse.ts');
containsAll(
  sse,
  ['text/event-stream', 'X-Accel-Buffering', 'no-transform'],
  'SSE 响应头带禁缓冲标记（nginx 代理才不攒着一起发）',
);

// ───────────────────────────── 结果 ─────────────────────────────
console.log('');
if (failures.length > 0) {
  console.error(`✗ 静态断言失败 ${failures.length} 条（通过 ${passed} 条）：`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✓ 静态断言全部通过（${passed} 条）`);
