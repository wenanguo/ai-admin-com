# AI 服务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 AiAdmin 之上的 AI 编排层 —— 把自然语言变成受控的业务命令，每次写入可审计、可撤销，
破坏性操作先进待确认队列，并通过 SSE 把过程推给前端。

**Architecture:** 一个独立的 Next.js（Route Handlers）常驻进程，**只出 API 不出 UI**。进程内跑
pi agent（`@earendil-works/pi-coding-agent` 的同进程 SDK），agent 只注册本项目的业务命令工具；
工具一律经「适配层」访问 AiAdmin 的 PM API（通路 A：转发外部已实现的 API），适配层负责枚举归一、
字段映射、错误归一、写前快照；规则引擎是**纯函数**，不算 LLM 参与；本地只存 AI 侧元数据
（`ai_*` 六张表，MySQL，与 AiAdmin 同库）。

**Tech Stack:** Next.js 15（App Router，Route Handlers）· TypeScript · pi agent SDK
`@earendil-works/pi-coding-agent` · Prisma + MySQL · Vitest · Zod

**Spec:**
- [`docs/superpowers/specs/2026-11-03-aipm-merge-design.md`](../specs/2026-11-03-aipm-merge-design.md)
  （架构、裁决、审计模型、能力位实测）
- [`docs/aipm/docs/02-domain-model.md`](../../aipm/docs/02-domain-model.md)、
  [`03-api-contract.md`](../../aipm/docs/03-api-contract.md)、
  [`04-command-catalog.md`](../../aipm/docs/04-command-catalog.md)、
  [`05-agent-runtime.md`](../../aipm/docs/05-agent-runtime.md)、
  [`06-adapter-interface.md`](../../aipm/docs/06-adapter-interface.md)（AIPM 上游设计）

---

## Global Constraints

以下每条都来自 spec，**所有任务隐含包含**：

- **仓库位置**：`D:/project/ai-admin-ai`（独立 git 仓；本仓 `ai-admin-com` 不包含本计划的代码）。
- **Node ≥ 20**（pi agent SDK 要求）。
- **事实源**：AiAdmin FastAPI（`https://www.pmdict.cn/api/v1`；本地 `http://127.0.0.1:8001`）。
  **本服务不直连 AiAdmin 的数据库**，只调它的 REST API。
- **用户身份透传**：调用 AiAdmin 时带**调用方的** `Authorization: Bearer <token>`；
  本服务**不持有任何长期凭据**，不落盘 token，不把 token 写进日志。
- **数据库**：MySQL，与 AiAdmin 同库；表前缀 `ai_`；**单租户**（表里**没有** `tenant_id`）。
- **成功判定**：AiAdmin 的业务码 `code === 0`（也接受 `200`）；本服务对外的响应**统一用同样的信封**
  `{ code, msg, data }`。
- **写操作**：一律经适配层；**写前必须 GET 一次**存字段级差异（写前快照）；
  审计与业务写**不在同一事务**（跨进程），用「写前快照 + 写后核对 + 审计落库」三段式。
- **撤销**：补偿式（用快照旧值写回去）；**补偿前做冲突检测**（当前值 ≠ after_snapshot ⇒ 拒绝覆盖）；
  补偿**逐条独立**、部分失败**显式报告**；补偿本身也写审计（`undo_of`）。
- **待确认**：危险命令在 `execute()` 内**第一件事**是求预览并挂起等待，**不许先执行再问**；
  `PendingAction` 表是事实源。
- **规则优先**：进度、风险、健康度的**数字**由确定性规则算出；LLM 只负责措辞与意图抽取。
- **相对日期**：后端解析，模型不参与算日期；周起点周一，时区 Asia/Shanghai，区间闭区间。
- **不注册**：`add_task_dependency` / `remove_task_dependency`（后端没有依赖图接口）；
  ETA **不产出** P50/P90（CPM 不可用）。
- **测试**：Vitest。**每个任务自带测试循环**，TDD。
- **提交**：中文提交信息；subject 不得以大写拉丁词开头；多行信息用 `git commit -F <file>`。
- **不要 push**：除非计划明确要求。

## Review Focus

以下五类是 spec 暗示、但任何任务的测试都容易漏掉的失败模式。每个后面标了**归属任务**，
实施时要把对应的测试加进那个任务。

1. **部分失败**（Task 7、Task 8）：批量命令里一条失败，**其余必须已经生效**，
   且结果要**逐条**报告（"3 条已撤销，1 条失败：xxx"），不能整批回滚也不能整批吞掉。
2. **撤销时的并发修改**（Task 4）：用户在 AI 改完之后又手动改了同一条 ⇒ 撤销**必须拒绝覆盖**，
   并报出冲突，不能拿旧值把人家的新值盖掉。
3. **待确认过期**（Task 7）：`PendingAction` 过了 `expires_at` 之后再确认 ⇒ 拒绝执行，
   提示"预览已过期，请让 AI 重新生成"，不能执行一个陈旧的快照。
4. **适配层的枚举未命中**（Task 3）：AiAdmin 返回一个映射表里没有的状态码 ⇒ 归一为**默认状态 + 记一条告警**，
   **不许猜语义**。
5. **SSE 断线重连**（Task 9）：断线时正在流式 ⇒ 重连后的 `connected` 帧必须带
   `pendingActionIds` 与 `isStreaming`，前端才能恢复待确认卡片；不能只补发增量。

---

---

### Task 1: 仓骨架 · Prisma · ai_* 元数据表

