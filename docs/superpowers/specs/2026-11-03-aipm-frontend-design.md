# AIPM 前端界面设计

> 把 `docs/aipm/prototype/` 的 12 页原型，落成 `ai-admin-com`（React 19 + antd 6 +
> ProComponents 3 + Umi Max 4）里的页面与常驻 AI 工作台。
>
> **上游**：架构与合并方案见
> [`2026-11-03-aipm-merge-design.md`](2026-11-03-aipm-merge-design.md)（已定稿）。
> 本文只管界面：有什么页面、每个页面有什么、交互怎么走。
>
> **状态**：草案，待批准。批准后进入 `writing-plans`。
> **日期**：2026-11-03

---

## 1. 交付范围

### 1.1 做什么

| # | 交付物 | 路由 |
|---|---|---|
| F1 | **AI 工作台（常驻右侧栏）** | 无路由，挂在所有页面 |
| F2 | **AI 工作台（全宽页）** | `/ai/workspace` |
| F3 | 项目管理（列表 + 详情） | `/pm/project` · `/pm/project/:id` |
| F4 | 里程碑管理 | `/pm/milestone` |
| F5 | 任务列表 + 任务看板 | `/pm/task` · `/pm/task/board` |
| F6 | 风险登记册 | `/pm/risk` |

### 1.2 不做什么（v1）

| 原型页面 | 不做的原因 |
|---|---|
| `dashboard.html`（PMO 仪表盘） | AIPM 00 §2 已定「PMO 组合仪表盘 v1.1」；且它的数据依赖派生指标，P2 规则引擎没落地前没有真数据 |
| `comments.html` | AIPM 07 Q8 定 v1.1；且评论的 AI 总结价值依赖会议纪要 |
| `meeting-summary.html` | AIPM 07 Q8 定 v1.1 |
| `settings.html`（模板/字段/配额） | AIPM 00 §2 定 v1.1；后端 `module_pm_project_template` 也不完整 |
| `milestones.html` 的**甘特图** | AIPM 00 §2 定 v1.1。里程碑页做**时间线**（竖排），不做甘特 |
| 飞书机器人 | AIPM 00 §2 已定不做 |
| 向量库相似检索 | AIPM 07 Q10 定 v1 不做 |

### 1.3 与原型的差异总表

| 维度 | 原型 | 本设计 | 为什么 |
|---|---|---|---|
| 视觉 | Tailwind + Element Plus 视觉 | **antd 6 token** | 不引入第二套设计语言 |
| AI 标识色 | 紫→蓝渐变 | **antd 预设色 `purple`** | 渐变是 Tailwind 实现细节，不是设计意图 |
| 工作台宿主 | 页面右侧 `<aside>`，`hidden` 折叠 | **antd `Layout.Sider`**，`collapsedWidth=40` | 原型折叠后主内容**宽度不变**（右侧留白），是偷懒；Sider 让主内容跟着收窄 |
| 状态/类型标签 | 硬编码 `el-tag success` | **字典驱动**（`list_class`） | 后端字典带 `list_class`/`css_class`，状态色跟着字典走，不在前端硬编码 |
| 风险等级 | mock 里有 `level` | **前端按矩阵算** | 后端 `pm_risk` **只有 `score`，没有 `level`** —— 等级是 AIPM 02 §5.3 的派生量 |
| 风险 `score` | 前端以为后端算 | **前端算并提交** | 后端 `ModulePmRiskCreateSchema.score` 是**必填**且 `create_service` **直接透传**（不计算）⇒ 前端必须算 `probability × impact` 一起提交 |
| 里程碑状态 | 6 态 | **5 态** | 后端字典 `module_pm_milestone_status` 只有 `upcoming`/`in_progress`/`at_risk`/`done`/`missed`，**没有 `cancelled`** |
| 任务的项目/里程碑名 | 列里直接取 | **侧载列表解析** | `ModulePmTaskOutSchema` 只有 `assignee_by`/`reporter_by`，**没有 `project_by`/`milestone_by`** |
| 数据 | `MOCK.*` | **真实后端** | 本项目无 mock 政策 |

---

## 2. 设计语言

### 2.1 决策：只用 antd 6 的 token

**不引入自定义色板、不引入渐变、不引入第二套图标库。**

| 语义 | 用 antd 6 的 | token |
|---|---|---|
| 主色 / 强调 | `colorPrimary` | 蓝 |
| AI 身份标识 | `Tag color="purple"` | 紫（仅用于 AI 相关标签与命令名） |
| 成功 / 警告 / 危险 | `colorSuccess` / `colorWarning` / `colorError` | — |
| 中性底色 | `colorBgContainer` / `colorBgLayout` | — |
| 正文 / 次要 | `colorText` / `colorTextSecondary` | — |

**原型里所有 `el-tag` / `el-input` / `btn` 的语义，一律映射到 antd 的
`Tag` / `Input` / `Button` / `Alert` / `Table` / `Tabs` / `Badge` / `Tooltip`。**

### 2.2 组件映射表

| 原型 | antd 6 |
|---|---|
| `el-tag` | `Tag` |
| `el-input` | `Input` / `Input.TextArea` |
| `btn btn-primary` | `Button type="primary"` |
| `card` / `card-title` | `Card` / `Card title` |
| `data-tabs` | `Tabs` |
| 徽标数字（红点计数） | `Badge count` |
| 橙底警告条 | `Alert type="warning"` |
| 命中清单表格 | `Table size="small"`（或 `Descriptions`） |
| 5×5 风险热力图 | 自绘 `div` 网格（用 token 底色 + `Tooltip`） |
| 看板 6 列 | `Row`/`Col` + `Card`，拖拽用 `@dnd-kit` 或 antd v6 拖拽 |
| 抽屉（无） | `Drawer`（仅「调整范围」「详情」用） |

