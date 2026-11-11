# ai-admin-ai

AiAdmin 的 **AI 编排服务**（独立仓）。业务事实源是 AiAdmin 后端的 API，本服务只保存 AI 运行时
必需的元数据（`ai_*` 表），并对外提供对话 / 命令接口。

| 角色 | 位置 |
| --- | --- |
| 前端 | `D:/project/ai-admin-com`（Ant Design Pro） |
| 后端（业务事实源） | `D:/project/AiAdmin/backend`（FastAPI） |
| 本服务 | 本仓：Express 5（Node HTTP 层）+ pi SDK + Prisma（MySQL）+ Vitest |

## 快速开始

```bash
npm install
cp .env.example .env      # 填真值：模型 key / 数据库口令
npm run dev               # http://localhost:3100（tsx 热重载）
```

生产：

```bash
npm run build             # tsc ⇒ dist/（ESM）
npm start                 # node --env-file=.env dist/main.js
```

> **为什么不用 Next.js**：本服务**不渲染任何页面**，只有 10 个 HTTP 端点。
> agent 内核（`src/agent/**`）对框架零依赖 ⇒ Next 当年只是一层路由壳，
> 却带来了打包器、`serverExternalPackages`、全局单例热重载一堆包袱。
> 2026-11-11 起 HTTP 层换成 **Express 5**，产物是 `tsc` 编译的 **ESM**
> （pi SDK 是 ESM-only，CommonJS 产物 `require` 不了它）。
> 对外行为（路径、状态码、信封、CORS、SSE 帧）由 `src/routes/contract.ts`
> 的**契约表**锁住，迁移前后跑的是同一张表。

## 环境变量

| 变量 | 说明 | 必填 |
| --- | --- | --- |
| `MINIMAX_CN_API_KEY` | minimax-cn 的 api key（pi SDK 只靠这个环境变量鉴权） | 是 |
| `AI_MODEL` | 模型标识，如 `minimax-cn/MiniMax-M3.1-Flash` | 是 |
| `AI_THINKING_LEVEL` | 思考级别（`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`），**缺省 `off`** | 否 |
| `AIADMIN_BASE_URL` | AiAdmin 后端地址，base 里已含 `/api/v1` | 是 |
| `DATABASE_URL` | AiAdmin 的 MySQL 连接串（`ai_*` 元数据表与业务表**同库**） | 是 |
| `ALLOWED_ORIGINS` | 允许跨域的前端源，逗号分隔（回具体的源，不用 `*`） | 是 |

- `.env` **不入库**（里面有模型 key 与数据库口令），仓库里只有 `.env.example`。
- `src/env.ts` 用 zod 校验，**缺哪个变量就在启动时报哪个**（不等到第一个请求打进来才炸）。
- 校验发生在 **import 时**（`env.ts` 模块级就执行 `parseEnv`）⇒
  **启动服务必须有 `.env`**（`npm run dev` / `npm start`）。
  ℹ️ `npm run build` 只是 `tsc` 类型检查，**不执行代码** ⇒ 构建机上不需要 `.env`。
- 端口：缺省 **3100**，可用 `PORT` 环境变量覆盖。
- ⚠️ **`AI_THINKING_LEVEL` 默认 `off`**：开了思考 ⇒ 模型**先想再写** ⇒ 用户等得更久。
  开了它，服务端会把思考增量以 `thinking_delta` 事件外发 ⇒ 前端显示「思考中…」。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（3100 端口，`tsx watch` 热重载） |
| `npm run build` | 生产构建（`tsc` ⇒ `dist/`，ESM） |
| `npm start` | 起服务（`node --env-file=.env dist/main.js`） |
| `npm test` | Vitest 单元测试（`src/**/*.test.ts`） |
| `npm run typecheck` | `tsc --noEmit` |

测试用的环境变量是**假值**，写在 `vitest.config.ts` 的 `test.env` 里；真值只在 `.env`。

> ⚠️ **改了 `src/agent/` 下的代码要重启 dev 服务器**：`src/agent/runtime.ts` 把运行时挂在
> `globalThis` 上（dev 热重载不重复建会话），热重载后进程里**还是旧的运行时实例**，
> 新代码不生效。生产环境每次部署都是新进程，不受这条影响。

---

