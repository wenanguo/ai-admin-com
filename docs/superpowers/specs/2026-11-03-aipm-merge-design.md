# AIPM × AiAdmin 合并设计

> 把 `docs/aipm/` 的 AI 项目管理能力，合并进 `ai-admin-com`（React + antd Pro）与
> AiAdmin（FastAPI）这一套已有栈里。
>
> **状态**：草案，待批准。批准后进入 `writing-plans` 拆实施计划。
> **日期**：2026-11-03
> **决策人**：项目所有者

---

## 1. 意图与背景

### 1.1 要解决什么

`docs/aipm/` 是一套完整但**尚未落地**的设计：对话驱动的项目管理平台 —— 用一句话完成
项目/里程碑/任务/风险的日常操作，AI 同时给出可解释的进度预测与风险预警。

它现在的状态是：

| 部分 | 状态 |
|---|---|
| 00–07 文档（8300 行） | 完整、自洽 |
| 12 页 HTML 原型 | 完整，但是 Tailwind + 假数据 |
| 前端实现 | **无** |
| 后端实现 | **无** |
| 业务事实源 | **已存在** —— AiAdmin 后端的 PM 插件 |

最后一行是这次合并的起点，也是整个规划能成立的原因。

### 1.2 合并前必须承认的事实

AIPM 文档 07 §Q1 把「外部已实现的 PM API 是哪一个」列为 🔴 阻塞项，答案未定。
**这个问题现在有答案了**：

```
AiAdmin 后端  D:/project/AiAdmin/backend/app/plugin/
  module_pm_project/pm_project/      →  /pm_project
  module_pm_project/pm_milestone/     →  /pm_milestone
  module_pm_project/pm_task/         →  /pm_task
  module_pm_risk/pm_risk/             →  /pm_risk
  module_pm_comment/pm_comment/       →  /pm_comment
  module_pm_meeting/pm_meeting/       →  /pm_meeting
```

插件由 `app/core/discover.py` 自动发现注册（顶级目录名以 `module_` 开头即可）。
而这些字典种子的注释直接写着：

```sql
('任务状态', 'module_pm_task_status',  0, '任务状态机(PRD-v2 §3.3)', ...)
('风险状态', 'module_pm_risk_status',  0, '风险状态机(PRD-v2 §3.4)', ...)
```

⇒ **AiAdmin 后端已经是 PRD-v2 的实现了。**

这改变了合并的性质：AIPM 文档 00 §3.10 说「PRD-v2 的业务模型层全量移植 → 02/04/05」，
但那个移植**已经发生在后端**了。AIPM 的 02 领域模型不是从零建模，而是一层
**枚举归一 + 字段映射 + 派生状态**。合并要做的是把这层映射建起来，不是重造 PM 领域。

### 1.3 这次合并的"为什么"

一句话：**让 AI 成为这套系统的主操作入口，而不是一个外挂聊天框。**

具体到可交付的能力：

1. 一句话完成建任务、改截止日、改状态、拆里程碑、登记/升级风险、批量调整。
2. 每条 AI 写入都产生**命令卡片**，破坏性操作先进**待确认队列**。
3. 每条 AI 写入都**可查、可撤销**。
4. 进度、风险、健康度的**数字**由确定性规则算，LLM 只负责措辞。
5. 关键路径始终可用：关掉模型 key，手动操作与全部视图照常。

---

## 2. 目标 / 非目标 / 反目标

### 2.1 目标

| # | 目标 | 验证方式 |
|---|---|---|
| G1 | AI 工作台**常驻右侧栏**，与左侧导航对称，可折叠（⌘B） | 原型对照 + 交互走查 |
| G2 | AI 与人工**走同一条写入通路**（同一适配层、同一审计、同一撤销语义） | AI 侧 `ai_audit_log` 是权威审计（字段级 before/after，可撤销）；AiAdmin 操作日志是**不可关联**的旁证（§6.8） |
| G3 | 所有 AI 写入**可撤销**，撤销有冲突检测 | 撤销后数据与操作前完全一致；他人改过则拒绝覆盖 |
| G4 | 破坏性操作**无静默生效** | 删除/拆分/批量/风险降级/里程碑改期 > 3 天，必须人工确认 |
| G5 | 派生指标（健康度/进度/ETA/风险候选）**由规则算**，与模型可用性无关 | 断掉模型 key，指标照常 |
| G6 | AiAdmin 现有 9 个系统管理模块**零回归** | 现有 279 单测 + 76 e2e 全绿 |

### 2.2 非目标（第一版不做）

- 飞书机器人（AIPM 07 Q9；架构预留 `Conversation.channel = FEISHU`）。
- 甘特图、PMO 组合仪表盘、项目模板（AIPM 00 §2 已定 v1.1）。
- 计费、多租户 SaaS 化、外部干系人门户、自定义工作流引擎。
- 向量库 / 语义相似项目检索（AIPM 07 Q10）。
- 改写 AiAdmin 后端的 PM 业务逻辑（本次合并**只读**后端，见 §6.3 的例外清单）。

### 2.3 反目标（做到即失败）

- **AI 直连数据库** —— 由 LLM 拼出的 SQL 一律是缺陷。
- **静默的破坏性操作** —— 无人确认即生效即缺陷。
- **不可回溯的 AI 变更** —— 每条 AI 写入必须可查、可撤销。
- **规则被 LLM 覆盖** —— 进度/风险/健康度的数字必须确定性算出。
- **AI 不可用即系统不可用** —— 关掉 key，手动操作与全部视图照常。
- **为了接 AI 而牺牲系统管理的稳定性** —— G6 是硬门槛。

---

## 3. 约束（全部已核实）

