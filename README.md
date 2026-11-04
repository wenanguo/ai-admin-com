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
| `AIADMIN_BASE_URL` | AiAdmin 后端地址，base 里已含 `/api/v1` | 是 |
| `DATABASE_URL` | AiAdmin 的 MySQL 连接串（`ai_*` 元数据表与业务表**同库**） | 是 |
| `PORT` | 本服务监听端口，缺省 3100 | 否 |
| `ALLOWED_ORIGINS` | 允许跨域的前端源，逗号分隔（回具体的源，不用 `*`） | 是 |

- `.env` **不入库**（里面有模型 key 与数据库口令），仓库里只有 `.env.example`。
- `src/env.ts` 用 zod 校验，**缺哪个变量就在启动时报哪个**（不等到第一个请求打进来才炸）。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（3100 端口） |
| `npm run build` / `npm start` | 生产构建 / 起服务 |
| `npm test` | Vitest 单元测试（`src/**/*.test.ts`） |
| `npm run typecheck` | `tsc --noEmit` |

测试用的环境变量是**假值**，写在 `vitest.config.ts` 的 `test.env` 里；真值只在 `.env`。

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

```bash
# 1) 改了 prisma/schema.prisma 之后，先离线算出「上一版 → 下一版」的差量
#    （离线 = 不连库、不做 drift 检查，绝不会把别人的表算成 DROP）
git show HEAD:prisma/schema.prisma > /tmp/schema_before.prisma
mkdir -p prisma/migrations/<时间戳>_<名字>
npx prisma migrate diff \
  --from-schema-datamodel /tmp/schema_before.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<时间戳>_<名字>/migration.sql

# 2) 人工审一遍这份差量，再执行
npx prisma migrate deploy --schema prisma/schema.prisma
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

## 目录

```
prisma/schema.prisma              5 张 ai_* 元数据表（单租户，无 tenant_id）
prisma/migrations/                迁移历史（0_init_ai_tables = 基线）
src/env.ts                        环境变量校验（zod；缺变量启动即失败）
src/db.ts                         PrismaClient 单例（globalThis 缓存，dev 热重载不漏连接）
src/types/api.ts                  AiAdmin 响应信封（ApiResponse / SUCCESS_CODES / isSuccess）
src/app/                          Route Handler
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
