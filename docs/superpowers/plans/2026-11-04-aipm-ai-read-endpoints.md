# AI 服务补只读端点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 AI 服务补两个**只读**端点，让前端的「待确认」与「审计」两个页签有真数据可读：
`GET /api/pending` 与 `GET /api/audit`。

**Architecture:** 纯读取 —— 不新增业务逻辑、不新增表、不改 agent 运行时。两个端点都在
Next.js Route Handler 里读 Prisma，把 `ai_pending_action` / `ai_audit_log` 的行映射成
前端要的形状，用与服务其余部分**同一个响应信封** `{ code, msg, data }`。

**Tech Stack:** Next.js 15（App Router / Route Handlers）· TypeScript · Prisma + MySQL · Vitest

**Spec:** `docs/superpowers/specs/2026-11-03-aipm-merge-design.md`（审计模型）·
`docs/superpowers/specs/2026-11-03-aipm-frontend-design.md` §3.5–§3.7（前端要消费的形状）

**关系：** 这是
[AI 服务垂直切片](2026-11-04-aipm-ai-service-slice.md) 之后的前置 —— 前端工作台
（Plan C′-2）要靠这两个端点填「待确认」与「审计」两个页签。

---

## Global Constraints

- **仓库**：`D:/project/ai-admin-ai`（独立 git 仓；`.env` 已就位且 **不入库**）。
- **本计划只加只读端点**：不实现撤销（补偿式撤销属完整版计划的 Task 4），
  不实现待确认的挂起/恢复机制（服务端 `pi.on("tool_call")` 的 `{block:true}` 路径
  属完整版的 Task 7）。**前端这两处的按钮要么不出现，要么禁用并说明。**
- **用户身份透传**：每个端点从 `Authorization: Bearer <token>` 取**调用方的** token；
  服务端**不解析 token 内容**（AiAdmin 才是权威）。缺 token ⇒ 401 信封。
- **数据作用域**：只返回**当前用户自己**的行（`ai_pending_action.userId` /
  `ai_audit_log.userId` 必须等于调用方的 AiAdmin user id）。**不要返回别人的行。**
- **响应信封**：`{ code, msg, data }`，成功 `code === 0`（复用 `src/types/api.ts` 的
  `isSuccess`）。
- **CORS**：回**具体的**已登记源（`env.ALLOWED_ORIGINS`），**不能用 `*`**。
- **不打印** API key、数据库密码、用户的 access token。
- **不 push**（这个仓还没有远端）。
- TypeScript strict；无 `any`；中文注释。
- 提交信息用中文；subject 不得以大写拉丁词开头。

---

### Task 1: `GET /api/audit` —— 审计流水

**Files:**
- Create: `src/app/api/audit/route.ts`、`src/audit-query.ts`
- Test: `src/audit-query.test.ts`

**Interfaces:**
- Consumes: `prisma`（Task 2 的切片）、`src/agent/identity.ts`（解析调用方身份 ——
  **先读这个文件，看它导出什么、怎么用**）
- Produces（**前端按这个形状写**）:

```
GET /api/audit?limit=50&offset=0&actor=AI|USER&command=create_task
→ {
    code: 0, msg: "成功",
    data: {
      total: 42,
      items: [
        { id: "7", command: "create_task", actorType: "AI",
          actorName: "管理员",
          args: { project_key: "PRJ-2026-Q3-001", title: "…" },
          before: null,
          after: { id: 104, title: "…", status: "BACKLOG", priority: "P1" },
          undoOf: null, undoneAt: null, adopted: null,
          model: "minimax-cn/MiniMax-M3.1-Flash", tokens: null,
          latencyMs: 1234, traceId: null, error: null,
          createdAt: "2026-11-04T15:43:04.152Z" }
      ]
    }
  }
```

- **筛选**：`actor`（`AI`/`USER`）、`command`、`limit`（默认 50，上限 200）、
  `offset`、`undone`（`true` = 只看已撤销的；省略 = 全部）。`from`/`to`（时间区间）
  **本轮不做**，但**参数先留着**（前端会传未知参数，服务端忽略即可 —— 不要因为不认识的
  query 参数就报错）。
- **`actorName`**：审计行里没有用户名字段（只有 `userId`）。**用调用方的 token 向 AiAdmin
  取一次当前用户**（`GET /system/user/current/info`），把 `name` 填进去；取不到就填
  `userId` 字符串。**不要为了填名字去 N+1 查询**。