这一节只写**动手前验证过的事实**，不是推测。

### 3.1 前端侧

| 约束 | 证据 | 影响 |
|---|---|---|
| 生产是**静态导出** | `config/config.ts:224` `exportStatic: {}`；`npm run build` 产出 41 个静态 HTML | **生产环境没有 Node 进程** ⇒ agent 不能寄居在前端的运行时里 |
| 部署是 nginx 静态托管 | `.github/workflows/deploy.yml`（GitHub Pages 预览）；`config/proxy.ts` 把 `/api/` 转发到后端 | 可以加一条 `location /ai-api/` 反代 ⇒ 前端与 AI 服务**同源**，无 CORS |
| umi 4.7 **没有 BFF 插件** | `node_modules/@umijs/plugins/dist/` 无 bff；`@umijs/preset-umi/dist/features/apiRoute` 是给 Vercel/Netlify/Worker 的 | "把 agent 放进 umi `server/`" **不可行** |
| pi SDK 在 npm 上 | `@earendil-works/pi-coding-agent@1.5.0`（本地 1.4.0） | agent 服务可用 TypeScript 实现 |

### 3.2 后端侧

| 约束 | 证据 | 影响 |
|---|---|---|
| PM 实体已实现 | `app/plugin/module_pm_*` | 事实源现成 |
| 已有**自动操作日志** | `app/core/router_class.py` 的 `OperationLogRoute`，PM 路由都挂了 `route_class=OperationLogRoute` | 人工写操作**已经有**审计记录 |
| 但操作日志**不是字段级前后快照** | 只记 request/response payload，且是 `BackgroundTask` 异步、**独立事务** | 撤销仍需 AIPM 的**写前快照**（多一次 GET） |
| **没有服务账号 / API Key 机制** | `app/api/v1/module_system/auth/` 只有密码登录 + OAuth | AI 服务不能用一个固定服务账号 ⇒ 见 §6.4 的**用户身份透传**裁决 |
| **PM 菜单没有种子** | `sql/mysql/pm_v2_seed_v1.sql` 有表与字典数据，无 `sys_menu` 插入 | PM 页面不会被菜单下发，需要补种子 |
| 状态是**字典码**不是枚举 | `ModulePmTaskCreateSchema.status_code: str`（字典 `module_pm_task_status`） | 枚举映射表要按字典实际值写 |

### 3.3 枚举映射（实测值 ↔ AIPM 02 §2 统一模型）

| 统一模型 | AiAdmin 字典实际值 | 一致性 |
|---|---|---|
| `Project.status`：PLANNING / ACTIVE / ON_HOLD / COMPLETED / CANCELLED / ARCHIVED | `planning` / `active` / `on_hold` / `completed` / `cancelled` / `archived` | ✅ 全一致 |
| `Task.status`：BACKLOG / TODO / IN_PROGRESS / REVIEW / DONE / BLOCKED / CANCELLED | `backlog` / `todo` / `in_progress` / `blocked` / `review` / `done` / `cancelled` | ✅ 全一致 |
| `Task.priority`：P0 / P1 / P2 / P3 | `P0` / `P1` / `P2` / `P3` | ✅ 全一致 |
| `Task.type`：FEATURE / BUG / TASK / CHORE | `feature` / `bug` / `ops` / `research` / `spike` | ⚠️ **不一致**（后端多 3 类，少 2 类） |
| `Task.source`：MANUAL / AI / IMPORT | `manual` / `nl_chat` / `import` / `api` | ⚠️ **不完全一致** |

> **裁决（我的判断）**：以**后端字典为准**。
> 统一模型是给上层（tool 定义、前端视图）用的**归一视图**，不是要覆盖后端的取值集合。
> `Task.type` 的统一枚举扩成 7 个后端值的并集（`feature/bug/ops/research/spike` +
> 映射到 `FEATURE/BUG/CHORE` 的兼容别名），`source` 补 `api`。
> **代价**：AIPM 02 文档的枚举表要改；PRD-v2 的 `TASK/CHORE` 在后端无对应字典值，
> 工具描述里不能承诺它们。

### 3.4 前端可复用地基（已存在，不必重造）

| 能力 | 位置 | AI 工作台怎么用 |
|---|---|---|
| token 存取 + 401 静默刷新重放 | `src/auth/token.ts`、`src/auth/session.ts` | 直接复用 |
| 后端下发菜单 + 按钮级 `useAccess()` 门控 | `src/menu/adapter.ts`、`src/access.ts` | AI 工作台的命令按钮按权限码门控 |
| 统一业务码判定 + `BizError` | `src/services/response.ts`、`src/requestErrorConfig.ts` | AI 服务返回同样的信封，前端同一套判定 |
| `CrudTable` 脚手架（状态机 / 权限门控列 / 分页） | `src/components/CrudTable/` | PM 页面复用 |
| `DeptTreeSelect` / `MenuPermissionTree` | `src/components/` | PM 页面复用 |
| ProTable + ModalForm 的页面范式 | `src/pages/module_system/*/index.tsx`（9 个模块） | PM 页面照抄这个范式 |

---

## 4. 方案对比与选择

### 4.1 三个候选