### 2.3 排版与间距

- 字号只用 antd token：`fontSize` 12 / 14 / 16。
- 间距用 `margin` / `padding` 的 8 的倍数（antd 默认）。
- 代码/命令名用等宽字体（`fontFamily: monospace`），对应原型的 `<code>`。

---

## 3. AI 工作台：常驻右侧栏（F1）

### 3.1 宿主

```
ProLayout
└── childrenRender → <Layout>
      ├── <Layout.Content>          主内容（随 Sider 收窄而收窄）
      └── <Layout.Sider width={400} collapsedWidth={40} collapsible>
            └── <AiWorkspace />
```

- **不是 `Drawer`**：AIPM 00 §3.3 明确否决了抽屉（「遮挡主内容，任务栏宽度不可控」）。
- **不是浮窗**：原型旧形态（右下角圆钮）已被 AIPM 文档否决。
- **折叠**：`collapsedWidth={40}`，收成一个 40px 的竖条（图标 + 竖排「AI 工作台」），
  主内容**同步收窄**，不留空档。
- **快捷键**：`⌘B` / `Ctrl+B` 切换（原型已有这个约定，保留）。
- **状态持久化**：`localStorage['aipm.workspace']` 存 `{ collapsed, tab, conversationId }`。
  > 原型的 key 是 `aipm.wb`；本项目用自己的 key，避免与原型演示互踩。

### 3.2 结构

```
┌──────────────────────────────────┐
│ [icon] AI 工作台            [>]  │  ← 头部 48px，colorPrimary 底色
│       对话 · 待确认 · 审计        │
├──────────────────────────────────┤
│ 对话  │ 待确认 ③ │ 审计 ⑦        │  ← Tabs size=small，Badge 计数
├──────────────────────────────────┤
│                                  │
│            （页签内容，可滚动）      │
│                                  │
├──────────────────────────────────┤
│ [输入框                    ][发送] │  ← 底部固定 72px
│ ⛨ 批量与破坏性操作需人工确认       │  ← 11px 灰字边界声明
└──────────────────────────────────┘
```

- 头部副标题沿用原型：**「对话 · 待确认 · 审计 ｜ 命令层受控写入」**。
- 底部那行灰字沿用原型的语义，改写为：
  **「批量与破坏性操作需人工确认 · 每次写入可撤销」**（去掉模型供应商名 ——
  模型可配，写死会在换模型时变成假信息）。

### 3.3 对话页签

**气泡**

| 角色 | 样式 |
|---|---|
| 用户 | 右对齐，`colorPrimary` 底、白字 |
| 助手 | 左对齐，白底 + `colorBgLayout` 边，机器人头像（antd `Avatar`） |

**助手气泡内的四段结构**（对应 AIPM 03 §4 的事件流）：

```
[意图识别：更新任务（置信度 0.92）]     ← tool_call 事件的摘要
完成度 42%，截止 07-25。                  ← text_delta 累积的正文
┌─ 命令卡片 ────────────────────┐
│ ⌨ update_task        [已执行]  │      ← tool_call / tool_result
│ 「对账引擎 V2 性能压测」→ 拆为…  │
│              [↩ 撤销]           │      ← auditId 可撤销时才出现
└──────────────────────────────┘
[→ 查看引用卡片] [→ 跳转到来源]         ← 引用可回跳（AIPM 00 §5 第 8 条）
2.3s · tokens 156                      ← latency_ms / tokens
```

**快捷 chips**：空对话时显示 5 条原型里的示例问句，点击即填入输入框：
「@AI 建一个 SSO 登录任务」/「本周所有 P0 顺延到下周一」/「「预付款模块」还能按期完成吗？」/
「识别「财务对账系统」的潜在风险」/「总结本周项目亮点与风险」。

### 3.4 命令卡片（`CommandCard`）

| 部位 | 内容 | 来源 |
|---|---|---|
| 头 | `⌨` + 命令名（等宽、`colorPurple`）+ 右侧状态标签 | `tool_call` / `tool_result` |
| 体 | 自然语言摘要（模型写的） | `tool_result.summary` |
| 底 | `↩ 撤销`（仅当 `auditId` 存在且未撤销）/ `查看待确认 →`（仅当有 pending action） | — |

**状态标签的四种取值**（对应 AIPM 03 §4 的事件）：

| 标签 | 触发 | antd |
|---|---|---|
| 只读 | 只读命令的 `tool_result` | `Tag color="default"` |
| 已执行 | 写命令执行成功 | `Tag color="success"` |
| 待确认 | 产生了 `action_request` | `Tag color="warning"` |
| 失败 | `tool_result.status = error` | `Tag color="error"` |

> **状态由事件驱动，不由前端推断。** 前端不做任何「这条命令是不是危险」的判断 ——
> 那是命令层的事（AIPM 04 §3）。

### 3.5 待确认页签（F1 的核心）

**卡片结构**（照原型）：