## 接口（前端按这份契约接）

对话那四件套在 `/api/agent` 下，审计流水在 `/api/audit`，待确认列表在 `/api/pending`；
响应一律是 `{code, msg, data}`（`code === 0` 为成功）。

| 接口 | 说明 |
| --- | --- |
| `POST /api/agent/conversations` | 新建会话 → `{conversationId, title, createdAt}` |
| `GET /api/agent/conversations` | 列会话 → `[{conversationId, title, updatedAt}]` |
| `POST /api/agent/:cid/command` | 提交命令（`{id, type, message}`）→ `{id, type:'response', success:true}` |
| `POST /api/agent/:cid/abort` | **中止**当前那一轮 → `{conversationId, aborted:true}` |
| `GET /api/agent/:cid/events` | **SSE** 事件流（`text/event-stream`） |
| `GET /api/agent/:cid/state` | 会话快照 → `{conversationId, messages[], isStreaming, model}` |
| `GET /api/audit` | 审计流水 → `{total, items[]}`（**只看自己的行**） |
| `GET /api/pending` | 待确认列表 → `[{id, conversationId, command, args, preview, status, expiresAt, createdAt}]`（**只看自己的行**） |

### 审计（只读）

`GET /api/audit?actor=&command=&limit=&offset=&undone=` → `{total, items[]}`。

- **只看自己的行**（按 `userId` 过滤）—— 别人的审计流水一条都不返回；
- `limit` 缺省 50、**上限 200**；`offset` 缺省 0；新的排在前面；
- `actor`（`AI`/`USER`）、`command`（精确匹配）、`undone=true`（只看已撤销的）；
- **不认识的 query 参数静默忽略**（前端会多传 `from` / `to`，本轮不做时间区间）；
- `items[]` 的每一项：`{id, command, actorType, actorName, args, before, after,
  undoOf, undoneAt, adopted, model, tokens, latencyMs, traceId, error, createdAt}`；
- ⚠️ `args` **已脱敏**（凭据类键名的值换成「[已脱敏]」，与写审计同一份实现）。

### 待确认（只读）

`GET /api/pending?status=&limit=` → `data` 是**数组**（没有 `total`）。

- **只看自己的行**（按 `userId` 过滤）—— 别人的待确认行一条都不返回；
- `status` **缺省 `PENDING`**（只看待确认的；认得 `PENDING`/`CONFIRMED`/`REJECTED`/`EXPIRED`/`EXECUTED`，
  别的值当没传 ⇒ 仍按 `PENDING` 查，不报错）；
- `limit` 缺省 50、**上限 200**；新的排在前面；
- **不认识的 query 参数静默忽略**（前端会多传 `from` / `to`，本轮不做时间区间）；
- `data[]` 的每一项：
  `{id, conversationId, command, args, preview, status, expiresAt, createdAt}`
  —— `id` 是**字符串**（前端当不透明 key 用）、`conversationId` 没有就是 `null`、
  `expiresAt`/`createdAt` 是 ISO 字符串；
- `preview` 是 JSON 列，**原样透出**（`{title, hits[], warning}` 这类给人看的摘要）；
- ⚠️ `args` **已脱敏**（与审计读侧共用同一份实现）；
- ℹ️ **现在这个列表是空的**：当前切片里唯一的命令 `create_task` 是**非破坏性**的
  （新建的东西可以补偿撤销）⇒ 不需要先问人 ⇒ 没有命令会写 `ai_pending_action`。
  端点是真的读表的（不是写死的空数组）⇒ 前端的空态是真的，
  完整版的确认流程（挂起/恢复）落地后这里立刻就有数据。

### 鉴权

每个接口都要带 **`Authorization: Bearer <token>`**（前端自己的登录 token）。

- 本服务**不解析 token**，只把它**透传**给 AiAdmin —— AiAdmin 才是权威；
- **缺 token ⇒ 401 信封**；token 无效时 AiAdmin 说了算（本服务如实转成 401）；
- token **绝不**进日志、进错误消息、进数据库（只在内存里待着）。

### CORS

`Access-Control-Allow-Origin` 回 `env.ALLOWED_ORIGINS` 里的**具体源**（**不用 `*`** ——
请求带 `Authorization`，`*` 会被浏览器拒掉）。预检（`OPTIONS`）会回
`Access-Control-Allow-Headers: authorization, content-type` 与 `Access-Control-Max-Age: 300`。

