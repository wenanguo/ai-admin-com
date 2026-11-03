# 01 · 架构设计

> 系统分几块、每块负责什么、怎么通信、怎么部署。**先读 §1 边界，再读 §4 运行时。**

## 1. 总体形态

```
┌──────────────────────┐   REST + SSE   ┌──────────────────────────────────────────┐
│  ① 前端界面           │ ─────────────▶ │  ② 后端                                     │
│  Next.js App Router   │ ◀── SSE 事件流 │                                            │
│                      │               │  ┌────────────────────────────────────────┐ │
│  · 概览/看板/时间轴    │               │  │ 模块① CRUD 业务代码（适配层）           │ │
│  · 风险墙/进度/报告    │               │  │   DataSource 接口                      │ │
│  · AI 工作台三页签    │               │  │   ↳ 通路A（默认）转发外部已实现 API      │ │
│  · 命令卡片/待确认     │               │  │   ↳ 通路B（备选）直连数据库               │ │
│                      │               │  └───────────────▲────────────────────────┘ │
│                      │               │                  │ tool call / 数据查询      │
│                      │               │  ┌───────────────┴────────────────────────┐ │
│                      │               │  │ 模块② Agent 代码（pi agent）            │ │
│                      │               │  │   意图路由 / 上下文装配 / tool-calling │ │
│                      │               │  │   prompt / 模型调用 / 降级 / 评测        │ │
│                      │               │  └────────────────────────────────────────┘ │
└──────────────────────┘               └──────────────────────────────────────────┘
                                                     │
                                                     ▼
                                         外部 PM API（业务事实源）
```

## 2. 模块①：CRUD 业务代码（适配层）

### 2.1 职责
所有与业务数据打交道的读写都经过这一层。对外只暴露统一领域模型，**内部差异被完全吸收**。

### 2.2 双通路

| 通路 | 说明 | 何时选 |
|---|---|---|
| **A（默认）** | **转发外部已实现的 API**。不持有业务数据，只做鉴权透传、字段映射、错误归一、分页/批量语义转换、幂等 | 外部已有可用 PM 系统 |
| B（备选） | 直连数据库（Prisma/PostgreSQL），自行实现读写 | 无外部 API，或需本地扩展字段/索引 |

**必须可切换**：对外暴露同一套接口（§3.4），内部由 `DataSource` 抽象切换实现。切换只换实现类，上层零改动。

### 2.3 适配层职责清单

| 职责 | 通路 A | 通路 B |
|---|---|---|
| 认证 | 持有外部凭据（服务账号/OAuth），**前端永远拿不到** | 内部连接池 |
| 字段映射 | 外部字段/枚举 ↔ 统一领域模型（02 §2） | 直接读写领域模型 |
| 实体 ID | 外部 ID ↔ 本地引用（`EntityRef`） | 本地自增/UUID |
| 错误归一 | 外部错误码 → `NOT_FOUND` / `CONFLICT` / `VALIDATION` / `RATE_LIMIT` / `AUTH_EXPIRED` | 同左 |
| **写前快照** | **写前先 GET 一次**存旧值（撤销的唯一依据） | 事务内读旧值 |
| 批量语义 | 外部不支持批量 → 循环 + 限流 + 部分失败报告 | 单事务批量 |
| 幂等 | 带 `Idempotency-Key` | 同左 |

### 2.4 写前快照（关键）
外部 API 一般不提供字段历史，所以**每次写之前必须主动读旧值**。成本是一次额外 GET，换来"可撤销 + 可展示 diff + 可做冲突检测"三件事。

快照只存**字段级差异**（被改字段的旧值），不是全量对象，体积可控。

## 3. 模块②：Agent 代码（pi agent）

### 3.1 职责边界

| 做 | 不做 |
|---|---|
| 意图识别、上下文装配、tool-calling | **不碰数据库** |
| prompt 管理、模型调用、降级 | **不做权限判定**（后端做） |
| 评测 | **不直接执行命令**（只向后端请求执行） |

