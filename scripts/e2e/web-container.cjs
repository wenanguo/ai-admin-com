/**
 * 前端镜像 —— **容器验收**（需要 docker）。
 *
 * ## 它验什么（= issue #38 的验收标准）
 *
 *   1. `docker build -f docker/web/Dockerfile -t ai-admin-web .` 能成功
 *   2. 镜像里**没有 node_modules**（只有构建产物）
 *   3. 容器内 `nginx -t` 通过
 *   4. `GET /` ⇒ 200 + 前端首页 HTML（含 `<div id="root">`）
 *   5. `GET /pm/task` ⇒ 200 + 同一套壳（SPA fallback，不 404）
 *   6. 带 hash 的静态资源 ⇒ 长缓存（`max-age=31536000`）
 *   7. `GET /index.html` ⇒ **不缓存**（`no-store`）
 *   8. `GET /healthz` ⇒ 200 + JSON，且**不含版本敏感信息**
 *
 * ## 用法
 *
 *   node scripts/e2e/web-container.cjs
 *
 * 环境变量：
 *   IMAGE        镜像名（默认 `ai-admin-web:local`）
 *   PORT         宿主机端口（默认 18080）
 *   SKIP_BUILD=1 跳过构建（用已有镜像）
 *
 * ⚠️ 本机没有 docker ⇒ 打印 SKIP 并退出 0（不拦人）。
 *    CI（GitHub runner 自带 docker）上会真跑。
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const IMAGE = process.env.IMAGE || 'ai-admin-web:local';
const PORT = Number(process.env.PORT || 18080);
const CONTAINER = 'ai-admin-web-e2e';
const BASE = `http://127.0.0.1:${PORT}`;

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

/** 跑一条命令，失败也不抛（用于清理）。 */
function tryRun(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
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
  const dockerOk = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  });
  if (dockerOk.status !== 0) {
    console.log('  SKIP：本机没有可用的 docker ⇒ 跳过容器验收。');
    console.log('        静态断言仍可跑：node scripts/e2e/web-container.static.cjs');
    return 0;
  }
  console.log('  ✓ docker 可用');

  // ─────────────────────── 1. 构建镜像 ───────────────────────
  console.log('\n[1] 构建镜像');
  if (process.env.SKIP_BUILD === '1') {
    console.log('  · SKIP_BUILD=1 ⇒ 跳过构建');
  } else {
    console.log(`  · docker build -f docker/web/Dockerfile -t ${IMAGE} .（可能要几分钟）`);
    run('docker', ['build', '-f', 'docker/web/Dockerfile', '-t', IMAGE, '.']);
  }
  console.log('  ✓ 构建成功');

  // ─────────────────────── 2. nginx 配置校验 ───────────────────────
  console.log('\n[2] nginx -t');
  // ⚠️ nginx -t 的结果打在 **stderr** ⇒ stdout+stderr 都要看
  const nginxT = tryRun('docker', ['run', '--rm', '--entrypoint', 'nginx', IMAGE, '-t']);
  const nginxTText = `${nginxT.stdout}\n${nginxT.stderr}`;
  check(
    '容器内 nginx -t 通过',
    nginxT.status === 0 && /syntax is ok|test is successful/i.test(nginxTText),
    nginxTText.slice(-500),
  );

  // ─────────────────────── 3. 镜像里没有 node_modules ───────────────────────
  console.log('\n[3] 镜像内容');
  const nodeModulesDirs = run('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    IMAGE,
    '-c',
    'find / -maxdepth 4 -type d -name node_modules',
  ]);
  check('镜像里没有 node_modules 目录', nodeModulesDirs === '', nodeModulesDirs.slice(0, 500));

  const indexHtml = tryRun('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    IMAGE,
    '-c',
    'ls -l /usr/share/nginx/html/index.html',
  ]);
  check(
    '镜像里有前端构建产物（index.html）',
    indexHtml.status === 0 && indexHtml.stdout.includes('index.html'),
    `${indexHtml.stdout}${indexHtml.stderr}`.slice(-300),
  );

  // ─────────────────────── 4. 起容器并验收 HTTP ───────────────────────
  console.log('\n[4] 起容器并验收 HTTP');
  tryRun('docker', ['rm', '-f', CONTAINER]);
  run('docker', ['run', '-d', '--name', CONTAINER, '-p', `${PORT}:80`, IMAGE]);

  try {
    // 等健康检查通过
    let healthy = false;
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await fetch(`${BASE}/healthz`);
        if (res.status === 200) {
          healthy = true;
          break;
        }
      } catch {
        /* 还没起来 */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    check('容器起来了（/healthz 200）', healthy);
    if (!healthy) {
      console.error(tryRun('docker', ['logs', '--tail', '50', CONTAINER]).stdout);
      return 1;
    }

    // 4.1 首页
    const home = await get('/');
    check('GET / ⇒ 200', home.status === 200, `status=${home.status}`);
    check(
      'GET / ⇒ 返回 HTML',
      (home.headers.get('content-type') || '').includes('text/html'),
      home.headers.get('content-type'),
    );
    check('GET / ⇒ 是前端首页（壳里有 root 节点）', home.body.includes('<div id="root">'));

    // 4.2 SPA fallback
    const spa = await get('/pm/task');
    check('GET /pm/task ⇒ 200（刷新不 404）', spa.status === 200, `status=${spa.status}`);
    check('GET /pm/task ⇒ 返回同一套前端壳', spa.body.includes('<div id="root">'));

    // 4.3 静态资源长缓存
    const assetMatch = home.body.match(/(?:src|href)="(\/[^"]+\.(?:js|css))"/);
    check('首页里找得到带 hash 的静态资源', Boolean(assetMatch), home.body.slice(0, 200));
    if (assetMatch) {
      const asset = await get(assetMatch[1]);
      const cc = asset.headers.get('cache-control') || '';
      check('静态资源 ⇒ 200', asset.status === 200, `status=${asset.status}`);
      check('静态资源 ⇒ 长缓存（max-age=31536000）', cc.includes('max-age=31536000'), cc);
    }

    // 4.4 index.html 不缓存
    const index = await get('/index.html');
    const indexCc = index.headers.get('cache-control') || '';
    check('GET /index.html ⇒ 不缓存（no-store）', indexCc.includes('no-store'), indexCc);

    // 4.5 健康检查内容
    const health = await get('/healthz');
    check('GET /healthz ⇒ 200', health.status === 200, `status=${health.status}`);
    let healthJson = null;
    try {
      healthJson = JSON.parse(health.body);
    } catch {
      /* 留给下面的断言报错 */
    }
    check('GET /healthz ⇒ JSON', Boolean(healthJson), health.body.slice(0, 200));
    check(
      'GET /healthz ⇒ 不含版本敏感信息',
      !/version|commit|build[-_]?id/i.test(health.body),
      health.body.slice(0, 200),
    );
  } finally {
    // ─────────────────────── 5. 清理 ───────────────────────
    console.log('\n[5] 清理');
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
