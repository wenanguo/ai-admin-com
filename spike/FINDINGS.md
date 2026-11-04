# Task 1 · 风险尖峰实测报告

> 三件事，各给一条**命令 + 真实输出 + 结论**：
> ① pi SDK 能不能在 Next.js Route Handler 里跑？　② Route Handler 能不能流式输出 SSE？　③ Prisma 能不能连上这个 MySQL 并建表？
>
> 测于 2026-11-04。环境：Node v26.13.0 / npm 11.16.0 / Windows / Next.js 15.5.29。
> 本文件里的每段输出都是当时跑出来的原文（只裁掉了无关行），没有改写成「成功」。
>
> **AIPM 01 §3.2 的表是设计意图，不是实测。** 最后一节逐条点名差异。

## 0. 结论速览

| # | 问题 | 结论 |
|---|---|---|
| ① | pi SDK 能进 Route Handler 吗？ | **能。** 真调模型、真 tool-calling 都跑通了（`echo` 工具确实被调用） |
| ② | Route Handler 能流式 SSE 吗？ | **能。** 逐帧到达（1s 一帧），`Content-Type: text/event-stream`，客户端断开服务端能感知且不崩 |
| ③ | Prisma 能连上这个 MySQL 并建表吗？ | **能，但 `prisma migrate dev` 不能用**——它会把共享库 `aipm` 整个判为 drift 并要求 reset（= DROP 掉 56 张表，含 AiAdmin 业务表） |

> ⚠️ 另外在动手前发现并修掉的一个坑：仓库里 `.env` 的 `DATABASE_URL` **密码是错的**（4 字符），
> 计划书里写的来源是后端 `env/.env.prod`（8 字符）。用错密码连库直接 `ER_ACCESS_DENIED_ERROR`。
> 已按计划书把 `.env` 改成后端 `.env.prod` 的密码（`.env` 不入库，值未打印）。

---

## ① pi SDK 能不能在 Next.js Route Handler 里跑？

### 1.1 安装与版本

```bash
npm i @earendil-works/pi-coding-agent@1.5.0 next@15.5.29 react@19 react-dom@19
npm i -D typescript@5.9.3 @types/node @types/react @types/react-dom
npm i typebox@1.3.27
```

```
$ node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"
1.5.0
```

**实测到的 SDK 版本：`@earendil-works/pi-coding-agent@1.5.0`**（npm 上的 `latest` 就是 1.5.0；本机 pi harness 装的是 1.4.0）。
它带两个必须知道的兄弟包：`@earendil-works/pi-ai`（模型/provider）、`@earendil-works/pi-agent-core`（消息与工具结果类型）。

### 1.2 真实 API（从 `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts` 抄的）

```ts
export interface CreateAgentSessionOptions {
    cwd?: string;
    agentDir?: string;
    modelRuntime?: ModelRuntime;
    model?: Model<any>;            // ← 对象，不是 "provider/model" 字符串
    thinkingLevel?: ThinkingLevel;  // "off" | "low" | "medium" | "high"
    scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
    noTools?: "all" | "builtin";
    tools?: string[];               // 白名单
    excludeTools?: string[];
    customTools?: ToolDefinition[]; // ← 直接注册自定义工具，不用走扩展
    resourceLoader?: ResourceLoader;
    sessionManager?: SessionManager;
    settingsManager?: SettingsManager;
    sessionStartEvent?: SessionStartEvent;
}
export declare function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
// 返回 { session, extensionsResult, modelFallbackMessage? }
```

自定义工具（`dist/core/extensions/types.d.ts`）：

