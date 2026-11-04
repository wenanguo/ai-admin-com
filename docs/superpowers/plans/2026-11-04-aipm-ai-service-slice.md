# AI 服务垂直切片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 AI 服务的**可运行骨架**，让「用一句话建一个任务」这条链路端到端跑通 ——
前端发一句话 → agent 解析成命令 → 适配层调 AiAdmin 的 PM API 真的建出任务 → 结果流回前端。

**Architecture:** 一个独立的 Node 进程（Next.js Route Handlers），进程内跑 pi agent
（同进程 SDK），agent 只注册业务命令工具；工具一律经**适配层**访问 AiAdmin 的 PM API
（转发，不直连数据库）；AI 侧的元数据（会话、消息、审计）落 AiAdmin 同库的 `ai_*` 表。

**Tech Stack:** Node ≥ 20 · Next.js 15（App Router / Route Handlers）· TypeScript ·
`@earendil-works/pi-coding-agent`（pi SDK）· Prisma + MySQL · Vitest

**Spec:** `docs/superpowers/specs/2026-11-03-aipm-merge-design.md`（架构与裁决）
· `docs/superpowers/specs/2026-11-03-aipm-frontend-design.md`（前端侧契约）
· 上游 AIPM 设计 `docs/aipm/docs/{02,03,04,05,06}-*.md`

**关系：** 这是 [完整版 AI 服务计划](2026-11-03-aipm-ai-service.md)（9 个任务）的**垂直切片**。
完整版的 Task 4（撤销）、Task 5（规则引擎）、Task 7（待确认队列）、Task 6 的其余 ~39 个命令、
以及前端侧栏的「待确认 / 审计」两个页签，**都在切片之外**，后续按完整版计划补齐。
切片的产物**不是临时代码** —— 目录结构、接口契约、表结构与完整版一致。

---

## Global Constraints

- **仓库**：`D:/project/ai-admin-ai`（已 `git init`，`.env` 已就位且 **不入库**）。
- **`.env` 里的变量**（已写好，**不要打印 key 的值**）：
  | 变量 | 值 |
  |---|---|
  | `MINIMAX_CN_API_KEY` | 复用 pi harness 的 `~/.pi/agent/auth.json` 里 `minimax-cn` 的 key |
  | `AI_MODEL` | `minimax-cn/MiniMax-M3.1-Flash` |
  | `AIADMIN_BASE_URL` | `https://www.pmdict.cn/api/v1` |
  | `DATABASE_URL` | `mysql://root:<密码>@115.191.17.4:3306/aipm`（密码来自后端 `env/.env.prod`） |
  | `PORT` | `3100` |
  | `ALLOWED_ORIGINS` | `http://localhost:8000,http://127.0.0.1:8000` |
- **事实源是 AiAdmin（FastAPI）**，`D:/project/AiAdmin/backend` **只读**。
- **接口前缀是两段的插件路径** —— 见下方「必须照抄的路径」。写错就是 404，而且**很容易写错**
  （前端刚踩过这个坑）。
- **用户身份透传**：调 AiAdmin 时带**调用方的** `Authorization: Bearer <token>`；
  本服务**不持有任何长期凭据**，不落盘 token，不把 token 写进日志。
- **数据库**：MySQL，与 AiAdmin 同库（`aipm`），表前缀 `ai_`；**单租户**（无 `tenant_id`）。
  ⚠️ 库里已有一张**后端遗留的空表** `ai_action_log`（PRD-v2 §7 的 AI 操作记录，源码里没有
  对应 model）—— **不要动它**，也别和本服务的表重名。
- **成功判定**：AiAdmin 的业务码 `code === 0`（也接受 `200`）。
- **写操作**：一律经适配层；**写前必须 GET 一次**存字段级差异（写前快照）。
- **测试**：Vitest。**每个任务自带测试循环**，TDD。
- **提交**：中文提交信息；subject 不得以大写拉丁词开头；多行用 `git commit -F <file>`。
- **不要 push**（除非计划明确要求）。

---

## 实测约束（Task 1 尖峰的结论，**优先于 AIPM 文档**）

尖峰报告在 `D:/project/ai-admin-ai/spike/FINDINGS.md`。以下几条与 AIPM 01 §3.2/§3.3 的
**设计意图不符**，本计划的实现**一律以实测为准**：

