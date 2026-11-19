# dsh 存储与审计 —— 设计文档（spec）

> 对应 issue **#121** · 上游：#119 的 spec（§2.7 存储那节）与 plan（§3 阶段 2）
> · 2026-11-20
>
> ⚠️ **本条动数据模型** ⇒ PR **只开不合并**，由 PM / 人亲自看内容再合并。
>
> **上游文档**：
> - spec：[`2026-11-19-dsh-底座摸底-目标架构-design.md`](./2026-11-19-dsh-底座摸底-目标架构-design.md)（§2.7 存储 · §5 契约不变 · §7 类型边界）
> - plan：[`2026-11-19-dsh-底座摸底-目标架构.md`](../plans/2026-11-19-dsh-底座摸底-目标架构.md)（§3 阶段 2）

---

## 0. 摘要：先说结论

| 问题 | 结论 | 依据 |
| ---- | ---- | ---- |
| 会话持久化用 `dsh-storage` 还是我们自己的表？ | **都不用**（不是二选一）：**产品事实仍在我们自己的表**（`ai_conversation` / `ai_message` 语义一字不改），**执行痕迹用「dsh 形状的追加式事件日志」落进 MySQL**（新增表 `ai_session_event`） | 上游 spec §2.7 的「两边都要，各管各的」 |
| 和 `ai_conversation` 怎么共存？ | **并存**：`ai_conversation` 继续是「会话是什么」的事实源；新增**会话 ↔ dsh session 的映射列** `ai_conversation.dsh_session_id`（**可空** ⇒ 迁移前的旧会话照读） | 上游 spec §2.7 第 3 条 |
| `dsh-storage` 家族为什么不选？ | 它是给**非会话的应用数据**（工作区记录、sidecar）用的 ⇒ **不是** `ai_*` 表的替代品；而且 `dsh-session-persistence-sqlite` 没有 0.2.2-rc.5（还在 0.0.1-rc.1 线）⇒ 强行用会引入第二条依赖线 | 上游 spec §2.7 · 版本锁的 `knownGaps` |
| 审计还留痕吗？ | **留**：`ai_audit_log` 的**语义一字不改**（仍是「写操作审计」）；**新增三类留痕**（模型调用 / 工具调用 / 闸门决策）⇒ 沿用**现有检索口径**（`core/routes/audit.ts` 的 `/api/audit`）查得到 | issue #121 的验收标准 |
| 前端要改吗？ | **零改动**：`core/routes/contract.ts` 一字不改；`GET /api/agent/:cid/state` 只**多**一个字段（前端忽略未知字段） | 上游 spec §5 |
| 老数据能读吗？ | **能**：新列可空、新表是空的 ⇒ 旧会话 / 旧审计行**一条不少**（本条不做回填） | issue #121 的验收标准 |

> ⚠️ **一句话**：**产品事实留在关系型行（不动），执行痕迹搬成 dsh 形状的追加式事件日志（新增），
> 审计口径不动但补齐三类留痕。**

---

## 1. 为什么不是「二选一」

dsh 与我们是**两种形状**（上游 spec §2.7）：

| | dsh | 我们 |
| - | --- | --- |
| 形状 | **追加式事件日志**（每会话一个日志） | **关系型行**（会话 / 消息 / 待确认 / 审计） |
| 谁要 | 运行细节（工具轨迹、审批、压缩、流） | **产品事实**（会话列表、消息、待确认、审计） |

前端要的就是「会话 + 消息 + 审计」这个形状 ⇒ **产品事实源不能换**（换了前端就崩）。
而「这一轮到底发生了什么」在 dsh 那边是**事件流** ⇒ **执行痕迹应该按事件流存**。

⇒ **两层，各管各的**：