```ts
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
    name: string;         // 必填
    label: string;        // 必填 ← AIPM 表里没有
    description: string;  // 必填
    parameters: TParams;  // 必填，TypeBox schema
    annotations?: ToolAnnotations;
    execute(
        toolCallId: string,
        params: Static<TParams>,
        signal: AbortSignal | undefined,
        onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
        ctx: ExtensionToolContext,
    ): Promise<AgentToolResult<TDetails>>;
    // AgentToolResult = { content: (TextContent|ImageContent)[]; details: T; structuredContent?: JsonValue }
}
export declare function defineTool<TParams extends TSchema, ...>(tool: ToolDefinition<...>): ToolDefinition<...> & AnyToolDefinition;
```

**要点：`execute` 收 5 个参数，`(toolCallId, params, signal, onUpdate, ctx)`——不是 `(args, ctx)`。**

### 1.3 纯 Node 里的最小可运行范例（真调模型）

脚本：`spike/scripts/01-agent-sdk.mjs`（这是被搬进 Route Handler 的同一套调用）

```bash
node --env-file=.env spike/scripts/01-agent-sdk.mjs
```

真实输出（节选，逐字）：

```
=== [0] 环境 ===
node: v26.13.0
pi SDK: 1.5.0
MINIMAX_CN_API_KEY 是否存在: true (长度 125 )
=== [1] ModelRuntime ===
hasConfiguredAuth('minimax-cn'): true
getProviderAuthStatus: {"configured":true,"source":"environment","label":"MINIMAX_CN_API_KEY"}
getModel -> minimax-cn/MiniMax-M3.1-Flash api=anthropic-messages baseUrl=https://api.minimaxi.com/anthropic
=== [2] 自定义工具 ===
defineTool() -> object name = echo
=== [4] createAgentSession ===
session.model: minimax-cn/MiniMax-M3.1-Flash
session.getActiveToolNames(): ["echo"]
session.systemPrompt: "你是一个只做回显的测试助手。\n\n<cwd>\nD:/project/ai-admin-ai\n</cwd>"
=== [5] 真调一次模型（强制走 tool-calling）===
I'll call the echo tool with "pong".  [tool] execute 被调用
    toolCallId = "call_01a1a634ef8172c19f795bf5"
    params     = {"text":"pong"}
    signal     = AbortSignal
    onUpdate   = function
    ctx 类型   = Object | ctx 字段: ui,mode,hasUI,cwd,sessionManager,modelRegistry,model,scopedModels,thinkingLevel,isIdle,isProjectTrusted,signal,abort,hasPendingMessages,shutdown,getContextUsage,compact,getSystemPrompt
工具结果原样如下：

```
echo: pong
```
耗时 ms: 2035
事件类型（去重后按出现顺序）: ["agent_start","turn_start","message_start","message_end","message_update","tool_execution_start","tool_execution_end","turn_end","agent_end","agent_settled"]
事件总条数: 39
session.getLastAssistantText(): "工具结果原样如下：\n\n```\necho: pong\n```"
```

**结论：pi SDK 能在 Node 进程里跑，鉴权、模型调用、tool-calling 全链路通。**

### 1.4 放进 Route Handler 里再验一次

文件：`src/app/api/spike/agent/route.ts`

```bash
npx next dev -p 3100
curl -s "http://localhost:3100/api/spike/agent"
```

真实输出：

```json
{"ok":true,"prompt":"请调用 echo 工具，把 text 参数设为「pong」，然后把工具结果原样告诉我。",
 "text":"工具返回结果原样如下：\n\n```\necho: pong\n```","latencyMs":2356,
 "authStatus":{"configured":true,"source":"environment","label":"MINIMAX_CN_API_KEY"},
 "model":"minimax-cn/MiniMax-M3.1-Flash",
 "events":["agent_start","turn_start","message_start","message_end","message_update","tool_execution_start","tool_execution_end","turn_end","agent_end","agent_settled"]}
```

生产构建也过（`npx next build` → `✓ Compiled successfully`，两个路由都是 `ƒ (Dynamic)`），`next start` 下同样返回 `text`。

**必须的配置**（缺一个就跑不起来）：