```
┌─────────────────────────────────────┐
│ ⌨ batch_update_tasks      [待确认]   │  ← 头部
├─────────────────────────────────────┤
│ 把 3 个 P0 任务的截止日顺延到下周一   │  ← 标题
│ 来自：用户「本周所有 P0 顺延到下周一」 │  ← reason
│ ┌─────────────────────────────────┐ │
│ │ ↳ 预付款模块对接   ~~07-01~~ → 07-13 │ │  ← 命中清单
│ │ ↳ 对账规则重构     ~~07-04~~ → 07-13 │ │
│ └─────────────────────────────────┘ │
│ ⚠ 顺延后仍无法解锁关键路径            │  ← Alert warning（规则算的）
├─────────────────────────────────────┤
│ [确认执行] [取消]        [调整范围] 13:42 过期 │
└─────────────────────────────────────┘
```

- **命中清单**：每行 `↳ 实体标题` + `~~原值~~`（`colorTextSecondary` + 删除线）+
  `→` + **新值**（`font-medium`）。原型的表格形态在 400px 宽的侧栏里太挤，
  改成**逐行式**（原型 `partials.js` 里本来就是逐行式，全宽页才是表格）。
- **警告条**：`Alert type="warning"`，内容是**规则算出来的**（AIPM 04 §4「预览里的警告由规则算，
  不是模型编的」）。前端只渲染，不生成。
- **过期时间**：相对时间（`dayjs` 的 `fromNow`），≤ 5 分钟时标红。
- **三个按钮**：
  - `确认执行` → `action_response{decision:'confirm'}` → **工具原地恢复**（AIPM 03 §5）
  - `取消` → `action_response{decision:'reject'}`
  - `调整范围` → 打开 `Drawer`，改参数 → 重新预览 → 新 actionId（AIPM 03 §2.3）
- **空态**：「没有待确认的操作 / 批量与破坏性操作会先在这里等你点头」。

### 3.6 审计页签

**列表条目**（照原型）：

```
●  已把 3 个 P0 任务的截止日顺延到 07-13
   batch_update_tasks · AI 助理 · 2 分钟前            [↩]
```

- 圆点：`actor_type === 'AI'` → `colorPurple`；`USER` → `colorPrimary`。
- 「撤销」按钮**只在 `undone_at` 为空且该命令可补偿时出现**；否则显示「只读」。
- **脚注保留**（原型有，且是重要的语义说明）：
  > 审计记录 append-only：撤销是新增一条指向原记录的日志，不修改原记录。

### 3.7 前端消费 AI 服务的方式

**契约**（前端视角，AI 服务提供；**路径相对 `AI_API_BASE_URL`**，
AI 服务内部用 Next.js 的 `/api` 前缀）：

```
POST /api/agent/conversations                            → { conversationId, title, createdAt }
GET  /api/agent/conversations?limit=50                    → [{ conversationId, title, updatedAt }]
POST /api/agent/:conversationId/command                   { id, type, ... }  → { id, type:'response', success, data }
GET  /api/agent/:conversationId/events                    → SSE
GET  /api/agent/:conversationId/state                     → { conversation, messages, pendingActions, isStreaming, model, thinkingLevel }
GET  /api/pending?status=PENDING                          → 待确认列表
POST /api/pending/:id/adjust   { args }                   → 重新预览
POST /api/audit/:id/undo                                    → 撤销
GET  /api/audit?actor=&command=&from=&to=&undone=         → 审计列表
```

> 最终 URL = `${AI_API_BASE_URL}/api/...`。**前端不要自己拼 `/ai-api` 前缀**。

> **契约里的三个空缺**（本次补上）：
> 1. `POST/GET /agent/conversations` —— 会话的新建与列表（§3.8）。
> 2. `auth_expired` SSE 事件 —— token 过期时的通知（§3.10）。
> 3. 事件序号 —— 用于丢帧检测（§3.9）。

**SSE 事件 → 前端状态机**（AIPM 03 §4 的事件表）：

| 事件 | 前端动作 |
|---|---|
| `connected` | 建连；按 `pendingActionIds` 恢复待确认卡片；恢复 `isStreaming` |
| `message_start` | 在对话区追加一个助手气泡（空） |
| `text_delta` | 往当前气泡追加文本 |
| `thinking_delta` | 气泡上方显示「正在思考」（可折叠） |
| `message_end` | 气泡收尾 |
| `tool_call` | 追加一张 `CommandCard`（骨架态：只读标签 + 加载中） |
| `tool_result` | 更新那张卡片（状态标签 + 摘要 + 撤销按钮） |
| `action_request` | 追加一张待确认卡片；**页签徽标 +1** |
| `action_resolved` | 该卡片标记为已执行/已拒绝，从待确认列表移除；徽标 -1 |
| `state_dirty` | 提示主内容区刷新（`ProTable` 的 `actionRef.reload()`） |
| `agent_settled` | 本轮结束，解除输入禁用 |
| `heartbeat` | 保活，**不改 UI** |

**丢帧后的重建**（AIPM 03 §4「快照是最终真相」）：

- 前端记录每个 SSE 事件的序号；检测到序号跳变 ⇒ 调 `GET /state` 拉全量快照**重建**对话与待确认。
- 不做增量补偿 —— 快照重建更简单也更可靠。

### 3.8 会话生命周期

**契约补充**（前端要用，AI 服务要提供）：

```
POST /api/agent/conversations          → { conversationId, title, createdAt }   新建会话
GET  /api/agent/conversations?limit=50  → [{ conversationId, title, updatedAt }]  当前用户的会话列表
```

