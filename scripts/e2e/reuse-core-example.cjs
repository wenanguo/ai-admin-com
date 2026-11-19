/**
 * 「通用内核可复用」的验收 —— **真起 compose**（issue #116 的核心交付）。
 *
 * ## 它验什么
 *
 *   1. compose 里**只有**示例系统 + 示例自己的空库（没有别的业务系统）；
 *   2. `GET /api/agents` 能列出**示例自己的**智能体（`notes`）；
 *   3. 示例的**身份**是自己认的（坏 token ⇒ 401）；
 *   4. `POST /api/agent/conversations` 真的建得出会话（⇒ 内核 + 库都装配好了）；
 *   5. **示例命令真的能调**（有模型 key 时 ⇒ 模型真的调了 `add_note` ⇒ 笔记真的多了一条）；
 *      **没有模型 key 时** ⇒ 也要能跑到「装配成功」这一步（第 2~4 条照样断言）。
 *
 * ## 用法
 *
 *   node scripts/e2e/reuse-core-example.cjs
 *
 * 环境变量：
 *   MINIMAX_CN_API_KEY  模型 key（**可省** ⇒ 少了就只验到「装配成功」）
 *   NOTES_PORT          宿主机端口（默认 13200）
 *   SKIP_BUILD=1        跳过构建（用已有镜像）
 *
 * ⚠️ 本机没有 docker ⇒ 打印 SKIP 并退出 0（不拦人）。
 *    CI（GitHub runner 自带 docker）上会真跑。
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const EXAMPLE_DIR = path.join(ROOT, 'backend', 'ai', 'examples', 'reading-notes');
const COMPOSE_FILE = path.join(EXAMPLE_DIR, 'docker-compose.yaml');
const PROJECT = `core-reuse-e2e-${process.pid}`;
const PORT = Number(process.env.NOTES_PORT || 13200);
const BASE = `http://127.0.0.1:${PORT}`;
/** 示例系统的 token（示例插件认 `demo-` 开头的）。 */
const TOKEN = 'demo-reader';

/** 有没有**真的**模型 key（没有 ⇒ 只验到「装配成功」）。 */
const REAL_MODEL_KEY = (process.env.MINIMAX_CN_API_KEY || '').trim().length > 0;

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
        '──── stdout（尾 4000）────',
        out.slice(-4000),
      ].join('\n'),
    );
  }
  return (res.stdout || '').trim();
}

/** 跑一条命令，失败也不抛（用于清理与检查）。 */
function tryRun(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return {
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

/** docker compose（带项目名 ⇒ 不碰开发者本地的编排）。 */
function compose(args, options = {}) {
  return run('docker', ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...args], options);
}

function tryCompose(args, options = {}) {
  return tryRun('docker', ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...args], options);
}