| 配置 | 值 | 为什么 |
|---|---|---|
| `next.config.ts` → `serverExternalPackages` | `@earendil-works/pi-coding-agent` + `pi-agent-core` + `pi-ai` + `pi-codemode` + `pi-mcp` + `pi-tui` + `typebox` | 这些包带 `node:fs` / `jiti` / `quickjs-wasi`，交给 Next 打包器就会炸 |
| Route Handler | `export const runtime = "nodejs"` | 默认就是 node，但要显式写，别让 edge 进来 |
| 鉴权 | **只要 `MINIMAX_CN_API_KEY` 环境变量** | `minimax-cn` provider 内置 `envApiKeyAuth(["MINIMAX_CN_API_KEY"])`；Next.js 会自动加载 `.env` |
| 模型 | `modelRuntime.getModel("minimax-cn", "MiniMax-M3.1-Flash")` | `model` 选项吃**对象** |

**结论：能，且不需要配置文件、不需要 `auth.json`——`MINIMAX_CN_API_KEY` 环境变量就够了**
（`getProviderAuthStatus` 实测 `source: "environment"`）。

### 1.5 顺带量到的三件事（后面任务一定会撞上）

脚本：`spike/scripts/01b-probe-matrix.mjs`、`spike/scripts/01c-probe-ctx-and-concurrency.mjs`

**（a）`tools: []` 会把自定义工具一起关掉**——这是 AIPM §3.3 那段示例代码最要命的一处。

```
=== B. 工具激活矩阵 ===
tools: [] + customTools                              -> []
tools: ['echo'] + customTools                        -> ["echo"]
noTools: 'all' + customTools                         -> []
noTools: 'builtin' + customTools                     -> ["echo"]
(不给 tools) + customTools                             -> ["read","bash","edit","write","echo"]
tools: [] + 无 customTools                            -> []
扩展工厂 registerTool + tools: []                        -> []
扩展工厂 registerTool + tools: ['echo']                  -> ["echo"]
扩展工厂 registerTool + noTools: 'all'                   -> []
扩展工厂 registerTool + noTools: 'builtin'               -> ["echo"]
扩展工厂 registerTool + (不给 tools)                       -> ["read","bash","edit","write","echo"]
```

→ 想「不要内置工具、只要我们自己的」，用 **`noTools: "builtin"`**（或白名单 `tools: ["<工具名>", ...]`）。
→ `pi.registerTool()`（扩展工厂）与 `customTools:`（直接传）**两条路实测行为完全一致**，用哪条都行。

**（b）`ctx.ui.confirm()` 在服务端不能用**。

```
=== C. tool execute 收到的 ctx ===
ctx.hasUI      = false
ctx.mode       = print
ctx.ui 的方法  = select,confirm,input,notify,onTerminalInput,...
```

实测在 Route Handler 里调用 `ctx.ui.confirm("要继续吗？")` **立即返回 `false`**（不是挂住，是无人应答的桩）。
→ AIPM §3.2 的「`ctx.ui.confirm()` 走 extension_ui 桥」只在 TUI 里成立；**服务端必须自建桥**（正是 AIPM §4.6 那套 PendingAction + extension_ui_request）。
→ `pi.on("tool_call")` 返回 `{ block: true, reason }` 可以在服务端阻断——这条是可用的。

**（c）`prompt()` 在流式中再调会抛错**，AIPM §4.2 的「启动锁」是必需的：

```
D: 第二次 prompt 抛错 -> Error - Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.
```

---

## ② Route Handler 能不能流式输出 SSE？

文件：`src/app/api/spike/sse/route.ts`（`ReadableStream` 每秒 `enqueue` 一帧）

### 2.1 响应头

```bash
curl -s -D - -o /dev/null -m 8 "http://localhost:3100/api/spike/sse?frames=3"
```

```
HTTP/1.1 200 OK
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
cache-control: no-cache, no-transform
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
Date: Wed, 04 Nov 2026 11:09:42 GMT
Transfer-Encoding: chunked
```