### SSE 事件

> ⚠️ **前端不能用浏览器的原生 `EventSource`**：它**不能自定义请求头**，
> 而 `/api/agent/:cid/events` 必须要 `Authorization: Bearer <token>`（缺了就 401）。
> ⇒ 前端要用 **`fetch` + `ReadableStream`**（读 `response.body` 的流）自己解析 SSE 帧：
> `fetch(url, { headers: { Authorization: \`Bearer ${token}\` } })`，
> 然后按 `\n\n` 切帧、按 `event:` / `data:` 取内容。前端设计已经定了这个方案。

| 事件 | 载荷 |
| --- | --- |
| `connected` | `{conversationId, isStreaming}` |
| `message_start` / `text_delta` / `message_end` | 助手说的话（`message_start` 在第一条文本增量到来时才发 ⇒ 没有空气泡） |
| `thinking_delta` | 模型的思考增量（**只在 `AI_THINKING_LEVEL` 不为 `off` 时才有**；思考不是对话内容 ⇒ 前端显示「思考中…」而不是进气泡） |
| `tool_call` | `{toolName, args}` |
| `tool_result` | `{toolName, status:'ok'|'error', summary, details}` |
| `agent_settled` | 一轮结束 |

- 首帧是 `connected`，接着回放这个会话**之前**发生过的帧，再接增量；
- 每 15 秒一个心跳（`: heartbeat` 注释行，标准的 SSE 客户端会忽略它）；
- 回放窗口上限 16 MB，超了**先丢 `text_delta`**（可从 `state` 快照重建），保留结构帧；
- **`state` 才是真相**：SSE 是增量的，断线/刷新后用 `GET /api/agent/:cid/state` 重建界面。

### 命令类型

`POST /api/agent/:cid/command` 的 `type` 有三种：

| type | 含义 |
| --- | --- |
| `prompt` | 说一句话（**默认**）。当前没有轮次在跑 ⇒ 立刻开始跑；在跑 ⇒ 排队（**不打断**） |
| `prompt-followup` | 明确排队：当前轮干完活再处理这句 |
| `prompt-steer` | **打断**：插到当前助手轮次（及其工具调用）之后、下一次模型调用之前 |

- 后两种是 pi SDK 的**原生**排队语义（`session.followUp()` / `session.steer()`），
  不是本服务自己造的队列；
- ⚠️ 同一个 `id` 重复提交仍然**只跑一遍**（幂等），三种类型都算；
- ⚠️ `success: true` 的含义是「**已受理并排队**」，不是「这一轮跑完了」。

### 中止

`POST /api/agent/:cid/abort` → `{conversationId, aborted: true}`。

- 停掉**当前正在跑**的那一轮（pi 的 `session.abort()`），随后 pi 自己会发
  `agent_settled` ⇒ 前端输入框解禁；
- ⚠️ **中止不是回滚**：这一轮已经落库的消息（用户那句话、助手已写出的部分）都还在，
  已经建出来的任务也不会被撤销；
- 会话必须属于当前用户，否则 404。

### 命令

目前只有一个命令：**`create_task`**（非破坏性 ⇒ 不需要用户先确认）。
模型全靠工具描述决定用不用它，所以描述写清了「什么时候用 / 什么时候别用 / 参数格式与单位」；
参数名用**统一领域名**（`project_key` / `title` / `type` / `status` / `priority`），
不出现后端字段名（`project_id` 之类）。

⚠️ **破坏性由工具自己的 `annotations.destructiveHint` 决定**（SDK 的 `ToolAnnotations`），
没有另一个手写的开关 —— 「要不要先问人」只有一个事实源。

### 前端怎么接

开发期在前端加一条代理（`ai-admin-com` 的 config）：

```ts
proxy: {
  '/ai-api': { target: 'http://localhost:3100', changeOrigin: true },
},
```

然后前端把 AI 相关请求打到 `/ai-api/api/agent/...`；或者直接用
`AI_API_BASE_URL=http://localhost:3100`（跨域时记得把源加进本服务的 `ALLOWED_ORIGINS`）。

---

## 数据库（⚠️ 共享库，谨慎）