| | **A' 单栈收敛（本方案）** | B 双栈并存 | C agent sidecar + FastAPI 主导 |
|---|---|---|---|
| 前端 | Umi + antd Pro，PM 页面 + 常驻右侧 AI 工作台 | ai-admin-com 补 PM 页面；AIPM 独立 Next.js 应用，iframe/micro-frontend 嵌入 | 同 A' |
| AI 层 | **独立 Next.js 服务**（只出 API，不出 UI） | Next.js 全栈（UI + API） | FastAPI 加 `/api/agent/*` 反代到 Node 进程 |
| 事实源 | AiAdmin FastAPI | 同 | 同 |
| 推翻的决策 | A4 技术栈（部分）、A5 后端形态、A6 通路 A、A14 权限两层 | 几乎不推翻 | A4/A5 部分 |
| 登录态 | 一套（AiAdmin 的 token） | **两套**，token 要跨应用透传 | 一套 |
| SSE | 浏览器直连 AI 服务（同源反代），无跨进程转发 | iframe 内 SSE 跨域，且常驻右栏做不成 | **跨进程转发**（FastAPI 代理流） |
| 部署 | +1 个常驻 Node 服务 | +1 个前端应用 + 1 个后端服务 | +1 个常驻 Node 服务 |

### 4.2 选了 A'，以及为什么它和原提案 A 不一样

项目所有者选的是 **A · 单栈收敛**。动手核实后发现原提案有一处**技术前提不成立**：

> 原提案 A 说「Agent + 适配层放进 umi 的 `server/`（BFF，Node 运行时，pi agent 同进程）」。

但 `config/config.ts` 是 `exportStatic: {}` —— **生产环境根本没有 Node 进程**，
umi 4.7 也没有 BFF 插件（§3.1）。所以「同进程」在生产不成立。

A' 保留 A 的**合并形状**（一个前端、一个事实源、AI 层叠在上面），只把 AI 层的
**进程形态**从「寄居前端」改成「独立服务」：

```
┌───────────────────────────────────────────────────────────────────┐
│ 浏览器                                                              │
│   antd Pro 静态前端（ai-admin-com）                                  │
│   ├─ 系统管理 9 页（不动）                                            │
│   ├─ PM 5 页（项目/里程碑/任务/风险/看板）—— 本次新建                   │
│   └─ 右侧常驻 AI 工作台（对话 / 待确认 / 审计）—— 本次新建            │
└───────┬────────────────────────────────────┬───────────────────────┘
        │ /api/v1/**                         │ /ai-api/**
        ▼                                    ▼
┌────────────────────────┐        ┌──────────────────────────────────┐
│ FastAPI · AiAdmin      │◄───────│ Next.js AI 服务（常驻 Node 进程）   │
│  · PM 插件（事实源）    │ 用户身份 │  · pi agent（同进程 SDK）         │
│  · 系统管理 9 模块      │  透传   │  · 适配层（转发 PM API）           │
│  · OperationLogRoute   │  +token │  · AI 元数据表（Prisma → MySQL）   │
│    （人工写操作的审计）  │        │  · 命令层 / 待确认 / 撤销           │
└────────────────────────┘        │  · SSE 事件流                      │
                                  └──────────────────────────────────┘
                                          ▲
                                   nginx 同源反代 /ai-api/
```

### 4.3 为什么不是 B

- **违反一条已定决策**：AIPM 00 §3.3 选定「AI 工作台常驻右侧栏」，理由是「与左侧导航对称，
  主内容始终可见」，明确否决了「右侧抽屉」。iframe 嵌入做不成常驻栏，只能退化成抽屉。
- **登录态要复制一套**：B 里 AI 应用有独立的用户表（02 §1 的 `User`/`Session`），
  和 AiAdmin 的 RBAC 是两套。审计里的 `actor_id` 要跨系统对齐。
- **原型已经否掉了这条路**：`docs/aipm/prototype/` 的 AI 浮窗是右下角圆钮，
  AIPM 文档把它换成了常驻右侧栏 —— 原型是旧形态，不能照抄。

### 4.4 为什么不是 C

C 要让 FastAPI 反代 SSE（`StreamingResponse` 包一层 Node 的流）。多一跳、多一个
跨进程的背压与重连边界，而 AIPM 03 §4 已经把「丢帧时快照是最终真相」设计得很严格，
再叠一层代理转发会让 03 §4.4 的 backlog/丢帧语义更难验证。A' 里浏览器直连 AI 服务，
SSE 只跨 nginx 一跳。

### 4.5 推翻的决策与代价（AIPM 00 §3 的「不可静默推翻」清单）

| 原决策 | 改成 | 代价 |
|---|---|---|
| **A4** 技术栈 = Next.js + PG + Prisma + Tailwind/shadcn | 前端 = Umi + antd Pro；AI 服务保留 Next.js；**PG → MySQL**；Prisma 保留 | AIPM 00/01/03 的技术栈段落要改写；本地元数据表要按 MySQL 方言写迁移 |
| **A5** 后端 = Next.js（UI + API 同进程） | 后端拆成两进程（FastAPI 事实源 + Next.js AI 服务） | 多一个部署单元；跨进程调用要处理超时与降级 |
| **A6** 适配层「通路 A = 转发外部 API」（外部 = 未知第三方） | 通路 A = **转发 AiAdmin PM API**（已确定） | 06 §4 的枚举映射表从「可配置模板」变成「按实测值写死的单一映射」 |
| **A14** 权限两层（用户表 + 项目成员 5 角色） | **复用 AiAdmin 的 RBAC**（用户/角色/部门/岗位 + 权限码） | 项目成员 5 角色（VIEWER/MEMBER/ASSIGNEE/MANAGER/OWNER）没有现成对应物 ⇒ 本次**不做**，PM 权限沿用 AiAdmin 的菜单/按钮权限码 |
| **A2** 交互载体先 Web 后飞书 | 不变 | 无 |
| **A7** agent = 同进程 SDK | 不变（相对于 AI 服务进程） | 无 |
| **A8** 待确认 = extension_ui 桥 | 不变 | 无 |
| **A9** 撤销 = 补偿式（写前快照） | 不变 | 无 |
| **A10** 写操作经适配层 + 同事务写审计 | **降级**（见 §9.2） | 审计不再与业务写同事务 |