> 路径**相对 `AI_API_BASE_URL`**。开发期 `AI_API_BASE_URL=/ai-api`（走 `config/proxy.ts`
> 的转发，`pathRewrite` 去掉前缀），生产期是绝对地址（如 `https://ai.example.com`）。
> **追加的路径永远是 `/api/...`**，两边一致。

- 「新对话」→ `POST /conversations` 拿到 id，再切换。
- 「历史对话」→ `GET /conversations` 列表，v1 **只列当前用户自己的**。
- 前端持久化 `conversationId` 到 `localStorage`；刷新后用它拉 `GET /state` 恢复。
- 失效（服务端已删/过期）→ 降级为自动新建一个。

### 3.9 SSE 的鉴权与传输

**裁决：用 `fetch` + `ReadableStream` 手写 SSE 解析，不用原生 `EventSource`。**

| 方案 | 取舍 |
|---|---|
| **`fetch` + 手写 SSE 解析**（选） | 能带 `Authorization` 头 ⇒ 沿用现有的 Bearer token 机制；可控重连与丢帧检测。代价：自己写解析与重连（约 100 行），或用 `@microsoft/fetch-event-source` |
| 原生 `EventSource` | ❌ **不能带自定义头** ⇒ 鉴权无解 |
| token 走 query param | ❌ JWT 会进 nginx access log，违反合并设计 §6.4「token 不进日志」 |

⇒ 前端 `services/api/ai/sse.ts` 用 `fetch` + `ReadableStream`，按 `text/event-stream`
的格式拆帧（`data:` 行累积到空行则为一个事件），并在 `AbortController` 里断开。

> **URL 形态（已裁决）**：AI 服务**单独部署**，与前端**不同源** ⇒
> 前端用**绝对 URL**（构建期常量 `AI_API_BASE_URL`，读 `process.env.AI_API_BASE_URL`，
> 默认 `http://127.0.0.1:3100`），**跨域 + CORS**。
> 开发期在 `config/proxy.ts` 加一条转发：
> `'/ai-api/'` → `http://127.0.0.1:3100`，并用 `pathRewrite: { '^/ai-api': '' }` 去掉前缀，
> 于是浏览器请求 `/ai-api/api/agent/x` → AI 服务收到 `/api/agent/x`。
> 开发期 `AI_API_BASE_URL` 就是 `/ai-api`（相对），浏览器看到的是同源请求。
> CORS 要求（AI 服务侧）：处理 `OPTIONS` 预检；回
> `Access-Control-Allow-Origin: <具体前端源>`（**不能用 `*`**）与
> `Access-Control-Allow-Headers: authorization, content-type`；
> 预检缓存不超过 5 分钟（否则换 token 会失败）。

**丢帧检测**：每个事件带自增序号；序号跳变 ⇒ 调 `GET /state` 拉快照**重建**（AIPM 03 §4
「快照是最终真相」）。不做增量补偿。

### 3.10 三种降级态

| 情况 | 表现 |
|---|---|
| AI 服务不可达 | 侧栏头部显示 `Tag color="error"`「AI 服务不可用」；对话区显示 `Alert`「AI 暂不可用，请手动操作」；**PM 页面与系统管理页面完全不受影响**（AIPM 00 §5 第 6 条） |
| CORS 被拒 / 预检失败 | 与「服务不可达」同处理，但提示文案要能区分（浏览器控制台才能看到真因 ⇒ 前端给出「请检查 AI 服务地址与 CORS 配置」的技术提示） |
| 401（用户的 AiAdmin token 过期） | AI 服务回 `auth_expired` 事件 ⇒ 前端走**现有的**静默刷新流程（`src/auth/session.ts`）⇒ 刷新成功后重连 SSE 并重发原命令；刷新失败则清登录态回登录页。**该 SSE 事件必须由 AI 服务发出**（AIPM 03 的事件表里没有，要补） |
| 模型不可用（`AI_UNAVAILABLE`） | `tool_result` 为失败，助手气泡里说明原因；**不重试写操作**（AIPM 03 §7） |

> **AI 挂了系统不瘫**这条反目标，在界面上的体现就是：**AI 侧栏的任何错误都不允许影响主内容区**。
> 实现约束：SSE 连接与命令发送的所有异常都**在 `AiWorkspace` 内部消化**，
> 不往上抛到 `childrenRender`。

---

## 4. AI 工作台全宽页（F2）

路由 `/ai/workspace`。这是原型的 `ai-assistant.html` 的落法 —— 侧栏 400px 装不下这些内容。

### 4.1 页面结构