| 事项 | AIPM 文档写的 | **实测（照这个写）** |
|---|---|---|
| 注册工具 | `tools: []` 表示不启用内置工具 | ❌ `tools: []` 是**白名单**，会把自定义工具一起关掉。用 `noTools: "builtin"`（或白名单列自己的工具名） |
| 工具定义 | `defineTool({name, description, parameters, execute})` | 多一个**必填 `label`**；typebox 包名是 **`typebox`**（不是 `@sinclair/typebox`），且要写成直接依赖 |
| `execute` 签名 | `(args, ctx)` | **`(toolCallId, params, signal, onUpdate, ctx)`**，五参 |
| 模型 | `model: "minimax-cn/MiniMax-M3.1-Flash"`（字符串） | `model` 必须是**对象**：`modelRuntime.getModel("minimax-cn", "MiniMax-M3.1-Flash")` |
| system prompt | `createAgentSession({ systemPrompt })` | 属于 **`new DefaultResourceLoader({ systemPrompt })`**（它会在末尾追加 `\n\n<cwd>…</cwd>`） |
| 人工确认 | `ctx.ui.confirm()` 走 extension_ui 桥 | ❌ 服务端 `ctx.hasUI === false`，`ctx.ui.confirm()` **立即返回 false**。待确认只能走 **`pi.on("tool_call")` 返回 `{ block: true, reason }`** |
| 打包 | — | pi SDK 必须进 Next.js 的 **`serverExternalPackages`** |
| 并发 | 设计里有启动锁 | 流式中再 `prompt()` 会抛 `Agent is already processing` ⇒ **启动锁是必须的**（可选 `streamingBehavior: 'steer'/'followUp'`） |
| Prisma | — | **必须钉 `prisma@6.19.1` / `@prisma/client@6.19.1`**（npm latest 是 8.0.0-rc，CLI 全换） |
| 建表 | `prisma migrate dev` | ❌ **绝对不能用**：它会把共享库 `aipm` 判为 drift 并要求 reset（= DROP 56 张表，含 AiAdmin 业务表）。安全流程见下 |

**建表流程（共享库专用）**：

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/init.sql
# 人工审一遍 SQL（它只含本次的 5 张 ai_ 表）
npx prisma db execute --schema prisma/schema.prisma --file /tmp/init.sql
npx prisma migrate resolve --applied 0_init_ai_tables
# 之后的后续迁移走 npx prisma migrate deploy（不做 drift 检查）
```

**MySQL**：`lower_case_table_names = 1` ⇒ 表名一律**小写** `ai_*`（本来就小写，无影响）。

---

## 必须照抄的路径（实测自线上后端的 OpenAPI）

**插件路由有两段前缀** —— 后端的 `app/core/discover.py` 给插件目录加一段，再叠上 controller
自己声明的 `prefix=`，所以完整路径是两者拼接。前端踩过一次这个坑（全部 404，而 e2e 因为
mock 了同样的错路径而全绿）。

| 用途 | 路径 |
|---|---|
| 项目列表 | `GET /pm_project/pm_project/list` |
| 项目详情 | `GET /pm_project/pm_project/detail/{id}` |
| 建项目 | `POST /pm_project/pm_project/create` |
| 里程碑列表 | `GET /pm_project/pm_milestone/list` |
| 任务列表 | `GET /pm_project/pm_task/list` |
| 建任务 | `POST /pm_project/pm_task/create` |
| 任务详情 | `GET /pm_project/pm_task/detail/{id}` |
| 风险列表 | `GET /pm_risk/pm_risk/list` |
| 字典项 | `GET /system/dict/data/info/{dictType}` |

**权威来源**：线上后端的 OpenAPI —— `curl -s https://www.pmdict.cn/api/v1/openapi.json`。
**动手前先读它**，不要凭记忆写路径。

## 建任务的必填字段（后端 `ModulePmTaskCreateSchema` + 模型）

必填：`project_id`、`title`、`type_code`、`status_code`、`priority_code`，
以及三列 **NOT NULL 且 schema 标了必填**的：`reporter_id`、`sort_order`、`created_via_code`
（`sort_order` 传 `0`，`created_via_code` 传 `'manual'`）。
⚠️ 后端的 `create_service` **没有实现** schema 注释里承诺的自动填充 —— 这三个字段**必须由调用方给**。

