# 实施计划：backend/ai 拆分（通用内核 core/ + 业务插件 plugins/pm/）

> 对应 issue **#82** · 设计文档：`docs/superpowers/specs/2026-11-16-backend-ai-拆分-design.md`
> · 2026-11-16
>
> ⚠️ **阶段 0（本计划 + 设计文档）是唯一的「文档 PR」** ⇒ **等人 review 通过后**才允许动代码。

---

## 0. 阶段总览

| 阶段 | 是什么 | PR 数 | 风险 | 验证 | 回滚 |
| ---- | ------ | ----- | ---- | ---- | ---- |
| **0** | spec + plan（**纯文档**） | 1 | 无 | 人 review | 删文档 |
| **1** | 纯搬家：`adapter/` · `aadmin/` · `create-task.ts` → `plugins/pm/` | 1 | 低（只改 import） | tsc + 单测 + e2e | `git revert` |
| **2** | **唯一有逻辑的一步**：拆 `context.ts` | 1 | **中**（白名单） | tsc + 单测 + e2e + 白名单回归 | `git revert` |
| **3** | 纯搬家：`agent/` 剩余部分按能力目录重组 | 1~2 | 低 | tsc + 单测 + e2e | `git revert` |
| **4** | 接线：插件注册表 · 配置指插件 · `GET /api/agents` 报插件能力 | 1 | 中 | tsc + 单测 + e2e | `git revert` |
| **5** | 按「可发布」收口：公开入口 · 依赖不外泄 | 1 | 低 | tsc + 单测 + e2e + 入口单测 | `git revert` |

⇒ **每个阶段一个分支一个 PR** ⇒ 任何一步不对 ⇒ 回退一个 PR 即可。
⇒ **前置**：#77～#81 先合并（配置化落地后再切边界最清楚）。

---

## 1. 阶段 0：设计文档（**本 PR**）

- [x] `docs/superpowers/specs/2026-11-16-backend-ai-拆分-design.md`
      —— 逐条作答 ①～⑧ + 风险清单 + 回滚办法 + 未决问题
- [x] `docs/superpowers/plans/2026-11-16-backend-ai-拆分.md`（本文件）
- **验收**：人 review 通过（PM 的两阶段闸门）⇒ 才允许开阶段 1

⚠️ 本阶段**不改任何代码** ⇒ CI 的 e2e/单测行为与 main 一致。

---

## 2. 阶段 1：把业务代码挪进 `plugins/pm/`（**纯搬家**）

**目标**：让「哪些是业务」在目录上先看得见 ⇒ 后面拆 `context.ts` 时心里有数。

### 2.1 改动清单

| 现在 | 目标 |
| ---- | ---- |
| `src/adapter/**` | `src/plugins/pm/adapter/**` |
| `src/aadmin/**` | `src/plugins/pm/adapter/aadmin/**` |
| `src/tools/create-task.ts` | `src/plugins/pm/tools/create-task.ts` |
| `src/tools/index.ts`（`COMMAND_CATALOG`） | 留在 `core/tools/`（**注册表**），但**命令的来源改成插件注册表**（见下） |

- **import 批量改**：`src/adapter/*` → `../../plugins/pm/adapter/*`；`src/aadmin/*` → 同理。
- ⚠️ **一处接口形状的临时改动**（不改行为）：`COMMAND_CATALOG` 改成
  「从**已注册的插件**取命令」⇒ 于是插件里的 `create_task` 还能进来（否则阶段 1 就把功能拆没了）。
  ⇒ 这一步只是**把「命令从哪来」换成注册表**，注册表此时只有一个插件（pm）。

### 2.2 怎么验证

```bash
cd backend/ai
npm run typecheck
npm test
cd frontend && npm run build && npx playwright test     # 199 条 e2e 全绿
```

### 2.3 风险与回滚

- **风险**：漏改一条 import ⇒ tsc 立刻报；命令进不来 ⇒ 单测/e2e 立刻红。
- **回滚**：`git revert` ⇒ 文件原样回去（**无数据/配置影响**）。

---

## 3. 阶段 2：拆 `context.ts`（**唯一有逻辑的一步**）

**目标**：core 只保留「**锚点机制 + 白名单机制**」；PM 的字段语义（`status_code`/`actual_hours`/`description`、task/project 两种 scope）全在插件。

### 3.1 改动清单

| 现在 | 目标 |
| ---- | ---- |
| `src/agent/context.ts` 的**白名单字段**（`WRITABLE_FIELDS`） | `plugins/pm/context/`（**插件注入**） |
| `parseAiTaskContext`（解析 `kind: 'task' \| 'project'`） | `plugins/pm/context/` |
| `renderAiTaskContext`（渲染成提示词段落） | `plugins/pm/context/` |
| `writeTargetId` / `changedFields` | `core/context/anchor.ts`（**通用算法**：按 scope + 白名单算） |

⇒ core 侧只留：`ContextAnchor` 形状 + 「按白名单收窄写操作」的机制。

### 3.2 必钉的回归（**不许弱化**）

