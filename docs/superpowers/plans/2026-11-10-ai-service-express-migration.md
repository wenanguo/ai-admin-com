# AI 服务 HTTP 层迁移到 Express Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ai-admin-ai` 的 HTTP 层从 Next.js Route Handlers 换成 Express 5，彻底删掉 Next，让服务变成 `node dist/server.js` 就能跑的直白 Node 服务。

**Architecture:** agent 内核（`src/agent/**` 等）对框架零依赖，只动协议层。先用一张**契约表**把 9 个 JSON 端点的现有行为固化下来（对着 Next 实现写测试），再把同一张表用到 Express 实现上 ⇒ 两边行为必须一致。SSE 端点单独迁移（`res.write` + `req.on('close')`），语义（首帧 `connected` → 回放 → 增量 → 15s 心跳）不变。产物用 tsc 编译成 **ESM**（pi SDK 是 ESM-only，CommonJS require 不了它）。

**Tech Stack:** Express 5、TypeScript 5.9（`module: nodenext` + `rewriteRelativeImportExtensions`）、Vitest 5、Node 26（`--env-file`、`process.loadEnvFile`）、tsx（dev 热重载）。

**Spec:** `docs/superpowers/specs/2026-11-10-ai-service-express-migration-design.md`

## Global Constraints

- **前端零改动**：服务必须仍挂在 `/api/agent/**`、`/api/pending`、`/api/audit`；浏览器侧走 `/ai-api/` 代理（代理会剥掉前缀）。
- **对外行为一字不变**：HTTP 状态码、信封 `{code, msg, data}`（成功 `code===0`，失败码=HTTP 语义码）、CORS 头（回**具体**源，不用 `*`）、错误文案。
- **pi SDK 是 ESM-only**：`@earendil-works/pi-coding-agent` 的 `exports` 只有 `import` ⇒ 产物必须是 ESM；它带原生/动态依赖 ⇒ **不能打包**，只能 tsc 转译、依赖留在 `node_modules`。
- **agent 内核零改动**：`src/agent/**`、`src/tools/**`、`src/adapter/**`、`src/aadmin/**`、`src/pending-*.ts`、`src/audit*.ts` 一行不动。
- **不引新运行时依赖**（除 `express` 本身）：测试用 Node 内置 `fetch`，不用 supertest。
- **Express body 上限 1MB**：`express.json({ limit: '1mb' })`（Express 默认 100kb，Next 是 1MB ⇒ 必须显式对齐）。
- **端口 3100**（`PORT` 环境变量可覆盖）。
- 提交信息用中文；Conventional Commit type 仅 `build/chore/ci/docs/feat/fix/perf/refactor/revert/style/test`；body 单行 ≤100 字符。

## Review Focus

以下五类是「规格说了、但没有哪条测试盯着」的输入/情形，最容易咬人：

1. **CORS 预检不带 Authorization** ⇒ 必须回 `204` + 具体 `Access-Control-Allow-Origin`；不能 401、不能用 `*`。
2. **缺 token 的 10 个端点** ⇒ 一律 `401` + 一字不差的文案（前端据此提示用户）。
3. **请求体不是 JSON / 是数组 / 缺字段** ⇒ `400`（不是 500），文案与今天逐字相同。
4. **SSE 客户端秒退** ⇒ 写失败要静默收摊（不能把进程打挂、不能留下心跳定时器）。
5. **未知路径** ⇒ JSON 404（不是 Express 默认的 HTML 404）。