---

### Task 1: 风险尖峰（三个不确定点一次验掉）

**Files:**
- Create: `D:/project/ai-admin-ai/spike/`（三个独立脚本 + 一份 `FINDINGS.md`）
- Create: `D:/project/ai-admin-ai/package.json`（最小依赖，只为跑尖峰）

**Interfaces:**
- Consumes: `.env`（已在）
- Produces: `spike/FINDINGS.md` —— 三个问题的**结论 + 可复现的命令与输出**

**要验的三件事**（每件都要在报告里给出**命令 + 实际输出**）：

1. **pi SDK 能不能在 Next.js 的 Route Handler 里跑？**
   - 在一个最小的 Route Handler 里 `createAgentSession({ tools: [], customTools: [一个只回显的
     tool], model: 'minimax-cn/MiniMax-M3.1-Flash' })`，发一条 prompt，拿到回复。
   - **必须真的调一次模型**（用 `.env` 的 key）—— 「能 import」不等于「能跑」。
   - 记录：SDK 的实际 API 形状（`createAgentSession` 的参数名、`customTools` 的定义方式、
     `execute` 的签名、事件订阅方式）。**AIPM 01 §3.2 的表格是设计意图，不是实测** ——
     以你跑出来的为准，与设计不符就在报告里点名。
2. **Route Handler 能不能流式输出 SSE？**
   - 一个 `GET /api/spike/sse` 路由，用 `ReadableStream` 每秒推一帧，前端用 `fetch` 读。
   - 记录：能不能流、能不能中途断开、`Content-Type` 是什么。
3. **Prisma 能不能连上这个 MySQL 并建表？**
   - `prisma migrate dev` 建一张测试表，再 `migrate reset` 删掉。
   - 记录：连接串对不对、Prisma 版本、MySQL 版本。

**这三个结论决定后面怎么写。** 特别是第 1 条：如果 SDK 的真实 API 与 AIPM 01 §3.2 不一致，
**Task 4 的实现要按实测的来**，并在报告里说明差异。

- [ ] **Step 1: 写尖峰脚本**（三个独立脚本，各自可单独 `node`/`tsx` 跑）
- [ ] **Step 2: 逐个跑，把命令与输出记进 `spike/FINDINGS.md`**
- [ ] **Step 3: 提交**

```bash
git add -A && git commit -F - <<'EOF'
spike(ai): 验三个不确定点

- pi SDK 能不能在 Next.js Route Handler 里跑(真调一次模型)
- Route Handler 能不能流式输出 SSE
- Prisma 能不能连上 AiAdmin 同库的 MySQL 并建表

结论与可复现的命令输出见 spike/FINDINGS.md。
EOF
```

---

### Task 2: 仓骨架 · Prisma · ai_* 表

**Files:**
- Create: `package.json`、`tsconfig.json`、`next.config.ts`、`vitest.config.ts`、
  `.gitignore`、`.env.example`、`README.md`
- Create: `prisma/schema.prisma`
- Create: `src/env.ts`、`src/db.ts`、`src/types/api.ts`
- Test: `src/env.test.ts`

**Interfaces:**
- Consumes: Task 1 的尖峰结论（尤其 Prisma 的实际行为）
- Produces:
  ```ts
  // src/env.ts
  export const env: {
    MINIMAX_CN_API_KEY: string; AI_MODEL: string; AIADMIN_BASE_URL: string;
    DATABASE_URL: string; PORT: number; ALLOWED_ORIGINS: string[];
  };
  // 缺变量时启动即失败并说清缺哪个
  // src/db.ts
  export const prisma: PrismaClient;   // 单例（dev 热重载不泄漏连接）
  // src/types/api.ts
  export interface ApiResponse<T> { code: number; msg: string; data: T }
  export const SUCCESS_CODES = [0, 200];
  export function isSuccess(body: unknown): boolean;
  ```

**Prisma 模型（照 AIPM 02 §1，**单租户、无 `tenant_id`**）：**

