# AIPM — AI 驱动的项目管理平台 · 设计文档 v3

- 日期：2026-03-09（v3 合并稿）
- 状态：**待批准**
- 路径：`docs/superpowers/specs/2026-03-09-aipm-design.md`
- 原型：`.superpowers/brainstorm/80467-1793368904/content/aipm-prototype-v6.html`
- 上游参考：`docs/superpowers/specs/PRD-v2.md`（企业级 AI 增强 PM 系统 PRD，基于 AiAdmin）

---

## 0. 文档信息与与 PRD-v2 的关系

### 0.1 一句话定位

> **AIPM**：一个**对话驱动的项目管理平台**——用一句话完成项目/里程碑/任务/风险的全部日常操作，AI 同时基于平台数据给出可解释的进度预测与风险预警。

与 PRD-v2 的定位差异：PRD-v2 是"在 AiAdmin 上做企业级 PM 系统，AI 是增强层"；AIPM 是"**AI 是主操作入口，结构化视图是辅助**"。两者是互补关系：AIPM 借用了 PRD-v2 的业务模型，但把交互主轴倒过来了。

### 0.2 合并原则（重要）

PRD-v2 绑定 AiAdmin（FastAPI + Vue3 + MySQL + LiteLLM + Qwen/DeepSeek）。本项目已定 **Next.js + TypeScript + PostgreSQL + Vercel AI SDK + MiniMax**（用户明确确认）。

因此合并规则：

| 层 | 来源 | 处理 |
|---|---|---|
| **业务模型层**（状态机、不变量、计算口径、风险矩阵、预测算法、评测体系、指标） | **PRD-v2 全量移植** | 直接采用，可能做字段级适配 |
| **架构层**（命令层、待确认队列、可撤销、常驻 AI 工作台、Provider 抽象） | AIPM 独有 | **保留，这是本产品的差异化** |
| **Agent 运行时** | AIPM 独有 | **pi agent**（`@earendil-works/pi-coding-agent` SDK）。PRD-v2 的 LiteLLM 方案不移植 |
| **框架层**（AiAdmin 脚手架、代码生成器、RBAC 中间件、部署脚本） | PRD-v2 | **不移植**（仓库中无 AiAdmin 代码，移植成本 > 收益） |

> ⚠️ **唯一的全量推翻点**：若你决定改为"在 AiAdmin 上二次开发"，则本文档的架构层需重写、业务模型层可整段复用。请在批准前确认。

### 0.3 版本沿革
- v1（原始讨论）：AI 操作入口 + 洞察辅助，Next.js 技术栈，MiniMax。
- v2（本文档上一版）：命令层、待确认队列、撤销机制、数据模型。
- **v3（本次）**：移植 PRD-v2 的业务模型层，补齐状态机/不变量/口径/矩阵/预测/评测；合并审阅意见。

---

## 1. 范围

### 1.1 v1 范围（内部团队自用，单租户）

| 模块 | v1 内容 | 状态机 |
|---|---|---|
| 项目 | CRUD、列表/看板/详情、成员、状态机、模板套用 | ✅ |
| 里程碑 | CRUD、时间轴、**自动 at_risk/missed 判定**、交付物 | ✅ |
| 任务 | CRUD、子任务（≤3 层）、依赖（FS/SS/FF/SF）、看板/列表/树、估时与实际工时 | ✅ |
| 进度 | 完成率三口径、每日快照、燃尽图、**ETA 预测（P50/P90）** | ✅ |
| 风险 | 登记册、1–5 分制、**概率×影响矩阵**、缓解流程、**5 类自动识别** | ✅ |
| 评论 | 多态评论、@、AI 摘要 | ✅ |
| AI 助理 | 常驻右侧工作台、意图路由、tool-calling、待确认队列、审计 | ✅ |
| 会议纪要 | 结构化摘要（决策/行动项/风险/待决问题） | v1.1 |
| 模板 | 5 个内置范式模板 + 自定义字段 | v1.1 |
| PMO 组合仪表盘 | 多项目健康度并列 | v1.1 |
| 甘特图 | 依赖连线甘特 | v1.1 |
| 飞书机器人 | 复用命令层 | v2 |

### 1.2 不在范围（v2 及以后）
计费与配额商业化、多租户 SaaS 化、外部干系人门户、自定义工作流引擎、白板协同、移动 App、工时审批、外部 IM 双向深度集成。

### 1.3 反目标（做到即失败）
- **AI 直连数据库**——任何由 LLM 拼出的 SQL 都是缺陷。
- **静默的破坏性操作**——批量改、删除、风险升降级、拆分，若无人确认即生效即为缺陷。
- **不可回溯的 AI 变更**——每次 AI 写入都必须可查、可撤销。
- **规则被 LLM 覆盖**——进度、风险、里程碑健康度的**数字**必须由确定性规则算出，LLM 只负责措辞。
- **AI 不可用即系统不可用**——关掉 key 后，手动操作与全部视图必须照常工作。

---

## 2. 目标与指标

### 2.1 North Star（对齐 PRD-v2 §1.3，按 AIPM 口径裁剪）

| 维度 | 指标 | 目标 | 测量 |
|---|---|---|---|
| **效率** | 平均建任务耗时 | 5 min → 30 s | `nl_to_task` 端到端埋点 |
| **采纳** | AI 建议采纳率 | ≥ 55% | 采纳 / 编辑保存 / 拒绝 三按钮埋点 |
| **准确** | 里程碑达成日预测 MAPE | ≤ 25% | 离线评测集（30 个历史项目留一） |
| **风险** | AI 预警被处理比率 | ≥ 70% | `risk_accepted / risk_suggested` |
| **安全** | AI 写操作可回溯率 | **100%** | `AuditLog` 覆盖所有写命令（硬指标） |

### 2.2 埋点字段（`AuditLog` 复用）
`source`（AI/USER）、`command`、`payload`、`result`、`adopted`（是否被采纳）、`model`、`tokens`、`latency_ms`、`trace_id`。其中 `adopted` 与 `undo_of` 组合可算出**AI 准确率**与**回滚率**——这是 PRD-v2 缺失而 AIPM 天然具备的（因为我们有确认队列：用户拒绝 = 未采纳，确认后撤销 = 采纳但错误）。

---

## 3. 架构总览

### 3.0 两段式 + 后端两模块

```
┌──────────────────────┐   REST + SSE   ┌───────────────────────────────────────────┐
│  ① 前端界面           │ ─────────────▶ │  ② 后端                                    │
│  (Next.js App Router)│ ◀── SSE 事件流 │                                            │
│                      │               │  ┌────────────────────────────────────────┐ │
│  · 视图与交互         │               │  │ 模块① CRUD 业务代码（适配层）           │ │
│  · 命令卡片 / 待确认   │               │  │   ↳ 通路A（默认）：转发外部已实现 API     │ │
│  · 审计视图           │               │  │   ↳ 通路B（备选）：直连数据库              │ │
│                      │               │  └───────────────▲────────────────────────┘ │
│                      │               │                  │ tool call                 │
│                      │               │  ┌───────────────┴────────────────────────┐ │
│                      │               │  │ 模块② Agent 代码（pi agent）            │ │
│                      │               │  │   意图路由 / 上下文装配 / tool-calling │ │
│                      │               │  │   prompt / 模型调用 / 降级 / 评测        │ │
│                      │               │  └────────────────────────────────────────┘ │
└──────────────────────┘               └───────────────────────────────────────────┘
                                                │
                                                ▼
                                    外部已实现的 PM API（业务事实源）
                                    或 本地数据库（备选通路）
```

### 3.1 模块①：CRUD 业务代码（适配层）

这一层负责**所有与业务数据打交道的读写**，对外暴露稳定的内部接口给 Agent 模块调用。

**两种数据通路**

| 通路 | 说明 | 何时选它 |
|---|---|---|
| **通路 A（默认）** | **转发调用外部已实现的 API**。本模块不持有业务数据，只做：鉴权透传、字段映射、错误归一、分页/批量语义转换、幂等处理 | 外部已有可用的 PM 系统/API（业务事实源在外部） |
| 通路 B（备选） | 直连数据库（Prisma/PostgreSQL），本模块自己实现读写 | 没有外部 API，或需要本地扩展字段/本地索引 |

**两种通路必须可切换**：适配层对外暴露**同一套接口**（§3.4），内部通过 `DataSource` 抽象切换实现。通路 A 换成通路 B 只需替换实现类，上层（Agent、前端）零改动。

**适配层的具体职责**

| 职责 | 通路 A | 通路 B |
|---|---|---|
| 认证 | 持有外部 API 的凭据（服务账号 / OAuth），**前端永远拿不到** | 内部 DB 连接池 |
| 字段映射 | 外部字段名/枚举 ↔ 我们的统一领域模型（§5.2） | 直接读写统一领域模型 |
| 实体 ID | 外部 ID 与本地 ID 的双向映射表（`EntityRef`） | 本地自增/UUID |
| 错误归一 | 外部错误码 → 统一错误（`NOT_FOUND` / `CONFLICT` / `VALIDATION` / `RATE_LIMIT`） | 同左 |
| 写前快照 | **写之前先 GET 一次**，把旧值存进审计（撤销的依据，§3.5） | 同左（事务内读旧值） |
| 批量语义 | 外部 API 不支持批量时，在本层循环 + 限流 + 部分失败报告 | 单事务批量 |
| 幂等 | 带 `Idempotency-Key`，防止重试造成重复创建 | 同左 |

