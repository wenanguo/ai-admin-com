# ai-admin-ai

AiAdmin 的 **AI 编排服务**（独立仓）。业务事实源是 AiAdmin 后端的 API，本服务只保存 AI 运行时
必需的元数据（`ai_*` 表），并对外提供对话 / 命令接口。

| 角色 | 位置 |
| --- | --- |
| 前端 | `D:/project/ai-admin-com`（Ant Design Pro） |
| 后端（业务事实源） | `D:/project/AiAdmin/backend`（FastAPI） |
| 本服务 | 本仓：Next.js（Route Handler）+ pi SDK + Prisma（MySQL）+ Vitest |

## 快速开始

```bash
npm install
cp .env.example .env      # 填真值：模型 key / 数据库口令
npm run dev               # http://localhost:3100
```

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
- 校验发生在 **import 时**（`env.ts` 模块级就执行 `parseEnv`）。`next build` 也会加载路由模块，
  所以一旦路由（或路由引用到的模块）import 了 `env.ts`，**构建机上也得有 `.env`** ——
  Next 在 build 时同样会加载 `.env`。
  ⚠️ **本仓现在就是这样**：`/api/agent/**` 的路由 import 了 `agent/runtime.ts`，
  而运行时 import 了 `env.ts` ⇒ **`npm run build` 也需要 `.env`**（构建机上没有就会失败）。
  真要把校验推迟到运行时，得改用 `instrumentation.ts`（本仓不这么做）。
- 端口**不走环境变量**：钉在 `package.json` 的脚本里（`next dev -p 3100` /
  `next start -p 3100`），要换端口改 scripts。
- ⚠️ **`AI_THINKING_LEVEL` 默认 `off`**：开了思考 ⇒ 模型**先想再写** ⇒ 用户等得更久。
  开了它，服务端会把思考增量以 `thinking_delta` 事件外发 ⇒ 前端显示「思考中…」。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（3100 端口） |
| `npm run build` / `npm start` | 生产构建 / 起服务 |
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

## pi SDK 与 Next.js

pi SDK（`@earendil-works/pi-coding-agent`）必须列进 `next.config.ts` 的 `serverExternalPackages`，
否则 Next 的打包器会去处理它的 `node:fs` / `jiti` / wasm 依赖，运行时报错。
Route Handler 里还要显式写 `export const runtime = "nodejs"`。

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
src/http/                         HTTP 通用件（cors / respond 信封 / auth 取 token / sse 帧格式 / errors 错误映射）
src/app/                          Route Handler（/api/agent/** 、/api/audit 与 /api/pending；尖峰路由已删）
spike/                            Task 1 的风险尖峰（一次性，结论在 spike/FINDINGS.md）
```

### 五张表

| 表 | 是什么 |
| --- | --- |
| `ai_conversation` | 会话（一次连续对话） |
| `ai_message` | 会话里的消息（USER / ASSISTANT / SYSTEM） |
| `ai_pending_action` | **待人决定**的动作（等人确认后才执行） |
| `ai_audit_log` | **已经发生**的动作审计（由 pending_action 确认执行后生成，可被撤销） |
| `ai_entity_ref` | 外部业务实体的本地引用（只存 id 与标题缓存，不复制业务数据） |

`ai_pending_action` 与 `ai_audit_log` 是**两张表**，不是一个状态字段：前者是「待人决定」，后者是「已发生」。
