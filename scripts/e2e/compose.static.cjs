/**
 * compose 编排 —— **静态断言**（不需要 docker）。
 *
 * ## 为什么要有它
 *
 * `scripts/e2e/compose.cjs`（真起 compose）需要 docker ⇒ 没 docker 的机器什么也验不了。
 * 这个脚本只读文件（compose / 模板 / .env.example），断言 issue #40 的验收标准
 * 在**配置层面**成立 ⇒ 任何机器都能跑（CI 必跑）。
 *
 * 用法：
 *   node scripts/e2e/compose.static.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** 仓根（脚本在 `<root>/scripts/e2e/`）。 */
const ROOT = path.resolve(__dirname, '..', '..');

function read(rel) {
	return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const failures = [];
let passed = 0;

function check(label, ok, detail) {
	if (ok) {
		passed += 1;
		console.log(`  ✓ ${label}`);
		return;
	}
	failures.push(detail ? `${label} —— ${detail}` : label);
	console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`);
}

function containsAll(text, needles, label) {
	const missing = needles.filter((n) => !text.includes(n));
	check(label, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : '');
}

// ───────────────────────────── docker-compose.yaml ─────────────────────────────
console.log('\ndocker/docker-compose.yaml（编排）');
const compose = read('docker/docker-compose.yaml');
containsAll(
	compose,
	[
		// 两个服务
		'\n  web:',
		'\n  ai:',
		// 镜像与构建
		'image: ai-admin-web:latest',
		'image: ai-admin-ai:latest',
		'dockerfile: docker/web/Dockerfile',
		'dockerfile: backend/ai/Dockerfile',
		// 端口：web 是唯一入口；ai 只绑回环
		'"${WEB_PORT:-8080}:80"',
		'"127.0.0.1:${AI_PORT:-3100}:3100"',
		// 路由口径
		'AIADMIN_PROXY_TARGET:',
		'AI_UPSTREAM: "ai:3100"',
		// 依赖与网络
		'condition: service_healthy',
		'networks:',
		'- aiadmin',
		// 运维三件套
		'restart: unless-stopped',
		'mem_limit:',
		'cpus:',
		'driver: json-file',
		'max-size: "10m"',
		'max-file: "3"',
		// 健康检查
		'/healthz',
		'/health',
	],
	'两个服务 + 镜像/构建 + 端口 + 三条路由的变量 + 网络 + 限制/日志/重启/健康检查',
);
// ⚠️ AI 服务**不能**暴露到 0.0.0.0 ⇒ 端口必须绑回环
const aiPortLine = compose.split(/\r?\n/).find((l) => l.includes('${AI_PORT')) || '';
check(
	'AI 服务的端口只绑 127.0.0.1',
	aiPortLine.includes('127.0.0.1:') && !/^\s*-\s*"\$\{AI_PORT/.test(aiPortLine),
	aiPortLine.trim(),
);
// ⚠️ 凭据不许硬编码在编排里（只走环境变量）
const hardcodedSecret = compose
	.split(/\r?\n/)
	.filter((l) => /^\s*(MINIMAX_CN_API_KEY|DATABASE_URL|AIADMIN_MCP_URL):/.test(l))
	.filter((l) => !l.includes('${'));
check('编排里没有硬编码的凭据', hardcodedSecret.length === 0, hardcodedSecret.join(' | '));

// ───────────────────────────── nginx 模板（代理部分）────────────────────────────
console.log('\ndocker/web/templates/default.conf.template（三条路由）');
const tpl = read('docker/web/templates/default.conf.template');
containsAll(
	tpl,
	[
		'location /api/',
		'location /ai-api/',
		'location /',
		'proxy_pass ${AIADMIN_PROXY_TARGET};',
		'proxy_pass http://${AI_UPSTREAM}/;',
		'try_files $uri /index.html;',
		// SSE
		'proxy_buffering off;',
		'proxy_read_timeout  3600s;',
		'proxy_set_header Connection        "";',
	],
	'静态 + /api/（不 rewrite）+ /ai-api/（去前缀）+ SPA fallback + SSE 不缓冲',
);
/**
 * 取出一个 location 块（按缩进配对大括号 ⇒ 不会被 `${...}` 里的括号骗到）。
 * @param text 模板全文
 * @param header location 头（如 `/api/`）
 */
function locationBlock(text, header) {
	const lines = text.split(/\r?\n/);
	const startIdx = lines.findIndex((l) => new RegExp(`^\\s*location\\s+${header.replace(/[/]/g, '\\/')}\\s*\\{`).test(l));
	if (startIdx < 0) return '';
	const indent = (lines[startIdx].match(/^\s*/) || [''])[0];
	const block = [lines[startIdx]];
	for (let i = startIdx + 1; i < lines.length; i += 1) {
		block.push(lines[i]);
		if (lines[i].trim() === '}' && (lines[i].match(/^\s*/) || [''])[0] === indent) break;
	}
	return block.join('\n');
}

// ⚠️ `/api/` 的 proxy_pass **必须不带 URI 部分** ⇒ 否则 `/api/` 前缀被吃掉 ⇒ AiAdmin 404
const apiProxy = locationBlock(tpl, '/api/');
check(
	'/api/ 的 proxy_pass 不带 URI 部分（不 rewrite）',
	/proxy_pass\s+\$\{AIADMIN_PROXY_TARGET\};/.test(apiProxy) &&
		!/proxy_pass\s+\$\{AIADMIN_PROXY_TARGET\}\s*\//.test(apiProxy),
	apiProxy.replace(/\s+/g, ' ').slice(0, 200),
);
// ⚠️ `/ai-api/` 的 proxy_pass **必须带 `/`** ⇒ nginx 才会把匹配到的前缀替换成 `/`
const aiApiProxy = locationBlock(tpl, '/ai-api/');
check(
	'/ai-api/ 的 proxy_pass 带 /（去前缀）',
	/proxy_pass\s+http:\/\/\$\{AI_UPSTREAM\}\/;/.test(aiApiProxy),
	aiApiProxy.replace(/\s+/g, ' ').slice(0, 200),
);
// ⚠️ 每个自带 add_header 的 location 都要 include 安全头片段
const addHeaderCount = (tpl.match(/add_header/g) || []).length;
const includeCount = (tpl.match(/include\s+\/etc\/nginx\/snippets\/security-headers\.conf;/g) || []).length;
check(
	'每个自带 add_header 的 location 都 include 了安全头片段',
	includeCount >= addHeaderCount,
	`add_header ${addHeaderCount} 处，安全头 include ${includeCount} 处`,
);
// ⚠️ envsubst 占位符必须有默认值（否则 nginx 起不来）
const dockerfile = read('docker/web/Dockerfile');
containsAll(
	dockerfile,
	['AIADMIN_PROXY_TARGET=https://www.pmdict.cn', 'AI_UPSTREAM=127.0.0.1:3100'],
	'两个占位符在镜像里都有 ENV 默认值',
);

// ───────────────────────────── docker/.env.example ─────────────────────────────
console.log('\ndocker/.env.example（环境变量清单）');
const envExample = read('docker/.env.example');
containsAll(
	envExample,
	[
		'WEB_PORT=',
		'AI_PORT=',
		'AIADMIN_PROXY_TARGET=',
		'AIADMIN_BASE_URL=',
		'AIADMIN_MCP_URL=',
		'DATABASE_URL=',
		'MINIMAX_CN_API_KEY=',
		'AI_MODEL=',
		'AI_THINKING_LEVEL=',
		'ALLOWED_ORIGINS=',
	],
	'10 个变量齐全',
);
// ⚠️ 不许有真值：key 与口令必须是空的/占位
const realLooking = envExample
	.split(/\r?\n/)
	.filter((l) => /^\s*(MINIMAX_CN_API_KEY|AIADMIN_MCP_URL)\s*=\s*\S+/.test(l))
	.filter((l) => !/=\s*$/.test(l));
check('模型 key / MCP 地址都是空占位', realLooking.length === 0, realLooking.join(' | '));
check(
	'DATABASE_URL 用占位口令',
	/DATABASE_URL=mysql:\/\/USER:PASSWORD@HOST:3306\/aipm/.test(envExample),
	'DATABASE_URL 不是占位形式',
);

// ───────────────────────────── docker/.env 不入库 ─────────────────────────────
console.log('\ndocker/.env（真值文件）');
const ignored = spawnSync('git', ['check-ignore', '-q', 'docker/.env'], { cwd: ROOT });
check('docker/.env 被 gitignore（不入库）', ignored.status === 0, 'git check-ignore 没命中');
check('docker/.env.example 是入库的（要能提交）', fs.existsSync(path.join(ROOT, 'docker/.env.example')));

// ───────────────────────────── 验收夹具 ─────────────────────────────
console.log('\ndocker/docker-compose.ci.yaml（验收夹具）');
const ci = read('docker/docker-compose.ci.yaml');
containsAll(ci, ['aiadmin-stub:', 'AIADMIN_PROXY_TARGET: "http://aiadmin-stub:80"'], '有 AiAdmin 桩并把 web 上游指过去');
// ⚠️ compose 会做变量插值（$VAR / ${VAR} 都插）⇒ 桩里的 nginx 变量必须写成 $$request_uri
const ciCode = ci
	.split(/\r?\n/)
	.filter((l) => !l.trim().startsWith('#'))
	.join('\n');
check(
	'桩里的 nginx 变量用 $$ 转义（否则被 compose 插成空串）',
	ciCode.includes('$$request_uri') && !/(^|[^$])\$request_uri/.test(ciCode),
	'没看到 $$request_uri',
);

// ───────────────────────────── 结果 ─────────────────────────────
console.log('');
if (failures.length > 0) {
	console.error(`✗ 静态断言失败 ${failures.length} 条（通过 ${passed} 条）：`);
	for (const f of failures) console.error(`   - ${f}`);
	process.exit(1);
}
console.log(`✓ 静态断言全部通过（${passed} 条）`);