> **写前快照是通路 A 下撤销能力的唯一来源**：外部 API 一般不提供字段历史，所以必须在每次写之前主动读取旧值。成本是一次额外 GET，换来"可撤销 + 可展示 diff"。

### 3.2 模块②：Agent 代码（基于 pi agent）

**为什么选 pi agent**

`@earendil-works/pi-coding-agent` 的 SDK 提供了产品级 agent 需要的四件事：

| 需要的能力 | pi SDK 的支持 |
|---|---|
| 自定义工具（我们的命令 = tool） | `defineTool({ name, description, parameters: TypeBoxSchema, execute })` + `pi.registerTool()` |
| **人工确认**（待确认队列） | `pi.on("tool_call", handler)` 可**阻断**工具调用并返回 `{ block: true, reason }` |
| 危险动作标注 | tool 的 `annotations`：`readOnlyHint` / `destructiveHint` / `idempotentHint` |
| 流式输出到前端 | `session.subscribe(event)`，`message_update` / `tool_execution_*` 事件 |
| 自定义 system prompt | `createAgentSession({ systemPrompt })` |
| 会话持久化与续接 | `SessionManager`（文件或内存） |
| 模型与供应商 | 内置 provider，**MiniMax 已支持**（`MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY`） |

**关键适配：把我们的"命令层"翻译成 pi 的 tool**

```
我们的命令（§6）              pi 的实现
─────────────────────────    ────────────────────────────────
name                         tool.name
description                  tool.description（这是模型唯一的能力说明，务必写好）
args (zod/TypeBox)           tool.parameters（TypeBox schema → 模型直接看到）
needsConfirmation            tool.annotations.destructiveHint + 自定义标注
run()                        tool.execute() → 调用模块① 的适配层接口
invert()                     补偿写入（§3.5）由模块① 提供，不放在 tool 里
```

**关键适配：用 `tool_call` 钩子实现"待确认"**

```ts
// 伪代码
pi.on("tool_call", async (event, ctx) => {
  const tool = pi.getAllTools().find(t => t.name === event.toolName);
  const needConfirm = tool?.annotations?.destructiveHint === true
                   || await adapter.requiresConfirmation(event.toolName, event.args);
  if (!needConfirm) return;                       // 直接执行
  const preview = await adapter.preview(event.toolName, event.args);
  await pendingQueue.push({ userId, toolName, args, preview });  // 入队
  return { block: true, reason: "需要人工确认，已加入待确认队列" };
});
```

- 阻断后，Agent 的这一轮**不会拿到执行结果**，而是拿到"已入队、等待确认"的说明，并可以继续对用户说"我把这条放进了待确认队列"。
- 用户在前端点确认 → 前端调后端 `/api/pending/:id/confirm` → 后端**直接调用模块① 执行该命令**（不经过 agent，避免二次 LLM 往返）→ 写审计 → SSE 通知前端。
- 这保证了"确认后才落库"与"确认路径不依赖 LLM"。

**关键适配：只注册我们的工具**

pi 默认会加载 coding 场景的内置工具（read/bash/edit/write 等）。产品级 agent **必须禁用**：

```ts
const { session } = await createAgentSession({
  tools: [],                       // 不启用任何内置工具
  customTools: ourCommandTools,    // 只注册我们的业务命令
  resourceLoader: new DefaultResourceLoader({
    extensionFactories: [ourExtension],   // 注册 tool + tool_call 钩子
    additionalExtensionPaths: [],
  }),
  model: "minimax-cn/MiniMax-M3.1-Flash",
  sessionManager: SessionManager.inMemory(),  // 或持久化
  systemPrompt: PM_AGENT_PROMPT,
});
```

**Agent 模块的边界**：它**不碰数据库**、**不做权限判定**、**不自己决定能不能改**。它做的是：理解意图 → 选命令 → 调参数 → 请求模块① 执行 → 把结果说成人话。

### 3.3 本地存储的边界

外部 API 是业务事实源，因此**本地不再镜像业务实体**，只存 AI 侧元数据：

| 本地表 | 存什么 | 为什么必须本地 |
|---|---|---|
| `Conversation` / `Message` | 对话与消息 | 外部 API 没有这个概念 |
| `PendingAction` | 待确认队列 | 需要可靠队列语义与过期清理 |
| `AuditLog` | 所有写操作的前后快照 diff、actor、model、tokens | 撤销链 + 采纳率统计；外部 API 不会给 |
| `EntityRef` | 外部实体 ID ↔ 本地引用（项目/里程碑/任务/风险） | 上下文注入与引用卡片需要稳定引用 |
| `User` / `Session` | 登录与会话 | 内部身份体系 |
| `SyncCache`（可选） | 外部实体的只读缓存 | 降低对外部 API 的读压力、支撑燃尽图与趋势 |

**推论**：§5 的完整业务表不再在本项目落地——它们是**外部系统的表**。我们只维护"领域模型到外部模型的映射"（§5.2）与 AI 侧元数据。

> 若最终选通路 B（直连数据库），则 §5 的业务表在本项目落地，§3.3 的表退化为纯 AI 元数据表。**两种通路的表结构差异被隔离在模块① 内部**。

### 3.4 模块① 对外暴露的内部接口

