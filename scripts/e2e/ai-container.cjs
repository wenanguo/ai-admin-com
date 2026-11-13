/**
 * AI 服务镜像 —— **容器验收**（需要 docker）。
 *
 * ## 它验什么（= issue #39 的验收标准）
 *
 *   1. `docker build -f backend/ai/Dockerfile -t ai-admin-ai .` 能成功
 *   2. 镜像里**没有凭据**（`.ai/auth.json` 不在镜像层里）
 *   3. 镜像里**没有 devDependencies**（typescript / prisma CLI 都不在）
 *   4. 技能在 `/app/.pi/skills`（**cwd 相对** ⇒ `load_skill` 读得到）
 *   5. 容器起来后 `GET /health` ⇒ **200** + JSON（含 `status`）
 *   6. **依赖不可用时 `/health` 仍是 200**（数据库/AiAdmin 都指向黑洞地址）
 *   7. 业务路由照常挂载：`/api/agent`、`/api/pending`、`/api/audit`（无 token ⇒ 401）
 *
 * ## 用法
 *
 *   node scripts/e2e/ai-container.cjs
 *
 * 环境变量：
 *   IMAGE        镜像名（默认 `ai-admin-ai:local`）
 *   PORT         宿主机端口（默认 13100）
 *   SKIP_BUILD=1 跳过构建（用已有镜像）
 *
 * ⚠️ 本机没有 docker ⇒ 打印 SKIP 并退出 0（不拦人）。
 *    CI（GitHub runner 自带 docker）上会真跑。
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const IMAGE = process.env.IMAGE || 'ai-admin-ai:local';
const PORT = Number(process.env.PORT || 13100);
const CONTAINER = 'ai-admin-ai-e2e';
const BASE = `http://127.0.0.1:${PORT}`;

/** 容器的环境变量（**全是假值** ⇒ 不需要任何真凭据）。 */
const ENV = {
  MINIMAX_CN_API_KEY: 'e2e-fake-key',
  AI_MODEL: 'minimax-cn/MiniMax-M3.1-Flash',
  // 黑洞地址 ⇒ 依赖自检必然 down（正好验「依赖挂了也 200」）
  AIADMIN_BASE_URL: 'http://127.0.0.1:9/api/v1',
  DATABASE_URL: 'mysql://e2e:e2e@127.0.0.1:1/aipm',
  ALLOWED_ORIGINS: 'http://localhost:8000',
};

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
    const out = (res.stdout || '').trim();
    throw new Error(
      [
        `${cmd} ${args.join(' ')} 退出码 ${res.status}`,
        '──── stderr（尾 12000）────',
        err.slice(-12000),
        '──── stdout（尾 2000）────',
        out.slice(-2000),
      ].join('\n'),
    );
  }
  return (res.stdout || '').trim();
}