### 2.2 是不是真的「增量到达」而不是攒完一次性吐？

```bash
curl -N -s --no-buffer "http://localhost:3100/api/spike/sse?frames=4&interval=1000" \
  | while IFS= read -r line; do echo "$(date +%H:%M:%S.%3N) | $line"; done
```

```
19:09:45.925 | data: {"n":1,"ts":1793790585868}
19:09:46.928 | data: {"n":2,"ts":1793790586875}
19:09:47.929 | data: {"n":3,"ts":1793790587877}
19:09:48.940 | data: {"n":4,"ts":1793790588887}
```

→ 帧与帧之间正好隔 1 秒，**没有缓冲到最后**。

### 2.3 客户端中途断开

```bash
curl -N -s --no-buffer --max-time 2.5 "http://localhost:3100/api/spike/sse?frames=10&interval=1000"
```

客户端：

```
19:10:05.544 | data: {"n":1,"ts":1793790605491}
19:10:06.567 | data: {"n":2,"ts":1793790606497}
```

服务端日志：

```
[spike:sse] 已发第 1 帧
[spike:sse] 已发第 2 帧
 GET /api/spike/sse?frames=10&interval=1000 200 in 2510ms
[spike:sse] 关闭：收到客户端断开信号 (request.signal abort)（已发 2 帧）
```

断开后服务器仍然正常服务：

```json
{"ok":true,"prompt":"回一句 pong","text":"pong","latencyMs":1234, ...}
```

**结论：能流式、能断开、不崩。** `request.signal` 的 `abort` 事件能可靠地通知到 Route Handler 里，
断开后定时器被清掉、连接被关掉、进程继续服务别的请求。
（AIPM 03 §4 的 SSE 语义可以在这个基础上做；`X-Accel-Buffering: no` 头已带上，防 nginx 缓冲。）

---

## ③ Prisma 能不能连上这个 MySQL 并建表？

### 3.1 版本与目标库

```bash
npm i -D prisma@6.19.1 @prisma/client@6.19.1 mysql2
node --env-file=.env spike/scripts/02-db-inspect.mjs
```

```
MySQL 版本: 8.4.10 | MySQL Community Server - GPL
库字符集: {"cs":"utf8mb4","coll":"utf8mb4_unicode_ci","sql_mode":"IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION","cs_server":"utf8mb4"}
库里的表数量: 56
_prisma_migrations 存在？: false
同实例的库: ["aicomm","aipm","information_schema","mysql","performance_schema","pmdb","sys","w****o"]
```

> 打码说明：最后一个库名 `w****o` **与本服务的数据库密码同形**（就是那 8 个字符）。
> 它在本行里的身份是「库名」，但为了不把凭据写进仓库，这里打了码。需要看原值的自己跑一次
> `SHOW DATABASES`。

**Prisma 6.19.1 / MySQL 8.4.10 / `aipm` 库连上时已有 56 张表**（AiAdmin 的业务表，含后端遗留的空表 `ai_action_log`——不动它）。
**连接串不用加任何 `?connection_limit=` 或 charset 参数**，原样 `mysql://root:***@115.191.17.4:3306/aipm` 就能连。

### 3.2 ⚠️ `prisma migrate dev` 在这个库上**不能用**

```bash
npx prisma migrate dev --name spike_probe
```

真实输出（头部）：

```
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": MySQL database "aipm" at "115.191.17.4:3306"

Drift detected: Your database schema is not in sync with your migration history.

[+] Added tables
  - _z_test_addifnotexists
  - agno_schema_versions
  - agno_sessions
  - ai_action_log
  - alembic_version
  ...（共 56 张表全部列在这里）
```

尾部：

```
We need to reset the MySQL database "aipm" at "115.191.17.4:3306"

You may use prisma migrate reset to drop the development database.
All data will be lost.
```