每一条都在下面某个 Task 的步骤里补上对应的测试。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| `src/server.ts`（新） | `createApp()` 组装 Express app；`start()` 监听端口；优雅退出 |
| `src/routes/agent.ts`（新） | 会话列表/新建、命令、快照、中止、SSE 事件流 |
| `src/routes/pending.ts`（新） | 待确认列表、批准、拒绝 |
| `src/routes/audit.ts`（新） | 审计列表 |
| `src/routes/contract.ts`（新） | **契约表**：9 个 JSON 端点的「方法/路径/入参/期望状态码/期望信封/期望文案」，两个实现共用 |
| `src/http/respond.ts`（改） | 框架无关的信封构造：`okBody` / `errorBody` |
| `src/http/errors.ts`（改） | 框架无关的错误映射：`toErrorEnvelope(error) → {status, body}` |
| `src/http/cors.ts`（改） | 框架无关：`buildCorsHeaders(origin, origins)` / `originOf(header)` |
| `src/http/auth.ts`（改） | 框架无关：`extractBearerToken(headerValue)` |
| `src/http/sse.ts`（不改） | SSE 头常量与帧拼装（`sseFrame` / `sseComment` / `frameToSse` / `SSE_HEADERS`） |
| `src/app/**`（删） | Next 的路由与占位页 |
| `next.config.ts`、`next-env.d.ts`（删） | Next 配置 |
| `tsconfig.build.json`（新） | ESM 产物编译配置 |
| `tsconfig.json`（改） | 去掉 Next 相关项 |

---

### Task 1: 契约表 + 现状固化测试

**Files:**
- Create: `src/routes/contract.ts`
- Create: `src/app/api/contract.test.ts`（**临时**，Task 7 随 `src/app/**` 一起删）
- Read-only 参考: `src/app/api/**/route.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/routes/contract.ts
  export interface ContractCase {
    /** 用例名（失败时看这个） */
    name: string;
    /** HTTP 方法 */
    method: "GET" | "POST";
    /** 路径（相对服务根，含 /api 前缀） */
    path: string;
    /** 请求头（缺省只带 Authorization: Bearer test-token） */
    headers?: Record<string, string>;
    /** 请求体（对象 ⇒ 自动 JSON 序列化；字符串 ⇒ 原样当 body 传） */
    body?: unknown;
    /** 期望的 HTTP 状态码 */
    status: number;
    /** 期望的信封业务码（成功 0） */
    code: number;
    /** 期望的 msg（精确匹配；不填则不检查） */
    msg?: string;
    /** 对 data 的额外断言（不填则只检查 data 存在性） */
    checkData?: (data: unknown) => void;
  }
  export const JSON_CONTRACT: ContractCase[];
  /** 缺 token 时的统一文案（10 个端点共用） */
  export const MISSING_TOKEN_MESSAGE: string;
  ```

- **Produces（给 Task 4 用）**：Task 4 的 Express 契约测试直接复用 `JSON_CONTRACT` 与 `MISSING_TOKEN_MESSAGE`。

**Steps:**

- [ ] **Step 1: 写契约表** `src/routes/contract.ts`
  覆盖 9 个 JSON 端点（conversations GET/POST、command POST、state GET、abort POST、pending GET、approve POST、reject POST、audit GET）+ 预检。
  固定值（**照抄现状**，不要改文案）：
  - `MISSING_TOKEN_MESSAGE = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）"`
  - 缺 token ⇒ `status 401` / `code 401` / `msg = MISSING_TOKEN_MESSAGE`
  - command 的 body 非法 ⇒ `400` / `"请求体不是合法的 JSON"`；body 是数组 ⇒ `400` / `"请求体必须是对象"`
  - command 缺 `id` ⇒ `400` / `"命令 id 不能为空"`；缺 `type` ⇒ `400` / `"命令类型不能为空"`
  - command 的 `type` 不支持 ⇒ `400` / `暂不支持的命令类型「x」（支持：prompt / prompt-followup / prompt-steer）`
  - command 的 `message` 为空 ⇒ `400` / `"消息不能为空"`
  - approve/reject 重复处理 ⇒ `409` / `"这条待确认已经处理过了（或不存在）"`
  - 预检（OPTIONS）⇒ `204`，响应头 `access-control-allow-origin` 等于请求的 Origin

