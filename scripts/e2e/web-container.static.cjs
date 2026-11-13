/**
 * 前端镜像 —— **静态断言**（不需要 docker）。
 *
 * ## 为什么要有它
 *
 * `scripts/e2e/web-container.cjs`（真起容器）需要 docker ⇒ 没 docker 的机器 / 人
 * 什么也验不了 ⇒ 配置写错了也没人拦。
 *
 * 这个脚本只读文件（Dockerfile / nginx.conf / .dockerignore / docker/README.md），
 * 断言「issue #38 的验收标准在配置层面成立」⇒ **任何机器都能跑**（CI 必跑）。
 *
 * 用法：
 *   node scripts/e2e/web-container.static.cjs
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

// ───────────────────────────── .dockerignore ─────────────────────────────
console.log('\n.dockerignore（构建上下文卫生）');
const dockerignore = read('.dockerignore');
containsAll(
  dockerignore,
  ['**/node_modules', '**/dist', '**/.umi', '.git', '**/.env', '**/.ai', '**/auth.json', '**/*.pem'],
  '排除了依赖 / 旧产物 / 版本控制 / 凭据',
);
// ⚠️ 反向断言：不能把构建真正需要的东西排掉
const mustKeep = [
  'frontend/package.json',
  'frontend/package-lock.json',
  'frontend/.npmrc',
  'frontend/config',
  'frontend/src',
];
const wronglyExcluded = mustKeep.filter((p) => {
  const line = dockerignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && (l === p || l.endsWith(`/${p}`)));
  return Boolean(line);
});
check('没有排除构建必需的 frontend 文件', wronglyExcluded.length === 0, wronglyExcluded.join(' / '));
// ⚠️ docs/ 不能排掉：frontend/src/pages/Welcome.tsx import 了 docs/cheatsheet.*.md
const docsExcluded = dockerignore
  .split(/\r?\n/)
  .map((l) => l.trim())
  .some((l) => l && !l.startsWith('#') && (l === 'docs' || l === 'docs/' || l === '/docs'));
check('没有排除 docs/（Welcome.tsx 会 import docs/cheatsheet.*.md）', !docsExcluded);

// ───────────────────────────── frontend/.npmrc ─────────────────────────────
// ⚠️ 本仓的 lock 是按 legacy-peer-deps 生成的 ⇒ 镜像里必须带上这个 .npmrc
//    （少了它 ⇒ npm ci 报 EUSAGE：lock 与 package.json 不同步）
console.log('\nfrontend/.npmrc');
const npmrc = read('frontend/.npmrc');
check('带上了 legacy-peer-deps（与 lock 的生成方式一致）', /legacy-peer-deps\s*=\s*true/.test(npmrc));

// ───────────────────────────── Dockerfile ─────────────────────────────
console.log('\ndocker/web/Dockerfile（多阶段）');
const dockerfile = read('docker/web/Dockerfile');
containsAll(
  dockerfile,
  [
    'AS builder',
    'AS runtime',
    'FROM node:${NODE_VERSION}-bookworm-slim',
    'FROM nginx:${NGINX_VERSION}-alpine',
    'COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./frontend/',
    'npm ci --ignore-scripts',
    'npm rebuild esbuild',
    'npm run build',
    'COPY --from=builder /app/frontend/dist /usr/share/nginx/html',
    'COPY docker/web/nginx.conf /etc/nginx/nginx.conf',
    'EXPOSE 80',
    'HEALTHCHECK',
    '/healthz',
  ],
  '两阶段构建、依赖层缓存、只拷产物、带健康检查',
);
/** 取出所有 COPY / ADD 指令行。 */
function copyLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(COPY|ADD)\s/i.test(l));
}

// 拷贝指令里不得出现凭据文件（注释里提到 .env 不算）
const credentialCopy = copyLines(dockerfile).filter((l) =>
  [/\.env\b/i, /\.ai\b/i, /auth\.json/i, /id_rsa/i, /\.pem\b/i].some((re) => re.test(l)),
);
check('拷贝指令里没有凭据文件', credentialCopy.length === 0, credentialCopy.join(' | '));

// 运行时阶段不能把源码/依赖拷进去
const runtimePart = dockerfile.split(/FROM\s+nginx:/)[1] || '';
const runtimeCopies = copyLines(runtimePart);
const badRuntimeCopy = runtimeCopies.filter(
  (l) => /frontend\/(src|config)\b/i.test(l) || /node_modules/i.test(l),
);
check(
  '运行时阶段只拷构建产物与配置',
  badRuntimeCopy.length === 0,
  badRuntimeCopy.join(' | '),
);
// 且必须拷了构建产物
check(
  '运行时阶段拷进了构建产物',
  runtimeCopies.some((l) => /--from=builder .*\/dist/.test(l)),
  '没看到 COPY --from=builder .../dist',
);

// ───────────────────────────── nginx.conf ─────────────────────────────
console.log('\ndocker/web/nginx.conf（站点配置）');
const nginx = read('docker/web/nginx.conf');
containsAll(
  nginx,
  [
    'root  /usr/share/nginx/html',
    'try_files $uri /index.html;',
    'location = /healthz',
    'location = /index.html',
    'location ^~ /assets/',
    'public, max-age=31536000, immutable',
    'no-store, no-cache, must-revalidate',
    'access_log  /dev/stdout',
    'gzip           on;',
    'server_tokens        off;',
  ],
  'SPA fallback / 缓存策略 / 健康检查 / 日志到 stdout',
);
// ⚠️ nginx 语义：location 里出现 add_header ⇒ 父级 add_header 全部失效
//    ⇒ 每个带 add_header 的 location 都必须 include 安全头片段
const addHeaderCount = (nginx.match(/add_header/g) || []).length;
const includeCount = (nginx.match(/include\s+\/etc\/nginx\/snippets\/security-headers\.conf;/g) || []).length;
check(
  '每个自带 add_header 的 location 都 include 了安全头片段',
  includeCount >= addHeaderCount,
  `add_header ${addHeaderCount} 处，安全头 include ${includeCount} 处`,
);

// ───────────────────────────── docker/README.md ─────────────────────────────
console.log('\ndocker/README.md（构建命令与镜像名）');
const readme = read('docker/README.md');
containsAll(
  readme,
  ['docker build -f docker/web/Dockerfile -t ai-admin-web .', 'ai-admin-web', '/healthz'],
  '写明了构建命令、镜像名、健康检查',
);

// ───────────────────────────── 结果 ─────────────────────────────
console.log('');
if (failures.length > 0) {
  console.error(`✗ 静态断言失败 ${failures.length} 条（通过 ${passed} 条）：`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✓ 静态断言全部通过（${passed} 条）`);