Prisma 把 schema 之外的 55 张表当成「drift」，于是要求 **reset 整个 `aipm` 库**。
`prisma migrate reset` 会 `DROP DATABASE aipm` —— 那会连 AiAdmin 的业务表一起没。**绝对不能在这条命令上按回车。**
好消息：Prisma 只是**提示**并没有动手，库表数量仍然是 56，`_prisma_migrations` 也没被建出来。

对照组：同一套 schema 在一个**干净的临时库**上，`migrate dev` 完全正常：

```bash
# 建临时库 aipm_spike，然后
DATABASE_URL="$(cat spike/.scratch-db-url)" npx prisma migrate dev --name spike_probe
```

```
Datasource "db": MySQL database "aipm_spike" at "115.191.17.4:3306"

Applying migration `20261104110358_spike_probe`

The following migration(s) have been created and applied from new schema changes:

prisma\migrations/
  └─ 20261104110358_spike_probe/
    └─ migration.sql

Your database is now in sync with your schema.

Running generate... ✔ Generated Prisma Client (v6.19.1) to .\node_modules\@prisma\client in 58ms
```

### 3.3 共享库上安全的那条路（生成 SQL → 执行 → 建基线）

```bash
# 1) 从 schema 生成建表 SQL（不连库、不做 drift 检查）
npx prisma migrate diff --from-empty --to-schema-datamodel spike/prisma/schema.prisma --script
```

```sql
-- CreateTable
CREATE TABLE `SpikeProbe` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

```bash
# 2) 执行 SQL（db execute 不做 drift 检查，只跑你给的语句）
npx prisma db execute --schema spike/prisma/schema.prisma --file spike/sql/spike_probe_create.sql
# → Script executed successfully.
```

> 小坑：`prisma db execute` **必须**带 `--schema` 或 `--url`，否则报 `Either --url or --schema must be provided.`

```bash
# 3) 建基线：把首个迁移登记为「已应用」，但不执行它
npx prisma migrate resolve --applied 0_init --schema spike/prisma/schema.prisma
# → Migration 0_init marked as applied.

# 4) 之后正常的迁移走 deploy（不做 drift 检查，不会碰别人的表）
npx prisma migrate status --schema spike/prisma/schema.prisma
npx prisma migrate deploy --schema spike/prisma/schema.prisma
```

```
2 migrations found in prisma/migrations
Following migration have not yet been applied:
1_drop_spike_probe

To apply migrations in development run prisma migrate dev.
To apply migrations in production run prisma migrate deploy.

---
Applying migration `1_drop_spike_probe`
All migrations have been successfully applied.
```

> ⚠️ **`migrate deploy` 也需要基线。** 忘了先 `resolve --applied` 直接 `deploy`，会得到：
>
> ```
> Error: P3005
> The database schema is not empty. Read more about how to baseline an existing production database:
> https://pris.ly/d/migrate-baseline
> ```
>
> 也就是说：**在共享库上，`migrate dev` 和 `migrate deploy` 都拒绝在没有迁移历史时动手**。
> 唯一能落地的顺序是：`migrate diff` 生成 SQL → 人工审 → `db execute` 执行 → `migrate resolve --applied <init>` 建基线 → 之后才 `migrate deploy`。

### 3.4 Prisma Client 真连上真读写

```bash
node --env-file=.env spike/scripts/03-prisma-client.mjs
```

```
create -> {"id":1,"label":"hello-from-prisma","createdAt":"2026-11-04T11:03:39.900Z"}
findUnique -> {"id":1,"label":"hello-from-prisma","createdAt":"2026-11-04T11:03:39.900Z"}
count -> 1
delete -> {"id":1,"label":"hello-from-prisma","createdAt":"2026-11-04T11:03:39.900Z"}
结论：Prisma Client 能连上这个 MySQL 并正常读写。
```

### 3.5 清理：库回到了尖峰之前的样子

清理用的是**丢弃迁移**（`1_drop_spike_probe`），不是 `migrate reset`：

```bash
# drop 迁移应用后
SpikeProbe 还存在？ false
_prisma_migrations 内容: [{"migration_name":"0_init","ok":1},{"migration_name":"1_drop_spike_probe","ok":1}]