1. **白名单字段不变**：`status_code` / `actual_hours` / `description` 三个字段**能写**，
   其余**写不进去**（⇒ 迁移后的 `context.test.ts` 用例逐条照搬今天的断言）。
2. **「与 AI 讨论」的上下文渲染**不变（e2e 已有覆盖 ⇒ 必须全绿）。
3. ⚠️ **不许用「白名单改成全部字段」来让用例过** ⇒ review 时专门看这一条。

### 3.3 风险与回滚

- **风险 R3（最严重）**：白名单失效 ⇒ 静默改了不该改的字段。
- **回滚**：`git revert` ⇒ 回到今天的实现 ⇒ 行为回到今天。

---

## 4. 阶段 3：把 `agent/` 按能力重组（**纯搬家**）

| 现在 | 目标 |
| ---- | ---- |
| `src/agent/runtime.ts` `pi-session.ts` `session-entries.ts` `session-registry.ts` `frame-buffer.ts` `event-mapper.ts` `events.ts` `startup-lock.ts` `identity.ts` | `src/core/session/**` |
| `src/agent/skills.ts` `skill-tools.ts` `skill-catalog.ts` | `src/core/skills/**` |
| `src/agent/mcp.ts` `mcp.fake.ts` | `src/core/mcp/**` |
| `src/agent/gate.ts` `pending-waiters.ts` | `src/core/gate/**` |
| `src/pending-query.ts` `pending-write.ts` | `src/core/gate/**` |
| `src/audit.ts` `audit-query.ts` `audit-redact.ts` | `src/core/audit/**` |
| `src/agent/store.ts` `src/db.ts` | `src/core/store/**` |
| `src/http/**` | `src/core/http/**` |
| `src/routes/**` | `src/core/routes/**` |
| `src/types/api.ts` | `src/core/types/**` |
| `src/env.ts` `src/load-env.ts` | `src/core/env/**`（**`AIADMIN_*` 由插件声明**，见设计 §12.3） |
| `src/core/config/**` | `src/core/config/**`（**已经在目标位置** ⇒ 不用动） |

⚠️ **`agents/` 不动** ⇒ 配置里的技能相对路径**一个字不改**（设计 §7 第 7 条）。

### 4.1 怎么验证

```bash
cd backend/ai && npm run typecheck && npm test
cd frontend && npm run build && npx playwright test
node scripts/e2e/ai-container.static.cjs
```

⇒ 加一条回归单测：`agents-shipped.test.ts` 断言 **pm 的技能目录**仍是 `<backend/ai>/.pi/skills`
⇒ 技能目录解析错了会**静默**（模型看不到技能）⇒ 必须有这条。

---

## 5. 阶段 4：接线（插件注册表 · 配置指插件 · 能力可见）

- `core/plugins.ts`：接口 + 注册表（设计 §4.1）。
- `src/plugins.ts`（**入口侧**）：注册 `pm` 插件 ⇒ **唯一 import plugins 的地方**。
- 配置：`agents/<id>/agent.yaml` 可写 `plugin: pm` ⇒ core 按名字取插件。
- `GET /api/agents` 的能力摘要里**报出插件**（哪个智能体挂了哪个插件）。

### 5.1 验收

- 两个智能体各起一个会话 ⇒ 各自的能力**明显不同**（PM 有命令/技能，通用问答没有）⇒ 单测钉住。
- `core` 不 import plugins ⇒ 架构单测（设计 §5.1）通过。

---

## 6. 阶段 5：按「可发布」收口

- `core/index.ts`：**唯一公开入口**（外部只从这里 import）⇒ 单测断言。
- core 的依赖清单可枚举（`core/package.json` 或 core 目录说明）⇒ 只依赖通用件。
- 配置 schema 视为**对外契约**（写进 `agents/README.md`）。

---

## 7. 阶段 2 之外的「顺带做掉」（一次做完，别分多次）

- ⑤ 的**架构单测** + `scripts/check-core-purity.cjs` + CI 接线
  ⇒ **建议放在阶段 3**（那时 core/ 已经是最终形状）⇒ 一次做完，别分多次。
- ⑦ 的清单**逐项核对** ⇒ 放在阶段 3/5 收尾（文档同步）。

---

## 8. 每阶段的通用验收清单

- [ ] `npm run typecheck` 绿
- [ ] `npm test` 绿（backend/ai）
- [ ] `npm run lint` + `npm test` 绿（frontend）
- [ ] `npm run build` + `npx playwright test` 绿（**199 条 e2e**）
- [ ] `node scripts/e2e/ai-container.static.cjs` 绿
- [ ] `node scripts/e2e/ai-container.cjs` 绿（要 docker）
- [ ] `docs/notes/` 更新（这一步搬了什么、决策、怎么验）
- [ ] PR 正文写明：**只搬不改**（有行为改动 ⇒ 单独 PR 说明）

---

## 9. 回滚总则

- 每个阶段一个 PR ⇒ **回滚 = `git revert`**。
- **全程不动数据库、不动 `agents/` 配置** ⇒ 不需要数据/配置回滚。
- 阶段 2（唯一有逻辑的一步）⇒ revert 后行为回到今天（e2e 全绿即证明）。