---

## 5. 目标架构

### 5.1 组件职责

| 组件 | 形态 | 职责 | 不做什么 |
|---|---|---|---|
| **AI 工作台** | antd Pro 里的右侧常驻栏 | 对话、待确认队列、审计与撤销、命令卡片 | 不直接调 AiAdmin 的 PM API |
| **AI 服务** | Next.js Route Handlers（常驻 Node） | ① pi agent 运行时 ② 命令层 ③ 适配层 ④ 待确认 ⑤ 撤销 ⑥ SSE ⑦ AI 元数据 | 不渲染 UI；不做业务规则判定以外的权限判定 |
| **适配层** | AI 服务内的 `DataSource` 实现 | 枚举归一、字段映射、错误归一、写前快照、能力位声明、限流 | 不含任何 AI 逻辑；不做派生计算 |
| **规则引擎** | AI 服务内（纯函数） | 健康度、进度三口径、风险等级、候选风险识别、ETA | 不调用 LLM |
| **AiAdmin** | 现有 FastAPI | PM 事实源、系统管理、**人工写操作的审计** | 不感知 AI |

### 5.2 请求路径

```
① 结构化视图（PM 页面）
   浏览器 → /api/v1/pm_task/list → FastAPI → MySQL
   （走现有的 requestErrorConfig.ts，业务码判定、BizError、401 刷新全部复用）

② AI 对话
   浏览器 → POST /ai-api/agent/:cid/command  { type:"prompt", message }
          → AI 服务 → pi agent → 调 tool → 适配层
          → 适配层 → GET /api/v1/pm_task/list（用用户 token）
          → 结果 / 待确认 → SSE 推回浏览器
```

### 5.3 为什么前端不直连 AiAdmin 的 PM API 来做 AI 的活

AIPM 03 §1 的原话：「前端**永远不直连外部 API**（否则凭据泄露、权限绕过、审计断链）」。
在本方案里，AiAdmin 就是那个"外部 API"，规则不变：

- 浏览器只与**两个**后端说话：FastAPI（结构化视图）和 AI 服务（对话）。
- AI 服务转发 PM API 时带的是**用户的** token，不是服务账号（§6.4）。
- 写前快照、命令卡片、待确认、撤销，全部发生在 AI 服务这一侧。

---

## 6. 关键设计裁决

### 6.1 裁决一：AI 服务用什么进程形态

**Next.js Route Handlers，只出 API 不出 UI。**

| 候选 | 取舍 |
|---|---|
| Next.js（选） | 保留 AIPM 的技术栈与代码形态（SSE 流式响应、Prisma、Route Handlers）；只换掉 UI 层与数据库方言。实现成本最低。 |
| 裸 Fastify/Express + pi SDK | 更轻，但要自己写路由/序列化/文件服务，工作量反而大，且丢掉 AIPM 文档里已写好的 Next 侧约定 |
| umi BFF | **不可行**（§3.1：无 BFF 插件 + 静态导出） |

**代价**：AIPM 00 §3.5「前端 + 后端一个进程」的部署图要改写；AI 服务要单独构建与部署。

### 6.2 裁决二：AI 元数据表存在哪

**MySQL，与 AiAdmin 同库，表前缀 `ai_`，由 AI 服务用 Prisma 管理。**

| 候选 | 取舍 |
|---|---|
| MySQL 同库（选） | 一套备份、一套迁移、一套 docker-compose；Prisma 支持 MySQL；能直接 JOIN AiAdmin 的用户表做审计归因 |
| 独立 PostgreSQL | 保留 AIPM 原设计，但多一个数据库实例与一套备份；且审计要跨库关联 `user_id` |
| 独立 SQLite | 只适合单机开发，多实例会坏 |

表清单（来自 AIPM 02 §1，去掉不需要的）：

```
ai_conversation   id, user_id, project_ref, channel(WEB), created_at
ai_message        id, conversation_id, role, content, tool_calls(json), created_at
ai_pending_action id, conversation_id, user_id, command, args(json), preview(json),
                  status(PENDING|CONFIRMED|REJECTED|EXPIRED|EXECUTED),
                  expires_at, resolved_at, resolved_by, adjusted_from, created_at
ai_audit_log      id, user_id, actor_type(USER|AI), command, args(json),
                  before_snapshot(json), after_snapshot(json),
                  undo_of, undone_at, adopted, model, tokens, latency_ms, trace_id, error, created_at
ai_entity_ref     id, entity_type, external_id, title_cache, last_synced_at
ai_derived_state  id, entity_ref, kind(MILESTONE_HEALTH|ETA|RISK_SUGGESTION), payload(json), computed_at
```

**砍掉的**：`User` / `Session`（用 AiAdmin 的）、`SyncCache`（AiAdmin 就是事实源，不缓存）、
`ProgressSnapshot`（燃尽图数据可由 `ai_derived_state` 承载，见下）。

**注意**：`ai_pending_action` 与 `ai_audit_log` **必须分表**（AIPM 02 §1 已强调）：
前者是"待人决定"，后者是"已发生"。

### 6.3 裁决三：改不改 AiAdmin 后端

**原则：本次合并只读后端。** 只允许两类后端改动，且都列在清单里：

| # | 后端改动 | 为什么必须 | 规模 |
|---|---|---|---|
| B1 | 补 `sys_menu` 种子：PM 5 个菜单节点 + 对应按钮权限码（`module_pm_project:list` 等） | 后端决定菜单显示什么、前端决定路由能不能落地。没有种子，PM 页面永远不会被菜单下发 | 一份 SQL |
| B2 | 补 `module_pm_task` 的 `blocked_since` 字段 | AIPM 02 §5.1 的健康度规则要算「阻塞时长」，当前 `blocked_reason` 只有原因没有起始时间 | 一条 migration + 一个字段 |