/** 跑一条命令，失败也不抛（用于清理与检查）。 */
function tryRun(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

/** 在容器里跑一条 shell 命令 ⇒ { status, stdout, stderr }。 */
function inContainer(args) {
  return tryRun('docker', ['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', args]);
}

/** GET 一个 URL ⇒ { status, headers, body }。 */
async function get(url) {
  const res = await fetch(`${BASE}${url}`);
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function main() {
  // ─────────────────────── 0. docker 在不在？ ───────────────────────
  console.log('\n[0] 环境检查');
  const dockerOk = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  });
  if (dockerOk.status !== 0) {
    console.log('  SKIP：本机没有可用的 docker ⇒ 跳过容器验收。');
    console.log('        静态断言仍可跑：node scripts/e2e/ai-container.static.cjs');
    return 0;
  }
  console.log('  ✓ docker 可用');

  // ─────────────────────── 1. 构建镜像 ───────────────────────
  console.log('\n[1] 构建镜像');
  if (process.env.SKIP_BUILD === '1') {
    console.log('  · SKIP_BUILD=1 ⇒ 跳过构建');
  } else {
    console.log(`  · docker build -f backend/ai/Dockerfile -t ${IMAGE} .（可能要几分钟）`);
    run('docker', ['build', '-f', 'backend/ai/Dockerfile', '-t', IMAGE, '.']);
  }
  console.log('  ✓ 构建成功');

  // ─────────────────────── 2. 镜像内容 ───────────────────────
  console.log('\n[2] 镜像内容');
  const authFiles = inContainer('find / -name "auth.json" 2>/dev/null');
  check('镜像里没有 auth.json（凭据不入镜像层）', authFiles.stdout === '', authFiles.stdout.slice(0, 300));

  const agentDir = inContainer('ls -d /app/.ai 2>/dev/null');
  check('镜像里没有 /app/.ai（凭据目录不存在）', agentDir.status !== 0, agentDir.stdout);

  const skills = inContainer('ls /app/.pi/skills');
  check(
    '技能在 /app/.pi/skills（cwd 相对 ⇒ load_skill 读得到）',
    ['create-task', 'list-tasks', 'update-task'].every((name) => skills.stdout.includes(name)),
    skills.stdout || skills.stderr,
  );

  const skillFiles = inContainer('ls /app/.pi/skills/create-task/SKILL.md');
  check('技能文件在位（SKILL.md）', skillFiles.status === 0, skillFiles.stderr);

  const typescript = inContainer('ls -d /app/node_modules/typescript 2>/dev/null');
  check('镜像里没有 devDependencies（typescript 不在）', typescript.status !== 0, typescript.stdout);

  const prismaCli = inContainer('ls -d /app/node_modules/prisma 2>/dev/null');
  check('镜像里没有 prisma CLI（devDependency 不在）', prismaCli.status !== 0, prismaCli.stdout);

  const express = inContainer('ls -d /app/node_modules/express 2>/dev/null');
  check('镜像里有生产依赖（express 在）', express.status === 0, express.stderr);

  const prismaClient = inContainer('ls /app/node_modules/.prisma/client');
  check('prisma 生成的客户端在镜像里', prismaClient.status === 0, prismaClient.stderr);

  const dist = inContainer('ls /app/dist/main.js');
  check('编译产物在镜像里（dist/main.js）', dist.status === 0, dist.stderr);

  // ─────────────────────── 3. 起容器并验收 HTTP ───────────────────────
  console.log('\n[3] 起容器并验收 HTTP');
  tryRun('docker', ['rm', '-f', CONTAINER]);
  run('docker', [
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-p',
    `${PORT}:3100`,
    ...Object.entries(ENV).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    IMAGE,
  ]);

  try {
    // 等服务起来
    let healthy = false;
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await fetch(`${BASE}/health`);
        if (res.status === 200) {
          healthy = true;
          break;
        }
      } catch {
        /* 还没起来 */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    check('容器起来了（/health 200）', healthy);
    if (!healthy) {
      console.error(tryRun('docker', ['logs', '--tail', '80', CONTAINER]).stdout);
      return 1;
    }

    // 3.1 健康检查的内容
    const health = await get('/health');
    check('GET /health ⇒ 200', health.status === 200, `status=${health.status}`);
    let healthJson = null;
    try {
      healthJson = JSON.parse(health.body);
    } catch {
      /* 留给下面的断言报错 */
    }
    check('GET /health ⇒ JSON', Boolean(healthJson), health.body.slice(0, 300));
    check(
      'GET /health ⇒ 含 status 字段',
      typeof healthJson?.status === 'string',
      JSON.stringify(healthJson).slice(0, 300),
    );
    check(
      'GET /health ⇒ 含逐依赖的自检结果（checks）',
      Boolean(healthJson?.checks) && typeof healthJson.checks === 'object',
      JSON.stringify(healthJson).slice(0, 300),
    );
    check(
      '**依赖不可用时仍是 200**（数据库/AiAdmin 都指向黑洞）',
      health.status === 200 && healthJson?.status === 'degraded',
      `status=${healthJson?.status}`,
    );
    check(
      '健康检查里没有泄露凭据',
      !/e2e-fake-key|mysql:\/\//.test(health.body),
      health.body.slice(0, 300),
    );

    // 3.2 业务路由照常挂载（无 token ⇒ 401 ⇒ 说明路由在、且要 token）
    for (const route of ['/api/agent/conversations', '/api/pending', '/api/audit']) {
      const res = await get(route);
      check(`GET ${route} ⇒ 401（路由在，且要 token）`, res.status === 401, `status=${res.status}`);
    }

    // 3.3 SSE 端点在（无 token ⇒ 401）
    const sse = await get('/api/agent/conv-1/events');
    check('GET /api/agent/:id/events ⇒ 401（SSE 端点在）', sse.status === 401, `status=${sse.status}`);

    // 3.4 未知路径仍是 JSON 404
    const missing = await get('/api/nope');
    check('GET /api/nope ⇒ 404', missing.status === 404, `status=${missing.status}`);
    check(
      'GET /api/nope ⇒ JSON 404（不是 HTML）',
      (missing.headers.get('content-type') || '').includes('application/json'),
      missing.headers.get('content-type'),
    );
  } finally {
    // ─────────────────────── 4. 清理 ───────────────────────
    console.log('\n[4] 清理');
    tryRun('docker', ['rm', '-f', CONTAINER]);
    console.log('  ✓ 容器已删除');
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ 容器验收失败 ${failures.length} 条（通过 ${passed} 条）：`);
    for (const f of failures) console.error(`   - ${f}`);
    return 1;
  }
  console.log(`✓ 容器验收全部通过（${passed} 条）`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('✗ 容器验收异常：', err.message);
    process.exit(1);
  });