- [ ] **Step 2: 写现状固化测试** `src/app/api/contract.test.ts`
  - 用 `vi.mock` 替换模块级单例，让 200 路径也能测（不碰真数据库/真模型）：
    - `vi.mock('../../agent/runtime', …)`：`agentRuntime.resolveCurrentUser` 返回 `{id: 2, name: '测试'}`；`listConversations`/`createConversation`/`submitCommand`/`readState`/`abort` 返回固定值
    - `vi.mock('../../pending-write', …)`：`resolvePendingAction` 返回 `true`
    - `vi.mock('../../pending-query', …)`：`parsePendingFilters` / `queryPendingActions` 返回固定值
    - `vi.mock('../../audit-query', …)`：`parseAuditFilters` / `queryAuditLog` 返回 `{total: 0, items: []}`
    - `vi.mock('../../db', …)`：`prisma` 换成 `{}`
    - `vi.mock('../../agent/pending-waiters', …)`：`pendingWaiters.decide` 换成 `vi.fn()`
  - 写一个**路由表**把 `(method, path)` 映射到现在的 handler（从 `src/app/api/**/route.ts` 导入），逐条跑 `JSON_CONTRACT`：
    用 `new Request('http://ai.test' + case.path, { method, headers, body })` 调 handler，断言 `response.status` 与 `await response.json()`。

- [ ] **Step 3: 跑测试确认全绿**（此时它测的是**现状**，全绿说明契约表抄对了）
  Run: `npx vitest run src/app/api/contract.test.ts`
  Expected: PASS（用例数 = 契约条数）

- [ ] **Step 4: 提交**
  ```bash
  git add src/routes/contract.ts src/app/api/contract.test.ts
  git commit -m "test(ai): 固化 9 个 JSON 端点的现有行为（迁移前的契约表）"
  ```

---

### Task 2: HTTP 通用件改成框架无关

**Files:**
- Modify: `src/http/respond.ts`、`src/http/errors.ts`、`src/http/cors.ts`、`src/http/auth.ts`
- Modify: `src/http/cors.test.ts`、`src/http/errors.test.ts`

**Interfaces:**
- Consumes: 无（Task 1 的契约表不依赖它们）
- Produces（Task 3/4 使用）：
  ```ts
  // respond.ts
  export function okBody<T>(data: T, msg?: string): ApiResponse<T>;   // { code: 0, msg, data }
  export function errorBody(code: number, msg: string): ApiResponse<null>;
  // errors.ts
  export function toErrorEnvelope(error: unknown): { status: number; body: ApiResponse<null> };
  // cors.ts
  export function buildCorsHeaders(origin: string | undefined, origins: readonly string[]): Record<string, string>;
  export function originOf(headerValue: string | undefined): string | undefined;
  export const ALLOWED_REQUEST_HEADERS: string;   // 已有，不改
  export const ALLOWED_METHODS: string;           // 已有，不改
  export const PREFLIGHT_MAX_AGE_SECONDS: number; // 已有，不改
  // auth.ts
  export function extractBearerToken(headerValue: string | undefined): string | undefined;
  ```
  ⚠️ **全部不接收 Web `Request`/`Response`**，只收原始值 ⇒ 框架无关、可单测。
  ⚠️ `respond.ts` 里的 `allowedOrigins()` / `setAllowedOriginsForTest()` **必须保留**
     （CORS 白名单的入口，`src/http/cors.test.ts` 与服务器中间件都要用）。

- [ ] **Step 1: 改 `src/http/auth.ts`** —— `extractBearerToken(headerValue: string | undefined)`：逻辑照搬（Bearer 方案名大小写不敏感、空串⇒undefined），只是入参从 Request 变成 header 字符串。

- [ ] **Step 2: 改 `src/http/cors.ts`** —— `originOf(headerValue)`、`buildCorsHeaders(origin, origins)`；**CORS 语义一字不动**（回具体源、`Vary: Origin`、预检头与 300 秒缓存）。

- [ ] **Step 3: 改 `src/http/respond.ts`**
  - **新增** `okBody(data, msg?)` / `errorBody(code, msg)`（框架无关）。
  - **保留**（临时兼容层，Task 7 随 `src/app/**` 一起删）：`jsonResponse` / `okEnvelope` / `errorEnvelope` / `preflightResponse` —— 内部改用新的 body 函数，**对外行为一字不变** ⇒ 旧的 Next 路由不用改也能继续编译。
  - `allowedOrigins()` / `setAllowedOriginsForTest()` / `SUCCESS_CODE` **保留不动**。