`ai_*` 元数据表与 AiAdmin 的业务表在**同一个库** `aipm` 里（AiAdmin 56 张业务表 + 本服务 5 张表）。

> ### ⚠️ 禁止 `prisma migrate dev` / `prisma migrate reset`
>
> 这两条命令会把「不在本仓 schema 里的表」当成 **drift**，然后要求 **reset 整个库** ——
> 也就是 `DROP DATABASE aipm`，连 AiAdmin 的业务表一起没。
> 共享库上 `migrate deploy` 在没有迁移历史时也会报 P3005 拒绝动手。

### 第一个迁移（已做完；这里是它是怎么做的）

```bash
# 1) 生成建表 SQL（不连库、不做 drift 检查）
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/init.sql

# 2) 人工审一遍 —— 它只该含本次的 5 张 ai_ 表。若出现任何别的表，停下来报告。

# 3) 执行（db execute 不做 drift 检查，只跑你给的语句）
npx prisma db execute --schema prisma/schema.prisma --file /tmp/init.sql

# 4) 建基线：把首个迁移登记为「已应用」，但不执行它
npx prisma migrate resolve --applied 0_init_ai_tables
```

> **Windows（Git Bash）注意**：`prisma db execute --file` 收的是 Windows 路径，
> `/tmp/init.sql` 要先过一道 `cygpath -w`：`--file "$(cygpath -w /tmp/init.sql)"`。

第 4 步要求 `prisma/migrations/0_init_ai_tables/migration.sql` 存在（内容 = 第 1 步那份审过的 SQL）。

### 之后的迁移

**顺序铁律：先生成迁移、人工审、`deploy`，最后才提交 schema 改动。** 基线必须是
「最后一次已应用迁移那会儿的 schema」，**不是工作树的 `HEAD`** —— 若先把 schema 改动
commit 了再拿 `HEAD` 当基线，diff 会是空的；空迁移 `deploy` 到共享库是个**静默 no-op**，
不报任何错，改动就这么悄悄丢了。

```bash
# 1) 取基线：引入「最新一条迁移文件」的那个提交里的 schema。
#    惯例是迁移和 schema 一起提交，所以那个提交的 schema 正是上次部署后的状态；
#    而且它不随你本次是否提前 commit 了 schema 而漂移 —— 这正是不能拿 HEAD 当基线的原因。
git log -1 --diff-filter=A --format=%H -- prisma/migrations   # 输出 <base_sha>
git show <base_sha>:prisma/schema.prisma > /tmp/schema_before.prisma

# 2) 离线算「上一版 → 下一版」的差量
#    （离线 = 不连库、不做 drift 检查，绝不会把别人的表算成 DROP）
mkdir -p prisma/migrations/<时间戳>_<名字>
npx prisma migrate diff \
  --from-schema-datamodel /tmp/schema_before.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<时间戳>_<名字>/migration.sql

# 3) 人工审这份差量：只该含本次的改动；出现任何别的表（尤其 DROP TABLE）→ 停下报告。
#    ⚠️ 空 SQL = 红灯，立刻停，别 deploy：
[ -s prisma/migrations/<时间戳>_<名字>/migration.sql ] || echo "⚠️ 迁移是空的 —— 基线取错了，或这条迁移早已做完并提交；回第 1 步重取基线再生成"
#    （空迁移上了共享库，就把「没生成出来」伪装成「已上线」，问题被藏起来。）

# 4) 确认无误才执行
npx prisma migrate deploy --schema prisma/schema.prisma

# 5) 到这一步才提交：schema 与新迁移目录一起
#    （维持「迁移提交里的 schema = 部署后状态」的惯例，第 1 步靠它取基线）
git add prisma/schema.prisma prisma/migrations/<时间戳>_<名字>/
```

`migrate deploy` 不做 drift 检查、只认本仓的迁移历史，不会碰别人的表。

> ⚠️ **不要用 `--from-schema-datasource`**（拿线上库当「起点」）：那样会把 AiAdmin 的 56 张表
> 全算成 `DROP TABLE` 写进迁移文件。要拿「上一版 schema」当起点，就用上面的
> `--from-schema-datamodel`（拿 git 里的旧 schema 比）。

### 其它约定