- **`args` 必须脱敏**：沿用 `src/tools/create-task.ts` 里已有的脱敏逻辑（按键名
  `token`/`password`/`secret`/`authorization` 替换）。**不要把原始 args 直接吐出去。**
- **`total`**：符合筛选条件的总行数（`prisma.<model>.count`）。

- [ ] **Step 1: 写失败的测试** —— `src/audit-query.test.ts`（用注入的假 prisma，不连库）：
  - `只返回当前用户的行` —— 断言查询里带了 `userId` 过滤
  - `actor 筛选` / `command 筛选` 传进 prisma 的 where
  - `limit 上限 200`
  - `args 里的 token 被脱敏`
  - `after/before 原样透出`
  - `total 用 count`
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/audit-query.test.ts` → Expected: FAIL
- [ ] **Step 3: 实现** —— `src/audit-query.ts`（纯函数：`(prisma, userId, query) => data`）
  与 `src/app/api/audit/route.ts`（薄壳：取 token → 解析身份 → 调 query → 包信封）。
  **先读 `src/agent/identity.ts`**，复用它解析调用方身份的方式，不要另写一套。
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 审计只读端点

- GET /api/audit 返回当前用户自己的审计流水(actor/command/limit/offset 筛选)
- args 按键名脱敏(token/password/secret/authorization)
- total 用 count;actorName 取一次当前用户,不 N+1
EOF
```

---

### Task 2: `GET /api/pending` —— 待确认列表

**Files:**
- Create: `src/app/api/pending/route.ts`、`src/pending-query.ts`
- Test: `src/pending-query.test.ts`

**Interfaces:**
- Consumes: `prisma`、`src/agent/identity.ts`
- Produces:

```
GET /api/pending?status=PENDING
→ {
    code: 0, msg: "成功",
    data: [
      { id: "act_1", conversationId: "cmw2…", command: "batch_update_tasks",
        args: { … }, preview: { title: "…", hits: [ { title, from, to, owner } ], warning: "…" },
        status: "PENDING", expiresAt: "2026-11-04T16:13:04.152Z",
        createdAt: "…" }
    ]
  }
```

- **只返回当前用户的行**（`userId` 过滤），`status` 缺省 `PENDING`。
- **`preview` 原样透出**（它本来就是 JSON 列）。
- **诚实说明**：切片里**没有任何命令会进待确认**（唯一的 `create_task` 是非破坏性的，
  不需要确认），所以这个列表**现在是空的**。**端点必须真的存在、真的读表** ——
  前端的「待确认」页签要能显示空态，也要能在完整版落地后立刻有数据。
- **不要**在这里实现挂起/恢复机制（属完整版 Task 7）。

- [ ] **Step 1: 写失败的测试** —— `src/pending-query.test.ts`：
  - `只返回当前用户的行`；`status 缺省 PENDING`；`preview 原样透出`
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/pending-query.test.ts` → Expected: FAIL
- [ ] **Step 3: 实现** —— 同 Task 1 的形状（query 函数 + 薄路由）
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 手工验证** —— 起服务 `npm run dev`，用真实 token 打一次
  `GET /api/pending`，**贴出真实响应**（应当是 `data: []`）；再打一次
  `GET /api/audit`（应当能看到之前那些 `create_task` 的审计行 —— 注意那些行是
  **实现者**跑测试时写的，`ai_audit_log` 里可能还有几行；**不要删**它们，
  它们是真实审计流水）。
  ⚠️ **不要**为了验证去写新的审计行（那会污染共享库）。
- [ ] **Step 6: 提交**

```bash
git add -A && git commit -F - <<'EOF'
feat(ai): 待确认只读端点

- GET /api/pending 返回当前用户自己的待确认行(status 缺省 PENDING)
- 切片里没有命令会进待确认(create_task 非破坏性),列表现在是空的,
  但端点是真的读表,完整版落地后前端立即有数据
EOF
```

---

## 完成判据

- [ ] `npx vitest run` 全绿 · `npx tsc --noEmit` 干净 · `npm run build` 成功
- [ ] 两个端点都用**真实 token** 手工验证过，响应贴进报告
- [ ] 共享生产库**没有**因为验证而多出数据
- [ ] README 补上这两个端点（契约清单要与实现一致）

## 切片之外（完整版计划里的后续任务）

- **补偿式撤销**（`POST /api/audit/:id/undo`）—— 完整版 Task 4
- **待确认的挂起/恢复**（`pi.on("tool_call")` 返回 `{block:true, reason}`）—— 完整版 Task 7
- **审计里的引用回跳**（`after` 里的实体 id → 前端跳到对应页面）—— 前端侧做