**特别说明**：这次不做 AIPM 07 Q2 问的「外部 API 能力位」相关改造 —— 那些能力**本来就有**
（AiAdmin 已有 batch、delete、依赖表、评论），不需要加。

> **不在本次范围**：给 AiAdmin 加服务账号/API Key 机制（§6.4 用用户透传绕开了）、
> 给 AiAdmin 加「写操作 + 审计同事务」的接口（§9.2 用降级方案绕开了）。
> 这两项记入后续 backlog。

### 6.4 裁决四：AI 服务用什么身份调 PM API

**用户身份透传：浏览器把当前 AiAdmin token 交给 AI 服务，AI 服务用该 token 调 PM API。**

| 候选 | 取舍 |
|---|---|
| 用户身份透传（选） | **权限天然按用户走**（AiAdmin 的 RBAC 照常生效）；审计的 `actor_id` 天然正确；**不需要改后端**；不需要存服务账号凭据 |
| 固定服务账号 | 要改后端加服务账号机制；且所有 AI 操作在审计里都是同一个 actor，违反 AIPM 00 §3「每次写操作都留审计记录」的可归因性 |
| 每用户映射到自己的外部账号 | 同用户透传，但 AiAdmin 没有这个概念 |

**实现约束**：

- token **只在内存里**，不落盘、不进日志（`ai_audit_log.args` 要脱敏）。
- token 过期：AI 服务收到 AiAdmin 的 401 → 通过 SSE 回一个 `auth_expired` 事件 →
  前端走**现有的**静默刷新流程（`src/auth/session.ts`）→ 拿到新 token → 重发。
- 撤销时用户可能已换 token：撤销接口带当前 token，透传给适配层。

**代价**：AI 服务不持有长期凭据，不能做「无人值守的定时任务」（如每日 cron 算健康度）。
→ 需要 cron 的派生计算，见 §9.3。

### 6.5 裁决五：前端怎么长出 PM 页面与 AI 工作台

**PM 页面照抄 `src/pages/module_system/*` 的既有范式**（ProTable + ModalForm + `CrudTable`），
**不引入 Tailwind/shadcn，不改设计语言**。原型的视觉只作**布局参考**：

| 原型页面 | 本次产出 | 备注 |
|---|---|---|
| `projects.html` | `src/pages/module_pm/project/index.tsx` | 列表 + 筛选 |
| `project-detail.html` | `src/pages/module_pm/project/detail.tsx` | 概览 + 里程碑/任务/风险摘要 |
| `task-board.html` | `src/pages/module_pm/task/board.tsx` | 看板（6 列） |
| `task-list.html` | `src/pages/module_pm/task/index.tsx` | 表格 + 多列筛选 |
| `milestones.html` | `src/pages/module_pm/milestone/index.tsx` | 时间线（**不做甘特**，AIPM 00 §2 已定 v1.1） |
| `risks.html` | `src/pages/module_pm/risk/index.tsx` | 列表 + 5×5 热力图 |
| `dashboard.html` | **v1 不做** | PMO 组合视图（AIPM 00 §2 定 v1.1） |
| `comments.html` | **v1 不做** | 依赖 `module_pm_comment`（后端有），但评论的 AI 总结价值依赖会议纪要（AIPM 07 Q8：v1 不做会议） |
| `meeting-summary.html` | **v1 不做** | AIPM 07 Q8 定 v1.1 |
| `settings.html` | **v1 不做** | 项目模板（AIPM 00 §2 定 v1.1） |

**AI 工作台**：

- 位置：`ProLayout` 主内容区右侧**常驻栏**（不是抽屉、不是浮窗）—— AIPM 00 §3.3 已定。
- 形态：antd `Layout.Sider`（可折叠，⌘B），宽度约 400px，折叠后留一个图标条。
- 三个页签：**对话 / 待确认 / 审计**（AIPM 原型的三页签设计保留）。
- 复用现有 token/权限/请求层；新增一个 `src/services/api/ai/` 访问 AI 服务。

**代价**：antd 与原型（Element Plus 视觉）的配色/间距要重新对齐；这是**有意为之**，
不引入第二套设计语言。

### 6.6 裁决六：枚举映射表怎么落地

AIPM 06 §4 说映射写成**配置**。本方案里外部系统只有一个且已知 ⇒ **配置退化为常量**，
但**保留映射表这个抽象**（未来接别的 PM 系统时它还有用）。

放在 AI 服务：`src/adapter/aadmin/enums.ts`，内容就是 §3.3 那张表的实测值。
AIPM 06 §4 的 yaml 形式不采用（只有一个数据源，yaml 的收益不抵多一份解析器）。

### 6.7 裁决七：统一模型 vs 后端模型

**上层（tool 定义、前端视图）用 AIPM 02 的统一模型；适配层负责双向转换。**

- 工具的 `parameters` 与 description 里**只出现统一模型的名字**（AIPM 04 §6.6 保留）。
- 适配层把 `status_code: "in_progress"` ⇄ `Task.status: IN_PROGRESS`。
- 写回时取映射表的**第一个外部值**（AIPM 06 §4 规则保留）。
- 外部值没命中任何映射 → 归一为默认状态 + 记一条告警，**不猜语义**（保留）。

### 6.8 裁决八：INV-07 的降级（最需要解释的一条）

