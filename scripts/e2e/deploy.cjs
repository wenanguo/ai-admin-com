/**
 * 部署验收（端到端）—— 真起一套 compose，验「换台机器能不能跑起来」。
 *
 * ## 它验什么（= issue #42 的验收标准）
 *
 *   1. `docker compose config` 校验通过
 *   2. `up -d` ⇒ **两个容器都 healthy**
 *   3. `GET /` ⇒ 返回**前端 HTML**（不是 nginx 默认页）
 *   4. `GET /api/...` ⇒ **打到后端**（401/200 都算「通」）
 *   5. `GET /ai-api/...` ⇒ **打到 AI 服务**（401 也算通）
 *   6. AI 服务的 `/health` ⇒ **200**（经 nginx 的 `/ai-api/health` 访问）
 *   7. 结束后 **compose 清干净**（独立 project name ⇒ 不碰开发者的本地环境）
 *
 * ## 「不污染本地环境」怎么做到的
 *
 *   · **独立 project name**（`-p ai-admin-e2e-<pid>`）⇒ 与开发者的 `ai-admin` 项目互不相干；
 *   · **独立端口**（默认 18080 / 13100）⇒ 不抢 8080 / 3100；
 *   · **临时 env 文件**（`--env-file`，全是占位）⇒ **不读 `docker/.env`** ⇒ 不碰真凭据；
 *   · 结束时 `down -v --remove-orphans` ⇒ 容器/网络/卷全清。
 *
 * ## 用法
 *
 *   node scripts/e2e/deploy.cjs
 *
 * 环境变量：
 *   WEB_PORT / AI_PORT   验收用的端口（默认 18080 / 13100）
 *   E2E_AIADMIN_URL      `/api/` 的真实后端地址（不给 ⇒ 用夹具里的桩，验「路径没被改写」）
 *   SKIP_BUILD=1         跳过构建（用已有镜像）
 *
 * ⚠️ 本机没有 docker ⇒ 打印 SKIP 并退出 0（不拦人）。CI 上真跑。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/** 独立 project name ⇒ 不碰开发者的本地 compose 项目。 */
const PROJECT = `ai-admin-e2e-${process.pid}`;
const WEB_PORT = Number(process.env.WEB_PORT || 18080);
const AI_PORT = Number(process.env.AI_PORT || 13100);
const BASE = `http://127.0.0.1:${WEB_PORT}`;

/** compose 文件：主编排 + 验收夹具（AiAdmin 桩）。 */
const COMPOSE_FILES = ['docker/docker-compose.yaml', 'docker/docker-compose.ci.yaml'];

const failures = [];
let passed = 0;

function check(label, ok, detail) {
	if (ok) {
		passed += 1;
		console.log(`    ✓ ${label}`);
		return;
	}
	failures.push(detail ? `${label} —— ${detail}` : label);
	console.log(`    ✗ ${label}${detail ? ` —— ${detail}` : ''}`);
}

/** 跑一条命令（失败 ⇒ 抛错，附带 stderr）。 */
function run(cmd, args, options = {}) {
	const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
	if (res.status !== 0) {
		throw new Error(
			`${cmd} ${args.join(' ')} 退出码 ${res.status}\n${(res.stderr || '').trim().slice(-4000)}`,
		);
	}
	return (res.stdout || '').trim();
}