- **Prisma 版本钉死 `6.19.1`**（`prisma` 与 `@prisma/client` 都是）。npm 上的 `latest` 是
  `8.0.0-rc.30`，CLI 整个换了一套（没有 `prisma migrate` / `prisma validate`），不要用 `npm i prisma`。
- **表名/列名一律小写下划线**（MySQL `lower_case_table_names = 1`）。
- 库里还有一张**后端遗留的空表 `ai_action_log`**（AiAdmin PRD-v2 §7，源码里没有 model）——
  **不是本服务的表，不要动、不要重名**。

## pi SDK 与运行形态

pi SDK（`@earendil-works/pi-coding-agent`）是 **ESM-only**（它的 `exports` 只有 `import`）
⇒ 产物必须是 ESM ⇒ `tsc` 用 `module: nodenext` + `rewriteRelativeImportExtensions` 编译，
源码里的相对 import 一律带 `.ts` 后缀（`scripts/add-ts-extensions.mjs` 批量改）。

⚠️ **pi SDK 不能被打包**（它带 `node:fs` / `jiti` / wasm 等原生与动态依赖）
⇒ 只转译、不 bundle，依赖留在 `node_modules`。

尖峰阶段的实测结论（pi SDK 的真实 API、SSE 行为、Prisma 在共享库上的脾气）都在
[`spike/FINDINGS.md`](spike/FINDINGS.md)，写代码前先读它。

### 上下文怎么进到模型里（⚠️ 容易写错）

pi 的 SDK 文档说得很直白：

> **SessionManager is authoritative for finalized model context.**
> Restore external history by constructing the session with a manager containing those entries.
> Assigning `session.agent.state.messages` **does not** replace persisted context.

本服务把对话历史存在自己的 `ai_message` 表里，而 pi 会话是**内存态、懒创建**的
（进程重启就没了；通道空闲 30 分钟也会被回收）⇒

⇒ 建 pi 会话时，**把 `ai_message` 里的历史还原成 pi 的 entries**，
交给 `SessionManager.inMemory(cwd, { id }, entries)`（见 `src/agent/session-entries.ts`）。

- 不还原的话：**前端看得见历史，模型看不见**（用户会觉得「AI 明明看得到，却像第一次见我」）；
- ⚠️ **当前这一句要排除在历史之外** —— 它随后会被 `session.prompt(message)` 加进
  pi 的消息列表，两边都放 ⇒ 模型看到同一句话两遍；
- ⚠️ `session.agent.state.messages = ...` 那条路**不生效**（SDK 文档明说），
  上下文只有 `SessionManager` 一个权威来源；
- 附带好处：pi 的 compaction（长对话自动摘要）也随之生效（没有 entries 它无从下手）。

## 目录

```
prisma/schema.prisma              5 张 ai_* 元数据表（单租户，无 tenant_id）
prisma/migrations/                迁移历史（0_init_ai_tables = 基线）
src/env.ts                        环境变量校验（zod；缺变量启动即失败）
src/db.ts                         PrismaClient 单例（globalThis 缓存，dev 热重载不漏连接）
src/types/api.ts                  AiAdmin 响应信封（ApiResponse / SUCCESS_CODES / isSuccess）
src/aadmin/                       AiAdmin HTTP 客户端（client / errors / types：路径、字段逐字对齐后端）
src/adapter/                      适配层（enums 枚举归一 / capabilities 能力位 / keys 统一 key / model 统一模型 / datasource 读写）
src/agent/                        agent 运行时（runtime 会话与命令 / session-registry 通道与订阅 / startup-lock 同会话串行 / event-mapper 事件映射 / frame-buffer 回放窗口 / identity 当前用户 / pi-session SDK 接线 / **session-entries 历史→pi entries** / prompt 系统提示词 / store 落库）
src/audit.ts                      审计的**写侧**（每次 AI 写入留一条 ai_audit_log）
src/audit-redact.ts               审计参数脱敏（**写侧与读侧共用同一份**）
src/audit-query.ts                审计的**读侧**（只看自己的行 + 筛选 + 脱敏 + 分页）
src/pending-query.ts              待确认的**读侧**（只看自己的行 + status 缺省 PENDING + preview 原样透出）
src/tools/                        命令目录（create_task 一个命令 + 闸门形状）
src/http/                         HTTP 通用件（cors / respond 信封 / auth 取 token / sse 帧格式 / errors 错误映射 / body 读 JSON）
src/routes/                       ★ Express 路由（agent 会话与命令 / pending 待确认 / audit 审计 / events SSE / support 小工具 / contract **契约表**）
src/server.ts                     ★ Express app 装配（createApp / start / CORS 中间件 / JSON 404 / 错误中间件）
src/main.ts                       ★ 进程入口（node dist/main.js 就是它）
.pi/skills/<name>/SKILL.md        ★ 技能（**加 AI 能力不用改代码**；见下面那节）
spike/                            Task 1 的风险尖峰（一次性，结论在 spike/FINDINGS.md）
```