**Files:**
- Create: `package.json`、`tsconfig.json`、`vitest.config.ts`、`.env.example`、`README.md`
- Create: `prisma/schema.prisma`
- Create: `src/db.ts`、`src/types/api.ts`、`src/env.ts`
- Test: `src/db.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces:
  - `src/env.ts` → `env.AIADMIN_BASE_URL: string`、`env.DATABASE_URL: string`、
    `env.AI_MODEL: string`、`env.PORT: number`、`env.ALLOWED_ORIGINS: string[]`
  - `src/db.ts` → `prisma: PrismaClient`（单例）
  - `src/types/api.ts` → `ApiResponse<T> = { code: number; msg: string; data: T }`、
    `ApiCode`（`SUCCESS_CODES = [0, 200]`）、`isSuccess(body): boolean`

**Prisma 模型（照 spec §6.2，六张表，全部无 `tenant_id`）：**

```prisma
model AiConversation {
  id        String   @id @default(cuid())
  userId    String
  projectRef String?
  channel   String   @default("WEB")
  title     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages      AiMessage[]
  pendingActions AiPendingAction[]
  @@index([userId, updatedAt])
}

model AiMessage {
  id             String   @id @default(cuid())
  conversationId String
  conversation   AiConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String   // USER | ASSISTANT | SYSTEM
  content        String
  toolCalls      Json?
  seq            Int      @default(0)
  createdAt      DateTime @default(now())
  @@index([conversationId, seq])
}

model AiPendingAction {
  id             String   @id @default(cuid())
  conversationId String?
  conversation   AiConversation? @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  userId         String
  command        String
  args           Json
  preview        Json
  status         String   @default("PENDING") // PENDING|CONFIRMED|REJECTED|EXPIRED|EXECUTED
  expiresAt      DateTime
  resolvedAt     DateTime?
  resolvedBy     String?
  adjustedFrom   String?
  createdAt      DateTime @default(now())
  @@index([status, userId])
}

model AiAuditLog {
  id             String   @id @default(cuid())
  userId         String
  actorType      String   // USER | AI
  command        String
  args           Json
  beforeSnapshot Json?
  afterSnapshot  Json?
  undoOf         String?
  undoneAt       DateTime?
  adopted        Boolean?
  model          String?
  tokens         Int?
  latencyMs      Int?
  traceId        String?
  error          String?
  createdAt      DateTime @default(now())
  @@index([userId, createdAt])
  @@index([undoOf])
}

model AiEntityRef {
  id           String   @id @default(cuid())
  entityType   String   // PROJECT|MILESTONE|TASK|RISK
  externalId   String
  titleCache   String?
  lastSyncedAt DateTime?
  createdAt    DateTime @default(now())
  @@unique([entityType, externalId])
}

model AiDerivedState {
  id          String   @id @default(cuid())
  entityRefId String
  entityRef   AiEntityRef @relation(fields: [entityRefId], references: [id], onDelete: Cascade)
  kind        String   // MILESTONE_HEALTH|ETA|RISK_SUGGESTION
  payload     Json
  computedAt  DateTime @default(now())
  @@unique([entityRefId, kind])
}
```

- [ ] **Step 1: 写失败的测试** —— `src/db.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { isSuccess } from './types/api';