### 3.2 pi SDK 能力映射

| 需要的能力 | pi SDK |
|---|---|
| 自定义工具 | `defineTool({ name, description, parameters: TypeBoxSchema, execute })` + `pi.registerTool()` |
| 人工确认 | `pi.on("tool_call")` 可阻断；`ctx.ui.confirm()` 走 extension_ui 桥 |
| 危险标注 | tool `annotations`：`readOnlyHint` / `destructiveHint` / `idempotentHint` |
| 流式输出 | `session.subscribe(event)` → `message_update` / `tool_execution_*` |
| 自定义 system prompt | `createAgentSession({ systemPrompt })` |
| 会话持久化 | `SessionManager`（内存 / 文件） |
| 模型供应商 | 内置 provider，**MiniMax 已支持** |

### 3.3 关键：只注册我们的工具
pi 默认加载 coding 场景内置工具（read/bash/edit/write）。产品级 agent **必须禁用**：

```ts
const { session } = await createAgentSession({
  tools: [],                       // 不启用任何内置工具
  customTools: ourCommandTools,    // 只注册业务命令
  resourceLoader: new DefaultResourceLoader({
    extensionFactories: [ourExtension],   // 注册 tool + tool_call 钩子
  }),
  model: "minimax-cn/MiniMax-M3.1-Flash",
  sessionManager: SessionManager.inMemory(),
  systemPrompt: PM_AGENT_PROMPT,
});
```

### 3.4 模块① 对外接口（Agent 只能通过这些接触业务数据）

| 接口 | 方法 | 说明 |
|---|---|---|
| `/internal/pm/projects` | GET | 项目列表（过滤：状态、负责人、标签） |
| `/internal/pm/projects/:id` | GET / PATCH | 项目详情 / 更新 |
| `/internal/pm/milestones` | GET / POST | 里程碑 |
| `/internal/pm/milestones/:id` | GET / PATCH / DELETE | |
| `/internal/pm/tasks` | GET / POST | 任务（过滤：负责人、状态、优先级、里程碑、截止区间） |
| `/internal/pm/tasks/:id` | GET / PATCH / DELETE | |
| `/internal/pm/tasks/:id/transition` | POST | 状态迁移（对应 02 §4.3 事件） |
| `/internal/pm/tasks/batch` | POST | 批量更新（逐条结果，支持部分失败） |
| `/internal/pm/risks` | GET / POST | 风险 |
| `/internal/pm/risks/:id` | GET / PATCH | |
| `/internal/pm/risks/:id/to-task` | POST | 风险转应对任务 |
| `/internal/pm/dependencies` | POST / DELETE | 任务依赖 |
| `/internal/pm/search` | GET | 跨实体检索（指代消解："那个多轮对话的任务"） |
| **`/internal/pm/preview`** | POST | **只算不写**：返回命中清单与旧值（待确认预览） |
| **`/internal/pm/undo`** | POST | 补偿式撤销 |

## 4. 运行时（借鉴 pi-web）

pi-web 是成熟同类实现：**Next.js 服务 + 每个会话一个 pi RPC 子进程 + REST 控制面 + SSE 事件桥**。以下模式直接吸收。

### 4.1 会话注册表
- `Map<conversationId, AgentSession>` 挂在服务进程上；进程退出钩子统一 shutdown；`onDestroy` 时移除条目。
- 独立 Map 记录生命周期（`starts / firstStartedAt / lastStartedAt / lastClosedAt`），上限 1000 条，用于空闲回收与"我的会话"列表。

### 4.2 启动锁
同一会话并发 `prompt` 必须串行化——pi 的 `prompt()` 在运行中会拒绝。用 `Map<conversationId, Promise>` 做启动锁，排队而非报错。

### 4.3 命令协议
前端发**与 pi RPC 同构**的命令，服务端统一回 `{ id, type:"response", command, success, data }`。详见 03 §3。