# 再把尖峰自己建的 _prisma_migrations 删掉（尖峰前它并不存在），并删掉临时库
DROP TABLE IF EXISTS _prisma_migrations;
DROP DATABASE IF EXISTS aipm_spike;
DROP DATABASE IF EXISTS aipm_spike_shadow;
```

最终状态（与尖峰前逐张比对）：

```
尖峰前表数: 56 | 现在表数: 56
缺少: [] | 多余: []
与尖峰前完全一致？ true
删除后的库: ["aicomm","aipm","information_schema","mysql","performance_schema","pmdb","sys","w****o"]
```

**库已恢复原状：56 张表，与尖峰前逐张一致；临时库已删干净。**

### 3.6 ⚠️ npm 上的 `prisma` latest 是 RC，CLI 整个换了一套

```bash
npm i -D prisma@latest     # → 8.0.0-rc.30
npx prisma --help
```

```
│  auth                Manage authentication for the Prisma Platform.
│  project             Manage Prisma Platform projects. ...
│  contract            Manage your data contract: the PSL source of your data model. ...
│  db                  Run contract operations against a live database. ...
│  migration           Manage on-disk migrations derived from contract changes. ...
│  init                Prepare this repository for Prisma: config file, dev dependency, AI-agent skills
```

`prisma init` 不再接受 `--datasource-provider`，`prisma validate` **这个命令不存在**，`prisma migrate` 也没了，
改成 `prisma contract` / `prisma migration` / `prisma db`，并新增 `prisma.config.ts`。

**→ 依赖必须钉版本：`prisma@6.19.1` + `@prisma/client@6.19.1`（本仓已钉）。**
不要在 Task 2 里写 `npm i -D prisma`（不带版本）——那会装到 RC 上，Task 2 的所有命令都要重写。

---

## 与 AIPM 01 §3.2 / §3.3 的差异

### §3.2 那张能力映射表

| AIPM 写的 | 实测 | 差异 |
|---|---|---|
| 自定义工具：`defineTool({ name, description, parameters: TypeBoxSchema, execute })` | `defineTool` 存在且从包根导出；但 `ToolDefinition` **必填 `label`**，漏了编译不过 | **多一个必填 `label`** |
| 「TypeBoxSchema」 | 用的包是 **`typebox@1.3.27`**（`import { Type } from "typebox"`），**不是** `@sinclair/typebox` | **包名不同**，且 `typebox` 必须写成直接依赖 |
| `pi.registerTool()` | 真实可用 | 一致。**额外发现**：`createAgentSession({ customTools: [...] })` 也能直接注册，两条路行为完全一致 |
| 人工确认：`ctx.ui.confirm()` 走 extension_ui 桥 | Route Handler 里 `ctx.hasUI === false`，`ctx.ui.confirm()` **立即返回 `false`** | **服务端不可用**；`pi.on("tool_call")` 返回 `{ block: true, reason }` 才可用 |
| 危险标注：`annotations`：`readOnlyHint`/`destructiveHint`/`idempotentHint` | `ToolDefinition.annotations?: ToolAnnotations` 字段存在 | 一致（本次未逐字段验） |
| 流式输出：`session.subscribe(event)` → `message_update` / `tool_execution_*` | 完全一致；实测事件序列 `agent_start, turn_start, message_start, message_end, message_update, tool_execution_start, tool_execution_end, turn_end, agent_end, agent_settled` | 一致 |
| 自定义 system prompt：`createAgentSession({ systemPrompt })` | **`CreateAgentSessionOptions` 里没有 `systemPrompt`**；要写 `new DefaultResourceLoader({ systemPrompt })` | **位置错了**（注意它会在末尾追加 `\n\n<cwd>…</cwd>`） |
| 会话持久化：`SessionManager`（内存/文件） | 一致：`SessionManager.inMemory()` / `SessionManager.create(cwd)` | 一致 |
| 模型供应商：内置 provider，MiniMax 已支持 | 一致。`minimax-cn` 在内置目录，`MiniMax-M3.1-Flash` 在（catalog id `chat:MiniMax-M3.1-Flash`），`baseUrl=https://api.minimaxi.com/anthropic`，api=`anthropic-messages`；**只靠 `MINIMAX_CN_API_KEY` 环境变量就鉴权成功** | 一致（但 §3.3 的写法是错的，见下） |

