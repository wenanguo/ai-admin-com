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

**契约**（前端视角，AI 服务提供）：

```
POST /ai-api/agent/:conversationId/command   { id, type, ... }  → { id, type:'response', success, data }
GET  /ai-api/agent/:conversationId/events                          → SSE
GET  /ai-api/agent/:conversationId/state                           → { conversation, messages, pendingActions, isStreaming, model, thinkingLevel }
GET  /ai-api/pending?status=PENDING                                → 待确认列表
POST /ai-api/pending/:id/adjust   { args }                         → 重新预览
POST /ai-api/audit/:id/undo                                          → 撤销
GET  /ai-api/audit?actor=&command=&from=&to=&undone=               → 审计列表
```

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

### 3.8 三种降级态

| 情况 | 表现 |
|---|---|
| AI 服务不可达 | 侧栏头部显示 `Tag color="error"`「AI 服务不可用」；对话区显示 `Alert`「AI 暂不可用，请手动操作」；**PM 页面与系统管理页面完全不受影响**（AIPM 00 §5 第 6 条） |
| 401（用户的 AiAdmin token 过期） | 走**现有的**静默刷新流程（`src/auth/session.ts`）；刷新成功后重发原命令；失败则清登录态回登录页 |
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
| ETA 预测（burndown 外推 + CPM 关键路径 → P50/P90） | |
| 相对日期解析（周起点、时区、闭区间） | |

底部 `Alert type="warning"`：

> **边界**：LLM 不能写库、不能定权限、不能自己决定「要不要人确认」。
> 破坏性操作一律先进待确认队列；所有写操作留审计且可撤销。

> **注意**：左栏 ETA 那条要按**已核实的实情**改写 —— 后端没有依赖图接口，
> CPM 关键路径**不可用**，ETA 实际只有 burndown（无 P50/P90）。
> 页面不能承诺它给不出来的东西。

### 4.3 模型选择与配额

- 模型下拉：`MiniMax-M3.1-Flash`（默认/快）· `MiniMax-M3`（复杂任务）· `MiniMax-M2.7-highspeed`（成本优先）。
- **模型可配**：下拉的选项来自 AI 服务（`GET /ai-api/agent/models`），不是前端硬编码。
- 配额进度条：`Progress`；超配额时输入框禁用并提示。

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
| 状态 | 字典 `module_pm_milestone_status`：`upcoming`/`in_progress`/`at_risk`/`done`/`missed`/`cancelled` |
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
| 标题 / 所属项目 / 所属里程碑 | `project_id` / `milestone_id` |
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

**看板页 `/pm/task/board`** —— 6 列：

| 列 | 状态 |
|---|---|
| 待规划 | `backlog` |
| 待办 | `todo` |
| 进行中 | `in_progress` |
| 阻塞 | `blocked` |
| 评审 | `review` |
| 已完成 / 已取消 | `done` / `cancelled` |

- 卡片：标题 + 优先级标签 + 负责人 `Avatar` + 估时 + 截止日（逾期标红）。
- **拖拽改状态**：后端的任务更新是**整对象 PUT**（`ModulePmTaskUpdateSchema` 继承
  CreateSchema，全部必填）⇒ 拖拽必须**先 GET 再合并再 PUT**，不能只传 status。
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
| 分数 | `score` = 概率 × 影响（后端算） |
| **等级** | **前端按矩阵算**（见下） |
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
> 矩阵阈值要提到一个共享常量里（`src/pages/module_pm/risk/level.ts`），
> AI 服务侧的规则引擎也用同一套阈值 —— 两边不一致会出笑话。

**5×5 热力图**：以「概率」为纵、「影响」为横的网格，每格显示落入该格的**风险数**，
颜色按该格最高 score 的等级。点格子 → 过滤下面的列表。**v1 只读，不做拖拽建风险。**

**表单字段**：`project_id`（必填）、`title`（必填）、`description`、`category_code`（必填，字典）、
`probability`（必填，1–5）、`impact`（必填，1–5）、`status_code`（字典）、`owner_id`、
`mitigation_plan`、`contingency_plan`、`due_date`、`trigger_date`。

> `score` **不在表单里**（后端算）；`created_via_code` 与 `ai_suggestion` 也不在表单里
> （那是 AI 写路径的字段）。

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

前端要落地这些路由，后端就得下发对应的菜单节点。需要的菜单与权限码：

| 菜单 | 路径 | 按钮权限码 |
|---|---|---|
| 项目管理 | `/pm/project` | `module_pm_project:{list,query,detail,create,update,delete,patch,export}` |
| 里程碑管理 | `/pm/milestone` | `module_pm_milestone:{...}` |
| 任务管理 | `/pm/task` | `module_pm_task:{...}` |
| 风险登记 | `/pm/risk` | `module_pm_risk:{...}` |
| AI 工作台 | `/ai/workspace` | `module_ai_workspace:use` |

> **权限码的实际值必须以后端种子为准**。上表是按现有命名规律推的，
> 实现前要先读后端的 `AuthPermission` 依赖里到底写的什么。

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
      risk/index.tsx  level.ts
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
| U9 | 风险等级按矩阵算，且与 AI 服务侧的阈值一致 | 单测（两侧同一份常量或同一份契约） |
| U10 | 里程碑表单里**没有** `at_risk` / `missed` 选项 | 单测 |
| U11 | 看板拖拽改状态走整对象 PUT，且失败时卡片**回滚原位** | e2e |
| U12 | 现有 279 单测 + 80 e2e **零回归** | 门禁 |

---

## 9. 与合并设计的衔接

| 合并设计里的 | 本设计里 |
|---|---|
| §6.5「PM 页面照 module_system 范式」 | §5 逐页展开 |
| §6.5「AI 工作台 = 右侧常驻栏，三页签」 | §3 逐项展开 + §4 全宽页 |
| §6.5「原型只作布局参考，不引入 Tailwind/shadcn」 | §2 设计语言 + §1.3 差异总表 |
| §9.1.1 能力位实测（无依赖图、批量受限） | §5.3 看板拖拽的裁决 + §4.2 的文案修正 |
| §6.4 用户身份透传 | §3.8 的 401 降级 |
| §6.3 B1（补菜单种子） | §6.2 列出前端需要的菜单与权限码 |

**仍然悬着、影响本设计的三个待决点**（合并设计 §1 末尾已列，此处不重复）：
生产部署形态 / CPM 降级与否 / 是否多租户。
其中「是否多租户」会改 §5 所有页面的数据作用域；「生产部署形态」会改 §3.7 的 SSE 连接方式。

---

## 10. 下一步

1. 本文档经所有者批准。
2. 跑 `writing-plans`，按 F1–F6 拆实施计划（依赖顺序：F1/F2 依赖 AI 服务的 SSE；
   F3–F6 依赖后端菜单种子 B1）。
3. 实施时 §8 的 U1–U12 逐条验。