- [ ] **Step 4: 改 `src/http/errors.ts`**
  - **新增** `toErrorEnvelope(error): { status, body }`（框架无关）。
  - **保留**（临时兼容层）`errorResponse(request, error)`，内部改用 `toErrorEnvelope`。
  - 错误种类→状态码的映射表（NOT_FOUND→404、VALIDATION→400、AUTH_EXPIRED→401、CONFLICT→409、RATE_LIMIT→429、UNSUPPORTED→400、UPSTREAM→502、其它→500）与文案一字不动。

- [ ] **Step 5: 修 Next 侧的三处调用点**（否则 `tsc` 会红）
  - `src/http/respond.ts` 的 `jsonResponse`：改用 `originOf(request.headers.get('origin'))` 取 Origin。
  - `src/http/errors.ts` 的 `errorResponse`：同上。
  - `src/app/api/agent/[conversationId]/events/route.ts`：`buildCorsHeaders(request, …)` → `buildCorsHeaders(originOf(request.headers.get('origin')), …)`。
  - `src/http/auth.ts` 的 `extractBearerToken(request)` → 改成收 header 字符串 ⇒ **三个调用点同步改**（`src/app/api/**` 的各 route）。

- [ ] **Step 6: 更新既有单测** `src/http/cors.test.ts`、`src/http/errors.test.ts`（改签名，断言不变；新增 `okBody`/`errorBody`/`toErrorEnvelope` 的用例）。

- [ ] **Step 7: 跑测试**
  Run: `npx vitest run src/http`
  Expected: PASS
  ⚠️ `tsc --noEmit` 也必须**保持绿**（Step 5 已修好 Next 侧调用点）⇒ 每个任务结束时仓库都是可编译的。

- [ ] **Step 8: 提交**
  ```bash
  git add src/http src/app
  git commit -m "refactor(ai): HTTP 通用件改成框架无关（信封/CORS/鉴权/错误）"
  ```

---

### Task 3: Express 骨架（app 装配 + 中间件 + 404 + 优雅退出）

**Files:**
- Create: `src/server.ts`
- Create: `src/server.test.ts`
- Modify: `package.json`（加 `express`、`@types/express`）

**Interfaces:**
- Consumes: Task 2 的 `okBody` / `errorBody` / `toErrorEnvelope` / `buildCorsHeaders` / `originOf` / `extractBearerToken`
- Produces:
  ```ts
  // src/server.ts
  export function createApp(): import("express").Express;   // 只装配，不监听
  export function start(): void;                              // 监听 PORT（缺省 3100）
  ```
  路由挂载（**顺序固定**）：
  ```
  app.use(corsMiddleware)        // 挂 CORS 头；OPTIONS 直接 204 返回
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/agent', agentRouter)
  app.use('/api/pending', pendingRouter)
  app.use('/api/audit', auditRouter)
  app.use(notFoundHandler)       // JSON 404
  app.use(errorHandler)          // 统一错误信封
  ```

- [ ] **Step 1: 装依赖**
  Run: `npm install express@^5.1.0 && npm install -D @types/express@^5`
  Expected: package.json 出现 `express`，devDependencies 出现 `@types/express`。

- [ ] **Step 2: 写 `src/server.test.ts`（先红）**
  测试用 `app.listen(0)` + Node 内置 `fetch`：
  - `createApp()` 能起（监听 0 端口）
  - **预检**：`OPTIONS /api/pending` 带 `Origin: http://localhost:8000` ⇒ `204` + `access-control-allow-origin: http://localhost:8000`（**不是 `*`**）+ `access-control-allow-methods` 含 `GET`
  - **未知路径**：`GET /api/nope` ⇒ `404` + JSON（`content-type: application/json`），body 是 `{code,msg,data}` 形状
  - **缺 token**：`GET /api/pending` 无 Authorization ⇒ `401` + `code: 401` + msg 等于 `MISSING_TOKEN_MESSAGE`
  - **CORS 头在普通响应上也有**：任意 401 响应都带 `access-control-allow-origin`（当请求带了 Origin 时）