/** GET 一个 URL ⇒ { status, headers, body }。 */
async function get(url, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}${url}`, { headers });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

/** POST 一个 URL。 */
async function post(url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

/** 等一个条件成立（轮询）。 */
async function waitFor(fn, { timeoutMs = 120000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) {
      return value;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

async function main() {
  // ─────────────────────── 0. docker 在不在？ ───────────────────────
  console.log('\n[0] 环境检查');
  const dockerOk = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  });
  if (dockerOk.status !== 0) {
    console.log('  SKIP：本机没有可用的 docker ⇒ 跳过容器验收。');
    console.log('        静态断言仍可跑：node scripts/check-core-reuse.cjs');
    return 0;
  }
  console.log('  ✓ docker 可用');
  console.log(
    `  · 模型 key：${REAL_MODEL_KEY ? '有 ⇒ 会验「命令真的能调」' : '没有 ⇒ 只验到「装配成功」'}`,
  );

  // ─────────────────────── 1. 编排的口径 ───────────────────────
  console.log('\n[1] 编排的口径');
  // ⚠️ **不打印 `compose config`**：它会把环境变量（模型 key）原样打出来。
  const services = compose(['config', '--services']).split('\n').map((s) => s.trim()).filter(Boolean).sort();
  check('compose 能解析', services.length > 0, services.join('、'));
  check(
    '**编排里没有别的业务系统**（不出现 aiadmin）',
    !/aiadmin/i.test(require('node:fs').readFileSync(COMPOSE_FILE, 'utf8')),
    COMPOSE_FILE,
  );
  check(
    '编排里只有示例系统与它自己的库（app / db）',
    services.length === 2 && services.includes('app') && services.includes('db'),
    services.join('、'),
  );

  // ─────────────────────── 2. 构建并起 ───────────────────────
  console.log('\n[2] 构建并起 compose');
  try {
    if (process.env.SKIP_BUILD === '1') {
      console.log('  · SKIP_BUILD=1 ⇒ 跳过构建');
    } else {
      console.log('  · docker compose build（可能要几分钟）');
      compose(['build']);
    }
    console.log('  · docker compose up -d');
    compose(['up', '-d']);
    console.log('  ✓ 起来了');
  } catch (error) {
    console.error(error.message);
    console.error(tryCompose(['logs', '--tail', '120']).stdout);
    tryCompose(['down', '-v']);
    return 1;
  }

  try {
    // ─────────────────────── 3. 服务就绪 ───────────────────────
    console.log('\n[3] 服务就绪');
    const healthy = await waitFor(async () => {
      try {
        const res = await fetch(`${BASE}/health`);
        return res.status === 200;
      } catch {
        return false;
      }
    }, { timeoutMs: 180000, intervalMs: 2000 });
    check('示例系统起来了（/health 200）', Boolean(healthy));
    if (!healthy) {
      console.error(tryCompose(['logs', '--tail', '160']).stdout);
      return 1;
    }

    const health = await get('/health');
    let healthJson = null;
    try {
      healthJson = JSON.parse(health.body);
    } catch {
      /* 留给下面的断言报错 */
    }
    check('GET /health ⇒ 200', health.status === 200, `status=${health.status}`);
    check(
      'GET /health ⇒ 含逐依赖的自检结果（数据库可达）',
      Boolean(healthJson?.checks?.database) && healthJson.checks.database.status === 'up',
      JSON.stringify(healthJson?.checks ?? {}).slice(0, 300),
    );

    // ─────────────────────── 4. 智能体清单 ───────────────────────
    console.log('\n[4] 智能体清单（示例自己的）');
    const agents = await get('/api/agents', TOKEN);
    check('GET /api/agents ⇒ 200', agents.status === 200, `status=${agents.status} ${agents.body.slice(0, 200)}`);
    let agentIds = [];
    try {
      const parsed = JSON.parse(agents.body);
      agentIds = (parsed?.data ?? []).map((item) => item?.id);
    } catch {
      /* 留给下面的断言报错 */
    }
    check('清单里有示例的智能体「notes」', agentIds.includes('notes'), JSON.stringify(agentIds));
    check(
      '清单里**没有**别的系统的智能体（pm / qa 都不在）',
      !agentIds.includes('pm') && !agentIds.includes('qa'),
      JSON.stringify(agentIds),
    );

    const badToken = await get('/api/agents', 'not-a-demo-token');
    check(
      '坏 token ⇒ 401（身份是**示例自己**认的）',
      badToken.status === 401,
      `status=${badToken.status}`,
    );

    // ─────────────────────── 5. 会话（装配成功） ───────────────────────
    console.log('\n[5] 会话（⇒ 内核 + 库都装配好了）');
    const created = await post('/api/agent/conversations', { title: '验收会话' }, TOKEN);
    check('POST /api/agent/conversations ⇒ 200', created.status === 200, `status=${created.status} ${created.body.slice(0, 200)}`);
    let conversationId = '';
    try {
      conversationId = JSON.parse(created.body)?.data?.conversationId ?? '';
    } catch {
      /* 留给下面的断言报错 */
    }
    check('会话 id 拿得到', conversationId.length > 0, created.body.slice(0, 200));
    check(
      '会话 id 带着智能体 id（notes_…）',
      conversationId.startsWith('notes_'),
      conversationId,
    );

    // ─────────────────────── 6. 示例命令真的能调 ───────────────────────
    console.log('\n[6] 示例命令');
    const command = await post(
      `/api/agent/${conversationId}/command`,
      {
        id: 'e2e-command-1',
        type: 'prompt',
        message: '请用 add_note 工具记一条读书笔记：书名《活着》，作者余华。',
      },
      TOKEN,
    );
    check(
      'POST /api/agent/:id/command ⇒ 200（已受理）',
      command.status === 200,
      `status=${command.status} ${command.body.slice(0, 300)}`,
    );

    if (!REAL_MODEL_KEY) {
      console.log('  · 没有模型 key ⇒ 跳过「工具真的被调」这一步（装配已验完）');
    } else {
      const notes = await waitFor(async () => {
        const res = await get('/api/notes');
        if (res.status !== 200) {
          return undefined;
        }
        try {
          const parsed = JSON.parse(res.body);
          const list = parsed?.data ?? [];
          return list.length > 0 ? list : undefined;
        } catch {
          return undefined;
        }
      }, { timeoutMs: 120000, intervalMs: 3000 });
      check(
        '**示例命令真的能调**（模型调了 add_note ⇒ 笔记多了一条）',
        Boolean(notes),
        '120 秒内没等到笔记',
      );
      if (notes) {
        console.log(`    · 记下的笔记：${JSON.stringify(notes[0]).slice(0, 200)}`);
      }

      const state = await waitFor(async () => {
        const res = await get(`/api/agent/${conversationId}/state`, TOKEN);
        if (res.status !== 200) {
          return undefined;
        }
        try {
          const parsed = JSON.parse(res.body);
          const messages = parsed?.data?.messages ?? [];
          return messages.some((message) => message?.role === 'ASSISTANT') ? messages : undefined;
        } catch {
          return undefined;
        }
      }, { timeoutMs: 60000, intervalMs: 3000 });
      check('助手回话了（SSE/状态里有 ASSISTANT 消息）', Boolean(state));
    }
  } finally {
    // ─────────────────────── 7. 清理 ───────────────────────
    console.log('\n[7] 清理');
    tryCompose(['down', '-v']);
    console.log('  ✓ 容器与卷已删除');
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ 内核复用验收失败 ${failures.length} 条（通过 ${passed} 条）：`);
    for (const f of failures) console.error(`   - ${f}`);
    return 1;
  }
  console.log(`✓ 内核复用验收全部通过（${passed} 条）`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('✗ 内核复用验收异常：', err.message);
    tryCompose(['down', '-v']);
    process.exit(1);
  });