Agent 模块只通过这组接口接触业务数据（**不碰数据库**）：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/internal/pm/projects` | GET | 项目列表（过滤：状态、负责人、标签） |
| `/internal/pm/projects/:id` | GET / PATCH | 项目详情 / 更新 |
| `/internal/pm/milestones` | GET / POST | 里程碑 |
| `/internal/pm/milestones/:id` | GET / PATCH / DELETE | |
| `/internal/pm/tasks` | GET / POST | 任务（支持过滤：负责人、状态、优先级、里程碑、截止区间） |
| `/internal/pm/tasks/:id` | GET / PATCH / DELETE | |
| `/internal/pm/tasks/:id/transition` | POST | 状态迁移（对应 §4.3 的事件） |
| `/internal/pm/tasks/batch` | POST | 批量更新（返回逐条结果，支持部分失败） |
| `/internal/pm/risks` | GET / POST | 风险 |
| `/internal/pm/risks/:id` | GET / PATCH | |
| `/internal/pm/risks/:id/to-task` | POST | 风险转应对任务 |
| `/internal/pm/dependencies` | POST / DELETE | 任务依赖 |
| `/internal/pm/search` | GET | 跨实体检索（实体名/ID 模糊查，供"那个多轮对话的任务"这类指代消解） |
| `/internal/pm/preview` | POST | **只算不写**：返回某操作的命中清单与旧值（待确认预览用） |
| `/internal/pm/undo` | POST | 补偿式撤销（§3.5） |

### 3.5 撤销语义：补偿式撤销（外部 API 下的现实解）

外部 API 通常不提供"撤销"或字段历史。所以：

**撤销 = 用写前快照做一次反向写入**，而不是"回滚事务"。

| 变更类型 | 补偿动作 |
|---|---|
| 更新字段 | 把旧值 PATCH 回去 |
| 创建实体 | 调用 DELETE（若外部 API 支持软删/删除）；不支持则标记为"逻辑删除"（本地不再显示） |
| 删除实体 | 重新创建（用快照重建，ID 会变 → 需在 `EntityRef` 里更新映射） |
| 拆分 | 删除新实体 + 恢复原实体 |
| 批量 | 逐条补偿（单次调用，部分失败要报告） |

**三条硬约束**：

1. **补偿不是原子的**——补偿中途失败会留下不一致状态，因此补偿必须**逐条独立**执行并把失败项显式报告（"3 条已撤销，1 条失败：xxx"），不允许"假装全撤销了"。
2. **补偿前必须做冲突检测**（INV-14）：比对当前实体值与 `after_snapshot`，不一致说明有人后来改过 → 拒绝静默覆盖，提示冲突。
3. **补偿本身要写审计**（`undo_of` 指向原记录），形成可追溯的链。

> 如果外部 API 提供了版本号/ETag/历史版本接口，优先用它做撤销，补偿作为兜底。这一点在适配层用一个 `supportsHistory` 能力位来切换。

### 3.6 前后端通信契约

| 方向 | 协议 | 端点 | 说明 |
|---|---|---|---|
| 前端 → 后端 | REST | `/api/projects`、`/api/tasks`、`/api/risks`、`/api/milestones` | 后端代理到模块①（前端**不直接访问**外部 API） |
| 前端 → 后端 | REST | `/api/chat` | 发起一轮对话（SSE 流式返回） |
| 前端 → 后端 | REST | `/api/pending`、`/api/pending/:id/confirm`、`/api/pending/:id/reject`、`/api/pending/:id/adjust` | 待确认队列操作 |
| 前端 → 后端 | REST | `/api/audit` | 审计查询（含撤销按钮） |
| 后端 → 前端 | SSE | `/api/chat/stream` | 文本增量、命令卡片、工具执行状态 |

**关键**：前端**永远不直接访问外部 API**（否则凭据泄露、权限绕过、审计断链）。所有业务请求都过后端。

### 3.8 参考 pi-web 的运行时设计（借鉴）

pi-web（`@agegr/pi-web`）是一个成熟的同类实现：**Next.js 服务 + 每个会话一个 pi 子进程（RPC 模式，JSONL over stdio）+ REST 控制面 + SSE 事件桥**。它的运行时模式比本设计原稿更成熟，以下 8 点直接吸收。

| # | pi-web 的做法 | 我们怎么用 |
|---|---|---|
| 1 | **会话注册表**：`globalThis.__piSessions: Map<sessionId, Session>`，进程退出时统一 destroy，SIGINT/SIGTERM 时统一 shutdown | 后端维护 `Map<conversationId, AgentSession>`；进程退出钩子里统一 shutdown；避免会话泄漏 |
| 2 | **生命周期元数据**：独立 Map 记录 `starts / firstStartedAt / lastStartedAt / lastClosedAt`，上限 1000 条 | 记录会话的创建/最后活跃时间，用于**空闲回收**与"我的会话"列表 |
| 3 | **启动锁**（`__piStartLocks`）：同一会话并发 start 时串行化 | 同一 conversation 的并发 prompt 必须排队，否则 pi 的 `prompt()` 会拒绝 |
| 4 | **命令协议**：前端发 `{type:"prompt" \| "get_state" \| "abort" \| "steer" \| "extension_ui_response"}`，服务端 `session.send()` | 我们定义自己的等价协议（§3.10），语义与 pi RPC 对齐，前端代码可借鉴 pi-web |
| 5 | **SSE 语义**：连接后先发 `connected` 帧（含 `isStreaming` 与**未决 UI 请求 id 列表**）→ `heartbeat` 心跳 → 有 backlog 上限，超限丢弃**可重建的 delta**（客户端用 state 快照重建） | 直接采用（§3.9）。对我们的意义：**掉线的 delta 可以丢，状态快照必须能重建** |
| 6 | **holder 租约**：一个会话同一时刻只有一个 holder 在驱动，空闲自动释放（`debug.lease.noHolder`） | AI 工作台的对话要有"当前由谁在输入"的概念；多人同时对同一对话发消息要排队而非冲突 |
| 7 | **extension_ui 桥**：pi 的 `ctx.ui.confirm()` 等 UI 请求 → 变成 `extension_ui_request` 事件 → SSE 推给浏览器 → 浏览器回 `extension_ui_response` → resolve 挂起的 promise；带 `timeout`/`expiresAt`/abort 支持，**重连时补发未决请求** | **这就是我们的"待确认"通道**（§6.5 重写）。比"入队 + 前端另调后端执行"更好：用户确认后，被挂起的工具调用**原地恢复**，agent 这一轮自然收尾，无需二次 LLM 往返 |
| 8 | **fork / 分叉**："从此处编辑"在当前会话内开分支；"新建会话"从历史消息另起 | 对话支持"从这里重问"，且不破坏原历史 |

**我们与 pi-web 的关键差异**

| 维度 | pi-web | AIPM |
|---|---|---|
| pi 的嵌入方式 | **RPC 子进程**（每个会话一个 `pi --mode rpc` 子进程，JSONL over stdio） | **同进程 SDK**（`createAgentSession`）——我们只有一个后端进程，不需要进程隔离；省掉进程监管与 stdout 解析 |
| 工具集 | pi 内置 coding 工具 + MCP | 只有我们的业务命令（`tools: []` + `customTools`） |
| 会话存储 | pi 的 JSONL 会话文件（`~/.pi/agent/sessions/**`） | 我们的 `Message` 表 + pi `SessionManager`（自定义路径或内存） |
| 确认语义 | coding 场景的权限确认 | **业务语义的危险操作确认**（§6.3 规则） |

> **保留"同进程 SDK"是刻意的**：RPC 子进程的价值在于语言无关与崩溃隔离；我们的后端本来就是 TS，agent 崩溃会连带后端进程——但我们的 agent 不执行任意代码（没有 bash/write 工具），崩溃风险面很小。若将来要支持多租户高并发或需要 agent 崩溃不影响业务，再切 RPC 模式（接口层已按"命令协议"设计，切换成本低）。

### 3.9 SSE 事件协议（对齐 pi-web）

**连接建立**

```
GET /api/agent/:id/events        （SSE）
→ 第一帧：{ type:"connected", conversationId, isStreaming, pendingActionIds: [...] }
   - pendingActionIds：当前所有未决的确认请求 id（重连后前端据此恢复待确认卡片）
→ 若正在流式：{ type:"message_start", message }
→ 之后：增量帧 / 心跳帧
```

**心跳**：`{ type:"heartbeat" }`，间隔 15s（可配）。用于检测断连。

**背压与丢帧**
- 每连接的 backlog 上限 `SSE_BACKLOG_LIMIT_BYTES`（默认 16MB）。超限时**丢弃可重建的 delta 帧**（文本增量、思考增量），并保留结构性事件（工具调用开始/结束、命令卡片、待确认请求）。
- 客户端丢帧后用 `GET /api/agent/:id/state` 拉状态快照重建——**状态快照是最终真相，delta 只是优化**。

**事件类型**

| 事件 | 载荷 | 前端渲染 |
|---|---|---|
| `connected` | conversationId, isStreaming, pendingActionIds | 建立连接 / 恢复待确认卡片 |
| `message_start` / `text_delta` / `message_end` | 文本增量 | 对话气泡 |
| `thinking_delta` | 思考增量（可折叠显示） | "AI 正在思考"区 |
| `tool_call` | 命令名、参数摘要 | 命令卡片（骨架态） |
| `tool_result` | 影响范围、状态徽标 | 命令卡片（完成态 + 撤销按钮） |
| `action_request` | 确认请求 id、预览、影响范围、过期时间 | **待确认卡片**（确认 / 取消 / 调整范围） |
| `action_resolved` | 请求 id、结果 | 待确认卡片消失 / 标记已执行 |
| `state_dirty` | 受影响的视图 | 提示主内容区刷新对应数据 |
| `heartbeat` | — | 保活 |

**关键设计**：**结构性事件永不丢弃，增量事件可丢**。这样即使网络抖动，**待确认请求不会丢**（它有独立的 `pendingActionIds` 兜底），而文本增量丢了可以用快照重建。

### 3.10 前端 ↔ 后端命令协议

前端不发一堆语义各异的 REST，而是发**与 pi RPC 同构**的命令：

```ts
type ClientCommand =
  | { id: string; type: "prompt"; message: string; context?: { projectKey?: string } }
  | { id: string; type: "steer"; message: string }     // 插入当前轮次
  | { id: string; type: "abort" }
  | { id: string; type: "get_state" }
  | { id: string; type: "action_response"; actionId: string; decision: "confirm" | "reject" | "adjust"; args?: unknown }
  | { id: string; type: "fork"; fromEntryId?: string };
```

服务端统一回 `{ id, type:"response", command, success, data }`，失败时 `success:false` + `error`。

**`action_response` 的关键点**：`decision:"confirm"` **不新建后端执行流程**，而是**唤醒被挂起的那个工具调用**（§6.5）。因此：
- 不需要第二次 LLM 调用；
- agent 恢复后能自然地说出"已改好"；
- 确认与执行之间没有窗口期，不存在"确认了但没执行"的中间态。


### 3.11 与 PRD-v2 架构层的差异

| PRD-v2 | AIPM | 理由 |
|---|---|---|
| FastAPI + Vue3 + Element Plus | Next.js + TS + Tailwind/shadcn | 已定；单语言降低胶水成本 |
| LiteLLM 统一抽象 | pi agent 的 provider 抽象（内置 MiniMax） | 同理；且 pi 直接提供工具/确认/流式能力 |
| MySQL + Redis | PostgreSQL（仅 AI 侧元数据） | 业务数据在外部 API；规则计算需要窗口函数 |
| 数据表 12 张自建 | **转发外部已实现 API（默认）** | 用户明确选择：不重复造数据层 |
| AiAdmin RBAC 三层 | 简化两级 + 预留枚举（§7） | 内部工具不引入复杂权限 |
| 前端 API 直接 CRUD | **所有写操作经模块① 统一执行并留痕** | 唯一写入口，审计与撤销才成立 |
| AI 在后端内 | **后端内独立模块②（pi agent）** | agent 与业务解耦；可替换运行时；LLM 凭据隔离 |


## 4. 状态机与不变量（移植 PRD-v2 §3）

### 4.1 Project 状态迁移

| from | event | guard | to | side-effect |
|---|---|---|---|---|
| (new) | create | code 唯一；owner 有效 | `planning` | 写审计 |
| `planning` | activate | `start_date ≤ today` | `active` | 启动进度计算 |
| `active` | put_on_hold | reason 必填 | `on_hold` | 暂停预测任务 |
| `on_hold` | resume | — | `active` | 重启预测任务 |
| `active` | complete | 所有里程碑 `done`/`cancelled`；无 `in_progress` 任务 | `completed` | 归档评估 |
| `active` | cancel | reason 必填 | `cancelled` | 归档 |
| `completed` | archive | — | `archived` | 冻结历史 |

### 4.2 Milestone 状态迁移

| from | event | guard | to | side-effect |
|---|---|---|---|---|
| (new) | create | `[start_date, due_date] ∈ project 区间` | `upcoming` | — |
| `upcoming` | start | `start_date ≤ today` | `in_progress` | 写审计 |
| `in_progress` | complete | 关联任务全部 `done`/`cancelled` | `done` | 触发进度重算 |
| `in_progress` | **规则判定** | 见 §6.4 健康度规则 | `at_risk` | 通知 PM + 生成风险建议 |
| `at_risk` | **规则判定** | 逾期 > 14 天 | `missed` | 升级到风险登记册 |
| `at_risk` | complete | 任务全完成 | `done` | 同上 |

> **规则独占写回权**：`at_risk` / `missed` 只能由规则引擎写入，人和 AI 都**不能**手工把里程碑设成这两个状态。反向：人也不能手工把 `at_risk` 改成 `done`——必须走 `complete_milestone` 并通过任务校验。冲突时**规则优先**。

### 4.3 Task 状态迁移

| from | event | guard | to | side-effect |
|---|---|---|---|---|
| (new) | create | 项目未归档/取消 | `backlog` | — |
| `backlog` | schedule | `due_date ≥ today` | `todo` | — |
| `todo` | start | assignee ≠ null | `in_progress` | 写 `actual_start_date` |
| `todo`/`backlog`/`in_progress` | block | reason 必填 | `blocked` | 写 `blocked_since`，启动阻塞时长统计 |
| `blocked` | unblock | reason 必填 | `in_progress` | 累加阻塞时长 |
| `in_progress` | submit_review | reviewer ∅? | `review` | 通知 reviewer |
| `review` | approve | — | `done` | 写 `actual_end_date`、`actual_hours`、`completed_at` |
| `review` | reject | comment 必填 | `in_progress` | — |
| `in_progress` | pause | — | `todo` | 保留 `actual_start_date` |
| any | cancel | reason 必填 | `cancelled` | 写审计；**退出 ETA 预测** |
| any | reopen | PM/owner | `todo` | 清 `actual_end_date` |

**依赖不变量**：`type ∈ {FS(默认), SS, FF, SF}`；FS = 前置 done 才可 in_progress；SS = 前置 in_progress 即可；**不允许跨项目依赖**；**不允许成环**（创建/更新时 DFS 检测）。

### 4.4 Risk 状态迁移

| from | event | guard | to | side-effect |
|---|---|---|---|---|
| (new) | create / ai_suggest | probability, impact ∈ 1..5 | `identified` | 自动算 `score = p × i` |
| `identified` | analyze | PM 复核 | `analyzing` | 写 `mitigation_plan` |
| `analyzing` | start_mitigation | mitigation_plan 非空 + due_date | `mitigating` | 进风险仪表盘 |
| `mitigating` | close | 关闭原因必填 | `closed` | 冻结为历史 |
| `mitigating`/`analyzing` | **score_up** | p 或 i 提升 | `realized` | 升级为"已发生问题"，触发 PMO |
| any | force_close | PMO | `closed` | — |

**风险等级矩阵（移植 PRD-v2 §6.5，1–5 分制）**

| score | 等级 | 颜色 | 自动动作 |
|---|---|---|---|
| ≥ 16 | 严重 | 🔴 | 推送 PMO + 进入每周复盘 |
| 9–15 | 高 | 🟠 | 推送 PM |
| 4–8 | 中 | 🟡 | 仪表盘提示 |
| < 4 | 低 | 🟢 | 仅登记 |

`score = probability × impact`（1–5 各维）。**升级路径**：用户说"把风险升到高"时，AI 调用 `update_risk` 调整 probability/impact 使 score 落入目标区间，**不直接写 level**（level 是冗余计算列，见 §5）。

### 4.5 全局不变量清单

| ID | 不变量 | 强制位置 |
|---|---|---|
| INV-01 | 任务依赖不形成环 | DAO create/update 前 DFS |
| INV-02 | 子任务 `parent_id` 不能跨项目，且层级 ≤ 3 | DAO 校验 |
| INV-03 | 里程碑 `[start_date, due_date]` ⊆ 项目区间 | DAO 校验 |
| INV-04 | 评论 `target_type ∈ {task,milestone,project,risk,meeting}` | zod Literal |
| INV-05 | 项目 `code` 唯一且不可修改 | DAO + 状态机 |
| INV-06 | 删除项目前关联任务/里程碑必须 `archived` | Service 编排 |
| INV-07 | **AI 写库必须与 `AuditLog` 写入在同一事务内** | Service 层装饰器 |
| INV-08 | `Risk.score = probability × impact`，冗余但必须一致 | Service 校验 + 触发器 |
| INV-09 | 估时/实际工时 ≥ 0，精度 0.5h | zod |
| INV-10 | 任务依赖不允许跨项目 | DAO |
| INV-11 | **所有写操作（人或 AI）必须经过命令层**，不得直写数据库 | Code review + 架构测试 |
| INV-12 | **风险降级需人工确认**（防止 AI 自行淡化风险） | `needsConfirmation` |
| INV-13 | **里程碑 at_risk/missed 只由规则写入** | 规则引擎独占写路径 |
| INV-14 | 撤销不得静默覆盖他人后续修改 | 撤销冲突检测（§8.4） |

---

## 5. 数据模型与实体映射

### 5.1 本地存储（AI 侧元数据）

业务事实源在外部 API，本地只保存 AI 运行时必需的元数据（§3.3）：

```
User            id, name, email(unique), password_hash, role(MEMBER|ADMIN),
                is_admin(bool), external_id?, created_at
Session         id, user_id, token_hash(unique), expires_at, created_at

Conversation    id, project_ref, channel(WEB|FEISHU), created_at
Message         id, conversation_id, role(USER|ASSISTANT|SYSTEM), content,
                tool_calls(jsonb), created_at

PendingAction   id, conversation_id?, user_id, command, args(jsonb),
                preview(jsonb), status, expires_at, resolved_at?, resolved_by?,
                adjusted_from?, created_at
                status: PENDING|CONFIRMED|REJECTED|EXPIRED|EXECUTED

AuditLog        id, workspace_id, actor_type(USER|AI), actor_id, command,
                args(jsonb), before_snapshot(jsonb), after_snapshot(jsonb),
                undo_of?, undone_at?, adopted?(bool), model?, tokens?,
                latency_ms?, trace_id?, error?, created_at

EntityRef       id, workspace_id, entity_type(PROJECT|MILESTONE|TASK|RISK),
                external_id, local_alias?, project_ref?, title_cache?,
                last_synced_at, created_at
                -- 外部实体 ID ↔ 本地引用；title_cache 用于上下文注入与引用卡片

SyncCache       id, entity_type, external_id, payload(jsonb), etag?, fetched_at
                -- 可选：外部实体的只读缓存，降低读压力、支撑趋势图
```

### 5.2 领域模型（我们内部的统一模型）

外部 API 的字段名与状态枚举各异，模块① 负责把它们归一到下面这套**统一领域模型**。上层（Agent 的工具定义、前端视图）只认这套模型。

```
Project    key, code, name, description, owner, status, priority,
           start_date, due_date, tags[], extra{}
           status: PLANNING | ACTIVE | ON_HOLD | COMPLETED | CANCELLED | ARCHIVED
Milestone  key, project_key, name, description, start_date, due_date,
           actual_start_date?, actual_end_date?, status, deliverables[], sort_order
           status: UPCOMING | IN_PROGRESS | DONE | AT_RISK | MISSED
Task       key, project_key, milestone_key?, parent_key?, title, description,
           type, status, priority, estimate_hours?, actual_hours?, assignee?,
           reporter, reviewers[], labels[], start_date?, due_date?,
           actual_start_date?, actual_end_date?, sort_order, source
           status: BACKLOG | TODO | IN_PROGRESS | REVIEW | DONE | BLOCKED | CANCELLED
           priority: P0|P1|P2|P3
           source: MANUAL | AI | IMPORT
Risk       key, project_key, title, description, category, probability(1-5),
           impact(1-5), score, level, status, owner, mitigation_plan?,
           contingency_plan?, due_date?, trigger_date?, milestone_key?
           category: SCHEDULE|SCOPE|QUALITY|RESOURCE|COMPLIANCE
           status: IDENTIFIED|ANALYZING|MITIGATING|REALIZED|CLOSED
           level: SEVERE|HIGH|MEDIUM|LOW
```

**归一规则**：
- 外部枚举 → 统一枚举的映射表写在模块① 的适配器里（可配置，如 `jira_status_map`）。
- 外部缺少的字段（如 P0–P3 优先级）用默认值或从 labels 推断，**不猜测**——缺失即缺省。
- 统一模型里**多出来的字段**（如 `at_risk` 这类规则派生态）在本地计算，不回写外部（除非外部支持）。

### 5.3 里程碑健康度等派生状态存在哪

外部 API 通常只有"人填的状态"。规则派生的状态（`AT_RISK`/`MISSED`、健康度依据、ETA 预测）**存在本地**：

| 派生数据 | 存哪 | 何时算 |
|---|---|---|
| `Milestone.health_reason` / `health_computed_at` | 本地 `SyncCache` 或专门的派生表 | 任务变更后 + 每日 cron |
| ETA 预测（P50/P90/confidence） | 本地派生表 | 每日 cron + 手动触发 |
| 燃尽图快照 | 本地 `ProgressSnapshot` | 每日 24:00 |

> **重要**：派生状态**只读不回写外部系统**。避免污染外部数据源，也避免外部 API 拒绝写入。UI 展示时用"统一模型 = 外部状态 + 本地派生覆盖"的合成视图。


## 6. 命令层（本产品的差异化核心）

### 6.1 命令即 pi tool

命令层不再是"自己写的一套执行器"，而是**注册给 pi agent 的 tool**。好处是：模型直接看到工具定义、调用被 pi 统一拦截、流式事件统一、错误处理统一。

```ts
const tool = defineTool({
  name: "update_task",
  label: "更新任务",
  description: "更新任务的字段。批量修改请用 batch_update_tasks。日期用绝对日期或相对表达式（如 next-monday）。",
  parameters: Type.Object({
    task_key: Type.String({ description: "任务标识（可用 search 得到）" }),
    due_date: Type.Optional(Type.String({ description: "新截止日 YYYY-MM-DD 或相对表达式" })),
    status: Type.Optional(Type.String({ description: "目标状态" })),
    ...
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const result = await pmAdapter.updateTask(params);   // 模块①
    return { content: [{ type: "text", text: summarize(result) }], details: result };
  },
});
```

**约定**
- `description` 是模型**唯一**的能力说明，必须写清"什么时候用我、什么时候别用我"（MiniMax 的 `toolChoice` 只能是 `auto`，模型全靠描述选工具）。
- `parameters` 用 TypeBox（与 zod 同源思路）直接生成模型的 JSON schema。
- `execute` 内**只调模块①**，不直接访问数据库。

### 6.2 命令清单

命令按域分组，每个标注 **确认策略** 与 **实现通路**（A=外部 API / B=数据库；多数两者皆可）。

**项目域**
| 命令（tool 名） | 参数 | 确认 |
|---|---|---|
| `list_projects` | filter{status?, owner?, tag?} | 否（只读） |
| `get_project` | project_key | 否（只读） |
| `create_project` | name, code?, description?, start_date, due_date, template_id?, owner? | 否 |
| `update_project` | project_key, name?, description?, start_date?, due_date?, tags?, status? | 状态变更需确认 |

**里程碑域**
| 命令 | 参数 | 确认 |
|---|---|---|
| `list_milestones` | project_key | 否 |
| `create_milestone` | project_key, name, start_date?, due_date, description? | 否 |
| `update_milestone` | milestone_key, name?, start_date?, due_date? | 改期 > 3 天需确认 |
| `split_milestone` | milestone_key, parts[] | **是** |
| `split_milestone_into_tasks` | milestone_key, tasks[] | 否 |
| `compute_milestone_health` | milestone_key | 否 |

**任务域**
| 命令 | 参数 | 确认 |
|---|---|---|
| `list_tasks` | filter{project_keys[], assignee?, statuses?, priorities?, milestone_keys?, due_before?, due_after?} | 否 |
| `get_task` | task_key | 否 |
| `create_task` | project_key, title, milestone_key?, parent_key?, assignee?, due_date?, priority?, type?, estimate_hours?, labels? | 否 |
| `update_task` | task_key, title?, description?, status?, priority?, assignee?, due_date?, milestone_key?, estimate_hours?, actual_hours? | 按 §6.3 |
| `split_task` | task_key, parts[] | **是** |
| `batch_update_tasks` | filter{...}, set{due_date?, status?, assignee?, priority?}, reason? | **是** |
| `transition_task` | task_key, event(schedule/start/block/unblock/submit_review/approve/reject/pause/cancel/reopen), reason? | 按 §6.3 |
| `delete_task` | task_key | **是** |
| `add_task_dependency` | task_key, depends_on_key, type?(FS\|SS\|FF\|SF) | 否 |
| `move_task` | task_key, milestone_key | 否 |

**风险域**
| 命令 | 参数 | 确认 |
|---|---|---|
| `list_risks` | filter{project_keys?, levels?, statuses?} | 否 |
| `register_risk` | project_key, title, description?, category, probability(1-5), impact(1-5), owner?, milestone_key?, mitigation_plan?, due_date? | 否 |
| `update_risk` | risk_key, title?, probability?, impact?, owner?, mitigation_plan?, contingency_plan?, due_date? | 升降级均需确认 |
| `close_risk` | risk_key, reason? | **是** |
| `convert_risk_to_task` | risk_key, title?, assignee?, due_date?, estimate_hours? | 否 |

**进度与洞察域**
| 命令 | 参数 | 确认 |
|---|---|---|
| `get_progress` | project_key | 否 |
| `predict_milestone_slip` | milestone_key | 否 |
| `predict_project_eta` | project_key | 否 |
| `suggest_risks` | project_key | 否 |
| `generate_weekly_report` | project_key, date_range? | 否 |

**检索与评论域**
| 命令 | 参数 | 确认 |
|---|---|---|
| `search` | query, entity_types? | 否（只读） |
| `add_comment` | target_type, target_key, content, mentions? | 否 |
| `list_comments` | target_type, target_key | 否 |

### 6.3 确认判定规则

判定发生在**两个地方**，缺一不可：

1. **静态标注**：tool 的 `annotations.destructiveHint` 标记"这类命令天生危险"（删除、拆分、批量、风险关闭）。
2. **动态判定**：模块① 的 `requiresConfirmation(command, args)` 看具体参数（改期多少天、是否跨项目、影响多少条）。

| 情形 | 需确认 | 理由 |
|---|---|---|
| 只读命令 | 否 | |
| 新建实体 | 否 | 可补偿撤销 |
| 改 title/description/priority/assignee/估时 | 否 | 常规 |
| task.status → CANCELLED | **是** | 等价删除 |
| 改 due_date，变化 **> 3 天** | **是** | 3 天 = 是否影响本周交付的分界 |
| 任何批量命令 | **是** | 影响面不明确 |
| 删除 / 软删除 | **是** | |
| 拆分（`split_*`） | **是** | 产生多个新实体 |
| 改 risk.probability/impact（**含降级**） | **是** | INV-12 |
| 跨项目写操作 | **是** | 超出当前上下文 |

阈值 `DESTRUCTIVE_DATE_THRESHOLD_DAYS = 3` 可配置。

### 6.4 待确认队列（对齐 pi-web 的 extension_ui 桥）

**机制**：agent 调用危险命令时，工具内部通过 pi 的 UI 通道**挂起**，等待人的答复；答复到达后**原地恢复**该工具调用。

```
① 工具 execute() 内部：
     - 调模块① 的 preview(command, args) 求值：命中清单 + 旧值 + 规则警告
       （如"顺延后仍无法解锁关键路径"——由规则算，不是模型编的）
     - 写 PendingAction（args + preview + expires_at = now + 30min）
     - 发 extension_ui_request（method:"confirm"，带 requestId / timeout / expiresAt）
       → 工具在此 await 一个 promise，**挂起**
     → 后端同时通过 SSE 推 { type:"action_request", actionId, preview, expiresAt } 给前端

② 前端渲染待确认卡片：命中清单 + 旧值 + ⚠ 规则警告 + [确认] [取消] [调整范围]

③ 用户操作 → 前端发 { type:"action_response", actionId, decision }
     → 后端 resolve 对应的 promise → **工具原地恢复**
       → 真正调用模块① 执行（写前快照 → 执行 → 写 AuditLog）
       → 工具返回结果 → agent 这一轮自然收尾（"已把 3 个任务顺延到 3-16"）
     → SSE 推 { type:"action_resolved", actionId, result }
```

**为什么这样比"入队 + 前端另调后端执行"好**

| 维度 | extension_ui 桥（采用） | 入队 + 另调执行（放弃） |
|---|---|---|
| LLM 调用 | 0 次额外（工具原地恢复） | 0 次，但 agent 这一轮会提前结束，话术割裂 |
| 一致性 | 确认与执行之间**无窗口期**，不存在"确认了但没执行" | 有窗口期，需处理中间态 |
| 上下文 | agent 知道用户确认/拒绝了什么，后续话术连贯 | agent 不知情 |
| 断线重连 | pi-web 的成熟做法：**`connected` 帧带 `pendingActionIds`，未决请求补发** | 要自己实现补发 |
| 超时/取消 | pi 内置 `timeout` / `expiresAt` / abort 信号 | 自己实现定时器与清理 |

**仍然保留 `PendingAction` 表**（不靠 pi 的内存态）：它要承载**跨进程重启的持久性**、**审计**、**"待确认"页签的列表查询**、**过期清理任务**。pi 的挂起态在内存里，表是事实源——两者双写，表为准。

**调整范围**：用户点"调整范围" → 前端发 `decision:"adjust"` + 新参数 → 后端**取消当前挂起**（resolve 为 "adjusted"）→ 重新求值预览 → 发起新的 `action_request`（新 actionId，`adjusted_from` 指向旧的）→ 旧的置 EXPIRED，审计留痕。

**拒绝**：`decision:"reject"` → resolve 为 rejected → 工具返回"用户拒绝执行" → agent 这一轮自然说明"好的，我没改"。

**过期**：`expires_at` 过后（惰性判定 + 每日清理任务）→ EXPIRED；若用户此时才点确认 → 提示"预览已过期，请让 AI 重新生成"，并 resolve 为 expired。

**预览是快照**：生成 PendingAction 时就固定命中清单（实体键 + 旧值）。执行的是这份快照里的实体，不重新跑 filter——否则用户看到的预览和实际改动会不一致。

**服务端实现要点**（借鉴 pi-web）
- 挂起的 promise 与 requestId 存在 `Map<requestId, {resolve, reject, timer, actionId}>`；会话销毁时全部 reject（避免泄漏）。
- SSE 断连不影响挂起（挂起态在服务端），重连后靠 `connected` 帧的 `pendingActionIds` 恢复卡片。
- 超时用 `setTimeout`，到点 resolve 为 expired；会话关闭时清理定时器。

### 6.5 撤销（补偿式）

见 §3.5。要点重述：

- 撤销 = 用**写前快照**做反向写入，不是事务回滚。
- 补偿逐条独立执行，**部分失败必须显式报告**，不允许假装全撤销。
- 补偿前做冲突检测（INV-14）：当前值 ≠ after_snapshot → 拒绝静默覆盖，提示冲突。
- 补偿本身写审计（`undo_of`），形成链。
- 外部 API 若提供历史版本/ETag，优先用它，补偿作为兜底（能力位 `supportsHistory`）。

### 6.6 相对日期解析

"本周所有 P0 任务顺延到下周一"——**不让模型算日期**。

- 日期参数接受 `DateRef`：`"2026-03-16" | "next-monday" | "this-week" | "+3d" | "today"`。
- 模块① 统一解析：`this-week` = 本周一 00:00 ~ 本周日 23:59（**周起点周一，时区 Asia/Shanghai**）；`next-monday` = 下一个周一 00:00。
- 上下文仍注入"今天是 X（Asia/Shanghai）"供模型参考，但**落库的一定是后端解析出的绝对日期**。
- 区间端点**闭区间**（含两端）。

### 6.7 规则引擎（确定性，不经 LLM）

规则引擎跑在后端，读模块① 的数据、算派生指标。**LLM 只负责措辞，不负责数字。**

**里程碑健康度**

```
progress       = done 任务数 / 任务总数
days_left      = due_date - today
velocity       = 近 14 天完成任务数 / 14          ← 用 actual_end_date
required_rate  = 剩余任务数 / max(days_left, 1)
blocked_days   = max(now - 阻塞起始) over BLOCKED tasks

AT_RISK 若 (progress < 0.5 且 days_left < 14)
       或 (velocity < required_rate × 0.8)
       或 (存在 blocked_days > 3 的任务)
       或 (逾期 3 天 grace 期)
MISSED 若 due_date < today 且 progress < 1
```
结果写本地（§5.3），UI 展示"为什么判定为有风险"的依据。

**进度三口径**（移植 PRD-v2 §6.4，列为不变量）

| 指标 | 公式 |
|---|---|
| 任务完成率 | `done 任务数 / 总任务数`（分母为非 cancelled 且未删除的活跃任务） |
| 估时完成率 | `Σ done 任务 actual_hours / Σ done 任务 estimate_hours`（分母 0 时用项目均值兜底） |
| 里程碑达成率 | `done 里程碑数 / 按截止日排期应 done 里程碑数` |
| 项目健康度 | 红灯 = 任一里程碑 `at_risk`/`missed`，或延期率 > 30% |

**风险 5 类自动识别**（移植 PRD-v2 §7.3，规则层占 80%）

| 类别 | 规则 |
|---|---|
| 延期 | 任一里程碑 `at_risk` 或预测延期概率 ≥ 70% |
| 阻塞 | 存在任务 `blocked` 时长 > 历史均值 1.5× |
| 过载 | 任一 assignee 当前 WIP > 其历史 P75 |
| 流失 | assignee 7 天内未更新其名下任何任务 |
| 范围蔓延 | 新增需求估时 > 原计划估时 + 20% |

输出为**候选风险**，经人采纳才 `register_risk`（`source=AI`）——与确认队列一致。

**ETA 预测**（移植 PRD-v2 §7.2）

```
method = burndown 外推 + CPM 关键路径
输出   = { predicted_end_date, p50, p90, confidence, explanation }
降级   = 无 CPM 时仅 burndown 外推（无 P50/P90）；历史不足时返回"数据不足，无法预测"
```


## 7. 权限模型（简化版，移植 PRD-v2 §5 的数据层，砍掉框架层）

### 7.1 两层

| 层 | 内容 |
|---|---|
| **Layer 1：用户** | 邮箱+密码登录、自研 session（httpOnly cookie）、`User.role ∈ {MEMBER, ADMIN}` |
| **Layer 2：项目成员** | `ProjectMember.role ∈ {VIEWER, MEMBER, ASSIGNEE, MANAGER, OWNER}` |

权限矩阵（移植 PRD-v2 §5.3，v1 只实现前四列的行为约束）：

| 操作 | VIEWER | MEMBER | ASSIGNEE | MANAGER | OWNER |
|---|---|---|---|---|---|
| 读项目 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 评论 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 改任务状态 | ❌ | ❌ | ✅(仅自己名下) | ✅ | ✅ |
| 改任务字段（估时/优先级） | ❌ | ❌ | ❌ | ✅ | ✅ |
| 推进项目状态 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 添加/移除成员 | ❌ | ❌ | ❌ | ❌ | ✅ |
| **执行破坏性命令** | ❌ | ❌ | ❌ | ✅ | ✅ |

**实现方式**：不在每个 service 里手写 JOIN，而是在命令执行入口统一注入 `ExecContext.allowedProjectIds`，命令层过滤。**INV-11 的孪生约束**：绕过命令层直接查库也要被同一套过滤覆盖（Repository 层统一加 where 条件）。

### 7.2 AI 相关权限
- `ai:use`（所有登录用户）、`ai:admin`（模型/配额管理）、`ai:audit`（查看 AI 审计与 prompt 内容）。
- v1 实现方式：用户表加 `is_admin` 布尔；审计页签对非 admin 隐藏 prompt 原文，仅显示摘要。

---

## 8. AI 能力（每项按 PRD-v2 §7 的七段式：触发/输入/输出/算法/评测/限流/降级）

> 实现载体：全部在**模块②（pi agent）**内完成，模型调用走 pi 的 provider 抽象，数据与写操作一律回调模块①。

### 8.1 NL 建/拆任务

**① 触发**：AI 工作台输入；任务页 ⌘K；看板上选中卡片后问 AI。
**② 输入**：`raw_text` + `context{project_id, parent_task_id, user_role, now, timezone}`。
**③ 输出**（zod 强约束）：`{tasks:[{title, description, type, priority, estimate_hours, labels, assignee_hint, dependencies}]}`。
**④ 算法**：MiniMax tool-calling → `create_task` / `split_task` / `batch_update_tasks`。
**⑤ 评测**：JSON 校验通过率 ≥ 95%（失败自动重试 1 次）；采纳率 ≥ 70%（采纳/编辑保存/拒绝 三按钮）；字段准确率 ≥ 0.9；估算工时 MAPE < 30%。评测集 `datasets/nl_to_task_v1.jsonl`（100 条，PM 标 ground truth）。
**⑥ 限流**：用户 5 QPS；单次 ≤ 10 个任务（超出走分批 + 确认）。
**⑦ 降级**：LLM 不可用 → `AI_UNAVAILABLE`，前端提示"AI 暂不可用，请手动建任务"；**手动建任务路径不受影响**。

### 8.2 进度预测与 ETA

**① 触发**：每日 cron 02:00；里程碑页"重新预测"；概览页自动展示。
**② 输入**：任务、依赖、估时、实际工时、历史速率。
**③ 输出**：`{predicted_end_date, p50, p90, confidence, explanation}`。
**④ 算法**：burndown 外推 + CPM 关键路径（M2）；M3 增强加 LLM 元数据特征与相似项目检索。**LLM 只润色 explanation**。
**⑤ 评测**：MAPE ≤ 25%（30 个历史项目留一）；预测耗时 < 2s；预警覆盖率 ≥ 70%。
**⑥ 限流**：cron 全量；手动每用户 10 次/小时。
**⑦ 降级**：CPM 不可用 → 仅 burndown（无 P50/P90）；历史数据不足 → 返回"数据不足，无法预测"而非瞎猜。

### 8.3 风险预警

**① 触发**：每日 cron 02:30；状态变更时增量检查；AI 工作台问"有什么风险"。
**② 输入**：任务、依赖、评论、估时方差、人员负载。
**③ 输出**：5 类候选风险 + 等级 + 原因 + 建议（**候选，不直接落库**）。
**④ 算法**：规则层 80%（§6.4 的 5 类硬规则）→ ML 层（v2）→ LLM 解释层 5%。
**⑤ 评测**：误报率 < 25%；漏报率 < 15%；采纳率 ≥ 55%。评测集 200 条人工标定。
**⑥ 限流**：用户订阅触发 50 次/小时。
**⑦ 降级**：规则层始终可用（无 key 也生效）；LLM 不可用 → 只给结构化 JSON，不给自然语言解释。

### 8.4 智能问答 / 项目助理（= AI 工作台）

**① 触发**：常驻右侧工作台。
**② 输入**：自然语言 + 当前 project 上下文 + 用户身份。
**③ 意图分类（10 类，移植 PRD-v2 §7.4）**：进度查询 / 负责人查询 / 风险查询 / 负载查询 / 依赖查询 / 历史查询 / 总结查询 / SLA 查询 / 建议查询 / **操作意图**（本项目特有：走 tool-calling 执行命令）。
**④ 算法**：
```
NL → 意图分类 → 若为操作意图：tool-calling → 命令层 → 确认队列
                  → 若为查询意图：只读命令取数 → LLM 生成回答（含引用卡片）
```
**⑤ 评测**：意图识别准确率 ≥ 90%（200 问）；端到端 P95 < 6s；**引用准确率 100%**（每条结论能点回原始对象——命令层天然满足，因为引用的是真实实体 id）。
**⑥ 限流**：用户 2 QPS。
**⑦ 降级**：意图分类不可用 → 用户从下拉选意图；LLM 不可用 → 提示不可用，**手动路径照常**。

### 8.5 评论 / 会议纪要总结

**① 触发**：评论流"AI 总结"；粘贴会议记录。
**② 输入**：文本（≤ 8000 字）+ 上下文。
**③ 输出**（zod 强约束）：`{summary_short, summary_long, decisions[], action_items[{text,owner,due,priority}], risks[], open_questions[]}`。
**④ 算法**：MiniMax 结构化输出；`action_items` **可一键转成任务**（走 `create_task` 命令，进入确认队列）。
**⑤ 评测**：action items 抽取 F1 ≥ 0.75（200 条标定）；采纳率 ≥ 60%。
**⑥ 限流**：20 次/小时。
**⑦ 降级**：LLM 不可用 → "AI 总结暂不可用"。

### 8.6 降级总表

| 能力 | LLM 不可用 | 历史数据不足 | 全部依赖不可用 |
|---|---|---|---|
| NL 建/拆任务 | 错误码，手动可用 | — | 错误码 |
| 进度预测 | 仅 burndown，无 P50/P90 | 返回"数据不足" | 仅基础速率外推 |
| 风险预警 | 仅规则层（无自然语言解释） | 规则层仍生效 | 仅规则层 |
| 智能问答 | 错误码 | — | 错误码 |
| 纪要总结 | 错误码 | — | 错误码 |

> **原则**：每个降级路径必须写明触发条件 + 用户感知。**无 key 时的系统必须仍然是一个可用的项目管理系统**。

### 8.7 模型接入（MiniMax）

| 项 | 值 |
|---|---|
| baseURL（OpenAI 兼容） | `https://api.minimax.cn/v1` |
| baseURL（Anthropic 兼容，AI SDK 默认） | `https://api.minimax.cn/anthropic` |
| 模型 | `MiniMax-M3.1-Flash`（默认）、`MiniMax-M3` |
| 鉴权 | `Authorization: Bearer $MINIMAX_API_KEY` |

**MiniMax 的三个约束（必须遵守）**：
1. **`toolChoice` 只支持 `auto`** → 不能强制模型调工具，"必须走命令"只能靠 system prompt 约束 + schema 描述质量；且必须有"模型只回文本没调工具"的兜底：**不得猜测意图直接执行**。
2. **多轮 function call 必须回填完整 assistant 消息** → 对话历史裁剪必须**以完整轮次为单位**（含 `tool_calls` 的消息与其 tool 结果成组保留或成组丢弃）。
3. **Interleaved Thinking 会把思考写进 `content`** → 解析时**只看 `tool_calls` 数组**，不解析 `content`。

`.env.example`：
```
AI_PROVIDER=minimax
MINIMAX_API_KEY=
AI_MODEL=MiniMax-M3.1-Flash
AI_BASE_URL=https://api.minimax.cn/v1
AI_MOCK=0
```

**在 pi agent 中的落地**：pi 已内置 MiniMax provider，配置 `MINIMAX_API_KEY`（国际）或 `MINIMAX_CN_API_KEY`（国内）即可，模型 id 形如 `minimax-cn/MiniMax-M3.1-Flash`。pi 的 `ModelRuntime` 也允许完全自定义模型接入。

**降级链**：① 模型未调工具 → 纠正重试 1 次，仍不调则放弃该轮（不猜意图）；② tool-calling 不可用 → 退化为结构化 JSON 输出，用同一套 schema 校验；③ LLM 整体不可用 → 提示不可用，手动路径不受影响；④ `AI_MOCK=1` → 本地 mock，无 key / CI 可开发。

### 8.8 Prompt 策略

系统提示四块：
1. **角色与边界**：你是项目管理助理；只能通过工具操作数据；不要编造 id（不确定先查询）。
2. **工具使用规则**：多实体修改拆成多个命令；批量操作必须先预览；不确定参数先查再改。
3. **强制工具化**（因 `toolChoice=auto`）：任何"改/建/删/查项目数据"的意图**必须调用工具**，不得用文字代替；需求含糊时先调只读命令探查。
4. **输出风格**：中文、简洁、先结论后动作、每个结论带引用卡片。

### 8.9 上下文注入
- 注入：当前 project id、可见项目列表、当前视图上下文（如正在看某里程碑）、今天日期与时区。
- **不预先把整个项目塞进 prompt**；需要更广数据时由 LLM 先调只读命令。
- 历史：最近 N 轮 + 摘要，**按完整轮次裁剪**（§8.7 第 2 点）。

---

## 9. 审计、可观测与安全

### 9.1 审计（移植 PRD-v2 §8.2 + AIPM 撤销链）

| 表 | 内容 | 保留 |
|---|---|---|
| `AuditLog` | **所有**写操作的命令、参数、前后快照差异、actor、model、tokens、latency、trace_id、undo_of、adopted | 永久 |
| 操作日志 | 读操作与失败调用（可只记摘要） | 180 天 |

- `AuditLog` 是 **append-only**：撤销是新增一条 `undo_of` 指向原记录的日志，不修改原记录。
- AI 调用的 prompt/response **存哈希**（`prompt_hash`/`response_hash`）而非全文；全文仅 admin 可见（§7.2）。

### 9.2 可观测
| 类别 | 实现 |
|---|---|
| 指标 | Prometheus：`nl_to_task_latency_seconds`、`ai_call_total{model,status}`、`command_exec_total{command}`、`command_confirm_pending`、`command_undo_total`、`eta_mape` |
| 追踪 | 每次 AI 调用带 `trace_id`，贯穿 AuditLog |
| 日志 | 结构化日志，业务日志与 AI 日志分离 |

### 9.3 安全
- 传输 HTTPS；密码 bcrypt/argon2；session httpOnly cookie + 服务端哈希存 token。
- **PII 脱敏**：AI 输出到前端前做正则清洗（邮箱/手机号/身份证）。
- AI 输出的每条结论必须**可点回原始对象**（引用卡片 → 真实实体 id）。
- 删除/状态变更 → 二次确认 + 限速。
- 命令层是唯一写入口（INV-11）。

### 9.4 性能
| 指标 | 目标 |
|---|---|
| API P95（不含 AI） | < 300 ms |
| 列表分页 100 条 | < 500 ms |
| AI 建任务 P95 | < 5 s |
| ETA 预测 | < 2 s |
| 并发（内部） | ≥ 50（v1 内部规模，不追求 500） |

---

## 10. 前端

### 10.1 布局（原型 v6 已确认）
```
┌──────────┬──────────────────────────┬────────────────────┐
│ 左侧菜单  │        主内容区            │   AI 工作台         │
│ 236px    │  概览/看板/甘特/风险/报告  │   412px            │
│ 可折叠→图标│                          │  对话/待确认/审计    │
└──────────┴──────────────────────────┴────────────────────┘
```
- 左侧菜单可折叠为 58px 图标栏，悬停显示文字；状态存 localStorage。
- AI 工作台可折叠（⌘B）为右缘把手；状态存 localStorage。

### 10.2 主内容区视图

| 视图 | 内容 | v1 |
|---|---|---|
| 概览 | KPI 卡 + AI 今日洞察条 + 风险墙摘要 + 里程碑状态 + 项目健康度 | ✅ |
| 任务看板 | 5 列，拖拽改状态（拖拽写 `transition_task`），卡片显示优先级/里程碑/是否 AI 创建/截止/负责人 | ✅ |
| 里程碑时间轴 | 区间条 + 状态徽标 + 完成度 + 今天红线；点击展开子任务 | ✅ |
| 风险墙 | 卡片按等级配色 + 5 类自动识别的候选风险区 + **概率×影响热力图** | ✅ |
| 进度 | 燃尽图 + 完成率三口径 + ETA 预测带 P50/P90 区间 | ✅ |
| AI 报告 | 周报 + 行动项（可一键转任务）+ 推送/导出按钮 | ✅ |
| 甘特 | 依赖连线 | v1.1 |
| 我的任务 | assignee=我的过滤视图（复用看板组件） | ✅ |

### 10.3 AI 工作台三页签（同一套状态联动）
| 页签 | 内容 |
|---|---|
| 💬 对话 | 消息流 + 命令卡片（命令名、参数摘要、影响范围、状态徽标、撤销按钮）+ 快捷指令 chip |
| ⏳ 待确认 | destructive 命令队列：参数明细、命中清单、规则算出的 ⚠ 提示、确认/取消/调整范围 |
| 📋 审计 | 谁（人/AI）· 做了什么 · 何时 · 可撤销；按人/AI 过滤 |

**联动**：对话里确认执行 → 对话卡片变"已执行" + 待确认移除 + 审计新增一条。

### 10.4 手动操作也走命令层
看板拖拽、表单新建任务、风险卡片编辑——**全部走同一套命令**（`actor=USER`），同样写 `AuditLog`、同样可撤销。理由：① 审计页有完整时间线；② 撤销逻辑只有一份实现；③ 与 AI 的行为完全一致，用户不需要学两套心智。

### 10.5 前后端边界与协议
- 写操作统一走 Server Action / Route Handler，**不在客户端直连数据库**，也**不直连外部 API**。
- 对话走 §3.10 的命令协议（prompt / steer / abort / action_response / fork），不是一堆语义各异的 REST。
- 流式走 §3.9 的 SSE 协议：**结构性事件永不丢弃，增量事件可丢**，状态快照可重建。
- 命令卡片出现时立即显示"执行中"，成功后落地为"已执行"，失败回滚并展示错误。

### 10.6 与 pi-web 前端的对照
pi-web 的浏览器端已经实现了这套协议（SSE 事件订阅、心跳、pending 请求恢复、fork 操作）。我们的前端可以直接借鉴它的**事件处理与重连逻辑**，但视图与组件是 PM 领域自己的。
- 写操作统一走 Server Action / Route Handler，**不在客户端直连数据库**。
- 命令卡片出现时立即显示"执行中"，成功后落地为"已执行"，失败回滚并展示错误。

---

## 11. AI 评测流水线（移植 PRD-v2 §8.5）

```
scripts/ai_eval/
├── datasets/
│   ├── nl_to_task_v1.jsonl      # 100 条：raw_text + ground_truth_tasks
│   ├── progress_predict_v1.jsonl # 30 个历史项目：history + actual_end_date
│   ├── risk_predict_v1.jsonl     # 200 条历史项目（80 正例）
│   ├── intent_v1.jsonl           # 200 问：query + true_intent + true_target_id
│   └── meeting_summary_v1.jsonl  # 200 条会议记录 + 人工标 action_items
├── runners/{nl_to_task,progress_predict,risk_predict,intent,meeting_summary}.py
├── run.py                        # CLI: run.py --task <name> --report
└── report_template.md
```
**CI 钩子**：PR 上跑 `run.py --task all --report`，阈值不达标则 PR 变红，产出 `ai_eval_report.md` 作为 artifact。

> v1 优先做 `nl_to_task` 与 `intent` 两个评测集（覆盖最核心的两条链路），其余随对应能力上线。

---

## 12. 实施阶段

按新的两段式架构重排。**模块①（适配层）与模块②（pi agent）并行推进**，前端可以先用 mock 适配层开发。

| 阶段 | 交付 | 验收 |
|---|---|---|
| **P0 脚手架** | Next.js (前端 + API routes) + PostgreSQL(docker, 仅 AI 元数据) + Tailwind/shadcn + 登录(session) | 能起、能迁移、能登录 |
| **P1 模块①：外部 API 适配层** | 鉴权配置 + 实体 CRUD 封装 + 字段/枚举映射 + 错误归一 + 写前快照 + `preview` 只算不写 + 搜索 | 用真实外部 API 完成项目/里程碑/任务/风险的增删改查；写前快照可用 |
| **P2 模块①：命令映射** | §6.2 全部命令 → 模块① 接口的映射 + `requiresConfirmation` 动态判定 + 补偿撤销 | 每条命令有参数校验 + 单测；撤销后数据回到原样 |
| **P3 规则引擎** | 里程碑健康度 + 进度三口径 + 5 类风险识别 + ETA 预测 + 每日 cron | 数字确定、可测、**不依赖 LLM** |
| **P4 模块②：pi agent 骨架** | pi session + 自定义 system prompt + 工具注册机制 + `tool_call` 确认钩子 + MiniMax provider + 事件流 → SSE | 用 mock provider 跑通"一句话改任务"（三段联通） |
| **P5 前端主内容区** | 概览/看板/时间轴/风险墙/进度/报告；**所有写操作经模块①** | 数据来自真实外部 API；手动操作同样留痕 |
| **P6 AI 工作台** | 对话/待确认/审计三页签 + 联动 + 命令卡片 + 折叠交互 + **SSE 事件协议**（§3.9）+ **命令协议**（§3.10） | 确认执行 → 三处状态同步；**断线重连后待确认卡片不丢** |
| **P6.5 运行时加固** | 会话注册表 + 生命周期 + 空闲回收 + 启动锁 + holder 租约 + fork（§3.8） | 连续 100 次对话无会话泄漏；并发 prompt 正确排队 |
| **P7 撤销与冲突** | 补偿式撤销全链路 + 冲突检测 + 部分失败报告 | 拆分/批量撤销后数据与操作前完全一致 |
| **P8 洞察与报告** | ETA 展示、风险建议、周报 + 行动项转任务 | 概览洞察有真实结论 |
| **P9 评测流水线** | `nl_to_task` + `intent` 评测集 + CI 卡阈值 | PR 上能出报告并卡阈值 |

**P1/P2/P3 完全不需要 LLM key**（P4 之前 ai 侧不可用但系统可用）。**P4 之后的任何阶段都不依赖外部 API 是否支持某能力**——能力差异收敛在模块① 内部。

## 13. 验收标准

第一版算完成，当且仅当：

1. **一句话操作**：输入"把本周所有 P0 任务的截止日顺延到下周一" → 返回命中清单预览 → 确认后落库，且日期是后端按 Asia/Shanghai 周一为起点解析出的绝对日期。
2. **确认门槛**：风险降级、跨项目批量、删除、拆分均需确认；单条常规改动直接执行。
3. **可回溯**：每次写入都有 AuditLog；拆分与批量撤销后数据与操作前**完全一致**；冲突时拒绝静默覆盖。
4. **可解释的判定**：里程碑显示"有风险"时能说明依据；ETA 预测给出 P50/P90 与置信度。
5. **规则优先**：无 key 时里程碑健康度、风险识别、进度口径、燃尽图全部照常工作；AI 只影响"自然语言部分"。
6. **AI 挂了系统不瘫**：关掉 key 后手动建任务、改状态、看板/里程碑/风险/进度视图、审计与撤销全部可用。
7. **人工与 AI 同路径**：手动拖拽看板同样产生 AuditLog 并可撤销。
8. **引用可回跳**：AI 的每条结论都能点回原始任务/里程碑/风险。

---

## 14. 开放问题（需要你拍板）

| # | 问题 | 我的建议 | 影响 |
|---|---|---|---|
| Q1 | **是否改为在 AiAdmin 上二次开发**（PRD-v2 的原始路径）？ | **不改**。仓库无 AiAdmin 代码，移植成本远大于收益；PRD-v2 的业务模型已整体吸收 | 若改，本文档架构层需重写 |
| Q2 | 第一版是否要**真实多用户登录**？ | **要**（邮箱+密码，最简）。审计要区分"谁操作的"，撤销冲突判定依赖这个 | 若不要，INV-14 冲突检测降级为"仅比较 updated_at" |
| Q3 | 里程碑 `at_risk` 的规则阈值（进度 50%、剩余 14 天、速度比 0.8、阻塞 3 天） | 先用这组默认值，参数化后可调 | 直接影响"有风险"标签的准确率 |
| Q4 | 是否要**子任务（parent_id）**？ | **要**，v1 实现（≤3 层） | PRD-v2 有；AI 拆任务时最自然的产物 |
| Q5 | v1 是否做**评论**与**会议纪要**？ | 评论**做**（低成本、AI 总结价值高）；会议纪要 v1.1 | 影响阶段 5 的工作量 |
| Q6 | **飞书机器人**是否 v1 做？ | 不做（架构已预留，见 §6 命令层与传输层解耦） | 不阻塞 |
| Q7 | 是否引入**向量库**做相似项目检索？ | v1 不做，用标签 + 历史速率相似度 | PRD-v2 把 pgvector 放在 M3 |
| Q8 | 周起点与时区 | 周一为起点、Asia/Shanghai | 改"本周"命中范围 |
| Q9 | **Agent 端用什么实现？** | **已定：pi agent**（`@earendil-works/pi-coding-agent` SDK）。其 `defineTool` / `tool_call` 阻断 / `annotations` 正好覆盖命令层、待确认、危险标注三件事 | 已解决 |
| Q10 | **"外部已实现的 API"具体是哪一个？** | 需要你提供：接口文档/地址/鉴权方式。适配层的字段映射、枚举映射、错误码、批量与删除能力**全部取决于它** | **阻塞 P1**；这是当前最大的未知 |
| Q11 | 外部 API 是否支持：**删除**、**批量更新**、**历史版本/ETag**、**自定义字段**？ | 逐项确认。删除不支持 → 撤销退化为"逻辑删除"；无历史版本 → 撤销只能补偿式（§3.5）；无批量 → 模块① 内循环 + 部分失败报告 | 影响撤销能力边界与适配层实现 |
| Q12 | pi agent 的部署形态 | 建议**同进程内嵌**（后端 API 进程内 `createAgentSession`），不单独起服务——省一次网络往返与鉴权；pi 的 session 是进程内对象，与 SSE 流天然贴合。若将来要独立扩缩容再拆 | 影响部署复杂度 |

---

## 附录 A：与 PRD-v2 的映射（便于评审对照）

| PRD-v2 章节 | 本文档对应 | 处理 |
|---|---|---|
| §1.3 OKR | §2.1 | 采纳，裁剪为 5 项 |
| §2.1 组件图 | §3.1 | 重绘（保留 AI 四层分层） |
| §2.2 技术选型 | §0.2 | 框架层不移植，业务层移植 |
| §2.3 AI 调用分层 | §3.1 编排层、§8 | 采纳四层分层 |
| §3 状态机 | §4 | **全量移植** |
| §3.5 不变量 | §4.5 | 移植 + 新增 INV-11~14 |
| §4 数据模型 | §5 | 移植字段 + 补命令层字段 |
| §5 权限 | §7 | 简化为两层 |
| §6 模块定义 | §5、§6.3 | 字段移植为命令 |
| §7 AI 能力 | §8 | 七段式移植 |
| §7.6 降级总表 | §8.6 | 移植 |
| §8 可观测/审计/安全 | §9 | 移植 + 撤销链 |
| §8.5 评测流水线 | §11 | 移植 |
| §9 里程碑 | §12 | 重排依赖 |
| §10 风险/Open Questions | §14 | 采纳风险清单，Open Questions 重列 |

## 附录 B：原型说明
原型：` .superpowers/brainstorm/80467-1793368904/content/aipm-prototype-v6.html`（静态 HTML + 内联 CSS/JS）。
它确定的是**信息架构与交互**（左侧菜单可折叠、主内容区 5 个视图、右侧常驻 AI 工作台三页签），**不是像素级视觉稿**。本 v3 文档新增的视图（进度/燃尽、风险热力图、甘特）在实现阶段需要补原型或直接由设计实现。