AIPM 02 §4.5 的 INV-07 要求「写库必须与 AuditLog 写入在同一事务内」。
**本方案下这条不可达**：业务写是一次到 AiAdmin 的 HTTP 调用，审计写在 AI 服务的事务里，
两者跨进程跨库，不存在共同事务。

**裁决**：把保证改成**三段式**，并写进文档与验收标准：

1. **写前快照**（INV-15 保留）：适配层写前 GET 一次，存字段级差异。
2. **写后核对**：写完再 GET 一次，与预期比对；不一致则记 `error` 并告警。
3. **审计落库**：AI 侧 `ai_audit_log` 记录 before/after。

**权威审计是 AI 侧的 `ai_audit_log`**（字段级 before/after），AiAdmin 的
`OperationLogRoute` 是**次要证据**（路径/方法/载荷/响应级）。

> **⚠️ 两条记录无法可靠关联 —— 这是核实后的结论，不是遗漏。**
> `OperationLogCreateSchema` 只有 path / method / payload / response_code / response_json /
> process_time / created_id / updated_id / description 九个字段，**没有 trace_id 列**；
> `router_class.py` 只读 `Content-Type`，**不读任何自定义请求头**；且载荷超过 2000 字符
> 会被替换成「请求参数过长」。
> ⇒ 「用 trace_id 关联」在没有后端改动的前提下**不可实现**；靠「操作人 + 路径 + 时间窗」
> 的启发式关联在批量场景下也不可靠。
> ⇒ **裁决**：可回溯性由 `ai_audit_log` 的字段级快照承担（这才是 AIPM 要的粒度）；
> 操作日志只作为「确实发生过这次 HTTP 调用」的旁证，不承诺可关联。
> **代价**：无法从一条操作日志反查到对应的 AI 命令。**已否掉的替代方案**：
> (a) 启发式关联 —— 批量场景不可靠；(b) 给后端加 `X-Trace-Id` 头与列 —— 违背 §6.3
> 「只读后端」原则，且只买到"可关联"，不提升审计本身的粒度。

**代价**：AI 侧审计与业务写之间**存在一个不可原子的小窗口**（写成功但审计写失败）。
失败时 `ai_audit_log` 会留 `error` 字段并触发告警，但严格意义上不保证"业务写与审计同时存在"。
这是"业务写在别人家"这一事实的必然结果。缓解手段：审计写失败时**立即重试 3 次**，
仍失败则落到进程内队列 + 落地日志文件（`ai_audit_fallback`）。

---

## 7. 目录布局

```
ai-admin-com/
  src/
    pages/module_pm/              ← 新增：PM 页面（照 module_system 范式）
      project/  milestone/  task/  risk/
    components/ai-workspace/     ← 新增：右侧常驻 AI 工作台
      index.tsx  Conversation.tsx  PendingQueue.tsx  AuditTrail.tsx  CommandCard.tsx
    services/api/ai/              ← 新增：AI 服务客户端（命令协议 + SSE + REST）
      client.ts  sse.ts  types.ts
    pages/module_system/          ← 不动
  ...
ai-admin-ai/                      ← 新增仓（或 ai-admin-com 的 sibling 目录）
  src/app/api/                    ← Next.js Route Handlers
    agent/[conversationId]/command/route.ts
    agent/[conversationId]/events/route.ts
    agent/[conversationId]/state/route.ts
    pm/...                        ← REST（结构化视图的代理，或前端直接打 AiAdmin）
  src/agent/                      ← pi agent 运行时
    session-registry.ts  startup-lock.ts  prompt.ts
  src/tools/                      ← 命令定义（04 目录）
  src/adapter/aadmin/             ← 适配层
    datasource.ts  enums.ts  snapshot.ts  capabilities.ts  errors.ts  client.ts
  src/rule-engine/                ← 纯函数规则
    health.ts  progress.ts  risk-matrix.ts  risk-detect.ts  eta.ts  date-ref.ts
  prisma/schema.prisma            ← ai_* 表（MySQL provider）
  tests/contract/                 ← 适配层契约测试（AIPM 06 §8 第 6 条）
```

**为什么 AI 服务是独立的仓/目录而不是 `ai-admin-com/server/`**：
前端是静态导出（§3.1），两者构建产物、依赖树、发布节奏完全不同；
放一起只会让前端构建拖上 pi SDK 的依赖树。

---

## 8. 分期实施

每期结束都要过门禁：`npm run lint && npm test && npm run build && npm run e2e` +
AI 服务自己的 `lint/test/build`。

| 期 | 内容 | 产出 | 依赖 |
|---|---|---|---|
| **P0** | 打地基 | AI 服务仓骨架；Prisma + `ai_*` 表迁移；AiAdmin 后端补 PM 菜单种子（B1）；`blocked_since` 字段（B2）；契约测试骨架 | — |
| **P1** | 适配层 | `DataSource` 实现 + 枚举映射 + 能力位声明 + 错误归一 + 写前快照；**契约测试锁死** | P0 |
| **P2** | 规则引擎 | 健康度、进度三口径、风险矩阵、5 类候选风险、ETA、`DateRef` 解析；**纯函数，全覆盖单测** | P1 |
| **P3** | 命令层 + 确认 + 撤销 | 04 的命令目录落地；`requiresConfirmation` 判定；`PendingAction` 状态机；补偿式撤销 + 冲突检测 | P1 P2 |
| **P4** | agent 运行时 + SSE | pi agent 会话注册表、启动锁、工具注册、SSE 事件流、待确认 extension_ui 桥、断线重连 | P3 |
| **P5** | 前端 AI 工作台 | 右侧常驻栏、三页签、命令卡片、待确认队列、审计与撤销 | P4 |
| **P6** | 前端 PM 页面 | 项目/里程碑/任务/风险 5 个页面（照 module_system 范式） | P1 |
| **P7** | 端到端走查 + 文档 | 真实后端走查；原型对照；README 与 AIPM 文档改写（§4.5 的推翻项） | P5 P6 |