/** 跑一条命令，失败也不抛。 */
function tryRun(cmd, args, options = {}) {
	const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...options });
	return { status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

/** GET 一个 URL ⇒ { status, headers, body }。 */
async function get(url) {
	const res = await fetch(`${BASE}${url}`);
	return { status: res.status, headers: res.headers, body: await res.text() };
}

async function main() {
	// ─────────────────────── 0. docker 在不在？ ───────────────────────
	console.log('\n[0] 环境检查');
	const dockerOk = tryRun('docker', ['version', '--format', '{{.Server.Version}}']);
	if (dockerOk.status !== 0) {
		console.log('  SKIP：本机没有可用的 docker ⇒ 跳过部署验收。');
		console.log('        静态断言仍可跑：node scripts/e2e/compose.static.cjs');
		return 0;
	}
	console.log('  ✓ docker 可用');

	// ─────────────────────── 1. 临时 env（全是占位，不碰真值）───────────────────────
	const envFile = path.join(os.tmpdir(), `ai-admin-deploy-e2e-${process.pid}.env`);
	const aiadminUrl = process.env.E2E_AIADMIN_URL || 'http://aiadmin-stub:80';
	fs.writeFileSync(
		envFile,
		[
			'# 验收用的假值（**不读 docker/.env** ⇒ 不碰真凭据）',
			`WEB_PORT=${WEB_PORT}`,
			`AI_PORT=${AI_PORT}`,
			`AIADMIN_PROXY_TARGET=${aiadminUrl}`,
			'AIADMIN_BASE_URL=https://www.pmdict.cn/api/v1',
			'AIADMIN_MCP_URL=',
			'DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3306/e2e',
			'MINIMAX_CN_API_KEY=e2e-dummy-key',
			'AI_MODEL=minimax-cn/MiniMax-M3.1-Flash',
			'AI_THINKING_LEVEL=off',
			`ALLOWED_ORIGINS=http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
			'',
		].join('\n'),
	);

	/** compose 命令前缀：独立 project + 临时 env 文件。 */
	const composeArgs = (extra = []) => [
		'compose',
		'--project-name',
		PROJECT,
		'--env-file',
		envFile,
		...COMPOSE_FILES.flatMap((f) => ['-f', f]),
		...extra,
	];

	/** 当前步（失败时要说清是哪一步）。 */
	let stepName = '准备';
	const step = (name) => {
		stepName = name;
		console.log(`\n  ▶ ${name}`);
	};

	try {
		// ─────────────────────── 2. compose config ───────────────────────
		step('docker compose config（校验编排文件）');
		run('docker', composeArgs(['config']));
		console.log('    ✓ 编排文件校验通过');

		// ─────────────────────── 3. 起 ───────────────────────
		step(`起 compose（project=${PROJECT}，端口 ${WEB_PORT}/${AI_PORT}）`);
		if (process.env.SKIP_BUILD === '1') {
			run('docker', composeArgs(['up', '-d']));
			console.log('    · SKIP_BUILD=1 ⇒ 跳过构建');
		} else {
			console.log('    · 构建/复用两个镜像（要几分钟）…');
			run('docker', composeArgs(['up', '-d', '--build']));
		}
		console.log('    ✓ 容器已起');

		// ─────────────────────── 4. 等 healthy ───────────────────────
		step('等两个容器 healthy');
		/** 某服务的容器 id。 */
		const containerId = (service) => run('docker', composeArgs(['ps', '-q', service]));
		/** 某服务的健康状态。 */
		const healthOf = (service) => {
			const id = containerId(service);
			if (!id) return 'missing';
			const res = tryRun('docker', ['inspect', '--format', '{{.State.Health.Status}}', id]);
			return res.status === 0 ? res.stdout : 'unknown';
		};
		let healthy = false;
		for (let i = 0; i < 90; i += 1) {
			if (healthOf('web') === 'healthy' && healthOf('ai') === 'healthy') {
				healthy = true;
				break;
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
		check('web 容器 healthy', healthOf('web') === 'healthy', healthOf('web'));
		check('ai 容器 healthy', healthOf('ai') === 'healthy', healthOf('ai'));
		if (!healthy) {
			console.error(run('docker', composeArgs(['logs', '--tail', '80', 'ai'])));
			console.error(run('docker', composeArgs(['logs', '--tail', '80', 'web'])));
			throw new Error('容器没在预期时间内 healthy（上面的日志是线索）');
		}

		// ─────────────────────── 5. HTTP 断言 ───────────────────────
		step('HTTP 断言（三条路由 + 健康检查）');

		// 5.1 根路径 = 前端 HTML
		const home = await get('/');
		check('GET / ⇒ 200', home.status === 200, `status=${home.status}`);
		check(
			'GET / ⇒ 返回前端 HTML（不是 nginx 默认页）',
			(home.headers.get('content-type') || '').includes('text/html') &&
				home.body.includes('<div id="root">'),
			`content-type=${home.headers.get('content-type')}`,
		);

		// 5.2 /api/ 打到后端（401/200 都算「通」）
		const api = await get('/api/v1/currentUser');
		check(
			'GET /api/v1/currentUser ⇒ 打到后端（200/401/403 都算通）',
			[200, 401, 403].includes(api.status),
			`status=${api.status} body=${api.body.slice(0, 120)}`,
		);
		if (!process.env.E2E_AIADMIN_URL) {
			// 用的是夹具里的桩 ⇒ 桩会回显到达它的原始路径 ⇒ 能证明**没被 rewrite**
			check(
				'GET /api/... ⇒ 路径原样到达上游（没被 rewrite）',
				api.body.trim() === '/api/v1/currentUser',
				`上游收到：${api.body.trim().slice(0, 120)}`,
			);
		}

		// 5.3 /ai-api/ 打到 AI 服务（401 也算通）
		const aiApi = await get('/ai-api/api/agent/skills');
		check(
			'GET /ai-api/api/agent/skills ⇒ 打到 AI 服务（200/401 都算通）',
			[200, 401, 403].includes(aiApi.status),
			`status=${aiApi.status} body=${aiApi.body.slice(0, 120)}`,
		);

		// 5.4 AI 服务的 /health（经 nginx 的 /ai-api/health）⇒ 200
		const aiHealth = await get('/ai-api/health');
		check('GET /ai-api/health ⇒ 200', aiHealth.status === 200, `status=${aiHealth.status}`);
		let aiHealthJson = null;
		try {
			aiHealthJson = JSON.parse(aiHealth.body);
		} catch {
			/* 留给下面的断言报错 */
		}
		check(
			'GET /ai-api/health ⇒ 是 AI 服务的健康 JSON（status: ok/degraded）',
			Boolean(aiHealthJson) && typeof aiHealthJson.status === 'string',
			aiHealth.body.slice(0, 160),
		);

		// 5.5 前端自己的健康检查
		const healthz = await get('/healthz');
		check('GET /healthz ⇒ 200', healthz.status === 200, `status=${healthz.status}`);
	} catch (err) {
		failures.push(`第「${stepName}」步失败 —— ${err.message}`);
		console.error(`\n  ✗ 第「${stepName}」步失败：${err.message}`);
	} finally {
		// ─────────────────────── 6. 清理 ───────────────────────
		console.log('\n  ▶ 清理（down -v，只清自己那个 project）');
		const down = tryRun('docker', composeArgs(['down', '-v', '--remove-orphans']));
		console.log(down.status === 0 ? '    ✓ compose 已清干净' : `    ✗ 清理没成功：${down.stderr.slice(0, 300)}`);
		try {
			fs.unlinkSync(envFile);
		} catch {
			/* 临时文件删不掉也无所谓 */
		}
	}

	console.log('');
	if (failures.length > 0) {
		console.error(`✗ 部署验收失败 ${failures.length} 条（通过 ${passed} 条）：`);
		for (const f of failures) console.error(`   - ${f}`);
		return 1;
	}
	console.log(`✓ 部署验收全部通过（${passed} 条）`);
	return 0;
}

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		console.error('✗ 部署验收异常：', err.message);
		process.exit(1);
	});
