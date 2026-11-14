/**
 * compose 编排 —— **真起 compose 验收**（需要 docker）。
 *
 * ## 它验什么（= issue #40 的验收标准）
 *
 *   1. `docker compose config` 校验通过
 *   2. `up -d --build` ⇒ web + ai 两个容器都 **healthy**
 *   3. `GET /` ⇒ 前端页面（不是 nginx 默认页）
 *   4. `GET /api/v1/ping` ⇒ 到达上游时**路径原样**（证明 nginx **没有 rewrite**）
 *   5. `GET /ai-api/health` ⇒ AI 服务的健康 JSON（证明**前缀被去掉**）
 *   6. `GET /ai-api/api/agent/x/events` ⇒ 能到 AI 服务（不是 404/502）
 *   7. AI 服务端口**只绑 127.0.0.1**；web 端口才是对外入口
 *
 * ## 用法
 *
 *   node scripts/e2e/compose.cjs
 *
 * 环境变量：
 *   WEB_PORT / AI_PORT  端口（默认 8080 / 3100）
 *   SKIP_BUILD=1        跳过构建（用已有镜像）
 *
 * ⚠️ **不读 `docker/.env`**：脚本自己写一份**假值** env 文件传给 compose
 *    （--env-file）⇒ 不会碰到真值，也不会污染开发者的 .env。
 * ⚠️ 本机没有 docker ⇒ 打印 SKIP 并退出 0（不拦人）。CI 上真跑。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const WEB_PORT = Number(process.env.WEB_PORT || 8080);
const AI_PORT = Number(process.env.AI_PORT || 3100);
const BASE = `http://127.0.0.1:${WEB_PORT}`;

/** compose 的两个文件：主编排 + 验收夹具（AiAdmin 桩）。 */
const COMPOSE_FILES = ['docker/docker-compose.yaml', 'docker/docker-compose.ci.yaml'];

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

/** 跑一条命令（失败 ⇒ 抛错，附带 stderr）。 */
function run(cmd, args, options = {}) {
	const res = spawnSync(cmd, args, {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
		...options,
	});
	if (res.status !== 0) {
		const err = (res.stderr || '').trim();
		throw new Error(
			`${cmd} ${args.join(' ')} 退出码 ${res.status}\n${err.slice(-12000)}\n${(res.stdout || '')
				.trim()
				.slice(-2000)}`,
		);
	}
	return (res.stdout || '').trim();
}