**排期上的注意点**：

- P2（规则引擎）**不依赖 LLM**，可以与 P4 并行 —— 它是纯函数，最容易验对。
- P1 的**契约测试**是整个方案的质量闸门：AIPM 06 §8 第 6 条要求「换外部系统时行为漂移
  没人发现」的问题必须被测试堵住。契约用例集对每个适配器实现跑同一套。
- P7 的走查必须用**真实 AiAdmin 后端**（和 v0.2.0 那次一样的方式）。

---

## 9. 遗留风险与已知缺口

### 9.1 已知缺口（来自 AIPM 07，本次不关）

| 编号 | 问题 | 本次处理 |
|---|---|---|
| Q2 | 外部 API 能力位 | **已答，但比原估保守** —— 见下方「能力位实测」 |
| Q3 | 认证方式 | **已答**（§6.4）：用户身份透传 |
| Q5 | 里程碑 AT_RISK 阈值 | 沿用 AIPM 默认值（进度 < 50% 且剩余 < 14 天等），**可配**，v1 用默认值 |
| Q6 | 风险矩阵边界 | 沿用 `score = p × i`（≥16 严重 / 9–15 高 / 4–8 中 / <4 低），**以 AIPM 为准**，原型的示例与矩阵不一致 |
| Q7 | 周起点与时区 | 周一为起点、Asia/Shanghai、闭区间（后端解析，模型不参与算日期） |
| Q8 | 评论 v1 做不做 | **不做**（原型 `comments.html` 依赖会议纪要，AIPM 07 Q8 定 v1.1） |
| Q9 | 飞书 | 不做，架构预留 |
| Q10 | 向量库 | 不做 |

### 9.1.1 能力位实测（对 AiAdmin PM API 逐项核实）

| AIPM 06 §3 的能力位 | 实测 | 依据 |
|---|---|---|
| `supportsDelete` | ✅ true | PM 各模块都有 delete 端点 |
| `supportsBatchUpdate` | ⚠️ **部分** | 只有 `POST /pm_task/status/batch`（**指定 ID + 同一个状态**）。AIPM 的 `batch_update_tasks` 要 `filter{statuses[], priorities[], due_before, due_after} + set{due_date, status, assignee, priority}` ⇒ **适配层内循环 + 客户端过滤 + 逐条结果**（AIPM 06 §3 的降级路径）。另：`ModulePmTaskQueryParam` 只有单值 `eq`/`like`，**没有范围、没有多值**，且 page_size ≤ 100 ⇒ 筛选也要在客户端做 |
| `supportsHistory` | ❌ false | 无字段历史 ⇒ 补偿式撤销（写前快照反向写入） |
| `supportsCustomFields` | ✅ true | `module_pm_project.extra_fields`（JSON） |
| `supportsDependencyGraph` | ❌ **false** | `module_pm_task_dependency` 与 `module_pm_risk_task_link` **只有建表 SQL**（`pm_v2_schema_v1.sql`），**没有任何 model / controller / route** ⇒ 依赖图不可用 ⇒ **CPM 关键路径失效** ⇒ ETA 降级为纯 burndown（无 P50/P90）⇒ `add_task_dependency` / `remove_task_dependency` **不注册**（AIPM 06 §3：无依赖图时命令返回明确错误） |
| `supportsComments` | ✅ true | `module_pm_comment` 有 model/controller；但见 §2.2「评论 v1 不做」 |
| `maxBatchSize` | 100（分页上限） | `PaginationQueryParam` |

**另一个实测约束**：任务的更新是**整对象 PUT**（`ModulePmTaskUpdateSchema` 继承
`CreateSchema`，全部字段必填），**没有 PATCH、没有乐观锁** ⇒ 任何部分更新都是
「读 → 合并 → 写」。适配层必须自己维护读-改-写，且**冲突检测只能靠 `updated_at` 比较**
（后端不提供版本号/ETag）。这直接影响 AIPM 01 §4.5 的冲突检测强度。

> **待裁决（见交付消息）**：依赖图缺失导致 CPM 与 ETA 的 P50/P90 不可用。
> 是接受降级（v1 不动后端），还是追加 B3（补依赖 CRUD + 可选 PATCH/批量端点）？

### 9.2 硬约束的降级与代价

| 约束 | 降级 | 代价 | 缓解 |
|---|---|---|---|
| INV-07 同事务写审计 | §6.8 三段式 | 业务写与审计写之间有不可原子的小窗口 | 审计写失败重试 3 次 → 降级落地文件 + 告警 |
| INV-11 所有写操作经适配层 | **只对 AI 写成立**。人工写走 AiAdmin 自己的路径；外部 agent 走 `module_mcp`（既有第三条路径，本设计不动它） | 人工写的审计是 AiAdmin 的操作日志（路径/载荷级，不是字段级快照） | 「人工与 AI 同路径」的验收标准按 **G2** 重新定义：AI 侧 `ai_audit_log` 是权威审计（字段级 before/after），操作日志是**不可关联**的旁证（§6.8 已说明为什么无法关联） |
| INV-13 里程碑 AT_RISK/MISSED 只由规则写入 | 规则引擎在 **AI 服务**侧，但它要写回 AiAdmin ⇒ 规则引擎必须能写 PM API | 规则写回需要一个后端权限（超管或专用权限码） | 用**用户 token** 写回 ⇒ 写回者的身份是发起对话的用户；规则标记需要该用户有里程碑更新权限。若无 ⇒ 降级为「只提示不自动写」 |
| 每日 cron 派生计算 | AI 服务无长期服务账号（§6.4） | 无法无人值守跑 cron | 降级为**用户触发**：打开项目页时按需计算并缓存；或 AI 服务增加一个受限的服务凭据（记入 backlog） |
| 项目成员 5 角色（A14） | **不做** | PM 权限只有 AiAdmin 的菜单/按钮级权限码 | 依赖后端补 `sys_menu` 种子时一并规划 PM 的权限码粒度 |