```
ai_conversation   id, userId, projectRef?, channel(WEB), title?, createdAt, updatedAt
ai_message        id, conversationId, role(USER|ASSISTANT|SYSTEM), content, toolCalls(json), seq, createdAt
ai_pending_action id, conversationId?, userId, command, args(json), preview(json),
                  status(PENDING|CONFIRMED|REJECTED|EXPIRED|EXECUTED), expiresAt, resolvedAt?, resolvedBy?, adjustedFrom?, createdAt
ai_audit_log      id, userId, actorType(USER|AI), command, args(json), beforeSnapshot(json), afterSnapshot(json),
                  undoOf?, undoneAt?, adopted?, model?, tokens?, latencyMs?, traceId?, error?, createdAt
ai_entity_ref     id, entityType(PROJECT|MILESTONE|TASK|RISK), externalId, titleCache?, lastSyncedAt?, createdAt
```
`ai_pending_action` 与 `ai_audit_log` **必须分表**（前者「待人决定」，后者「已发生」）。
**切片里 `ai_pending_action` 会建表但不填**（待确认队列属于完整版）。

- [ ] **Step 1: 写失败的测试** —— `src/env.test.ts`（缺变量时报错、变量齐时解析成功、
  `ALLOWED_ORIGINS` 被切成数组）
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run` → Expected: FAIL
- [ ] **Step 3: 实现** —— 写上面列出的文件；`.gitignore` **必须含 `.env`**；
  `.env.example` 只列变量名与说明、**不含真值**
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 迁移能跑（**用共享库安全流程**，不要用 `prisma migrate dev`）**
  1. `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/init.sql`
  2. **人工审一遍 SQL**（它只该含本次的 5 张 `ai_` 表）
  3. `npx prisma db execute --schema prisma/schema.prisma --file /tmp/init.sql`
  4. `npx prisma migrate resolve --applied 0_init_ai_tables`
  Expected: 退出码 0；`npx prisma migrate status` 显示已应用；库里多出 5 张 `ai_` 表
  （**`ai_action_log` 是后端遗留的旧表，不要动**）
  ⚠️ **`prisma migrate dev` 在这个库上会要求 reset 整个库 —— 不要用。**
- [ ] **Step 6: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 仓骨架与 ai_* 元数据表

- Next.js + TypeScript + Prisma + Vitest
- ai_conversation / ai_message / ai_pending_action / ai_audit_log / ai_entity_ref 五张表
  (单租户,无 tenant_id;pending_action 与 audit_log 分表)
- 环境变量用 zod 校验,缺变量启动即失败
- .env 不入库,另给 .env.example
EOF
```

---

### Task 3: AiAdmin 客户端（token 透传 · 错误归一）

**Files:**
- Create: `src/aadmin/errors.ts`、`src/aadmin/client.ts`、`src/aadmin/types.ts`
- Test: `src/aadmin/client.test.ts`

**Interfaces:**
- Consumes: `env.AIADMIN_BASE_URL`、`src/types/api.ts`
- Produces:
  ```ts
  // src/aadmin/errors.ts
  export type AdapterError =
    | { kind: 'NOT_FOUND' } | { kind: 'CONFLICT'; message?: string }
    | { kind: 'VALIDATION'; fields?: Record<string, string> }
    | { kind: 'RATE_LIMIT'; retryAfterMs?: number } | { kind: 'AUTH_EXPIRED' }
    | { kind: 'UNSUPPORTED'; capability: string }
    | { kind: 'UPSTREAM'; message: string; retryable: boolean };
  export class AdapterErrorException extends Error { constructor(kind, message?, fields?) }

  // src/aadmin/client.ts
  export class AadminClient {
    constructor(opts: { baseUrl: string; fetchImpl?: typeof fetch });
    get<T>(path: string, token: string, query?: Record<string, string|number|undefined>): Promise<T>;
    post<T>(path: string, token: string, body: unknown): Promise<T>;
    put<T>(path: string, token: string, body: unknown): Promise<T>;
    delete<T>(path: string, token: string, body?: unknown): Promise<T>;
  }
  export function isRetryable(e: AdapterErrorException): boolean;
  ```