```
┌─ 前端（零改动） ─────────────────────────────────────────┐
│  GET /api/agent/:cid/state   GET /api/audit              │
└──────────────▲───────────────────────────────────────────-┘
               │
┌──────────────┴───────────────────────────────────────────┐
│ backend/ai                                                │
│  ai_conversation（产品事实：会话是什么）                   │
│  ai_message    （产品事实：对话内容）                       │
│  ai_audit_log  （审计：谁做了什么 · 改前改后）              │
│  ai_session_event（新：dsh 形状的追加式事件日志）           │
│      ↑ 一行 = 一个事件（模型调用 / 工具调用 / 闸门决策……）  │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 数据模型（**只加不改**）

> **共享库规矩**：`ai_*` 表与 AiAdmin 的 56 张业务表同库 ⇒ **只许加表 / 加列**，
> **不许改已有列的含义、不许删数据**（issue #121 的硬约束 · #81 的存储解耦约定）。

| 变更 | 表 | 内容 | 为什么 |
| ---- | -- | ---- | ------ |
| **加列** | `ai_conversation` | `dsh_session_id VARCHAR(64) NULL` | 会话 ↔ dsh session 的映射（上游 spec §2.7 第 3 条） |
| **加表** | `ai_session_event` | 追加式事件日志（见下） | dsh 形状的会话日志落进 MySQL |

```prisma
model AiSessionEvent {
  id             String   @id @default(cuid()) @db.VarChar(64)
  conversationId String   @map("conversation_id") @db.VarChar(64)
  dshSessionId   String?  @map("dsh_session_id") @db.VarChar(64)
  seq            Int      @default(0)              // 会话内递增
  kind           String   @db.VarChar(32)          // model_call / tool_call / …
  eventName      String   @map("event_name") @db.VarChar(64)  // dsh 的事件名
  payload        Json                              // 事件载荷（截断后）
  createdAt      DateTime @default(now()) @map("created_at") @db.DateTime(3)
  @@index([conversationId, seq])
}
```

### 2.1 迁移脚本的安全规矩

- 迁移目录：`backend/ai/prisma/migrations/2_add_dsh_session_storage/migration.sql`；
- **只许** `ADD COLUMN` / `CREATE TABLE` / `ADD CONSTRAINT`（外键）；
- **不许** `DROP` / `TRUNCATE` / `DELETE` / `RENAME` / `MODIFY` / `CHANGE COLUMN`；
- 新列**可空** ⇒ 旧会话不需要回填（**回填 = 在共享库上多一次写操作 ⇒ 不做**）；
- 迁移**不在库里执行**（只提交脚本）⇒ 由人在**测试库**先验（与 #81 的做法一致）。

### 2.2 迁移脚本的单测（issue 的验收项）

CI 里**没有 MySQL**（`.github/workflows/ci.yml` 没有数据库服务）⇒ 单测用一个
**只认我们迁移用到的 SQL 子集的迷你执行器**（`backend/ai/src/store/migration.test.ts`）：

| 用例 | 断言 |
| ---- | ---- |
| **空库跑通** | 从空状态按序执行 `0_init` → `1_add_conversation_agent_id` → `2_add_dsh_session_storage` ⇒ 5 张旧表 + 新表都在、`ai_conversation` 有 `agent_id` 与 `dsh_session_id` |
| **已有库跑通** | 先执行 `0_init` + `1` 并**塞进旧数据**（一条旧会话、一条旧审计行）⇒ 执行 `2` 后：旧行**一条不少、一字不改**，旧会话的 `dsh_session_id` 是 `NULL`（⇒ 老数据可读），新表是空的 |
| **只增不改** | 迁移 SQL 里没有危险动词（与 `scripts/e2e/ai-container.static.cjs` 的安全阀同一套判据） |

---

## 3. 谁写、什么时候写

### 3.1 会话事件日志（`ai_session_event`）

**写在适配层**（`core/adapter/dsh/persistence.ts`）⇒ **dsh 的类型只出现在适配层**（上游 spec §7）。

| dsh 事件 | `kind` | 说明 |
| -------- | ------ | ---- |
| `assistant/message` | `model_call` | 一次模型调用 |
| `tool/call` | `tool_call` | 模型要调工具了 |
| `tool/result` | `tool_result` | 工具执行完了 |
| `approval/asked` | `gate_asked` | 闸门问了 |
| `approval/decided` | `gate_decided` | dsh 侧的审批结果 |
| `turn/end` | `turn_end` | 一轮结束 |
| 其它 | `other` | 原样记（**只增不删** ⇒ 以后加事件类型不用改表） |

⚠️ **载荷要截断**（模型流可能很大 ⇒ 一条事件能到几十 KB）⇒ 截到 **8 KB** 再入库。

⚠️ **写失败不许影响对话**（表还没迁移 / 库连不上）⇒ 失败只记一条日志。

### 3.2 审计（`ai_audit_log`）

**语义一字不改**：仍是「**已经发生的动作**」的权威凭据（写前 / 写后快照、可撤销）。
**新增三类留痕**，沿用现有 writer / 脱敏 / 检索口径：

| 留痕 | `command` | `actor_type` | 什么时候写 |
| ---- | --------- | ------------ | ---------- |
| **模型调用** | `model_call` | `AI` | 收到 `assistant/message` |
| **工具调用** | 工具名（归一化后） | `AI` | 收到 `tool/result` ⇒ **且这次调用没有产生写审计** |
| **闸门决策** | 被闸的工具名 | `USER` | 人批准 / 拒绝的那一刻（**人做的决定**） |

**为什么工具调用要「没有写审计才补」**：
写工具（新建 / 修改）**自己已经写了一条写审计**（`create_task` 那样 ⇒ 命令目录里的工具自己写；
MCP 写工具 ⇒ 运行时写）⇒ 再补一条就是**同一件事记两遍**（审计页会看到两条同名行）。
⇒ 规则：**每个工具调用至少留一行** —— 写工具留的是那条**更全的写审计**（带写前 / 写后快照），
只读工具留的是这条**调用痕迹**。

> 这条规则由 `core/audit/audit-trail.ts`（包一层的 writer，记住「最近写过哪些命令」）判定
> ⇒ **不是靠猜工具名**（内核不许知道业务命令 ⇒ 业务词检查也过）。

---

## 4. 对外契约不变（前端零改动）

| 端点 | 变化 |
| ---- | ---- |
| `GET /api/agent/:cid/state` | **多**一个字段 `sessionEvents`（折叠后的会话事件）⇒ 已有字段一个不动 ⇒ 前端零改动 |
| `GET /api/audit` | 路径 / 参数 / 信封 / 形状**一字不改** ⇒ 只是**多了一些行**（三类留痕）⇒ 前端零改动 |
| 其余 8 个端点 | **一字不改**（`core/routes/contract.ts` 一个字都不动） |

⚠️ **已知的产品影响**（PM 需要知道）：审计页会多出 `model_call` 与只读工具调用的行
⇒ 列表条目变多（**数据变多，不是契约变**）。写操作审计一条不少。

---

## 5. 老数据可读

| 老东西 | 迁移后 |
| ------ | ------ |
| 旧会话（`agent_id` 可能也是空） | **读得到**（`dsh_session_id` 是 `NULL`）⇒ 快照端点返回 `sessionEvents: []` |
| 旧消息 | **读得到**（`ai_message` 一个字没动） |
| 旧审计行 | **读得到**（`ai_audit_log` 一个字没动）⇒ 检索口径不变 |
| 旧会话**续聊** | **不保证**（issue 只要求「至少能读」）⇒ 迁移前的会话在新 runner 下可能起不来新会话 |

⚠️ **不要求能续聊**：迁移前的会话是在 pi runner 下产生的 ⇒ dsh runner 的历史还原
走的是 `ai_message`（今天就是这样）⇒ **能读**；**续聊**要等 #123（拔 pi）之后统一。

---

## 6. 类型边界（上游 spec §7）

| 规矩 | 本条的落法 |
| ---- | ---------- |
| dsh 的类型只许在 `core/adapter/dsh/**` 与 `backend/ai/dsh-plugin/**` | 事件投影器（`core/adapter/dsh/persistence.ts`）**只认我们自己写的 JSON 形状**（`protocol.ts`）⇒ 不 import dsh 的类型 |
| `scripts/check-dsh-boundary.cjs` 要跟着更新并保持绿 | 本条**不需要改它**（新代码都在适配层里）⇒ 跑一遍确认仍绿 |

---

## 7. 逐文件清单

| 文件 | 动作 | 说明 |
| ---- | ---- | ---- |
| `backend/ai/prisma/schema.prisma` | 改 | 加 `AiConversation.dshSessionId` + 新模型 `AiSessionEvent`（**只加**） |
| `backend/ai/prisma/migrations/2_add_dsh_session_storage/migration.sql` | 加 | 只增的迁移脚本 |
| `backend/ai/src/core/store/store.ts` | 改 | `ConversationRecord` 加 `dshSessionId`；加 `setDshSessionId` |
| `backend/ai/src/core/store/session-events.ts` | 加 | 会话事件日志的存取 |
| `backend/ai/src/core/store/migration.test.ts` | 加 | 迁移脚本的单测（空库 / 已有库 / 只增不改） |
| `backend/ai/src/core/audit/audit-trail.ts` | 加 | 包一层的 writer（记住最近写过的命令 ⇒ 工具调用去重） |
| `backend/ai/src/core/adapter/dsh/persistence.ts` | 加 | dsh 事件 / 闸门决策 ⇒ 事件日志 + 审计留痕 |
| `backend/ai/src/core/adapter/dsh/session.ts` | 改 | 接线（把事件交给投影器） |
| `backend/ai/src/core/adapter/dsh/approvals.ts` | 改 | 闸门决策回报给投影器 |
| `backend/ai/src/core/adapter/dsh/runner.ts` | 改 | 透传 store / audit / userId / model |
| `backend/ai/src/core/session/runtime.ts` | 改 | 建 dsh 会话时写映射列；快照多一个字段 |
| `backend/ai/src/core/routes/agent.ts` | 改 | 快照多回一个字段（**已有字段不动**） |
| `backend/ai/src/core/routes/contract.ts` | **不动** | 契约表一个字都不改 |
| `scripts/e2e/ai-container.static.cjs` | 改 | 迁移安全阀：新表也在白名单里 |
| `scripts/e2e/dsh-storage.static.cjs` | 加 | 静态验收（模型 / 迁移 / 接线） |

**不做**：❌ 不改业务插件（PM 那套）· ❌ 不删老表 / 老数据 · ❌ 不做管理面 · ❌ 不改前端 ·
❌ 不改 `core/routes/contract.ts` · ❌ 不动 AiAdmin 那个仓。