### §3.3 那段示例代码

| AIPM 写的 | 实测 | 差异 |
|---|---|---|
| `model: "minimax-cn/MiniMax-M3.1-Flash"` | `model` 的类型是 `Model<any>`，**必须是对象**：`modelRuntime.getModel("minimax-cn", "MiniMax-M3.1-Flash")` | **类型错**（写字符串过不了 TS） |
| `tools: [], // 不启用任何内置工具` | `tools: []` 是**白名单**，会把自定义工具一起关掉（实测 `getActiveToolNames() === []`） | **语义错**；正确写法是 `noTools: "builtin"` 或白名单 `tools: ["<我们自己的工具名>"]` |
| `customTools: ourCommandTools` | 有效 | 一致（但必须配合上面那条） |
| `resourceLoader: new DefaultResourceLoader({ extensionFactories: [ourExtension] })` | 有效；且 `pi.registerTool()` 与 `customTools` 等价 | 一致 |
| `sessionManager: SessionManager.inMemory()` | 有效 | 一致 |
| `systemPrompt: PM_AGENT_PROMPT` | 不是 `createAgentSession` 的选项 | **位置错**（见 §3.2 表） |

### 别的差异

| 事项 | 实测 | 差异 / 影响 |
|---|---|---|
| `execute` 签名 | `execute(toolCallId, params, signal, onUpdate, ctx)` | **不是 `(args, ctx)`**；Task 4 的工具签名必须是 5 参 |
| `ctx` 的内容 | `ui, mode, hasUI, cwd, sessionManager, modelRegistry, model, scopedModels, thinkingLevel, isIdle, isProjectTrusted, signal, abort, hasPendingMessages, shutdown, getContextUsage, compact, getSystemPrompt` | `ctx` 是 `ExtensionToolContext`，够用 |
| 流式中再 `prompt()` | 抛 `Error - Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.` | AIPM §4.2 的启动锁**必须**做；可选 `steer`/`followUp` |
| Next.js 打包 | pi SDK 必须进 `serverExternalPackages` | 新增约束 |
| Prisma | `prisma migrate dev` 在共享库上会要求 reset 整个库；`migrate deploy` 在没有基线时也报 P3005 | **禁止 `migrate dev`**；走 `migrate diff` → `db execute` → `migrate resolve --applied` → `migrate deploy` |
| Prisma 版本 | npm `latest` = 8.0.0-rc.30（CLI 全换） | **必须钉 6.19.1** |
| MySQL 表名 | `lower_case_table_names = 1`，`` `SpikeProbe` `` 实际存成 `spikeprobe` | `ai_*` 表名本来就是小写，**无影响**；但别用大写驼峰表名 |

---

## 给后面任务的落点