### 9.3 AiAdmin 里已存在的另两套 AI 能力（核实后记录）

后端插件自动发现机制（`app/core/discover.py`）会把 `app/plugin/module_*` 全部注册，
所以下面两套能力**当前是活的**，本设计此前没有提到它们：

| 插件 | 是什么 | 与本设计的关系 |
|---|---|---|
| `module_ai`（chat） | 基于 **agno** 的通用 AI 聊天：自带会话存储 + **WebSocket** 端点 + 模型配置（`/chat/*`） | **不是同一件东西**。它是「通用 LLM 聊天」，本设计的 AI 工作台是「**PM 领域操作入口**」（命令层 + 待确认 + 撤销）。上游 Vue 前端有对应页面 `views/module_application/ai/index.vue`，但本仓库（antd Pro）没有。**裁决：v1 不动 `module_ai`，两套并存**；`module_ai` 继续服务通用问答，AIPM 工作台服务 PM 操作。是否要在工作台里复用它的模型配置，留到 P5 评估 |
| `module_mcp` | `fastapi-mcp` 把 PM 路由自动转成 MCP tool，供**外部 agent**（Claude Code / Cursor）调用；JWT 透传、RBAC 原样生效；默认屏蔽 `delete` | **它是一条绕过本设计命令/审计层的第三条写入路径**（外部 agent 直接写 PM 数据）。这是**既有例外**，不是本设计引入的。**裁决：v1 不动它**，但在 G2/INV-11 的表述里明确承认这个例外的存在（见下） |

`module_pm_project/me_stats` 里的「AI 使用」统计当前返回 `ai_used: 0`，代码里留了 TODO
等 `module_ai` 的表结构。**裁决：v1 不动**（让它继续是 0）—— 让它统计 AIPM 工作台
需要改后端（超出 B1/B2 范围），而 v1 的价值不在这个数字。

### 9.4 尚未验证的技术风险

| 风险 | 影响 | 怎么验 |
|---|---|---|
| Next.js Route Handlers 的 SSE 在生产（长时间连接、反向代理）下的行为 | P4 的核心 | **P0 就做一个 spike**：起一个 SSE 路由 + nginx 反代，压测 30 分钟长连接与断线重连 |
| Prisma + MySQL 的连接池在 AI 服务高并发下的表现 | P0 | spike 时一并测 |
| pi agent SDK 在 Next.js Route Handlers（无 CLI 环境）里的可用性 | P4 | spike 时验证 `createAgentSession` + `customTools` 能否在 Route Handler 里跑 |
| 静态前端 + 同源反代 `/ai-api/` 的 SSE 跨域/缓冲问题 | P5 | nginx 配置 `proxy_buffering off;`；spike 验证 |

> **这三条 spike 全部归到 P0**，且 **P0 的验收标准就是"三个 spike 都有结论"**。
> 如果 pi agent 在 Route Handler 里跑不起来，方案需要在 P0 就调整（最可能的退路：
> AI 服务换成裸 Node HTTP 服务 + pi SDK，放弃 Next.js）。

---

## 10. 验收标准

沿用 AIPM 00 §5 的九条，并按本方案调整：

| # | 标准 | 判定 |
|---|---|---|
| 1 | 一句话操作 | 输入「把本周所有 P0 任务的截止日顺延到下周一」→ 返回命中清单预览 → 确认后落库，日期由后端按 Asia/Shanghai 周一为起点解析 |
| 2 | 确认门槛 | 风险降级、跨项目批量、删除、拆分、改期 > 3 天均需确认；单条常规改动直接执行 |
| 3 | 可回溯 | 每次 AI 写入都有 `ai_audit_log`；拆分与批量撤销后数据与操作前完全一致；冲突时拒绝静默覆盖 |
| 4 | 可解释的判定 | 里程碑显示「有风险」时能说明依据；ETA 给出 P50/P90 与置信度 |
| 5 | 规则优先 | 无 key 时健康度、风险识别、进度口径照常工作 |
| 6 | AI 挂了系统不瘫 | 关掉 key 后手动建任务、改状态、各视图、审计与撤销全部可用 |
| 7 | 人工与 AI 同路径 | 人工拖拽看板与 AI 命令**都产生审计记录**，AI 侧的记录带字段级 before/after 且可撤销（G2 的重新定义见 §6.8 与 §9.2） |
| 8 | 引用可回跳 | AI 的每条结论都能点回原始任务/里程碑/风险 |
| 9 | 断线不丢待确认 | 刷新/断网重连后，未决的待确认卡片完整恢复 |
| **10** | **系统管理零回归** | 现有 279 单测 + 76 e2e 全绿（G6） |
| **11** | **AI 元数据表与 AiAdmin 同库** | `ai_*` 表在 AiAdmin 的 MySQL 库里，Prisma migration 可重放 |
| **12** | **没有服务账号凭据落盘** | 代码审查确认：无长期凭据、无 token 落盘、日志脱敏 |

---

## 11. 下一步

1. 本文档经所有者批准。
2. 跑 `writing-plans`，按 §8 的 P0–P7 拆成可执行的实施计划。
3. P0 的三个 spike 先做，结论回来再定 P1 之后的细节。