## MCP：工具从哪来（后端接口 ⇒ AI 的能力）

**一句话**：AiAdmin 的接口被后端挂成 **MCP tool** ⇒ AI 直接调用它们。
**后端加接口，AI 侧一行代码都不用改。**

| 事项 | 说明 |
| ---- | ---- |
| 开启方式 | 配 `AIADMIN_MCP_URL`（一般是 `${AIADMIN_BASE_URL}/mcp`）；**不配就不接**（AI 仍能用，只是没有那些工具） |
| 工具名 | `mcp__aiadmin__<工具名>`（模型看到的是带前缀的名字） |
| 身份 | 每个会话带**当次调用方的 JWT** ⇒ 后端的权限码校验原样生效（用户在 AiAdmin 的权限 = AI 能替他做的范围） |
| 换 token | 调用方 token 变了 ⇒ **重建会话**（老会话的 MCP 连接还带着旧 token ⇒ 会越权） |
| 连不上 | **会话照常能用**（只是没有那些工具）⇒ 后端还没部署 MCP 也不影响 |

### 怎么用

1. 后端把 `module_mcp` 合并部署，并把 `MCP_INCLUDE_TAGS` 开到要暴露的模块（默认只有「任务模块」）。
2. 本服务配 `AIADMIN_MCP_URL` ⇒ 重启。
3. **验证**：让 AI 说一句「列一下项目」⇒ 看 SSE 里的 `tool_call` 是不是 `mcp__aiadmin__*`。

### 与技能的关系

- **工具**（MCP）= 能做什么（后端给的）；
- **技能**（`.pi/skills/*/SKILL.md`）= 怎么用（人写的配方）。

⇒ **加能力不用改代码**：后端加接口（自动成为工具）+ 写一个技能（教模型怎么用）。

---

## 待确认（修改已有数据要人点头）

**口径**：**新增放行、修改要点头**（`update_*` / `patch_*` 类的工具要等人在界面上点「同意」）。

机制：pi 的 `tool_call` hook（**async 且被 await**）里**同步等批准** ⇒
批准后 **pi 照常执行原工具调用** ⇒ **模型那一轮不打断**（不用往会话里注入系统消息）。

```
用户：把任务 117 的标题改成「…」
  ↓ 模型先 get_task_detail（读，不拦）
  ↓ 模型调 update_task（改）⇒ **挂起**
  ↓ SSE 推 pending 事件 ⇒ 界面出现「⏳ 等待你确认」
  ↓ 用户在「待确认」页签点「同意」⇒ hook 放行 ⇒ 原调用执行
助手：改好了。任务 117 的标题：「…」→「…」，其余字段保持不变。
```

| 事项 | 说明 |
| ---- | ---- |
| 拦哪些 | 工具名里的 `update_` / `patch_`（`create_` / `list_` / `get_` 一律放行） |
| 挂起存哪 | **进程内存**（一个 await）⇒ 进程重启会丢掉 ⇒ DB 里那条 `ai_pending_action` 会停在 PENDING（靠 `expiresAt` 兜底） |
| 超时 | 缺省 5 分钟 ⇒ 超时按「拒绝」处理（宁可不做） |
| 端点 | `POST /api/agent/pending/:id/approve` 与 `/reject`（**只有发起这次对话的用户能批**；重复批准不会重复执行） |
| 审计 | 「谁批准的」记在 `ai_pending_action.resolvedBy` |

⚠️ **实测出来的坑**：`tool.execute(...)` 是**直接调工具** ⇒ 绕过整条流水线 ⇒
`tool_call` hook **不会触发** ⇒ 真链路里要过 `session.agent.beforeToolCall(...)`。