- [ ] **Step 3: 跑测试确认失败**
  Run: `npx vitest run src/server.test.ts`
  Expected: FAIL（`src/server.ts` 还不存在）

- [ ] **Step 4: 实现 `src/server.ts`**
  - `corsMiddleware`：`const origin = originOf(req.get('origin'))`；`buildCorsHeaders(origin, allowedOrigins())` 逐个 `res.setHeader`；`if (req.method === 'OPTIONS') { res.status(204).end(); return; }`
  - `notFoundHandler`：`res.status(404).json(errorBody(404, '接口不存在'))`
  - `errorHandler`（4 参数，Express 5 会把 async handler 的 reject 转进来）：`const { status, body } = toErrorEnvelope(err); res.status(status).json(body)`
  - `createApp()` 只装配；`start()` 里 `process.loadEnvFile?.()`（try/catch 兜底，`.env` 不存在不致命）→ `app.listen(port)`
  - 优雅退出：`SIGTERM`/`SIGINT` ⇒ `server.close()`（文档里写清行为）

- [ ] **Step 5: 跑测试确认通过**
  Run: `npx vitest run src/server.test.ts`
  Expected: PASS（5 条）

- [ ] **Step 6: 提交**
  ```bash
  git add src/server.ts src/server.test.ts package.json package-lock.json
  git commit -m "feat(ai): Express 骨架（app 装配、CORS 中间件、JSON 404、优雅退出）"
  ```

---

### Task 4: JSON 路由迁移（9 个端点）

**Files:**
- Create: `src/routes/agent.ts`、`src/routes/pending.ts`、`src/routes/audit.ts`
- Create: `src/routes/contract.test.ts`
- Modify: `src/server.ts`（挂三个 router）

**Interfaces:**
- Consumes: Task 1 的 `JSON_CONTRACT` / `MISSING_TOKEN_MESSAGE`；Task 2 的通用件
- Produces:
  ```ts
  // src/routes/agent.ts
  export const agentRouter: import("express").Router;  // 挂 conversations / :conversationId/{command,state,abort,events}
  // src/routes/pending.ts
  export const pendingRouter: import("express").Router; // GET /、POST /:id/approve、POST /:id/reject
  // src/routes/audit.ts
  export const auditRouter: import("express").Router;   // GET /
  ```
  挂载点由 `src/server.ts` 决定 ⇒ 对外路径仍是 `/api/agent/**`、`/api/pending`、`/api/audit`。
  ⚠️ 注册顺序：`/api/agent/pending/:id/*` 必须**先于** `/api/agent/:conversationId/*` 注册。

- [ ] **Step 1: 写契约测试** `src/routes/contract.test.ts`（先红）
  - 与 Task 1 相同的 `vi.mock` 组合（路径相对本文件：`../agent/runtime`、`../pending-write`、`../pending-query`、`../audit-query`、`../db`、`../agent/pending-waiters`）
  - `beforeAll` 里 `createApp()` + `app.listen(0)`，`afterAll` 关掉
  - 逐条跑 `JSON_CONTRACT`：`fetch(base + case.path, {method, headers, body})` ⇒ 断言 `status`、信封 `code`、`msg`、`data`
  - body 为对象时 `JSON.stringify` 并带 `content-type: application/json`；body 为字符串时原样传（用来测「不是合法 JSON」）

- [ ] **Step 2: 跑测试确认失败**
  Run: `npx vitest run src/routes/contract.test.ts`
  Expected: FAIL（router 还不存在）

- [ ] **Step 3: 实现 `src/routes/pending.ts`**
  - `GET /`：`req.query.status` / `req.query.limit` 传给 `parsePendingFilters`（**签名要改**：从 `URLSearchParams` 改成读 `req.query` ⇒ 或在路由里手工组装 `URLSearchParams` 保持 `pending-query.ts` 不动 ⇒ **选后者**：`new URLSearchParams(req.query as Record<string,string>)`）
  - `POST /:id/approve` → `resolvePendingAction(id, 'CONFIRMED', String(user.id))`；false ⇒ 409 信封；成功后 `pendingWaiters.decide(id, 'approved')`
  - `POST /:id/reject` 同上，状态 `'REJECTED'` / `'rejected'`