- [ ] **Step 1: 写失败的测试** —— 用 `fetchImpl` 注入假 fetch：
  `code===0` 时返回 `data`；业务码非 0 → `VALIDATION`（带 `fields`）；HTTP 401/403 →
  `AUTH_EXPIRED`；404 → `NOT_FOUND`；409 → `CONFLICT`；429 → `RATE_LIMIT`；
  `Authorization: Bearer <token>` 原样透传；**写操作不自动重试**（网络错误时只调一次 fetch）；
  **读操作遇可重试错误重试 1 次**
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/aadmin` → Expected: FAIL
- [ ] **Step 3: 实现**
  - URL 拼接：`${baseUrl}${path}`（`path` **不含** `/api/v1`，因为 `AIADMIN_BASE_URL` 已含）
  - **只做业务错误归一与透传**，不做 PM 的字段映射（那是 Task 4）
  - 写进 `src/aadmin/types.ts` 的 PM 类型：`PmProjectOut`、`PmTaskOut` 等，
    **字段逐字照抄后端 schema**（读 `D:/project/AiAdmin/backend/app/plugin/module_pm_project/*/schema.py`）
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): AiAdmin 客户端与错误归一

- 业务码 0/200 判成功,其余按七种 AdapterError 归一
- token 以 Authorization 头透传,本服务不持有长期凭据
- 读操作遇可重试错误重试一次,写操作绝不重试
- PM 出入参类型逐字对齐后端 schema
EOF
```

---

### Task 4: 适配层（枚举归一 · 能力位 · 建任务所需的 CRUD）

**Files:**
- Create: `src/adapter/enums.ts`、`src/adapter/capabilities.ts`、`src/adapter/datasource.ts`
- Test: `src/adapter/enums.test.ts`、`src/adapter/datasource.test.ts`

**Interfaces:**
- Consumes: `AadminClient`（Task 3）
- Produces:
  ```ts
  // src/adapter/enums.ts
  export type UnifiedTaskStatus = 'BACKLOG'|'TODO'|'IN_PROGRESS'|'REVIEW'|'DONE'|'BLOCKED'|'CANCELLED';
  export function taskStatusToUnified(v: string): UnifiedTaskStatus;   // 未命中 → 默认 + 告警
  export function taskStatusFromUnified(v: UnifiedTaskStatus): string;
  export function priorityToUnified(v: string): 'P0'|'P1'|'P2'|'P3';
  export function projectStatusToUnified(v: string): string;
  export function taskTypeToUnified(v: string): string;
  // src/adapter/capabilities.ts
  export const CAPABILITIES: Capabilities;   // 见下
  // src/adapter/datasource.ts
  export class AadminDataSource {
    constructor(client: AadminClient);
    listProjects(q?: { status?: string }): Promise<UnifiedProject[]>;
    listTasks(q: { project_id?: number; status?: string; page_no?: number; page_size?: number }): Promise<UnifiedTask[]>;
    getTask(key: string): Promise<UnifiedTask | null>;
    createTask(input: CreateTaskInput): Promise<UnifiedTask>;   // 见下
  }
  export interface CreateTaskInput {
    project_key: string; title: string; type?: string; status?: string; priority?: string;
    assignee_key?: string; due_date?: string; estimate_hours?: number;
  }
  ```

**能力位（按实测，不是按 AIPM 的设想）：**

```ts
export const CAPABILITIES: Capabilities = {
  supportsDelete: true,          // DELETE /pm_project/pm_task/delete 存在
  supportsBatchUpdate: false,     // 只有 status/batch（指定 ID + 同一状态）
  supportsHistory: false,         // 无字段历史 ⇒ 撤销只能补偿式
  supportsCustomFields: true,     // extra_fields(JSON)
  supportsDependencyGraph: false, // 依赖表只有建表 SQL,没有 model/controller
  supportsComments: true,
  maxBatchSize: 100,              // 后端 page_size 上限
  rateLimitPerMinute: 60,
};
```
**每条注明依据**（哪个端点/哪张表）。

**`createTask` 的载荷拼装**（关键，容易漏）：

- 路径：`POST /pm_project/pm_task/create`
- 必填：`project_id`（从 `project_key` 解出 id）、`title`、`type_code`、`status_code`、
  `priority_code`
- **三列 NOT NULL 且必填**：`reporter_id`（当前用户 id）、`sort_order: 0`、
  `created_via_code: 'manual'`
- 可选：`assignee_id`、`due_date`、`estimate_hours`
- ⚠️ `created_via_code` 用 `'manual'`（字典 `module_pm_task_created_via` 的值是
  `manual`/`nl_chat`/`import`/`api`，**没有 `'web'`**）

- [ ] **Step 1: 写失败的测试**
  - `enums.test.ts`：`'in_progress'→'IN_PROGRESS'`、`'cancelled'→'CANCELLED'`、
    `'P1'→'P1'`；**未知的码归一为默认并告警**（断言告警被调用）
  - `datasource.test.ts`（注入假 client，不碰网络）：
    - `listTasks 把 status_code 归一成统一枚举`
    - `createTask 的 body 含全部必填字段` —— 逐个断言 `project_id`/`title`/`type_code`/
      `status_code`/`priority_code`/`reporter_id`/`sort_order`/`created_via_code`
    - `createTask 的路径是 /pm_project/pm_task/create`（**两段前缀**）
    - `createTask 提交的是线上码`（`type_code: 'feature'`，不是「功能」）
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/adapter` → Expected: FAIL
- [ ] **Step 3: 实现** —— 照上面的签名；枚举映射双向；未命中归一为默认 + 告警（**不猜语义**）
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 适配层的枚举归一与建任务

- 枚举按后端字典的实测值双向映射,未命中归一为默认并告警
- 能力位按实测声明:无批量更新、无历史版本、无依赖图
- createTask 拼出后端必填的九个字段(含三列 NOT NULL:reporter_id/sort_order/created_via_code)
- 路径是两段插件前缀 /pm_project/pm_task/create
EOF
```

---

### Task 5: agent 运行时 · 命令目录 · SSE · 「说一句就建任务」端到端

**Files:**
- Create: `src/agent/session-registry.ts`、`src/agent/startup-lock.ts`、`src/agent/runtime.ts`
- Create: `src/tools/create-task.ts`、`src/tools/index.ts`
- Create: `src/app/api/agent/[conversationId]/command/route.ts`
- Create: `src/app/api/agent/[conversationId]/events/route.ts`
- Create: `src/app/api/agent/[conversationId]/state/route.ts`
- Create: `src/app/api/agent/conversations/route.ts`
- Create: `src/http/cors.ts`、`src/http/sse.ts`
- Test: `src/agent/startup-lock.test.ts`、`src/http/cors.test.ts`

**Interfaces:**
- Consumes: Task 1 的尖峰结论（**SDK 的真实 API 形状**）、`AadminDataSource`（Task 4）、
  `prisma`（Task 2）
- Produces（**这就是前端要消费的契约**）：

```
POST /api/agent/conversations                            → { code:0, msg, data:{ conversationId, title, createdAt } }
GET  /api/agent/conversations                            → { code:0, msg, data:[{ conversationId, title, updatedAt }] }
POST /api/agent/:cid/command  { id, type:'prompt', message } → { code:0, msg, data:{ id, type:'response', success:true } }
GET  /api/agent/:cid/events                             → SSE(text/event-stream)
GET  /api/agent/:cid/state                              → { code:0, msg, data:{ conversationId, messages[], isStreaming, model } }
```

**SSE 事件（切片只发这几种，前端按这几种写）：**

| 事件 | 载荷 |
|---|---|
| `connected` | `{ conversationId, isStreaming }` |
| `message_start` / `text_delta` / `message_end` | 对话增量 |
| `tool_call` | `{ toolName, args }` |
| `tool_result` | `{ toolName, status:'ok'|'error', summary, details }` |
| `agent_settled` | — |

**要点**

- **命令只有一个**：`create_task`。它是**非破坏性**的（新建实体可补偿撤销）⇒ **不需要待确认**
  （待确认队列属于完整版的 Task 7）。`destructiveHint: false`。
- ⚠️ **待确认机制与服务端不兼容**（尖峰实测）：`ctx.ui.confirm()` 在 Route Handler 里
  `ctx.hasUI === false`，会**立即返回 false** ⇒ 完整版的待确认队列必须改走
  `pi.on("tool_call")` 返回 `{ block: true, reason }`（工具挂起，等外部答复后由本服务恢复）。
  **切片里没有待确认**，但 Task 5 的工具要留出这个接口形状。
- **工具描述要写清**（MiniMax 的 `toolChoice` 只能是 `auto`，模型全靠描述选工具）：
  什么时候用我、什么时候别用我、参数格式与单位；**参数名用统一领域模型的名字**，
  不出现后端的 `project_id` 这种外部字段名。
- **SDK 用法照尖峰实测**：`defineTool` 带 `label`；`parameters` 用 `typebox` 的 `Type`；
  `noTools: "builtin"`；`model` 用 `modelRuntime.getModel(...)`；
  `systemPrompt` 放 `new DefaultResourceLoader({ systemPrompt })`；
  `execute(toolCallId, params, signal, onUpdate, ctx)`；
  pi SDK 进 `serverExternalPackages`。
- **模型调用要用 `env.MINIMAX_CN_API_KEY`**（尖峰里已验证过怎么配）。
- **CORS**：`Access-Control-Allow-Origin` 回**具体的**已登记源（`env.ALLOWED_ORIGINS`），
  **不能用 `*`**；处理 `OPTIONS` 预检；`Access-Control-Allow-Headers: authorization, content-type`；
  `Access-Control-Max-Age: 300`。
- **鉴权**：每个接口从 `Authorization: Bearer <token>` 取**用户的** token，透传给 AiAdmin；
  服务端**不解析 token 内容**（AiAdmin 才是权威）；缺 token ⇒ 401 信封。
- **会话注册表**：按 `conversationId` 复用 session；**启动锁**用 `Map<string, Promise>`
  让同一会话的并发 prompt **串行排队**（不报错）。
- **工具只注册业务命令**：`tools: []`（不启用 pi 的 coding 内置工具）。

- [ ] **Step 1: 写失败的测试** —— `startup-lock.test.ts`（同 key 串行、不同 key 并行、前一个失败不影响后一个）；
  `cors.test.ts`（源不在白名单时不回 Allow-Origin、预检回 Allow-Headers、Max-Age ≤ 300）
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/agent src/http` → Expected: FAIL
- [ ] **Step 3: 实现** —— 照上面；**SDK 的用法以尖峰实测为准**
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 手工端到端验证** —— 起服务 `npm run dev`，用 `curl` 打一遍：
  1. `POST /api/agent/conversations` 拿到 `conversationId`
  2. `POST /api/agent/:cid/command` 发一句「在项目 X 下建一个任务叫 Y」
     （token 用真实用户的：`admin` / `123456` 登录后拿 access_token）
  3. `curl -N GET /api/agent/:cid/events` 看事件流里出现 `tool_call` 与 `tool_result`
  4. `GET /api/v1/pm_project/pm_task/list`（直接打后端）确认**任务真的建出来了**
  把四步的实际请求与输出记进报告
- [ ] **Step 6: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): agent 运行时与「说一句就建任务」

- pi agent 同进程 SDK,tools 为空只注册业务命令
- 会话注册表与启动锁(同会话的 prompt 串行排队)
- 一个命令:create_task(非破坏性,不需要待确认)
- Route Handlers:命令 / 事件(SSE) / 状态 / 会话
- CORS 回具体的已登记源,不用 *
- 手工端到端验证过:一句话真的建出了任务
EOF
```

---

## 完成判据

- [ ] `npx vitest run` 全绿
- [ ] `npx tsc --noEmit` 干净
- [ ] `npx prisma migrate status` 显示已应用
- [ ] `npm run build` 成功
- [ ] `npm run dev` 起得来；`curl -N` 能收到 SSE 首帧
- [ ] **「说一句就建任务」端到端跑通，且任务真的出现在后端**
- [ ] README 写清：环境变量、怎么起、接口清单、**怎么接前端**（前端用
  `AI_API_BASE_URL` 指向本服务；开发期前端加一条 `/ai-api/` 代理）

## 切片之外（完整版计划里的后续任务）

- 撤销与冲突检测（完整版 Task 4）· 规则引擎（Task 5）· 其余 ~39 个命令（Task 6）
- 待确认队列（Task 7）· 补偿式撤销 · 项目成员 5 角色权限 · 飞书通道
- 前端侧栏的「待确认 / 审计」页签与全宽页（前端计划的 Plan C）