## 技能（SKILL.md）：加 AI 能力不用改代码

**一句话**：加一条 AI 能力 = 在 `.pi/skills/<名字>/SKILL.md` 放一个 markdown 文件，
**不用写 TypeScript、不用改本仓的代码**。

```markdown
---
name: create-task
description: 在 AiAdmin 的项目下新建一条任务。用户说「建个任务」时用。
---

# 建任务

1. 先用你工具里那个**列项目**的工具按编码找到项目 id；找不到 ⇒ 问用户，不要编。
2. 再用你工具里那个**建任务**的工具建任务（project_id / title / reporter_id …）。
3. 回报：任务标题、所属项目、状态、任务 key。
```

- **两个必填字段**：`name`（小写字母数字与连字符）与 `description`
  （**路由依据** —— 模型靠它决定要不要加载这个技能 ⇒ 写清「什么时候用」）。
- 正文是**给模型看的操作说明**：写「先做什么、再做什么、参数怎么填、
  什么时候该问用户」。
- **不要写死工具名**（工具名会随后端 MCP 接入而变）⇒ 写「你工具里那个…的工具」，
  并补一句「工具里没有它 ⇒ 直接说这个能力还没接上，不要瞎编工具名」。
- 附属文件（参考资料等）可以放在技能目录里，模型用 `load_skill` 读。

### 生效方式与边界

| 事项 | 现状 |
| ---- | ---- |
| 生效 | **重启服务**（pi 的 `/reload` 只在交互式会话里可用） |
| 技能来源 | **只有 `.pi/skills/`**（用户家目录的 `~/.agents/skills` 会被过滤掉） |
| 模型能读什么 | **只有技能目录内的文件**（pi 的 `read`/`bash` 工具是关着的） |
| 三个样板 | `create-task` / `list-tasks` / `update-task`（**都已按真实 MCP 工具写准**，2026-11-07 真实后端跑通） |

### 验收记录（2026-11-07，真实后端）

后端 `module_mcp` 上线后，用真账号跑通了完整链路：

```
用户：在项目 6 建一个任务，标题写「【AI 验收】冒烟测试」，类型 feature，优先级 p2
  ↓ 模型先 load_skill(create-task) → 再调 mcp__aiadmin__create_task
  ↓ 参数：{"project_id":6,"title":"【AI 验收】冒烟测试","type_code":"feature","status_code":"todo","priority_code":"p2"}
  ↓ 后端：创建任务成功 ⇒ 落库核对 id=117
助手：任务已创建：ID 117，「【AI 验收】冒烟测试」，项目 6，类型 feature，优先级 p2，状态 todo。
```

⇒ **业务同学写 markdown 就能加能力**，这条主张已被真实后端证明。

⚠️ 真实工具的口径（样板里已写进去）：

- 工具名 = `mcp__aiadmin__` + 后端 operation_id（`list_tasks` / `get_task_detail` / `create_task` / `update_task` / `patch_task_status`）
- **码是小写字典码**（`feature` / `todo` / `p0`），不是 `FEATURE` / `TODO` / `P0`
- `create_task` 的 `reporter_id` / `sort_order` / `created_via_code` **不用传**（后端自动填）
- `update_task` 是 **PUT 全量更新**：缺任一必填字段就 422 ⇒ 先 `get_task_detail` 再整体提交；只改状态用 `patch_task_status`

⚠️ 技能内容会进模型上下文 ⇒ **它等同于提示词** ⇒ 走 git 评审（别往里写凭据）。

### 五张表

| 表 | 是什么 |
| --- | --- |
| `ai_conversation` | 会话（一次连续对话） |
| `ai_message` | 会话里的消息（USER / ASSISTANT / SYSTEM） |
| `ai_pending_action` | **待人决定**的动作（等人确认后才执行） |
| `ai_audit_log` | **已经发生**的动作审计（由 pending_action 确认执行后生成，可被撤销） |
| `ai_entity_ref` | 外部业务实体的本地引用（只存 id 与标题缓存，不复制业务数据） |

`ai_pending_action` 与 `ai_audit_log` 是**两张表**，不是一个状态字段：前者是「待人决定」，后者是「已发生」。
