/**
 * dsh 存储与审计（issue #121）—— **静态验收**。
 *
 * ## 为什么有它
 *
 * 本条动了**数据模型**（共享库 ⇒ 高风险）⇒ 光有单测不够：
 * 「只加不改」「契约不变」「前端零改动」「老数据可读」这几条**要有人盯着**。
 *
 * ⇒ 这个脚本**只读文件**、不需要数据库 / docker / 凭据 ⇒ **任何机器都能跑**（CI 必跑）。
 *
 * 覆盖：
 * 1. **数据模型只加不改**：新列 / 新表在，老表的老列还在，迁移里没有删改；
 * 2. **会话 ↔ dsh session 的映射列**在；
 * 3. **留痕接线**：事件日志 + 三类审计留痕都接上了；
 * 4. **对外契约不变**：契约表与审计检索口径还在（前端零改动）。
 *
 * 用法：
 *   node scripts/e2e/dsh-storage.static.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

/** 仓根（脚本在 `<root>/scripts/e2e/`）。 */
const ROOT = path.resolve(__dirname, '..', '..');

/** 读文件（不存在 ⇒ 抛错，由顶层统一报错退出）。 */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 读文件（不存在 ⇒ undefined）。 */
function readOrUndefined(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : undefined;
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

// ───────────────────────────── 数据模型 ─────────────────────────────
console.log('\nbackend/ai/prisma/schema.prisma（数据模型只加不改）');
const schema = read('backend/ai/prisma/schema.prisma');
containsAll(
  schema,
  [
    'model AiConversation',
    'model AiMessage',
    'model AiPendingAction',
    'model AiAuditLog',
    'model AiEntityRef',
  ],
  '老的 5 张表都还在（一张都没删）',
);
containsAll(
  schema,
  ['dshSessionId', '@map("dsh_session_id")'],
  '会话 ↔ dsh session 的映射列在（可空 ⇒ 迁移前的旧会话读得到）',
);
containsAll(
  schema,
  ['model AiSessionEvent', '@map("ai_session_event")', 'eventName', 'payload'],
  '会话事件日志表在（dsh 形状的追加式日志）',
);
// ⚠️ **老表的老列一个都不许少**（只加不改 ⇒ 删列 = 改语义）
const legacyColumns = [
  'agentId',
  '@map("agent_id")',
  'actorType',
  '@map("actor_type")',
  'beforeSnapshot',
  '@map("before_snapshot")',
  'afterSnapshot',
  '@map("after_snapshot")',
  'undoOf',
  '@map("undo_of")',
];
const missingLegacy = legacyColumns.filter((c) => !schema.includes(c));
check(
  '老表的老列一个都没少（只加不改）',
  missingLegacy.length === 0,
  missingLegacy.join(' / '),
);

// ───────────────────────────── 迁移脚本 ─────────────────────────────
console.log('\nbackend/ai/prisma/migrations（迁移只增不改）');
const migrationsDir = path.join(ROOT, 'backend/ai/prisma/migrations');
const migrationDirs = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
check(
  '有本条的迁移（2_add_dsh_session_storage）',
  migrationDirs.includes('2_add_dsh_session_storage'),
  migrationDirs.join(' / '),
);
const dshMigration = read(
  'backend/ai/prisma/migrations/2_add_dsh_session_storage/migration.sql',
);
containsAll(
  dshMigration,
  [
    'ALTER TABLE `ai_conversation` ADD COLUMN `dsh_session_id` VARCHAR(64) NULL',
    'CREATE TABLE `ai_session_event`',
  ],
  '迁移 = 加一列 + 加一张表',
);
check(
  '新列**可空**（旧会话不用回填 ⇒ 共享库上零写操作）',
  /dsh_session_id` VARCHAR\(64\) NULL/.test(dshMigration),
);
const dangerous = dshMigration
  .split('\n')
  .map((line) => line.trim())
  // ⚠️ **注释不算**（头部注释里提了一嘴 `DROP DATABASE` ⇒ 那是在警告别用它）
  .filter((line) => line.length > 0 && !line.startsWith('--'))
  .filter(
    (line) =>
      /DROP\s/i.test(line) ||
      /TRUNCATE/i.test(line) ||
      /DELETE\s+FROM/i.test(line) ||
      /RENAME/i.test(line) ||
      /MODIFY\s/i.test(line) ||
      /CHANGE\s+COLUMN/i.test(line),
  );
check('迁移里没有删表 / 改列 / 删数据', dangerous.length === 0, dangerous.join(' | '));

// ───────────────────────────── 留痕接线 ─────────────────────────────
console.log('\nbackend/ai/src/core（存储与审计的接线）');
const persistence = read('backend/ai/src/core/adapter/dsh/persistence.ts');
containsAll(
  persistence,
  ['model_call', 'tool_call', 'gate_decided', 'DshTracer'],
  '留痕层在适配层里（dsh 的类型不外泄）',
);
check(
  '三类留痕都进审计（模型调用 / 工具调用 / 闸门决策）',
  persistence.includes('MODEL_CALL_COMMAND') &&
    persistence.includes('actorType: "AI"') &&
    persistence.includes('actorType: "USER"'),
);
const runtime = read('backend/ai/src/core/session/runtime.ts');
containsAll(
  runtime,
  ['AuditTrail', 'PrismaSessionEventStore', 'DshTracer', 'setDshSessionId'],
  '运行时用上了留痕带 / 事件日志 / 留痕层 / 映射列',
);
const store = read('backend/ai/src/core/store/store.ts');
containsAll(store, ['dshSessionId', 'setDshSessionId'], '存取层写了映射列');
const events = read('backend/ai/src/core/store/session-events.ts');
containsAll(events, ['aiSessionEvent', 'SessionEventKind'], '事件日志的存取在 store 层');
const approvals = read('backend/ai/src/core/adapter/dsh/approvals.ts');
containsAll(approvals, ['onDecision'], '闸门决策回报给留痕层');

// ───────────────────────────── 对外契约不变 ─────────────────────────────
console.log('\n对外契约（前端零改动）');
const contract = read('backend/ai/src/core/routes/contract.ts');
containsAll(
  contract,
  [
    '/api/agent/conversations',
    '/api/agent/conv-1/command',
    '/api/agent/conv-1/state',
    '/api/agent/conv-1/abort',
    '/api/pending',
    '/api/agent/pending/p-1/approve',
    '/api/agent/pending/p-1/reject',
    '/api/audit',
  ],
  '契约表的 9 个端点一个不少',
);
const auditRoute = read('backend/ai/src/core/routes/audit.ts');
containsAll(
  auditRoute,
  ['parseAuditFilters', 'prismaAuditReader', 'queryAuditLog'],
  '审计的检索口径没变（还是那三个函数）',
);
check(
  '前端**零改动**（没有引用新字段 sessionEvents）',
  !grepFrontend('sessionEvents'),
  '前端不该认识新字段',
);

// ───────────────────────────── 结果 ─────────────────────────────
console.log('');
if (failures.length > 0) {
  console.error(`✗ 静态断言失败 ${failures.length} 条（通过 ${passed} 条）：`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✓ 静态断言全部通过（${passed} 条）`);

/** 前端源码里有没有这个标识符（**只查 src/ ⇒ 不查产物**）。 */
function grepFrontend(needle) {
  const dir = path.join(ROOT, 'frontend/src');
  if (!fs.existsSync(dir)) {
    return false;
  }
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }
      if (readFileSyncSafe(full).includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

/** 读文件（坏了就当空串）。 */
function readFileSyncSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