/** 跑一条命令，失败也不抛。 */
function tryRun(cmd, args, options = {}) {
	const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...options });
	return {
		status: res.status,
		stdout: (res.stdout || '').trim(),
		stderr: (res.stderr || '').trim(),
	};
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
		console.log('  SKIP：本机没有可用的 docker ⇒ 跳过 compose 验收。');
		console.log('        静态断言仍可跑：node scripts/e2e/compose.static.cjs');
		return 0;
	}
	console.log('  ✓ docker 可用');

	// ─────────────────────── 1. 假值 env 文件（不碰真值）───────────────────────
	const envFile = path.join(os.tmpdir(), `ai-admin-compose-e2e-${process.pid}.env`);
	fs.writeFileSync(
		envFile,
		[
			'# 验收用的假值（真值在 docker/.env；这里**故意不用**它）',
			'WEB_PORT=8080',
			'AI_PORT=3100',
			'AIADMIN_PROXY_TARGET=http://aiadmin-stub:80',
			'AIADMIN_BASE_URL=https://www.pmdict.cn/api/v1',
			'AIADMIN_MCP_URL=',
			'DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3306/e2e',
			'MINIMAX_CN_API_KEY=e2e-dummy-key',
			'AI_MODEL=minimax-cn/MiniMax-M3.1-Flash',
			'AI_THINKING_LEVEL=off',
			'ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080',
			'',
		].join('\n'),
	);

	/** compose 命令前缀（带文件列表与 env 文件）。 */
	const composeArgs = (extra = []) => [
		'compose',
		'--env-file',
		envFile,
		...COMPOSE_FILES.flatMap((f) => ['-f', f]),
		...extra,
	];

	try {
		// ─────────────────────── 2. compose config 校验 ───────────────────────
		console.log('\n[1] docker compose config');
		run('docker', composeArgs(['config']));
		console.log('  ✓ compose 文件校验通过');

		// ─────────────────────── 3. 起起来 ───────────────────────
		console.log('\n[2] docker compose up -d');
		if (process.env.SKIP_BUILD === '1') {
			console.log('  · SKIP_BUILD=1 ⇒ 跳过构建');
			run('docker', composeArgs(['up', '-d']));
		} else {
			console.log('  · 构建两个镜像（要几分钟）…');
			run('docker', composeArgs(['up', '-d', '--build']));
		}
		console.log('  ✓ 容器已起');

		// ─────────────────────── 4. 等 healthy ───────────────────────
		console.log('\n[3] 等两个容器 healthy');
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
			const web = healthOf('web');
			const ai = healthOf('ai');
			if (web === 'healthy' && ai === 'healthy') {
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
			return 1;
		}

		// ─────────────────────── 5. HTTP 验收 ───────────────────────
		console.log('\n[4] HTTP 验收');

		// 5.1 根路径 = 前端页面
		const home = await get('/');
		check('GET / ⇒ 200', home.status === 200, `status=${home.status}`);
		check(
			'GET / ⇒ 返回前端页面（不是 nginx 默认页）',
			(home.headers.get('content-type') || '').includes('text/html') &&
				home.body.includes('<div id="root">'),
			`content-type=${home.headers.get('content-type')}`,
		);

		// 5.2 健康检查
		const healthz = await get('/healthz');
		check('GET /healthz ⇒ 200', healthz.status === 200, `status=${healthz.status}`);
		check('GET /healthz ⇒ 固定 JSON', healthz.body.includes('"status":"ok"'), healthz.body.slice(0, 120));

		// 5.3 /api/ **不 rewrite**
		const api = await get('/api/v1/ping');
		check('GET /api/v1/ping ⇒ 200', api.status === 200, `status=${api.status}`);
		check(
			'GET /api/v1/ping ⇒ 到达上游时路径原样（没 rewrite）',
			api.body.trim() === '/api/v1/ping',
			`上游收到：${api.body.trim().slice(0, 120)}`,
		);

		// 5.4 /ai-api/ **去前缀**
		const aiHealth = await get('/ai-api/health');
		check('GET /ai-api/health ⇒ 200', aiHealth.status === 200, `status=${aiHealth.status}`);
		let aiHealthJson = null;
		try {
			aiHealthJson = JSON.parse(aiHealth.body);
		} catch {
			/* 留给下面的断言报错 */
		}
		check(
			'GET /ai-api/health ⇒ 是 AI 服务的健康 JSON（前缀已去掉）',
			Boolean(aiHealthJson) && typeof aiHealthJson.status === 'string',
			aiHealth.body.slice(0, 160),
		);

		// 5.5 AI 的事件流路由能到 AI 服务（要 token ⇒ 401 也算「到了」）
		const sse = await get('/ai-api/api/agent/e2e/events');
		check(
			'GET /ai-api/api/agent/:id/events ⇒ 到 AI 服务（不是 404/502）',
			sse.status !== 404 && sse.status !== 502,
			`status=${sse.status}`,
		);

		// ─────────────────────── 6. 端口边界 ───────────────────────
		console.log('\n[5] 端口边界');
		const aiPort = tryRun('docker', composeArgs(['port', 'ai', '3100']));
		check(
			'AI 服务只绑 127.0.0.1',
			aiPort.status === 0 && aiPort.stdout.startsWith('127.0.0.1:'),
			aiPort.stdout || aiPort.stderr,
		);
		const webPort = tryRun('docker', composeArgs(['port', 'web', '80']));
		check(
			'web（唯一入口）对宿主暴露',
			webPort.status === 0 && /\d+\.\d+\.\d+\.\d+:\d+|:::?\d+/.test(webPort.stdout),
			webPort.stdout || webPort.stderr,
		);
	} finally {
		// ─────────────────────── 7. 清理 ───────────────────────
		console.log('\n[6] 清理');
		tryRun('docker', composeArgs(['down', '-v', '--remove-orphans']));
		try {
			fs.unlinkSync(envFile);
		} catch {
			/* 临时文件删不掉也无所谓 */
		}
		console.log('  ✓ compose 已 down');
	}

	console.log('');
	if (failures.length > 0) {
		console.error(`✗ compose 验收失败 ${failures.length} 条（通过 ${passed} 条）：`);
		for (const f of failures) console.error(`   - ${f}`);
		return 1;
	}
	console.log(`✓ compose 验收全部通过（${passed} 条）`);
	return 0;
}

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		console.error('✗ compose 验收异常：', err.message);
		process.exit(1);
	});