```
┌──────────────────────────────────────────────────────────────┐
│ AI 工作台  [对话·待确认·审计]              [历史对话][配额][新对话] │
│ 由 MiniMax 驱动 · 命令层受控写入 · 实时引用                      │
├──────────────────────────────────────────────────────────────┤
│ 当前模型：[MiniMax-M3.1-Flash ▾]      今日配额 ▓▓▓░░ 350/1000   │
├──────────────────────────────────────────────────────────────┤
│ 工作台视图                                                     │
│ ┌ 待确认队列 ③ │ 审计日志 │ 规则与 AI 的分工 ┐                  │
│ │ ...（比侧栏更宽的表格形态）                │                   │
│ └────────────────────────────────────────────┘                  │
├──────────────────────────────────────────────────────────────┤
│ 10 类意图（点击即可体验）                                       │
│ [进度查询][Owner 查询][风险查询][负载查询][依赖查询]              │
│ [历史相似][总结查询][SLA 查询][文档查询][建议查询]                │
├──────────────────────────────────────────────────────────────┤
│ 对话演示（宽版）                                                │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 「规则与 AI 的分工」双栏（原型最有价值的一块，保留）

| 左栏（`colorSuccess` 底）规则引擎 | 右栏（`colorPurple` 底）LLM |
|---|---|
| 里程碑健康度（进度/速度比/阻塞时长 → 有风险、已错过） | 自然语言 → 命令参数抽取 |
| 进度三口径（任务完成率/估时完成率/里程碑达成率） | 把规则算出的结论写成人类可读的说明 |
| 风险 score = 概率 × 影响，等级四级映射 | 建议下一步动作（拆任务/排期/指派） |
| 5 类风险自动识别（延期/阻塞/过载/流失/范围蔓延） | 纪要与评论的结构化摘要 |
| ETA 预测（burndown 外推；**CPM 关键路径因缺依赖图不可用，v1 无 P50/P90**） | |
| 相对日期解析（周起点、时区、闭区间） | |

底部 `Alert type="warning"`：

> **边界**：LLM 不能写库、不能定权限、不能自己决定「要不要人确认」。
> 破坏性操作一律先进待确认队列；所有写操作留审计且可撤销。

> **注意**：左栏 ETA 那条要按**已核实的实情**改写 —— 后端没有依赖图接口，
> CPM 关键路径**不可用**，ETA 实际只有 burndown（无 P50/P90）。
> 页面不能承诺它给不出来的东西。

### 4.3 模型与配额

> **裁决（v1）**：**不做模型切换下拉，不做配额进度条。**
>
> 理由：契约里没有模型列表端点，也没有配额的数据源（`GET /state` 不含配额，
> `ai_*` 表也没有）。**做一条假数字的进度条就是 mock**，违反本项目无 mock 的底线。
>
> v1 的做法：
> - 只**显示**当前模型 —— 数据来自 `GET /api/agent/:cid/state` 的 `model` 字段（契约已有）。
> - 「配额」按钮 **v1 不做**（没有数据源就不画）。
> - 换模型是 AI 服务侧的配置（环境变量 `AI_MODEL`），不在前端切。
>
> 若以后要做，契约需补 `GET /api/agent/models` 与 `GET /api/agent/quota`，
> 且配额必须在**服务端**计量并强制（前端禁用输入框只是 UX，不能当配额控制）。

---

## 5. PM 五个页面

**统一范式**（照 `src/pages/module_system/*`，不发明新东西）：

- `ProTable` + `ModalForm` + `src/components/CrudTable/` 的 `useCrudTable` / `useCrudColumns`。
- 列的校验用 `formItemProps.rules`，且**规则必须逐条对后端 schema**（v0.2.0 那轮的教训）。
- 状态/类型/分类列用**字典驱动**：`ProFormSelect` 的选项来自字典接口
  （`/system/dict/data/list?dict_type=module_pm_task_status`），
  标签颜色用字典项的 `list_class`。
- 操作列用 `src/components/AntdOperationColumn/`。
- 权限码按后端约定：`module_pm_<实体>:<动作>`。

### 5.1 F3 项目管理

**列表页 `/pm/project`**

| 列 | 来源 | 备注 |
|---|---|---|
| 项目编码 | `code` | 唯一，`^[A-Z0-9_-]{2,32}$` |
| 项目名称 | `name` | |
| 状态 | `status_code` | 字典 `module_pm_project_status`，6 态 |
| 优先级 | `priority_code` | 字典 `module_pm_priority`（P0–P3） |
| 负责人 | `owner_id` → `owner_by.name` | |
| 计划区间 | `start_date` ~ `due_date` | |
| 标签 | `tags` | JSON 数组字符串，渲染成 `Tag` 串 |
| 创建时间 | `created_at` | |

**搜索项**：`name` / `code` / `status_code` / `priority_code` / `owner_id`。

**详情页 `/pm/project/:id`** —— 6 个 Tab（照原型）：

| Tab | 内容 | 数据源 |
|---|---|---|
| 概览 | 元信息 + 里程碑摘要 + 任务摘要 + 风险摘要 | `/pm_project/detail/:id` + 三个 list（带 `project_id` 过滤） |
| 里程碑 | 里程碑卡片列表 + 进度条 | `progress`（后端已缓存的派生字段） |
| 任务 | 任务表格（精简列） | `/pm_task/list?project_id=` |
| 风险 | 风险卡片 + 等级 | `/pm_risk/list?project_id=` |
| 成员 | 项目成员 | `/pm_project/members/:id` |
| 评论 | **v1 不做** | — |

**里程碑卡片**：名称 + 状态标签 + `progress` 进度条 + 计划区间 + 实际区间。
> 里程碑的健康度用后端的 `health_score`（0–100，字段已在 schema 里），
> **不在前端重算** —— 规则的归规则引擎管（AIPM 02 §3「派生状态只读不回写外部」的反面：
> 这里是后端算，前端只显示）。

### 5.2 F4 里程碑管理

`/pm/milestone` —— **竖排时间线**，不做甘特。

| 列 | 备注 |
|---|---|
| 里程碑名称 / 所属项目 | `project_by.name` |
| 状态 | 字典 `module_pm_milestone_status`：`upcoming`/`in_progress`/`at_risk`/`done`/`missed`（**5 态，后端没有 `cancelled`**） |
| 进度 | `progress` 0–100，进度条 |
| 健康度 | `health_score` 0–100 |
| 计划区间 / 实际区间 | |
| 排序 | `sort_order` |

**表单字段**：`project_id`（必填，`ProFormSelect` 远程搜项目）、`name`（必填）、
`description`、`start_date`（必填）、`due_date`（必填）、`status_code`（字典）、
`deliverables`（JSON 对象，用 `ProFormTextArea` + JSON 校验）、`sort_order`（数字）。

> **⚠️ 状态门控**：`at_risk` / `missed` 只能由规则引擎写入（AIPM 02 §4.5 INV-13）。
> ⇒ 表单里**不提供**这两个选项；列表里如果读到它们，显示为 `Tag color="error"` +
> Tooltip「由规则引擎判定，不可手工设置」。

### 5.3 F5 任务

**列表页 `/pm/task`**

| 列 | 备注 |
|---|---|
| 标题 | `title` |
| 所属项目 / 所属里程碑 | `project_id` / `milestone_id` —— ⚠️ 响应**没有** `project_by`/`milestone_by` ⇒ **侧载项目/里程碑列表在户端映射成名字** |
| 状态 | 字典 `module_pm_task_status`（7 态） |
| 优先级 | P0–P3 |
| 类型 | 字典 `module_pm_task_type`（feature/bug/ops/research/spike） |
| 负责人 / 报告人 | `assignee_by.name` / `reporter_by.name` |
| 计划起止 | `start_date` ~ `due_date` |
| 实际起止 | `actual_start_date` ~ `actual_end_date` |
| 估时 / 实际工时 | `estimate_hours` / `actual_hours`（Decimal） |
| 排序 / 阻塞原因 | `sort_order` / `blocked_reason` |
| 创建方式 | `created_via_code`（manual/nl_chat/import/api） |

**搜索项**：`title` / `status_code` / `priority_code` / `type_code` / `assignee_id` / `project_id`。

**看板页 `/pm/task/board`** —— **6 列**（裁决：已取消的任务**不进看板**）：

| 列 | 状态 |
|---|---|
| 待规划 | `backlog` |
| 待办 | `todo` |
| 进行中 | `in_progress` |
| 阻塞 | `blocked` |
| 评审 | `review` |
| 已完成 | `done` |

> **裁决**：看板是「当前工作」视图，`cancelled` 的任务已经退出工作流，不占看板列。
> 拖到第 6 列 = `done`；要取消任务走列表页的编辑弹窗。

- 卡片：标题 + 优先级标签 + 负责人 `Avatar` + 估时 + 截止日（逾期标红）。
- **拖拽改状态**：后端的任务更新是**整对象 PUT**（`ModulePmTaskUpdateSchema` 继承
  CreateSchema，全部必填）⇒ 拖拽要拼出**全部必填字段**。
  > **实施时修订（Task 6/7 的复审裁决）**：**不额外 GET 详情** —— 列表/看板返回的
  > `ModulePmTaskOutSchema` 继承创建 schema，**行/卡片本身就带齐了 PUT 需要的字段**。
  > 少一次请求，也少一个 `…:detail` 权限依赖。
  > `reporter_id` / `sort_order` / `created_via_code` 三列是后端 NOT NULL 且**不可由人填**，
  > 拖拽的 PUT **不提交**它们（后端 `exclude_unset` ⇒ 原值保留）。
  > 这条在 v0.2.0 的工单页已经踩过类似的坑（创建/更新入参要对齐后端的两个 schema）。
- **拖拽是否需要确认？** 人工操作**不走 AI 的确认门槛**（那是 AI 命令的规则）。
  拖拽改状态是人工直接操作，但**必须写审计**（AIPM 00 §5 第 7 条「人工与 AI 同路径」）。

> **v1 的裁决**：看板拖拽**只改 `status_code`**（一个维度），不拖到别的里程碑/负责人。
> 理由：跨列拖拽 = 整对象 PUT 的一次回环，且失败要回滚卡片位置，复杂度高。
> 其余维度的修改走列表页的编辑弹窗。

### 5.4 F6 风险登记册

`/pm/risk`

| 列 | 备注 |
|---|---|
| 风险标题 / 所属项目 | |
| 分类 | 字典 `module_pm_risk_category`（schedule/scope/quality/resource/compliance） |
| 概率 / 影响 | 1–5 |
| 分数 | `score` = 概率 × 影响 —— ⚠️ **后端不计算**（`score` 是必填字段，`create_service` 透传）⇒ **表单实时算并一起提交** |
| **等级** | **前端按矩阵算**（后端没有 `level` 字段） |
| 状态 | 字典 `module_pm_risk_status`（identified/analyzing/mitigating/realized/closed） |
| 负责人 / 缓解措施截止 | `owner_id` / `due_date` |

**等级矩阵**（AIPM 02 §5.3，**前端算，因为后端没有 `level` 字段**）：

| score | 等级 | 颜色 |
|---|---|---|
| ≥ 16 | 严重 | `colorError` |
| 9–15 | 高 | `colorWarning` |
| 4–8 | 中 | `colorPrimary` |
| < 4 | 低 | `colorTextSecondary` |

> 这条要在代码注释里写清楚：**`level` 是派生量，不是后端字段**。
> 矩阵阈值要提到一个共享常量里（`src/components/pm/riskLevel.ts`），
> AI 服务侧的规则引擎也用同一套阈值 —— 两边不一致会出笑话。

**5×5 热力图**：以「概率」为纵、「影响」为横的网格，每格显示落入该格的**风险数**，
颜色按该格最高 score 的等级。点格子 → 过滤下面的列表。**v1 只读，不做拖拽建风险。**

**表单字段**：`project_id`（必填）、`title`（必填）、`description`、`category_code`（必填，字典）、
`probability`（必填，1–5）、`impact`（必填，1–5）、**`score`（必填，前端算 = 概率 × 影响）**、
`status_code`（字典，必填）、`owner_id`（必填 —— 后端 schema 里 `owner_id: int` 非可空）、
`mitigation_plan`、`contingency_plan`、`due_date`、`trigger_date`、
`created_via_code`（必填；**新增**固定传 `manual`，**编辑原样回传行里的值** ——
后端 `ModulePmRiskUpdateSchema` 继承 CreateSchema，这一列必填，不带就 422）。

> `ai_suggestion` **不在表单里**（那是 AI 写路径的字段）。
> `score` 与 `created_via_code` 是后端必填但用户不该看见的字段 ——
> 前端算好/填好再提交，**不要露在界面上**。

---

## 6. 路由、菜单与权限

### 6.1 路由

```
/pm/project        项目管理
/pm/project/:id    项目详情
/pm/milestone      里程碑管理
/pm/task           任务列表
/pm/task/board     任务看板
/pm/risk           风险登记册
/ai/workspace      AI 工作台（全宽页）
```

路由注册在 `config/routes.ts`；菜单由**后端下发**（AIPM 沿用合并设计的「后端决定显示什么，
前端决定能不能点开」）。

### 6.2 后端要补的菜单种子（合并设计 §6.3 的 B1）

前端要落地这些路由，后端就得下发对应的菜单节点。

> **⚠️ B1 的归属已裁决：由后端写。** PM 菜单种子是后端 SQL，不是前端工作线的交付物。
> 但它是 F3–F6 的**前置依赖** —— 没有种子，这 5 个页面永远不会被菜单下发。
> ⇒ 实施计划里要把它列为**外部依赖**并跟踪，不能默认它会自己来。
>
> **⚠️ 权限码的拼写必须以后端 controller 里实际写的为准。** 已核实：
>
> | 实体 | 实际权限码 |
> |---|---|
> | 项目 | `module_pm_project:pm_project:{query,detail,create,update,delete,patch,export,import,download,transition,member:write}` |
> | 里程碑 | `module_pm_project:pm_milestone:{query,detail,create,update,delete,patch,export,import,download}` |
> | 任务 | `module_pm_project:pm_task:{query,detail,create,update,delete,patch,export,import,download}` |
> | 风险 | `module_pm_risk:pm_risk:{query,detail,create,update,delete,patch,export,import,download}` |
>
> ⇒ 形式是**三段式** `module_pm_<插件模块>:<子模块>:<动作>`，
> **不是** `module_pm_task:list` 那种两段式。
> 前端 `useAccess().hasPermission()` 必须用上表的**完整字符串**。
>
> ⚠️ 另注：**列表权限码是 `query`，不是 `list`**（工单那个 `module_system:ticket:list`
> 是后端的另一个特例）。

### 6.3 前端侧的门控

- 菜单项：后端下发 ⇒ 自动有权限。
- 页面内的按钮：用 `useAccess().hasPermission(code)`，与现有 9 个模块一致。
- AI 工作台侧栏的**写入类命令**：不由前端按钮控制 —— 由**命令层的确认门槛**控制
  （AIPM 04 §3）。前端**不预判**某条命令要不要确认。

---

## 7. 前端工程清单

### 7.1 新增目录

```
src/
  components/ai-workspace/
    index.tsx            工作台容器（Sider 内容 + Tabs + 底部输入区）
    ChatPanel.tsx        对话页签
    MessageBubble.tsx    助手/用户气泡
    CommandCard.tsx      命令卡片
    PendingPanel.tsx     待确认页签
    PendingCard.tsx      待确认卡片
    HitList.tsx          命中清单（原值 → 新值）
    AuditPanel.tsx       审计页签
    Composer.tsx         输入区
    WorkspaceRules.tsx   「规则与 AI 的分工」双栏
    IntentGallery.tsx    10 类意图卡片
    useWorkspace.ts      折叠/页签/会话状态（localStorage）
    useAgentStream.ts    SSE 订阅 + 事件 → UI 状态机
    types.ts             SSE 事件 / 命令卡片 / 待确认 的 TS 类型
  pages/
    ai/workspace/index.tsx        AI 工作台全宽页
    module_pm/
      project/index.tsx  detail.tsx
      milestone/index.tsx
      task/index.tsx  board.tsx
      risk/index.tsx  Heatmap.tsx
  components/pm/                 ← PM 页面共用的件
    DictSelect.tsx               ← 字典驱动的下拉(选项值用 dict_value)
    DictTag.tsx                  ← 字典驱动的状态标签(颜色用 list_class)
    useDictOptions.ts            ← 字典选项的 hook
    riskLevel.ts                 ← 风险等级矩阵(派生量;后端只有 score)
  services/api/ai/
    client.ts            命令协议 + REST
    sse.ts               SSE 连接与重连
    types.ts
  services/api/pm/
    project.ts  milestone.ts  task.ts  risk.ts
```

### 7.2 复用的现成件（不重造）

| 件 | 位置 |
|---|---|
| `useCrudTable` / `useCrudColumns` / `useDeleteHandler` / `CRUD_PAGINATION` | `src/components/CrudTable/` |
| `ProColumns → antd` 列适配 | `src/components/AntdOperationColumn/` |
| 远程搜索下拉（负责人/项目） | `src/components/TagSelect/` 或 `ProFormSelect` 的 `fieldProps` |
| 请求层 / 业务码 / BizError / 401 刷新 | `src/requestErrorConfig.ts`、`src/services/response.ts` |
| 权限判定 | `src/access.ts` |
| 字典取选项 | `src/services/api/system/dict.ts`（已有 `getDictDataOptions` 一类函数则直接用） |

### 7.3 新的 service 层

`src/services/api/pm/*.ts` 的形状照 `src/services/api/system/*.ts`：

- 每个模块一份，导出出入参类型 + 请求函数。
- **类型逐字对齐后端 schema**（`ModulePmTaskCreateSchema` 等），不发明中间类型。
- 注释里写清后端的坑（本轮已核实的）：
  - 任务更新是**整对象 PUT**，全部字段必填 ⇒ 部分更新要读-改-写。
  - 删除请求体是**裸数组** `[1,2]`。
  - 批量只有 `POST /pm_task/status/batch`（指定 ID + 同一状态）。
  - `tags` / `labels` / `reviewers` 是**字符串**（JSON 或 ID 列表），不是数组。
  - `deliverables` 是 **dict**（不是数组）。

---

## 8. 验收标准（界面层）

| # | 标准 | 怎么验 |
|---|---|---|
| U1 | 工作台常驻右侧，⌘B 折叠成 40px 竖条，**主内容跟着收窄** | 手动 + e2e |
| U2 | 折叠状态与页签在刷新后保持 | e2e |
| U3 | 三页签各自的内容与原型一致（对话/待确认/审计） | 原型对照 |
| U4 | 待确认卡片显示命中清单与规则警告；确认/取消/调整范围三个动作都能走通 | e2e |
| U5 | 审计条目可撤销；撤销后按钮消失并显示「已撤销」 | e2e |
| U6 | AI 服务不可达时，侧栏显示降级提示，**PM 页面与系统管理页面完全正常** | e2e + 手动 |
| U7 | 5 个 PM 页面字段与后端 schema 一致（逐条核对） | 契约测试 |
| U8 | 状态/类型/分类标签**字典驱动**（改字典颜色，页面跟着变） | 手动 |
| U8.1 | 里程碑状态只有 5 个（`upcoming`/`in_progress`/`at_risk`/`done`/`missed`） | 单测 |
| U9 | 风险等级按矩阵算，且与 AI 服务侧的阈值一致 | 单测（两侧同一份常量或同一份契约） |
| U9.1 | 风险表单提交体里的 `score` = 概率 × 影响（后端不计算，必填） | e2e 钉死提交体 |
| U9.2 | 风险表单提交 `created_via_code: 'manual'`、`owner_id`、`status_code`（后端必填） | e2e 钉死提交体 |
| U10 | 里程碑表单里**没有** `at_risk` / `missed` 选项 | 单测 |
| U11 | 看板拖拽改状态走整对象 PUT（用卡片自带字段拼，不发详情请求），且失败时卡片**回滚原位** | e2e |
| U11.1 | 看板 6 列，`cancelled` 不在看板；拖到第 6 列写 `done` | e2e |
| U12 | 现有 279 单测 + 80 e2e **零回归** | 门禁 |

---

## 9. 与合并设计的衔接

| 合并设计里的 | 本设计里 |
|---|---|
| §6.5「PM 页面照 module_system 范式」 | §5 逐页展开 |
| §6.5「AI 工作台 = 右侧常驻栏，三页签」 | §3 逐项展开 + §4 全宽页 |
| §6.5「原型只作布局参考，不引入 Tailwind/shadcn」 | §2 设计语言 + §1.3 差异总表 |
| §9.1.1 能力位实测（无依赖图、批量受限） | §5.3 看板拖拽的裁决 + §4.2 的文案修正 |
| §6.4 用户身份透传 | §3.10 的 401 降级 |
| §5.4 部署形态（异源 + CORS） | §3.9 的绝对 URL + CORS 要求 |
| §6.3 B1（补菜单种子，**后端负责**） | §6.2 列出前端需要的菜单与权限码 |

### 9.1 已裁决的待决点（2026-11-03）

| 问题 | 裁决 | 对本设计的影响 |
|---|---|---|
| 生产部署形态 | **AI 服务单独部署，异源** | §3.9：绝对 URL + CORS；`config/proxy.ts` 加开发期转发 |
| 是否多租户 | **先不用**（单租户） | §5 五个页面**不做租户 UI**、不加租户筛选 |
| CPM 降级 vs B3 | **按建议：接受降级，不动后端** | §4.2 的 ETA 文案**不得**提 P50/P90；§5.3 看板已按无依赖图设计 |
| B1 菜单种子归属 | **后端写** | §6.2：列为外部依赖，需跟踪 |

---

## 10. 下一步

1. 本文档经所有者批准。
2. 跑 `writing-plans`，按 F1–F6 拆实施计划（依赖顺序：F1/F2 依赖 AI 服务的 SSE；
   F3–F6 依赖后端菜单种子 B1）。
3. 实施时 §8 的 U1–U12 逐条验。