1. **Task 2（骨架 + Prisma + ai_* 表）**
   - 依赖钉死：`prisma@6.19.1` / `@prisma/client@6.19.1`。
   - **不要用 `prisma migrate dev`**（会想 DROP 整个 `aipm`）。走
     `migrate diff --from-empty --to-schema-datamodel --script` → 人工审 SQL → `prisma db execute --schema … --file …` →
     `prisma migrate resolve --applied <init>` 建基线 → 之后 `prisma migrate deploy`。
     （`migrate deploy` 也需要基线，没有基线会报 P3005。）
   - 表名一律小写 `ai_*`；库已有 `ai_action_log`（后端遗留空表）**不要重名、不要动**。
   - `.env` 的 `DATABASE_URL` 密码已修正为后端 `env/.env.prod` 里的那个；Task 2 若重建 `.env` 别再写错。
2. **Task 3/4（对话与命令工具）**
   - 建会话：`modelRuntime.getModel("minimax-cn", "MiniMax-M3.1-Flash")` + `noTools: "builtin"` + `customTools: [...]`。
   - 工具：`defineTool({ name, label, description, parameters: Type.Object(...), execute })`，
     `execute` 是 **5 参** `(toolCallId, params, signal, onUpdate, ctx)`。
   - `parameters` 的 TypeBox 从 **`typebox`** 导入（不是 `@sinclair/typebox`）。
   - system prompt 放 `DefaultResourceLoader({ systemPrompt })`。
   - 事件订阅：`session.subscribe(cb)`，返回 `unsubscribe`；用 `message_update` 推增量、`tool_execution_start/end` 推工具状态。
3. **Task 6/7（SSE + 待确认）**
   - SSE 直接可用（实测逐帧 + 断开可感知）。
   - **待确认不能靠 `ctx.ui.confirm()`**（在服务端恒为 `false`），必须按 AIPM §4.6 自建 extension_ui 桥；
     服务端能用的阻断手段是 `pi.on("tool_call")` 返回 `{ block: true, reason }`。
   - 同一会话并发 `prompt()` 会抛错，必须做启动锁。

---

## 复现清单

```bash
# 依赖
npm i @earendil-works/pi-coding-agent@1.5.0 next@15.5.29 react@19 react-dom@19 typebox@1.3.27
npm i -D typescript@5.9.3 @types/node @types/react @types/react-dom prisma@6.19.1 @prisma/client@6.19.1 mysql2

# ① pi SDK（纯 Node）
node --env-file=.env spike/scripts/01-agent-sdk.mjs
node --env-file=.env spike/scripts/01b-probe-matrix.mjs
node --env-file=.env spike/scripts/01c-probe-ctx-and-concurrency.mjs

# ① pi SDK（Route Handler）
npx next dev -p 3100
curl -s "http://localhost:3100/api/spike/agent"

# ② SSE
curl -s -D - -o /dev/null "http://localhost:3100/api/spike/sse?frames=3"
curl -N -s --no-buffer "http://localhost:3100/api/spike/sse?frames=4&interval=1000"
curl -N -s --no-buffer --max-time 2.5 "http://localhost:3100/api/spike/sse?frames=10&interval=1000"

# ③ Prisma
node --env-file=.env spike/scripts/02-db-inspect.mjs
npx prisma migrate diff --from-empty --to-schema-datamodel spike/prisma/schema.prisma --script
npx prisma db execute --schema spike/prisma/schema.prisma --file spike/sql/spike_probe_create.sql
npx prisma generate --schema spike/prisma/schema.prisma
node --env-file=.env spike/scripts/03-prisma-client.mjs

# 基线与清理（顺序不能乱）
npx prisma migrate resolve --applied 0_init --schema spike/prisma/schema.prisma
npx prisma migrate deploy --schema spike/prisma/schema.prisma   # 应用 1_drop_spike_probe
# 尖峰跑完后手工删掉 _prisma_migrations（尖峰前它并不存在）
```

> 尖峰目录 `spike/` 是一次性的，但它里面的脚本就是后面任务要抄的样板。
> `spike/prisma/` 是尖峰用的 schema 与迁移（`0_init` 建表 / `1_drop_spike_probe` 删表），
> Task 2 会用真正的 `ai_*` 模型在仓库根重建 `prisma/`。
