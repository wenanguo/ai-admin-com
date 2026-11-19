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
  'backend/ai/agents',
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
    'COPY backend/ai/agents ./agents',
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
// ⚠️ **--omit=dev 拦不住 peerOptional**：`@prisma/client` 把 prisma CLI 与 typescript
//    声明成 peerOptional ⇒ npm 会装上 ⇒ 必须显式删（实测：npm prune --omit=dev 也不行）
check(
  '运行时阶段显式删掉了 peerOptional 带进来的 prisma CLI / typescript',
  /rm -rf[^\n]*node_modules\/prisma/.test(runtimePart) &&
    /node_modules\/typescript/.test(runtimePart),
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

// 智能体配置也是 cwd 相对（`agents/<agentId>/agent.yaml`）⇒ 必须带进镜像
check(
  '智能体配置在 /app/agents（与 WORKDIR /app 的相对关系一致）',
  /WORKDIR \/app/.test(dockerfile) &&
    /COPY backend\/ai\/agents \.\/agents/.test(dockerfile),
);

// ⚠️ **默认智能体（PM 助手）的配置与提示词必须在镜像里** ⇒ 缺了容器里的 AI 就没有提示词
check(
  '默认智能体的配置与提示词都入库（agents/pm/agent.yaml + agents/pm/prompt.md）',
  fs.existsSync(path.join(ROOT, 'backend/ai/agents/pm/agent.yaml')) &&
    fs.existsSync(path.join(ROOT, 'backend/ai/agents/pm/prompt.md')),
);

// 容器里没有 .env ⇒ 启动命令不能用 --env-file（缺文件会直接退出）
check(
  '启动命令不依赖 .env 文件',
  !/CMD[^\n]*--env-file/.test(dockerfile),
);
check('启动命令是 node dist/main.js', /CMD \["node", "dist\/main\.js"\]/.test(dockerfile));

console.log('\nbackend/ai/prisma/migrations（迁移的安全阀）');
const migrationsDir = path.join(ROOT, 'backend/ai/prisma/migrations');
const migrationDirs = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
check(
  '有基线迁移（0_init_ai_tables）与增量迁移',
  migrationDirs.includes('0_init_ai_tables') && migrationDirs.length >= 2,
  migrationDirs.join(' / '),
);
// ⚠️ **增量迁移只许「加列 / 加表」** —— 共享库上 DROP/CREATE TABLE 会毁掉别人的数据
for (const name of migrationDirs.filter((dir) => dir !== '0_init_ai_tables')) {
  const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
  const lines = sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));
  const dangerous = lines.filter(
    (line) =>
      /DROP\s/i.test(line) ||
      /TRUNCATE/i.test(line) ||
      /DELETE\s+FROM/i.test(line) ||
      /RENAME/i.test(line) ||
      /MODIFY\s/i.test(line) ||
      /CHANGE\s+COLUMN/i.test(line),
  );
  check(
    `迁移 ${name} 没有删表/改列/删数据`,
    dangerous.length === 0,
    dangerous.join(' | '),
  );
  // ⚠️ **按「语句」判**（不是按行）—— CREATE TABLE 的列定义行里没有表名。
  const statements = lines
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  const foreignTables = statements.filter(
    (statement) => !/ai_conversation|ai_session_event/.test(statement),
  );
  check(
    `迁移 ${name} 只动 ai_conversation / ai_session_event`,
    foreignTables.length === 0,
    foreignTables.join(' | '),
  );
}

// ───────────────────────────── 健康检查路由 ─────────────────────────────
console.log('\nbackend/ai/src/core/routes/health.ts（健康检查）');
const health = read('backend/ai/src/core/routes/health.ts');
containsAll(
  health,
  ['buildHealthReport', 'createHealthRouter', 'res.status(200)'],
  '有报告构造、有路由、恒回 200',
);
// ⚠️ **健康检查的挂载点搬进内核了**（issue #116）：`src/server.ts` 变成薄壳
//    （`createApp()` 委托给内核）⇒ 真正 `app.use("/health")` 的是 `src/core/app.ts`
//    ⇒ 断言**不能只读一个文件** ⇒ 挨个找「真正挂 /health 的那个文件」。
const healthMountCandidates = [
  'backend/ai/src/core/app.ts',
  'backend/ai/src/server.ts',
];
const healthMountFiles = healthMountCandidates.filter((rel) =>
  /app\.use\("\/health"/.test(read(rel)),
);
check(
  '健康检查挂在根路径 /health（不在 /api/agent 下）',
  healthMountFiles.length > 0,
  healthMountFiles.length > 0
    ? ''
    : `这些文件里都没有 app.use("/health"：${healthMountCandidates.join(' / ')}`,
);
check(
  '健康检查**不要 token**（编排系统没有用户 token）',
  !/requireToken/.test(health),
);

// ───────────────────────────── SSE 不缓冲 ─────────────────────────────
console.log('\nbackend/ai/src/core/http/sse.ts（SSE 不缓冲）');
const sse = read('backend/ai/src/core/http/sse.ts');
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
