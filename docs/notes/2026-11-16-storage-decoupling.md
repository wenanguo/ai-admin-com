# 存储解耦：`ai_*` 表可指向自己的库 + 会话加智能体维度（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #81 · PR（待提）
- **一句话**：`ai_*` 那 5 张表不再只能躺在 AiAdmin 的共享库里（换系统就没库可用）
  ⇒ **连接串由配置决定**；并给会话加上**智能体维度**（`ai_conversation.agent_id`）。

## 状态

**已完成**（代码 + 迁移脚本 + 测试都齐了；**迁移尚未在库里执行** ⇒ 只在测试库验）。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `backend/ai/src/env.ts` | 新增 `AI_DATABASE_URL`（本服务自己的库）；`DATABASE_URL` 变**可省**；新增 `env.databaseUrl`（两者取一） |
| `backend/ai/src/db.ts` | 建 Prisma 客户端**之前**把 `process.env.DATABASE_URL` 对齐成 `env.databaseUrl`（Prisma 的 datasource 只能写死一个变量名） |
| `backend/ai/prisma/schema.prisma` | `AiConversation` 加 `agentId String? @map("agent_id")`（**可空** ⇒ 旧会话不丢） |
| `backend/ai/prisma/migrations/1_add_conversation_agent_id/migration.sql` | **只加一列**：`ALTER TABLE ai_conversation ADD COLUMN agent_id VARCHAR(64) NULL;` |
| `backend/ai/src/agent/store.ts` | 建会话写入 `agent_id`；`ConversationRecord` 多一个 `agentId` |
| `backend/ai/src/agent/runtime.ts` | 建会话时把智能体**入库**；`#agentOf` **先看库里的 `agent_id`**（再会话 id 前缀、最后默认智能体） |
| `backend/ai/src/routes/agent.ts` | 会话列表返回 `agentId` |
| `backend/ai/.env.example` · `docker/.env.example` · `docker/docker-compose.yaml` | 新增 `AI_DATABASE_URL`（**空值当没配** ⇒ 现有部署一个字不改） |
| `backend/ai/README.md` | 「本服务自己的库」一节 + 增量迁移只许加列的规矩 |
| `scripts/e2e/ai-container.static.cjs` | **迁移安全阀**：增量迁移里出现 `DROP`/`TRUNCATE`/`DELETE`/`RENAME`/`MODIFY` ⇒ 断言失败；且只许动 `ai_conversation` |
| 单测 | `env.test.ts`（+5 条：库的优先级/空串/两个都没配）· `runtime.agents.test.ts`（+2 条：入库 + 库里优先）· `db.test.ts`（3 条：**连接串真的被对齐到 Prisma 认的变量名**） |

**下一步**：#82（目录拆分：`backend/ai` → `core/` + `plugins/pm/`）—— 大重构。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **不改 Prisma 的 datasource 写法**（仍是 `env("DATABASE_URL")`），而在 `db.ts` 里对齐 | Prisma 的 datasource 只能写死**一个**环境变量名 ⇒ 想「换库只改配置」就得在**建客户端之前**把它指向真正要用的那个 | 改成 `env("AI_DATABASE_URL")` ⇒ **所有现有部署立刻起不来**（.env / compose / 部署脚本全要改，且旧部署漏改就挂） |
| `DATABASE_URL` 变**可省**、`AI_DATABASE_URL` 也可省，但**至少要有一个** | 「复用别的系统」⇒ 不该强迫对方给 AiAdmin 的库 | 保留必填 ⇒ 换系统时仍要编一个假的 AiAdmin 库 |
| `agent_id` **可空** | 迁移前的旧会话没有这个值 ⇒ 可空 ⇒ 旧数据不丢、不用回填 | NOT NULL ⇒ 迁移得先回填 5000 行旧会话 ⇒ 共享库上多一次写操作 |
| 事实源 = **库里的 `agent_id`**，会话 id 的前缀只是同义反复 | 前缀是「同义反复」（id 里编码）⇒ 库里这一列才是**正经的字段** ⇒ 列表/查询都能用 | 只靠前缀 ⇒ 「会话是哪个智能体的」没法用 SQL 查、也没法给前端 |
| `#agentOf` 的顺序：库里 → 会话 id 前缀 → 默认智能体 | 库里最准；前缀兜住「迁移前的旧会话」；默认智能体兜住「既没入库也没前缀」的 | 只认库里 ⇒ 旧会话全落到默认智能体（虽然也是 PM，但语义上不对） |
| 迁移用**离线 diff**（`--from-schema-datamodel`）生成 | 连库做 diff 会把 AiAdmin 的 56 张表算成 `DROP TABLE` 写进迁移文件 | 用 `--from-schema-datasource` ⇒ 迁移文件里全是 DROP ⇒ **共享库一 deploy 就毁** |
| 迁移**没有在库里执行**（只提交脚本） | 共享库/生产库上动手 = 高风险操作 ⇒ 由人在**测试库**先验（issue 的约束也这么说） | 我在生产库上 deploy ⇒ 出事没法回退 |
| 加了**迁移安全阀**（静态断言） | 「只许加列」是硬要求 ⇒ 让 CI 盯着（以后谁写了个 DROP 迁移，红灯） | 只靠人记住 ⇒ 总有一天有人写错 |

## 怎么验

```bash
cd backend/ai
npm run typecheck
npm test                    # 422 条
cd ../.. && node scripts/e2e/ai-container.static.cjs   # 迁移安全阀（20 条）
```

⚠️ **迁移要在测试库上验**（本机没有测试库 ⇒ 我没执行）：

```bash
cd backend/ai
# ⚠️ **只允许 deploy**（dev/reset 会把共享库 DROP 掉）
npx prisma migrate deploy --schema prisma/schema.prisma
# 验：旧会话读得到（agent_id 为 NULL）、新会话写进去了
```

## 坑与提醒

- ⚠️ **共享库上只能 `migrate deploy`** ⇒ `migrate dev` / `reset` 会 `DROP DATABASE aipm`
  （连 AiAdmin 的 56 张业务表一起没）—— README 里那节务必先读。
- ⚠️ `npx prisma generate` 在 Windows 上偶尔 **EPERM**（引擎 DLL 被占用）
  ⇒ 类型已经更新了（报错只是 DLL 换名失败）⇒ 重试即可。
- ⚠️ 建会话现在**多读一次库**（拿 `agent_id`）⇒ 比以前慢一拍
  ⇒ 有几条测试因此需要「等会话建好」（`waitFor(() => sessionCount() >= 1)`）。
- ⚠️ **本仓的 `main` 可能落后 origin**（PM 在同一个 checkout 里干活 ⇒ `git pull` 会被拒）
  ⇒ 开发 agent 应该在自己的 **worktree** 里干活（这次踩到了，已改用 worktree）。
- ⚠️ **分支要记得同步 main**：#81 的分支是在 #96 合并**之前**开的 ⇒ 它的 diff 里会把 #96 的改动
  显示成「回退」⇒ 合并前先 `git merge origin/main`（否则一合就把别人的 PR 冲掉了）。
  ⇒ 本 PR 已在合并 main 之后重新推（diff 现在只有 #81 的内容）。