- [ ] **Step 4: 实现 `src/routes/audit.ts`**
  - `GET /`：`parseAuditFilters(new URLSearchParams(req.query as Record<string,string>))` → `queryAuditLog(...)` ⇒ `okBody(page)`

- [ ] **Step 5: 实现 `src/routes/agent.ts` 的 JSON 部分**
  - `GET /conversations` → `listConversations(String(user.id))`
  - `POST /conversations`：body 可选（解析失败**忽略**，与现状一致）⇒ `createConversation(userId, title?)` ⇒ `okBody({conversationId, title, createdAt: createdAt.toISOString()})`
  - `POST /:conversationId/command`：body 校验顺序**一字不差**（不是 JSON → 必须是对象 → id → type → type 白名单 → message）⇒ `submitCommand({...})` ⇒ `okBody(ack)`
  - `GET /:conversationId/state` ⇒ `okBody({conversationId, messages: [...], isStreaming, model})`，`messages` 里 `createdAt` 仍是 ISO 字符串
  - `POST /:conversationId/abort` ⇒ `okBody({conversationId, aborted: true})`
  - 每个 handler 的开头：`const token = extractBearerToken(req.get('authorization')); if (!token) return res.status(401).json(errorBody(401, MISSING_TOKEN_MESSAGE));`

- [ ] **Step 6: 在 `src/server.ts` 挂三个 router**（顺序见上）

- [ ] **Step 7: 跑测试确认通过**
  Run: `npx vitest run src/routes/contract.test.ts src/server.test.ts`
  Expected: PASS（契约表全绿 ⇒ Express 行为与现状一致）

- [ ] **Step 8: 提交**
  ```bash
  git add src/routes src/server.ts
  git commit -m "feat(ai): 9 个 JSON 端点迁到 Express（行为由契约表锁定）"
  ```

---

### Task 5: SSE 事件流迁移

**Files:**
- Modify: `src/routes/agent.ts`（加 `GET /:conversationId/events`）
- Create: `src/routes/events.test.ts`

**Interfaces:**
- Consumes: `src/http/sse.ts` 的 `SSE_HEADERS` / `sseFrame` / `sseComment` / `frameToSse`；`agentRuntime.getChannel` / `subscribe` / `readState` / `resolveCurrentUser`
- Produces: 无新接口（对外仍是 `GET /api/agent/:conversationId/events`）

- [ ] **Step 1: 写 SSE 测试** `src/routes/events.test.ts`（先红）
  - mock `agentRuntime`：`resolveCurrentUser` → `{id:2}`；`readState` → 正常；`getChannel` → `{isStreaming:false, backlog:{list:()=>[]}}`；`subscribe` 立刻回调一帧 `{seq:1, event:'text_delta', data:'{"delta":"hi"}'}`
  - 断言：
    - 响应头 `content-type: text/event-stream`、`cache-control: no-cache, no-transform`、`x-accel-buffering: no`
    - 首帧是 `event: connected`
    - 增量帧里出现 `event: text_delta` 与 `hi`
    - **客户端断开不抛错**：读完就 `abort()` 掉 fetch，服务端不崩（用 `vi.spyOn(console,'error')` 断言没有未捕获错误）

- [ ] **Step 2: 跑测试确认失败**
  Run: `npx vitest run src/routes/events.test.ts`
  Expected: FAIL（路由还没实现）

- [ ] **Step 3: 实现 SSE handler**
  - `res.writeHead(200, { ...SSE_HEADERS, ...buildCorsHeaders(originOf(req.get('origin')), allowedOrigins()) })`；`res.flushHeaders?.()`
  - 顺序照搬现状：① 取回放快照 `channel?.backlog.list()` 与 `snapshotMaxSeq` ② `subscribe`（跳过 `seq <= snapshotMaxSeq` 的帧）③ 写首帧 `connected` ④ 写回放帧 ⑤ 15 秒心跳 `sseComment('heartbeat')`
  - `req.on('close', cleanup)`：`clearInterval(heartbeat)` + `unsubscribe?.()`；写失败（`res.write` 抛错）⇒ 静默 cleanup，不打栈
  - ⚠️ 先 `await agentRuntime.readState(conversationId, userId)` 校验会话归属（不存在 ⇒ 404 信封，**不要**开一条永远没消息的流）