### 4.4 SSE 语义
- 连接后先发 `connected` 帧（含 `isStreaming` 与**未决确认请求 id 列表**）。
- 心跳 15s。
- backlog 上限 16MB；超限时**丢弃可重建的增量帧**，保留结构性事件。
- **状态快照是最终真相，增量只是优化**。

详见 03 §4。

### 4.5 撤销：补偿式
外部 API 通常无历史版本，所以：

| 变更类型 | 补偿动作 |
|---|---|
| 更新字段 | 旧值 PATCH 回去 |
| 创建实体 | 调用 DELETE；不支持则本地标记"逻辑删除" |
| 删除实体 | 用快照重建（ID 会变 → 更新 `EntityRef` 映射） |
| 拆分 | 删除新实体 + 恢复原实体 |
| 批量 | 逐条补偿 |

**三条硬约束**：
1. 补偿**不是原子的** → 必须逐条独立执行，**部分失败要显式报告**（"3 条已撤销，1 条失败：xxx"）。
2. 补偿前做**冲突检测**：当前值 ≠ after_snapshot → 拒绝静默覆盖。
3. 补偿本身写审计（`undo_of`）。

外部 API 若提供版本号/ETag/历史版本，优先用它，补偿作兜底（能力位 `supportsHistory`）。

### 4.6 待确认：extension_ui 桥
```
工具 execute()：
  preview(args) → 写 PendingAction → 发 extension_ui_request → await promise（挂起）
前端 → action_response → 后端 resolve promise → 工具原地恢复 → 执行 → agent 继续本轮
```
- **无窗口期**：不存在"确认了但没执行"的中间态。
- **零额外 LLM 调用**：工具原地恢复，agent 自然收尾。
- **断线重连**：`connected` 帧的 `pendingActionIds` 补发未决请求。
- `PendingAction` 表仍是事实源（跨重启持久性、审计、列表查询、过期清理）。

详见 03 §5、04 §4。

### 4.7 holder 租约
一个会话同一时刻只有一个 holder 在驱动；多人/多标签页同时发言要**排队**而非冲突。空闲自动释放租约。

### 4.8 fork
- "从此处编辑"：在当前会话内开分支。
- "新建会话"：从历史消息另起一个会话，原历史保留。

## 5. 我们与 pi-web 的差异

| 维度 | pi-web | AIPM |
|---|---|---|
| pi 嵌入方式 | **RPC 子进程**（JSONL over stdio） | **同进程 SDK**——我们只有一个后端进程，不需要进程隔离，省掉进程监管与 stdout 解析 |
| 工具集 | coding 工具 + MCP | 只有业务命令（`tools: []` + `customTools`） |
| 会话存储 | pi 的 JSONL 会话文件 | 我们的 `Message` 表 + pi `SessionManager` |
| 确认语义 | coding 权限确认 | 业务语义的危险操作确认（04 §3） |

> **保留同进程 SDK 是刻意的**：RPC 子进程的价值在于语言无关与崩溃隔离；我们后端本来就是 TS，且 agent 不执行任意代码（无 bash/write 工具），崩溃风险面很小。若将来需要多租户高并发或要求 agent 崩溃不影响业务，再切 RPC 模式——接口层已按"命令协议"设计，切换成本低。

## 6. 本地存储边界

业务事实源在外部 API，**本地不镜像业务实体**，只存 AI 侧元数据（02 §1）。

## 7. 部署形态

| 组件 | 形态 | 端口 |
|---|---|---|
| 前端 + 后端（Next.js） | 一个进程（App Router + Route Handlers） | 3000 |
| PostgreSQL | docker-compose | 5432 |
| 外部 PM API | 外部服务 | — |

开发期用 `docker-compose up db`；生产期 Next.js 用 `next start`，agent 与业务同进程。

环境变量：
```
DATABASE_URL=
MINIMAX_API_KEY=          # 或 MINIMAX_CN_API_KEY
AI_MODEL=minimax-cn/MiniMax-M3.1-Flash
EXTERNAL_PM_API_BASE=
EXTERNAL_PM_API_TOKEN=
AI_MOCK=0
```