describe('isSuccess', () => {
  it('接受 code 0 与 200', () => {
    expect(isSuccess({ code: 0, msg: 'ok', data: null })).toBe(true);
    expect(isSuccess({ code: 200, msg: 'ok', data: null })).toBe(true);
  });
  it('拒绝其他业务码与非信封', () => {
    expect(isSuccess({ code: 10401, msg: 'x', data: null })).toBe(false);
    expect(isSuccess({ msg: 'x' } as never)).toBe(false);
    expect(isSuccess(null)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** —— Run: `npm install && npx vitest run src/db.test.ts`
  Expected: FAIL（`./types/api` 不存在）

- [ ] **Step 3: 实现** —— 写 `package.json`（deps：`@earendil-works/pi-coding-agent`、`@prisma/client`、`prisma`、
  `next`、`react`、`zod`；devDeps：`typescript`、`vitest`、`tsx`、`@types/node`）、
  `tsconfig.json`（`strict: true`、`moduleResolution: bundler`）、`vitest.config.ts`、
  `.env.example`（列出上面 `env.ts` 的五个变量）、`README.md`（怎么起、怎么测）、
  `prisma/schema.prisma`（上面六个模型逐字照抄）、`src/db.ts`（PrismaClient 单例，
  `globalThis` 缓存避免 dev 热重载泄漏连接）、`src/types/api.ts`（上面两个导出）、
  `src/env.ts`（用 zod 校验环境变量，缺变量**启动即失败**并打印缺哪个）。
  `src/db.test.ts` 里的两个用例按 Step 1 写。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS（2 passed）

- [ ] **Step 5: 验证迁移能跑** —— Run: `npx prisma migrate dev --name init_ai_tables`
  Expected: 退出码 0，数据库里出现 6 张 `ai_` 开头的表
  （用 `npx prisma migrate status` 确认已应用）

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 搭起 AI 服务骨架与 ai_* 元数据表

- Next.js + TypeScript + Prisma + Vitest 骨架
- ai_conversation / ai_message / ai_pending_action / ai_audit_log /
  ai_entity_ref / ai_derived_state 六张表(单租户,无 tenant_id)
- 统一的 ApiResponse 信封与 isSuccess 判定(接受 code 0 与 200)
- 环境变量用 zod 校验,缺变量启动即失败
EOF
```

---

### Task 2: AiAdmin 客户端（token 透传 · 错误归一 · 分页）

**Files:**
- Create: `src/aadmin/client.ts`、`src/aadmin/errors.ts`、`src/aadmin/types.ts`
- Test: `src/aadmin/client.test.ts`

**Interfaces:**
- Consumes: `src/env.ts` 的 `env.AIADMIN_BASE_URL`；`src/types/api.ts` 的 `ApiResponse`、`isSuccess`
- Produces:
  ```ts
  // src/aadmin/errors.ts
  export type AdapterError =
    | { kind: 'NOT_FOUND' }
    | { kind: 'CONFLICT'; message?: string }
    | { kind: 'VALIDATION'; fields?: Record<string, string> }
    | { kind: 'RATE_LIMIT'; retryAfterMs?: number }
    | { kind: 'AUTH_EXPIRED' }
    | { kind: 'UNSUPPORTED'; capability: string }
    | { kind: 'UPSTREAM'; message: string; retryable: boolean };

  export class AdapterErrorException extends Error {
    constructor(public readonly kind: AdapterError['kind'], message?: string, public readonly fields?: Record<string,string>) { super(message ?? kind); }
  }

  // src/aadmin/client.ts
  export interface AadminClientOptions { baseUrl: string; fetchImpl?: typeof fetch; }
  export class AadminClient {
    constructor(opts: AadminClientOptions);
    get<T>(path: string, token: string, query?: Record<string, string|number|undefined>): Promise<T>;
    post<T>(path: string, token: string, body: unknown): Promise<T>;
    put<T>(path: string, token: string, body: unknown): Promise<T>;
    patch<T>(path: string, token: string, body: unknown): Promise<T>;
    delete<T>(path: string, token: string, body?: unknown): Promise<T>;
  }
  export function isRetryable(err: AdapterErrorException): boolean;
  ```

- [ ] **Step 1: 写失败的测试** —— `src/aadmin/client.test.ts`，用 `fetchImpl` 注入假 fetch：
  - `业务码 0 时返回 data` —— fetch 返回 `{ code: 0, msg: 'ok', data: { id: 7 } }` ⇒ `get` 返回 `{ id: 7 }`
  - `业务码非 0 时抛 VALIDATION` —— 返回 `{ code: 400, msg: '字段错误', data: { title: '不能为空' } }`
    ⇒ 抛 `AdapterErrorException`，`kind === 'VALIDATION'`，`fields.title === '不能为空'`
  - `HTTP 401 映射为 AUTH_EXPIRED` —— fetch 返回 401 ⇒ `kind === 'AUTH_EXPIRED'`
  - `HTTP 404 映射为 NOT_FOUND`；`HTTP 409 映射为 CONFLICT`；`HTTP 429 映射为 RATE_LIMIT`
  - `token 以 Authorization 头透传` —— 断言 fake fetch 收到的 `headers.Authorization === 'Bearer tkn'`
  - `写操作不自动重试` —— fetch 抛网络错误时，`post` **只调用一次** fetch

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/aadmin/client.test.ts`
  Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**
  - `src/aadmin/errors.ts`：按上面签名导出 `AdapterError` 与 `AdapterErrorException`。
  - `src/aadmin/client.ts`：
    - URL 拼接：`${baseUrl}${path}`，`path` 形如 `/pm_task/list`（**不含** `/api/v1`，
      因为 `env.AIADMIN_BASE_URL` 已经含 `/api/v1`）。
    - 查询串：`query` 里 `undefined` 的键**跳过**；其余 `encodeURIComponent`。
    - 响应处理：先看 HTTP status，再看 body 的业务码。
      HTTP 401/403 → `AUTH_EXPIRED`；404 → `NOT_FOUND`；409 → `CONFLICT`；429 → `RATE_LIMIT`；
      400/422 → `VALIDATION`（`fields` 从 body.data 取）；其余 5xx → `UPSTREAM`（`retryable: true`）。
      HTTP 2xx 但业务码非 0 ⇒ 按业务码映射（`10401`/`401` → `AUTH_EXPIRED`，
      其余 → `VALIDATION` 或 `UPSTREAM`，取不到就 `UPSTREAM` + `retryable: false`）。
    - **读操作重试 1 次**（仅 `UPSTREAM` 且 `retryable`）；**写操作绝不重试**。
    - `delete` 的 body 是**裸数组**（`[1,2]`），不是 `{ids}` —— 这一点与其他模块不同，
      在方法注释里写明。
  - `src/aadmin/types.ts`：放 AiAdmin PM 的出入参类型（`PmProjectOut`、`PmTaskOut`、
    `PmMilestoneOut`、`PmRiskOut` 及其 Create/Update），**字段逐字对齐后端 schema**。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): AiAdmin 客户端与错误归一

- 业务码 0/200 判成功,其余按 spec 的 7 种 AdapterError 归一
- token 以 Authorization 头透传,本服务不持有长期凭据
- 读操作遇可重试错误重试 1 次,写操作绝不重试
- 删除的请求体是裸数组(不是 { ids })
- PM 四个实体的出入参类型逐字对齐后端 schema
EOF
```

---

### Task 3: 适配层 DataSource（枚举映射 · 能力位 · 实体 CRUD）

**Files:**
- Create: `src/adapter/aadmin/enums.ts`、`src/adapter/aadmin/capabilities.ts`、
  `src/adapter/aadmin/datasource.ts`、`src/adapter/types.ts`
- Create: `tests/contract/fixtures.ts`
- Test: `src/adapter/aadmin/enums.test.ts`、`src/adapter/aadmin/datasource.test.ts`

**Interfaces:**
- Consumes: `AadminClient`（Task 2）
- Produces:
  ```ts
  // src/adapter/types.ts
  export type EntityType = 'PROJECT'|'MILESTONE'|'TASK'|'RISK';
  export type EntityKey = string;                 // 形如 'task:123'
  export interface UnifiedTask {
    key: EntityKey; project_key: string; milestone_key?: string; parent_key?: string;
    title: string; description?: string;
    type: 'FEATURE'|'BUG'|'OPS'|'RESEARCH'|'SPIKE';
    status: 'BACKLOG'|'TODO'|'IN_PROGRESS'|'REVIEW'|'DONE'|'BLOCKED'|'CANCELLED';
    priority: 'P0'|'P1'|'P2'|'P3';
    estimate_hours?: number; actual_hours?: number;
    assignee?: string; reporter?: string; reviewers: string[]; labels: string[];
    start_date?: string; due_date?: string;
    actual_start_date?: string; actual_end_date?: string;
    sort_order: number; source: 'MANUAL'|'NL_CHAT'|'IMPORT'|'API';
  }
  // 同理 UnifiedProject / UnifiedMilestone / UnifiedRisk

  // src/adapter/aadmin/enums.ts
  export function taskStatusToUnified(v: string): UnifiedTask['status'];   // 未命中 → 'TODO' + 记告警
  export function taskStatusFromUnified(v: UnifiedTask['status']): string;
  export function priorityToUnified(v: string): 'P0'|'P1'|'P2'|'P3';
  export function projectStatusToUnified(v: string): UnifiedProject['status'];
  export function milestoneStatusToUnified(v: string): UnifiedMilestone['status'];
  export function riskStatusToUnified(v: string): UnifiedRisk['status'];
  export function riskCategoryToUnified(v: string): UnifiedRisk['category'];
  export function riskLevelOf(score: number): 'SEVERE'|'HIGH'|'MEDIUM'|'LOW';
  export function typeToUnified(v: string): UnifiedTask['type'];
  export function sourceToUnified(v: string): UnifiedTask['source'];

  // src/adapter/aadmin/capabilities.ts
  export const CAPABILITIES: Capabilities;

  // src/adapter/aadmin/datasource.ts
  export class AadminDataSource {
    constructor(client: AadminClient);
    listTasks(q: TaskQuery): Promise<UnifiedTask[]>;
    getTask(key: EntityKey): Promise<UnifiedTask | null>;
    createTask(input: UnifiedTaskInput): Promise<UnifiedTask>;
    updateTask(key: EntityKey, patch: Partial<UnifiedTask>): Promise<UnifiedTask>;
    deleteTask(key: EntityKey): Promise<void>;
    listProjects(q: ProjectQuery): Promise<UnifiedProject[]>;
    getProject(key: EntityKey): Promise<UnifiedProject | null>;
    listMilestones(projectKey: EntityKey): Promise<UnifiedMilestone[]>;
    listRisks(q: RiskQuery): Promise<UnifiedRisk[]>;
    search(query: string, types?: EntityType[]): Promise<SearchHit[]>;
  }
  ```

**枚举映射表（照 spec §3.3，**实测值**）：**

| 统一 | AiAdmin 字典值 |
|---|---|
| project.status | `planning`/`active`/`on_hold`/`completed`/`cancelled`/`archived` |
| task.status | `backlog`/`todo`/`in_progress`/`blocked`/`review`/`done`/`cancelled` |
| task.priority | `P0`/`P1`/`P2`/`P3` |
| task.type | `feature`/`bug`/`ops`/`research`/`spike` |
| task.source | `manual`/`nl_chat`/`import`/`api` |
| milestone.status | `upcoming`/`in_progress`/`at_risk`/`done`/`missed`（**5 个，没有 cancelled**） |
| risk.status | `identified`/`analyzing`/`mitigating`/`realized`/`closed` |
| risk.category | `schedule`/`scope`/`quality`/`resource`/`compliance` |

- [ ] **Step 1: 写失败的测试**
  - `enums.test.ts`：
    - `taskStatusToUnified('in_progress') === 'IN_PROGRESS'`；
      `'todo'→'TODO'`；`'done'→'DONE'`；`'cancelled'→'CANCELLED'`
    - `taskStatusToUnified('unknown_code')` 返回默认 `'TODO'` **并且** 调用了告警回调
    - `taskStatusFromUnified('IN_PROGRESS') === 'in_progress'`
    - `milestoneStatusToUnified('at_risk') === 'AT_RISK'`；`'missed'→'MISSED'`
    - `riskLevelOf(16)==='SEVERE'`；`15→'HIGH'`；`8→'MEDIUM'`；`3→'LOW'`
    - `sourceToUnified('nl_chat')==='NL_CHAT'`；`'api'==='API'`
  - `datasource.test.ts`：注入 fake client（不碰网络）
    - `listTasks 把 status_code 归一成统一枚举`
    - `listTasks 把 tags 字符串(JSON)解成数组`
    - `listTasks 把 reviewers 字符串(逗号分隔 id)解成数组`
    - `updateTask 读-改-写：先 GET 再 PUT` —— 断言 PUT 的 body 含**所有**必填字段
    - `deleteTask 的请求体是裸数组`
    - `search 跨实体：项目/里程碑/任务各调一次 list 并汇总`

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/adapter`
  Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**
  - `enums.ts`：每对映射写成**两个方向的表**；未命中时归一为该字段的默认状态
    并 `console.warn` 一次（**不许猜语义**）。
  - `capabilities.ts`：
    ```ts
    export const CAPABILITIES: Capabilities = {
      supportsDelete: true, supportsBatchUpdate: false, supportsHistory: false,
      supportsCustomFields: true, supportsDependencyGraph: false,
      supportsComments: true, maxBatchSize: 100, rateLimitPerMinute: 60,
    };
    ```
    每条**注明实测依据**（哪个端点/哪张表）。
  - `datasource.ts`：
    - 实体 key 形如 `task:123`（`${type}:${externalId}`）。
    - `updateTask` 是**读-改-写**：先 `GET /pm_task/detail/:id`，合并 patch，再 `PUT /pm_task/update/:id`，
      body 含**全部**后端必填字段（后端更新 schema 继承创建 schema，没有 PATCH）。
    - `listTasks` 的筛选**在客户端做**（后端查询参数只有单值 eq/like，没有范围与多值），
      分页上限 100（后端约束）。
    - `deleteTask`：`DELETE /pm_task/delete`，body 是**裸数组** `[id]`。
    - `search`：分别 list 三类实体，在**标题/名称**上做包含匹配。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 适配层 DataSource 与枚举归一

- 枚举映射按后端字典的实测值写死,双向;未命中归一为默认并告警,不猜语义
- 能力位按实测声明:无批量更新、无历史版本、无依赖图
- 任务更新是读-改-写(后端无 PATCH,更新 schema 继承创建 schema)
- 任务筛选在客户端做(后端查询参数无范围无多值)
- 删除请求体是裸数组
EOF
```

---

### Task 4: 写前快照 · 补偿式撤销 · 冲突检测

**Files:**
- Create: `src/adapter/snapshot.ts`、`src/audit/writer.ts`
- Test: `src/adapter/snapshot.test.ts`、`src/audit/writer.test.ts`

**Interfaces:**
- Consumes: `AadminDataSource`（Task 3）、`prisma`（Task 1）
- Produces:
  ```ts
  // src/adapter/snapshot.ts
  export type Snapshot = Record<string, { before: unknown; after: unknown }>;
  export async function withSnapshot<T>(
    source: AadminDataSource, command: string, userId: string,
    target: { type: EntityType; key: EntityKey },
    mutate: () => Promise<T>,
  ): Promise<{ result: T; before: Snapshot; after: Snapshot }>;

  // src/audit/writer.ts
  export async function writeAudit(entry: {
    userId: string; actorType: 'USER'|'AI'; command: string; args: unknown;
    beforeSnapshot?: Snapshot; afterSnapshot?: Snapshot; undoOf?: string;
    adopted?: boolean; model?: string; tokens?: number; latencyMs?: number;
    traceId?: string; error?: string;
  }): Promise<string>;   // 返回 audit id
  ```

- [ ] **Step 1: 写失败的测试**
  - `snapshot.test.ts`：
    - `写前先读一次旧值` —— 断言 mutate 之前已经发生过一次 GET
    - `快照只存被改字段的差异` —— 断言 snapshot 的键**只有** patch 涉及的字段
    - `写后再读一次核对` —— 断言 mutate 之后还有一次 GET
    - `写后核对不一致时记 error` —— 假 GET 返回不同的值 ⇒ 审计的 `error` 字段非空
    - `撤销用旧值写回去`
    - `冲突时拒绝覆盖`：当前值 ≠ after_snapshot ⇒ 抛 `CONFLICT`，**不发任何写请求**
    - `补偿逐条独立`：3 条补偿里第 2 条失败 ⇒ 第 1、3 条**已经补偿**，结果逐条报告
  - `writer.test.ts`：
    - `写审计把 args 里的 token 脱敏` —— args 含 `authorization`/`token` 字段 ⇒ 落库值里不含原值

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/adapter/snapshot.test.ts`
  Expected: FAIL

- [ ] **Step 3: 实现**
  - `snapshot.ts`：`withSnapshot` 按签名实现；快照只存**被改字段**的 before/after。
  - `writer.ts`：`writeAudit` 落 `ai_audit_log`；**脱敏**规则：键名含
    `token`/`authorization`/`password`/`secret` 的值替换成 `'[redacted]'`；
    审计写失败时**重试 3 次**，仍失败则抛错（调用方决定是否降级）。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 写前快照与补偿式撤销

- 写前 GET 存字段级差异,写后 GET 核对
- 撤销前做冲突检测:当前值与 after_snapshot 不一致则拒绝覆盖
- 补偿逐条独立,部分失败逐条报告
- 审计落库,args 里的 token/密码类字段脱敏
EOF
```

---

### Task 5: 规则引擎（纯函数）

**Files:**
- Create: `src/rule-engine/date-ref.ts`、`src/rule-engine/health.ts`、
  `src/rule-engine/progress.ts`、`src/rule-engine/risk-matrix.ts`、
  `src/rule-engine/risk-detect.ts`、`src/rule-engine/eta.ts`、`src/rule-engine/index.ts`
- Test: `src/rule-engine/*.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，不依赖 DB 与网络）
- Produces:
  ```ts
  // date-ref.ts
  export type DateRef = string;   // "2026-03-16" | "next-monday" | "this-week" | "+3d" | "today"
  export function parseDateRef(ref: DateRef, now: Date): { start: Date; end: Date } | { date: Date };
  export function thisWeekRange(now: Date): { start: Date; end: Date };  // 周一 00:00 ~ 周日 23:59:59.999, Asia/Shanghai, 闭区间

  // health.ts
  export function milestoneHealth(input: {
    tasks: { status: string; actual_end_date?: string; blocked_since?: string }[];
    due_date: string; today: string;
  }): { level: 'OK'|'AT_RISK'|'MISSED'; reason: string; progress: number; days_left: number; velocity: number; required_rate: number; blocked_days: number };

  // progress.ts
  export function projectProgress(tasks: { status: string; estimate_hours?: number; actual_hours?: number }[], milestones: { status: string; due_date: string }[], today: string): {
    task_done_rate: number; estimate_done_rate: number; milestone_done_rate: number; health: 'RED'|'YELLOW'|'GREEN';
  };

  // risk-matrix.ts
  export function riskLevel(score: number): 'SEVERE'|'HIGH'|'MEDIUM'|'LOW';

  // risk-detect.ts
  export function detectRisks(input: { milestones: HealthInput[]; tasks: TaskRiskInput[]; assignees: AssigneeLoad[]; originalEstimate: number; newEstimate: number; today: string }): RiskSuggestion[];

  // eta.ts
  export function predictEta(input: { tasks: { status: string; actual_end_date?: string; estimate_hours?: number }[]; today: string }): { predicted_end_date: string; confidence: 'LOW'|'MEDIUM'|'HIGH'; explanation_data: { velocity_per_day: number; remaining_estimate: number; days_needed: number } };
  ```
  **注意：`eta.ts` **不产出** P50/P90**（后端无依赖图，CPM 不可用）。

- [ ] **Step 1: 写失败的测试** —— 每一族都要覆盖：
  - `date-ref.test.ts`：`this-week` 在 `2026-03-18`（周三）⇒ 起点 `2026-03-16`（周一）00:00、
    终点 `2026-03-22`（周日）23:59:59.999；`next-monday` 在周三 ⇒ `2026-03-23`；
    `+3d`；绝对日期原样返回；非法值抛错
  - `health.test.ts`：进度 0.3 且剩余 10 天 ⇒ `AT_RISK`，reason 里含「进度」；
    速度比 < 0.8 ⇒ `AT_RISK`；有阻塞 5 天的任务 ⇒ `AT_RISK`；已逾期且未完成 ⇒ `MISSED`
  - `progress.test.ts`：任务完成率**分母排除 CANCELLED**；估时完成率分母为 0 ⇒ 用项目均值兜底
  - `risk-matrix.test.ts`：16/15/8/3 四个边界
  - `risk-detect.test.ts`：五类各一个正例；正例不触发时返回空数组
  - `eta.test.ts`：**结果里没有 p50/p90 字段**（用 `expect(result).not.toHaveProperty('p50')` 钉死）

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/rule-engine` → Expected: FAIL

- [ ] **Step 3: 实现** —— 照 AIPM 02 §5 的公式逐条实现；**所有输入用 `today` 参数传入**，
  不在函数里调 `new Date()`（否则不可测）。周起点与时区固定 Asia/Shanghai。
  `eta.ts` 只用 burndown 外推。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 规则引擎

- 相对日期解析:周起点周一、Asia/Shanghai、闭区间
- 里程碑健康度、进度三口径、风险等级矩阵、五类候选风险
- ETA 只用 burndown 外推(不产出 P50/P90,后端无依赖图)
- 全部为纯函数,today 由参数传入
EOF
```

---

### Task 6: 命令目录（tool 定义 · 确认门槛）

**Files:**
- Create: `src/tools/types.ts`、`src/tools/registry.ts`、`src/tools/tasks.ts`、
  `src/tools/projects.ts`、`src/tools/milestones.ts`、`src/tools/risks.ts`、
  `src/tools/insights.ts`
- Test: `src/tools/registry.test.ts`

**Interfaces:**
- Consumes: `AadminDataSource`（Task 3）、`withSnapshot`（Task 4）、规则引擎（Task 5）
- Produces:
  ```ts
  // src/tools/types.ts
  export interface ToolContext {
    source: AadminDataSource; userId: string; token: string;
    conversationId: string;
    requestConfirmation: (req: ConfirmationRequest) => Promise<ConfirmationDecision>;
  }
  export interface ConfirmationRequest {
    command: string; args: unknown;
    preview: { title: string; hits: { title: string; from: string; to: string; owner?: string }[]; warning?: string };
  }
  export type ConfirmationDecision = { decision: 'confirm' } | { decision: 'reject' } | { decision: 'adjust'; args: unknown };
  export interface CommandTool {
    name: string; label: string; description: string;
    parameters: unknown;                       // pi SDK 的 TypeBox schema
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
    requiresConfirmation(args: unknown): boolean;
    execute(args: any, ctx: ToolContext): Promise<{ summary: string; details: unknown; auditId?: string }>;
  }
  // src/tools/registry.ts
  export function buildRegistry(deps: { source: AadminDataSource }): CommandTool[];
  export function requiresConfirmation(command: string, args: unknown): boolean;  // 静态 + 动态
  export const DESTRUCTIVE_DATE_THRESHOLD_DAYS = 3;
  ```

**确认门槛（照 AIPM 04 §3，**判定在两处**：静态 `destructiveHint` + 动态 `requiresConfirmation`）：**

| 情形 | 需确认 |
|---|---|
| 只读命令 | 否 |
| 新建实体 | 否 |
| 改 title/description/priority/assignee/估时/milestone 归属 | 否 |
| `status` → `CANCELLED` | **是** |
| 改 due_date 变化 **> 3 天** | **是** |
| 任何 `batch_*` | **是** |
| 删除 | **是** |
| 拆分 `split_*` | **是** |
| 改 risk 的 probability/impact（**含降级**） | **是** |
| risk → `CLOSED` | **是** |
| 里程碑 → `DONE` | **是** |
| 跨项目写操作 | **是** |

- [ ] **Step 1: 写失败的测试** —— `registry.test.ts`：
  - `注册的命令名唯一`
  - `只读命令不需要确认`
  - `删除需要确认`
  - `批量命令需要确认`
  - `改期 3 天以内不需要确认，超过 3 天需要`
  - `风险降级需要确认（probability 下降也算）`
  - `风险升到 CLOSED 需要确认`
  - `不注册依赖相关命令` —— 断言 `buildRegistry` 的名字里**没有** `add_task_dependency`
  - `工具描述里不出现外部字段名` —— 断言所有 tool 的 `description` **不含** `status_code`、
    `project_id`、`dict_type`（只能用统一模型的名字）

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/tools` → Expected: FAIL

- [ ] **Step 3: 实现**
  - 命令清单照 AIPM 04 §2，但**去掉** `add_task_dependency` / `remove_task_dependency`
    （后端无依赖图接口，见 spec §9.1.1）。
  - `split_task` / `split_milestone` / `split_milestone_into_tasks` **要实现**：
    后端有创建与删除端点，拆分 = 「创建 N 个 + 处理原实体」，撤销 = 「删新建的 + 恢复原实体」
    （AIPM 04 §5 的撤销矩阵）。三者都属**破坏性操作**，需确认。
  - `batch_update_tasks`：**先全部读、再全部写**，逐条结果。
  - 每个 tool 的 `description` 写三件事：什么时候用我、什么时候别用我（点名替代命令）、
    参数格式与单位。**不能出现外部 API 的字段名**。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 命令目录与确认门槛

- 工具名唯一,只注册业务命令
- 确认判定在两处:静态 destructiveHint + 动态 requiresConfirmation
- 改期超过 3 天、批量、删除、拆分、风险升降级、里程碑完成、跨项目写都要确认
- 不注册依赖相关命令(后端无依赖图接口)
- 工具描述里只用统一领域模型的名字,不含外部字段名
EOF
```

---

### Task 7: 待确认（PendingAction 状态机 · 预览）

**Files:**
- Create: `src/pending/store.ts`、`src/pending/service.ts`
- Test: `src/pending/service.test.ts`

**Interfaces:**
- Consumes: `prisma`（Task 1）、`CommandTool`（Task 6）
- Produces:
  ```ts
  // src/pending/service.ts
  export class PendingService {
    constructor(prisma: PrismaClient);
    create(input: { conversationId: string; userId: string; command: string; args: unknown; preview: unknown; ttlMinutes?: number }): Promise<{ id: string; expiresAt: Date }>;
    get(id: string): Promise<PendingActionRecord | null>;
    listByUser(userId: string, status?: PendingStatus): Promise<PendingActionRecord[]>;
    resolve(id: string, decision: 'confirm'|'reject', userId: string): Promise<{ status: PendingStatus }>;
    adjust(id: string, args: unknown, userId: string): Promise<{ id: string; expiresAt: Date }>;  // 旧记录置 EXPIRED,新建
    expireStale(now: Date): Promise<number>;
  }
  export type PendingStatus = 'PENDING'|'CONFIRMED'|'REJECTED'|'EXPIRED'|'EXECUTED';
  export interface PendingActionRecord { id: string; command: string; args: unknown; preview: unknown; status: PendingStatus; expiresAt: Date; }
  ```

- [ ] **Step 1: 写失败的测试**
  - `创建时状态是 PENDING,过期时间是现在 +30 分钟`
  - `过期后确认被拒绝` —— 把 `expiresAt` 改成过去 ⇒ `resolve` 返回 `EXPIRED` 且**不执行**
  - `只有 PENDING 能转 CONFIRMED` —— 已 `REJECTED` 的再确认 ⇒ 拒绝
  - `同一 actionId 重复确认只执行一次`（幂等）—— 连续两次 `resolve('confirm')`，
    第二次返回**同一个**状态且**不重复产生副作用**
  - `调整范围会新建一条并把旧记录置 EXPIRED`
  - `expireStale 把过期的 PENDING 置 EXPIRED`
  - `预览里的警告来自规则,不是模型` —— 断言 preview.hits 里的 from/to 是**算出来的**旧值新值

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/pending` → Expected: FAIL

- [ ] **Step 3: 实现** —— 状态机严格按上面的枚举；`resolve` 用
  `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CONFIRMED' } })`
  做乐观并发（**只有一条能改成**），靠 `count === 1` 判定「我是第一个」——
  这是幂等的关键。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 待确认队列的状态机

- 状态:PENDING/CONFIRMED/REJECTED/EXPIRED/EXECUTED
- 用条件更新做乐观并发,同一 actionId 重复确认只执行一次
- 过期后拒绝执行;调整范围新建一条并把旧记录置 EXPIRED
- 预览里的命中清单与警告来自规则引擎
EOF
```

---

### Task 8: Agent 运行时（pi SDK · 会话 · 启动锁）

**Files:**
- Create: `src/agent/session-registry.ts`、`src/agent/startup-lock.ts`、
  `src/agent/runtime.ts`、`src/agent/prompt.ts`
- Test: `src/agent/startup-lock.test.ts`、`src/agent/session-registry.test.ts`

**Interfaces:**
- Consumes: `buildRegistry`（Task 6）、`PendingService`（Task 7）
- Produces:
  ```ts
  // src/agent/startup-lock.ts
  export class StartupLock {
    run<T>(key: string, fn: () => Promise<T>): Promise<T>;  // 同 key 串行,排队不报错
  }
  // src/agent/session-registry.ts
  export class SessionRegistry {
    get(conversationId: string): AgentSession | undefined;
    async ensure(conversationId: string, deps: RuntimeDeps): Promise<AgentSession>;
    close(conversationId: string): void;
    stats(): { starts: number; firstStartedAt?: string; lastStartedAt?: string; lastClosedAt?: string };
  }
  // src/agent/runtime.ts
  export interface RuntimeDeps {
    source: AadminDataSource; prisma: PrismaClient; pending: PendingService;
    model: string; token: string; userId: string; conversationId: string;
    onEvent: (event: AgentEvent) => void;
  }
  export type AgentEvent =
    | { type: 'message_start'; message: unknown }
    | { type: 'text_delta'; delta: string }
    | { type: 'thinking_delta'; delta: string }
    | { type: 'message_end'; message: unknown }
    | { type: 'tool_call'; toolName: string; args: unknown }
    | { type: 'tool_result'; toolName: string; status: 'ok'|'error'; summary: string; auditId?: string; details?: unknown }
    | { type: 'action_request'; actionId: string; command: string; preview: unknown; expiresAt: string }
    | { type: 'action_resolved'; actionId: string; decision: string; result?: unknown }
    | { type: 'state_dirty'; entities: string[] }
    | { type: 'agent_settled' }
    | { type: 'auth_expired' }
    | { type: 'heartbeat' };
  export function createRuntime(deps: RuntimeDeps): Promise<AgentSession>;
  ```

- [ ] **Step 1: 写失败的测试**
  - `startup-lock.test.ts`：
    - `同一个 key 的两次调用串行执行` —— 断言第二个在第一个之后才开始
    - `不同 key 可以并行`
    - `前一个失败不影响后一个`
  - `session-registry.test.ts`：
    - `同一个 conversationId 复用同一个 session`
    - `close 后 stats 的 lastClosedAt 被更新`
    - `上限 1000 条,超出后回收最久未用的`
  - `runtime.test.ts`（用假 session，不真调模型）：
    - `只注册业务命令,不带 coding 工具` —— 断言传给 SDK 的 `tools` 是 `[]`
    - `工具执行失败时抛错而不是静默成功`
    - `工具返回的 details 是结构化的`

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/agent` → Expected: FAIL

- [ ] **Step 3: 实现**
  - pi SDK 用法照 AIPM 01 §3.3：
    ```ts
    const { session } = await createAgentSession({
      tools: [],                       // 不启用任何内置工具
      customTools: ourCommandTools,    // 只注册业务命令
      resourceLoader: new DefaultResourceLoader({ extensionFactories: [ourExtension] }),
      model: deps.model,
      sessionManager: SessionManager.inMemory(),
      systemPrompt: PM_AGENT_PROMPT,
    });
    ```
  - `systemPrompt` 里写清边界：**LLM 不能写库、不能定权限、不能自己决定要不要人确认**；
    日期参数用 `DateRef` 交给后端解析。
  - 危险命令在 `execute()` 内**第一件事**是求预览并 `await ctx.requestConfirmation(...)`，
    **不许先执行再问**。
  - `StartupLock` 用 `Map<string, Promise>` 排队，**不报错**。
  - `SessionRegistry` 的容量上限 1000。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): agent 运行时

- pi SDK 同进程 SDK,tools 为空只注册业务命令
- 会话注册表(上限 1000)与启动锁(同会话串行,排队不报错)
- 危险命令在 execute 内第一件事就是求预览并挂起等待确认
- 事件类型覆盖 AIPM 03 的事件表,外加 auth_expired
EOF
```

---

### Task 9: HTTP 接口层（Route Handlers · CORS · SSE）

**Files:**
- Create: `src/app/api/agent/[conversationId]/command/route.ts`
- Create: `src/app/api/agent/[conversationId]/events/route.ts`
- Create: `src/app/api/agent/[conversationId]/state/route.ts`
- Create: `src/app/api/agent/conversations/route.ts`
- Create: `src/app/api/pending/route.ts`、`src/app/api/pending/[id]/adjust/route.ts`
- Create: `src/app/api/audit/route.ts`、`src/app/api/audit/[id]/undo/route.ts`
- Create: `src/http/cors.ts`、`src/http/sse.ts`、`src/http/envelope.ts`
- Test: `src/http/cors.test.ts`、`src/http/sse.test.ts`

**Interfaces:**
- Consumes: `SessionRegistry` / `StartupLock`（Task 8）、`PendingService`（Task 7）、`writeAudit`（Task 4）
- Produces（**这就是前端要消费的契约，spec 已钉死**）：

```
POST /api/agent/conversations           → { code:0, msg, data: { conversationId, title, createdAt } }
GET  /api/agent/conversations?limit=50   → { code:0, msg, data: [{ conversationId, title, updatedAt }] }
POST /api/agent/:cid/command             → { code:0, msg, data: { id, type:'response', command, success, data } }
GET  /api/agent/:cid/events              → SSE(text/event-stream)
GET  /api/agent/:cid/state               → { code:0, msg, data: { conversation, messages[], pendingActions[], isStreaming, model, thinkingLevel } }
GET  /api/pending?status=PENDING         → { code:0, msg, data: PendingActionRecord[] }
POST /api/pending/:id/adjust { args }    → { code:0, msg, data: { id, expiresAt } }
GET  /api/audit?actor=&command=&from=&to=&undone= → { code:0, msg, data: AuditRow[] }
POST /api/audit/:id/undo                 → { code:0, msg, data: { ok, failed, results: [{ key, ok, error? }] } }
```

- [ ] **Step 1: 写失败的测试**
  - `cors.test.ts`：
    - `Origin 不在白名单时不回 Allow-Origin`（**不能用 `*`**）
    - `预检请求回 Allow-Headers 含 authorization`
    - `预检的 Access-Control-Max-Age 不超过 300`
  - `sse.test.ts`：
    - `connected 帧带 isStreaming 与 pendingActionIds`
    - `心跳间隔 15 秒`
    - `事件带自增 seq`（前端据此检测丢帧）
    - `断开后清理订阅`

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/http` → Expected: FAIL

- [ ] **Step 3: 实现**
  - `cors.ts`：白名单来自 `env.ALLOWED_ORIGINS`；`OPTIONS` 直接 204；
    `Access-Control-Allow-Origin` 回**具体源**并加 `Vary: Origin`；
    `Access-Control-Allow-Headers: authorization, content-type`；
    `Access-Control-Max-Age: 300`。
  - `sse.ts`：`ReadableStream` 写帧；首帧 `connected`（含 `pendingActionIds` 与 `isStreaming`）；
    15 秒心跳；每帧带 `seq`；backlog 上限 16MB（超限时**丢弃可重建的增量帧**
    —— `text_delta`/`thinking_delta`，保留结构性事件）。
  - `envelope.ts`：统一 `{ code, msg, data }`；成功 `code: 0`。
  - **鉴权**：每个接口从 `Authorization: Bearer <token>` 取**用户的** token，
    透传给 AiAdmin；**服务端不解析 token 内容**（AiAdmin 才是权威）。
    token 缺失 ⇒ 401 信封。
  - **路由前缀**：本服务用 Next.js App Router 的 `app/api/...` ⇒ **路径前缀是 `/api`**。
    前端通过 `AI_API_BASE_URL`（如 `https://ai.example.com`）指向本服务，
    最终 URL = `${AI_API_BASE_URL}/api/agent/...`。
    ⇒ **前端不要自己拼 `/ai-api`**。这一条要写进 README，避免前端拼错。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 端到端手工验证** —— 起服务 `npm run dev`，用 `curl -N` 连
  `GET /api/agent/<cid>/events`，确认能收到 `connected` 帧；
  再 `POST` 一条 `prompt` 命令，确认事件流里出现 `tool_call`。
  记下实际输出到本任务的报告里。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): HTTP 接口层与 SSE

- Route Handlers:命令/事件/状态/会话/待确认/调整/审计/撤销
- CORS:白名单校验具体 Origin,不能用 *,预检缓存 300 秒
- SSE:首帧带 isStreaming 与 pendingActionIds,15 秒心跳,事件带自增 seq
- backlog 上限 16MB,超限丢弃可重建的增量帧
- 统一 { code, msg, data } 信封,成功码 0
EOF
```

---

## 完成判据

- [ ] `npx vitest run` 全绿
- [ ] `npx tsc --noEmit` 干净
- [ ] `npx prisma migrate status` 显示已应用
- [ ] `npm run dev` 能起，`curl -N` 能收到 SSE 首帧
- [ ] README 写清：环境变量、怎么起、契约清单（前端按它写 client）

## 后续（不在本计划内）

- **Plan C = 前端 AI 工作台**（F1/F2）：本计划的契约落地后即可开工，
  见 [`2026-11-03-aipm-frontend-design.md`](../specs/2026-11-03-aipm-frontend-design.md) §3。
- 飞书机器人、向量检索、多租户：spec 已定 v1 不做。