- [ ] **Step 4: 跑测试确认通过**
  Run: `npx vitest run src/routes/events.test.ts src/routes/contract.test.ts`
  Expected: PASS

- [ ] **Step 5: 提交**
  ```bash
  git add src/routes
  git commit -m "feat(ai): SSE 事件流迁到 Express（首帧/回放/心跳/断连清理不变）"
  ```

---

### Task 6: 构建链（ESM 产物 + import 后缀化）

**Files:**
- Create: `tsconfig.build.json`
- Modify: `tsconfig.json`、`package.json`、`.gitignore`
- Modify: **全部 `src/**/*.ts` 的相对 import**（181 处，机械）

**Interfaces:**
- Consumes: 无
- Produces: `npm run build` ⇒ `dist/server.js`（ESM）；`npm start` ⇒ `node --env-file=.env dist/server.js`；`npm run dev` ⇒ `tsx watch src/server.ts`

- [ ] **Step 1: 加依赖 `tsx`**（dev 热重载）
  Run: `npm install -D tsx@^4`

- [ ] **Step 2: 改 `tsconfig.json`**
  - 删 `plugins: [{ name: 'next' }]`、`jsx: 'preserve'`
  - `include` 去掉 `next-env.d.ts` 与 `.next/types/**/*.ts`
  - 其余不动（仍用于 `tsc --noEmit`）

- [ ] **Step 3: 新增 `tsconfig.build.json`**
  ```jsonc
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "noEmit": false,
      "module": "nodenext",
      "moduleResolution": "nodenext",
      "rewriteRelativeImportExtensions": true,
      "outDir": "dist",
      "rootDir": "src",
      "sourceMap": true,
      "declaration": false
    },
    "include": ["src/**/*.ts"],
    "exclude": ["src/**/*.test.ts", "node_modules", "spike"]
  }
  ```

- [ ] **Step 4: 脚本化给相对 import 加 `.ts` 后缀**
  - 脚本：对 `src/**/*.ts` 里形如 `from "./x"` / `from "../x"` 的**相对路径**，若不以 `.ts`/`.js`/`.json` 结尾 ⇒ 追加 `.ts`
  - ⚠️ 只改相对路径；`@/` 别名与包名不动
  - 改完 `npx tsc --noEmit` 必须仍然通过

- [ ] **Step 5: 改 `package.json` 脚本**
  | 脚本 | 值 |
  | --- | --- |
  | `dev` | `tsx watch src/server.ts` |
  | `build` | `tsc -p tsconfig.build.json` |
  | `start` | `node --env-file=.env dist/server.js` |
  | `typecheck` | `tsc --noEmit`（不变） |

- [ ] **Step 6: 改 `.gitignore`**：删 `.next/`，加 `dist/`

- [ ] **Step 7: 跑门禁**
  Run: `npx tsc --noEmit && npx vitest run`
  Expected: 两者全绿（vitest 能解析 `.ts` 后缀 import —— 已 spike 验证）

- [ ] **Step 8: 构建并冒烟**
  Run: `npm run build && node --env-file=.env dist/server.js &`
  然后 `curl -i http://localhost:3100/api/pending` ⇒ 期望 `401` + JSON 信封；`curl -N http://localhost:3100/api/agent/x/events` ⇒ 期望 401（不是挂死）
  Expected: 与今天的行为一致

- [ ] **Step 9: 提交**
  ```bash
  git add tsconfig.json tsconfig.build.json package.json package-lock.json .gitignore src
  git commit -m "build(ai): 产物改用 tsc 编译的 ESM（pi SDK 是 ESM-only，不能用 CJS）"
  ```

---

### Task 7: 删掉 Next + 文档 + 端到端验收

**Files:**
- Delete: `src/app/**`、`next.config.ts`、`next-env.d.ts`
- Modify: `package.json`（移除 `next`、`react`、`react-dom`、`@ant-design/*` 依赖 —— 本服务**不渲染 UI**）
- Modify: `README.md`
- Modify: `.gitignore`（确认 `.next/` 已删）

**Interfaces:**
- Consumes: Task 1–6 的全部产出
- Produces: 最终形态 —— 仓库里**不含任何 Next 依赖**

- [ ] **Step 1: 删文件**
  Run: `git rm -r src/app next.config.ts next-env.d.ts`
  ⚠️ `src/app/api/contract.test.ts`（Task 1 的临时测试）随之删除 ✔ —— 契约表本体在 `src/routes/contract.ts`，由 Task 4/5 的测试继续使用。

- [ ] **Step 2: 清依赖**
  Run: `npm uninstall next react react-dom @ant-design/icons @ant-design/x @ant-design/x-markdown @ant-design/x-sdk typebox`
  ⚠️ `@ant-design/*` 只有占位页在用 ⇒ 一并删；`typebox` 由 pi SDK 依赖 ⇒ **只在它不是直接依赖时才删**（先 `npm uninstall typebox` 看它是否还在 package.json 里，若 pi 需要它会作为传递依赖保留 ✔）。
  ⚠️ `zod` **保留**（`src/env.ts` 在用）。

- [ ] **Step 3: 更新 README**
  写清：启动方式（`npm run dev` / `npm run build && npm start`）、端口 3100、`.env` 变量清单、与前端的 `/ai-api/` 代理关系、**为什么不用 Next**（一句话：它只提供 10 个端点，agent 内核零框架依赖）。

- [ ] **Step 4: 全量门禁**
  Run: `npx tsc --noEmit && npx vitest run && npm run build`
  Expected: 全绿；`dist/server.js` 存在

- [ ] **Step 5: 真实冒烟（生产形态）**
  Run: `node --env-file=.env dist/server.js &` ⇒
  - `curl -i http://localhost:3100/api/pending` ⇒ 401 + JSON 信封
  - `curl -i -X OPTIONS -H "Origin: http://localhost:8000" http://localhost:3100/api/pending` ⇒ 204 + 具体 Origin
  - `curl -N -H "Authorization: Bearer $TOKEN" http://localhost:3100/api/agent/<真实会话>/events` ⇒ 首帧 `event: connected`
  - 前端侧：`npm run dev` 起前端 ⇒ AI 工作台能建会话、能发消息（**端点路径没变 ⇒ 前端零改动**）

- [ ] **Step 6: 提交**
  ```bash
  git add -A
  git commit -m "refactor(ai): 删掉 Next.js —— 服务只剩 Express（端点行为由契约表锁定）"
  ```

---

## 自查（对照 spec）

| spec 要求 | 由哪个 Task 覆盖 |
| --- | --- |
| 端点对外行为一字不变 | Task 1（固化）+ Task 4（同一契约表验证） |
| 前端零改动 | Task 7 Step 5（前端联调冒烟） |
| pi SDK 是 ESM-only ⇒ 产物必须 ESM | Task 6 Step 3–4（tsconfig + import 后缀化） |
| pi SDK 不能打包 | Task 6（tsc 转译，依赖留在 node_modules） |
| agent 内核零改动 | 全部 Task（`src/agent/**` 不在改动清单里） |
| CORS 回具体源、不用 `*` | Task 1（契约含预检断言）+ Task 3 |
| 不引新运行时依赖 | Task 3（只用 express）+ Task 4（测试用内置 fetch） |
| Express body 上限 1MB | Task 3 Step 4 |
| 先补 route 层测试再改实现 | Task 1 → Task 4 |
| 端口 3100 / PORT 可覆盖 | Task 3 |
| 优雅退出 | Task 3 Step 4 |
| 删 Next、不保留回退开关 | Task 7 Step 1–2 |
| README 更新 | Task 7 Step 3 |
