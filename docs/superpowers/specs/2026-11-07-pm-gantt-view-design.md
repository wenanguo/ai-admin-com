# 任务管理「甘特视图」设计

> 日期：2026-11-07
> 状态：待评审
> 相关：任务列表 `/pm/task`、任务看板 `/pm/task/board`、后端 `module_pm_task` 表

## 1. 意图与为什么

任务管理现在有两个视图：**列表**（ProTable，字段齐全、能筛选编辑）和**看板**（按状态六列，拖拽改状态）。
两者都答不了同一个问题：**「谁在什么时候做什么」** —— 排期是否重叠、哪段是瓶颈、父任务和子任务的窗口有没有对齐。

甘特视图补的就是这一维：**横轴是时间，条形是任务，层级是项目 → 里程碑 → 任务**。

## 2. 目标 / 非目标 / 反目标

### 目标

1. 新增第三个视图 `/pm/task/gantt`，与列表、看板并列（入口放在任务列表页工具栏）。
2. 层级：**项目 → 里程碑 → 任务**，与后端 `project_id` / `milestone_id` / `parent_id` 一一对应。
3. 时间轴：日 / 周 / 月三级缩放，默认「周」；有今天线。
4. 能**拖拽改期**（移动条、拉边改时长），写回后端。
5. 条形按任务状态字典着色，与看板页、列表页的 `DictTag` 同一口径。
6. 视觉与现有 antd 页面同一套（字体、表格线、留白、tag 形态）。

### 非目标（这一版明确不做）

- **不做依赖连线（箭头）**：后端 `module_pm_task` 表没有依赖字段，也没有任何任务关联表 ⇒ 没有数据可画。
  dhtmlx 原生支持 links，将来后端加表时只是「多喂一个 `links` 数组」，不用重画。
- **不做自动排期 / 关键路径 / 资源管理 / 撤销重做**：这些是 dhtmlx **PRO 独有**，本项目用 MIT Community Edition。
- **不做 PDF/Excel 导出**：dhtmlx 的导出走它的云服务（要联网、带水印）。
- **不改后端**：这一版零后端改动。
- **不做里程碑页的甘特**：里程碑有独立页面。

### 反目标

- 不引入第二套「拖拽写回」语义：甘特的拖拽与看板的拖拽**必须**是同一套纪律（整对象 PUT + 失败回滚），否则同一个页面上两种行为会打架。

## 3. 约束

| 约束 | 来源 | 影响 |
|---|---|---|
| 后端任务**无 `progress`**（只有里程碑有） | `module_pm_task` 模型 | 条形里的进度只能靠 `actual_hours / estimate_hours` 粗算 ⇒ **这一版不画进度条**（不编数据） |
| 后端更新是**整对象 PUT**（无 PATCH），缺必填字段就 422 | `ModulePmTaskUpdateSchema` 继承 CreateSchema | 拖拽写回必须带齐 `project_id/title/type_code/status_code/priority_code` ⇒ 要用**拖动前的那份数据**拼 |
| MIT 版**没有撤销重做** | dhtmlx Community Edition | 拖拽写失败**必须自己回滚** |
| 右侧 AI 工作台常驻 400px | 本项目布局 | 内容区只剩 ~944px ⇒ 左表格 + 时间轴很挤 ⇒ 左表格要窄、列要少、分隔条可拖 |
| 前端是 `exportStatic` 静态导出 | 部署形态 | 只能跑浏览器端库 ⇒ dhtmlx 纯前端 ✓ |
| 项目 UI 一贯是 antd Pro + 自研 | 现状 | 引入 dhtmlx 是例外 ⇒ 必须用 CSS 变量把它拉到 antd token 上 |

## 4. 选型：为什么是 dhtmlx Gantt Community (MIT)

考虑过三条路：

| 方案 | 结论 |
|---|---|
| **A. 自己画（antd + SVG）** | 不做依赖连线后工作量确实不大，但时间轴刻度、缩放、拖拽、层级布局都要自己迭代 ⇒ 不划算 |
| **B. dhtmlx Gantt Community (MIT)** ✅ **选中** | 树形层级、里程碑、拖拽改期、三级缩放、今天线都是现成的；MIT 免费商用、闭源可发布 |
| **C. frappe-gantt / gantt-task-react** | 比 dhtmlx 功能更少，视觉同样要自己改 ⇒ 性价比最低 |

**授权结论（已核实）**：`dhtmlx-gantt` v10+ = Community Edition = **MIT**（`LICENSE.md`: MIT, © 2026 XB Software），
免费、闭源可发布（保留版权声明即可）⇒ **不用买 PRO**（PRO $799 起）。

⚠️ **官方 React wrapper 是商业版**：npm 上只有 `@dhtmlx/trial-react-gantt`（评估版带水印），
正式版 `@dhx/react-gantt` 在私有 registry ⇒ **本项目用 MIT 版只能 vanilla 初始化**
（`gantt.init(box)` + 自己同步数据），**拿不到声明式 props**。

### 探针实测（一次性，已删）

- ✅ **React 19 + Umi 4 + vanilla 初始化跑通**（9 行 / 层级 / 里程碑菱形 / 周月刻度都正常）。
- ✅ 自定义列模板（状态/优先级上 tag 色）可行。
- ⚠️ **`config.columns` 必须在 `gantt.init()` 之前设完**：先 init 再设 ⇒ 列宽被忽略（标题列被压成 90px）。
- ⚠️ 左表格宽度与时间轴抢空间：默认网格 470px 时时间轴只剩 ~150px ⇒ 需要**窄列 + 可拖分隔条**。
- **体积**：JS **169KB gzip** + CSS **49KB gzip**，且都是**独立 chunk** ⇒ **只有打开甘特页才加载，其它页面零成本**（实测生产构建）。
- 视觉：dhtmlx 默认皮肤（浅灰网格、细边框）与 antd 并排**不算违和**，但表头/行高/字体要用 antd token 覆盖。

证据截图：`docs/superpowers/specs/assets/pm-gantt-spike.png`

## 5. 怎么做（已定的部分）

### 5.1 文件与路由

| 文件 | 职责 |
|---|---|
| `src/components/pm/GanttChart.tsx` | **vanilla 封装**：初始化/销毁、配置注入、antd token → CSS 变量、事件回抛 |
| `src/pages/module_pm/task/useGanttTasks.ts` | 取数（列表）、**TaskOut → dhtmlx task 映射**、拖拽写回（整对象 PUT + 回滚） |
| `src/pages/module_pm/task/gantt.tsx` | 页面：加载态/空态、工具栏（缩放、重置、回到今天）、组装 |

路由 `/pm/task/gantt`；任务列表页工具栏在「看板」按钮旁加「甘特」按钮（沿用现有模式，菜单种子不动）。

### 5.1.1 数据范围与截断纪律

- **默认显示全部项目的任务**（按项目分组）⇒ 甘特是「全局排期视图」；顶部另给**按项目筛选**的下拉（用已有的项目侧载）。
- 后端 `listTasks` 是分页的，一次取 **100 条**（与看板页 `page_size: 100` 同款）。
  ⇒ **超出 100 条时**：页头给一条提示（「共 N 条，已显示前 100 条」），**不静默截断**
  （与列表页侧载、看板页同一条纪律）。
- 只显示**当前筛选范围内**的任务；筛项目时分组随之收敛。

### 5.2 数据映射（`TaskOut` → dhtmlx task）

- **只纳入同时有 `start_date` 与 `due_date` 的任务**。
  dhtmlx Community v10 **取消了 unscheduled tasks 特性** ⇒ 没有日期的任务画不出条。
  ⇒ 被排除的数量在页头给一条提示（「N 个任务没有计划起止日期，未显示」），**不静默丢**。
- id 前缀区分三类行，避免与 dhtmlx 的数字 id 撞：`p-{projectId}` / `m-{milestoneId}` / `t-{taskId}`。
- 层级：项目行与里程碑行都是 `type: 'task'` + `parent` ⇒ dhtmlx 自动把它们画成**汇总条**；
  只有真正的「里程碑型任务」才用 dhtmlx 的 milestone 类型（本项目没有 ⇒ 不用）。
- 时间：`start_date` → `start_date`，`due_date` → `end_date`（dhtmlx 的 end_date 是**含当天**的，与我们的 due_date 语义一致）。
- 颜色：`gantt.templates.task_class` 按 `status_code` 分类 ⇒ CSS 里给每种状态一个色。

### 5.3 左表格列

`任务标题(树形)` / `负责人` / `状态` / `优先级` / `起止日期`（合并成一列，省一列宽度）。

- 起止列显示 `09-01 ~ 09-12`（**不带年**，省宽度）；完整日期在**条形的 tooltip** 里给全。
- 标题列宽 + 网格总宽可**拖分隔条**调 ⇒ 解决「AI 面板占 400px」的空间问题。
  - ⚠️ **实现说明（复审后）**：dhtmlx **社区版没有**这个分隔条（PRO 才有，
    社区版只有列内的 resizer）⇒ 分隔条自己实现（网格与时间轴之间的把手）。
  - 网格总宽**跟着容器走**（容器窄 ⇒ 网格窄），但**标题列的最小宽度（160px）优先保住**
    ⇒ 标题永远能看清任务名。
  - dhtmlx 的网格宽度 = **各列宽度之和**（不是 `grid_width` 那个值）⇒ 列宽自己算。
- 宽度不够时，提示用户 **⌘B 收起 AI 面板**有更多空间（收起后容器变宽 ⇒ 网格与时间轴一起变宽，
  提示是真的）；也可以直接拖分隔条调两边的比例。
- 分组行（项目/里程碑）的条是**汇总条**（由子任务窗口推导）⇒ 没有子任务的里程碑行就是一条空汇总，不画日期条。

### 5.4 拖拽写回（与看板页同一套纪律）

1. `onBeforeTaskDrag`：**缓存拖动前的 task 对象**（整对象 PUT 要拿它拼必填字段）。
2. `onAfterTaskDrag`：取新的 `start_date` / `end_date` ⇒ 用缓存的旧对象拼 `TaskUpdateParams` ⇒ `updateTask`（整对象 PUT）。
3. **写失败 ⇒ 回滚**：`gantt.updateTask(id)` 把日期恢复成旧值（MIT 无 undo/redo ⇒ 这是刚需）。
4. **只改 `start_date` / `due_date` 两个维度**：不碰状态、负责人、优先级（与看板「只改一个维度」同纪律）。
5. 没有 `module_system:task:update` 权限 ⇒ `gantt.config.readonly = true`（不给拖、不给内联编辑）。

### 5.5 时间轴与交互

- 两级刻度：月（`%F %Y`）+ 周（`第 %W 周`）；缩放级别：日 / 周 / 月，**默认周**。
- 今天线：`gantt.addMarker({ start_date: today, css: 'today' })`。
- 左表格/时间轴共用 dhtmlx 的垂直滚动；页面本身不滚（沿用 app shell 的满高布局）。
  ⇒ 图表高度**跟着可用高度走**（不是写死的 520）：页面高度 = 内容区可用高度
  （含页脚占位）⇒ 内容区不出现第二条滚动条。

### 5.6 视觉贴合（antd token → CSS 变量）

在 `GanttChart` 里用 `theme.useToken()` 取 token，注入成 CSS 变量给 dhtmlx 用：

- 字体：`font-family: inherit`
- 表头背景：`colorFillAlter`、边框：`colorBorderSecondary`
- 行高 34px（比 antd 表格紧凑，甘特要一屏多行）
- 条形圆角 3px；条内文字白字
- **状态配色口径**：条形底色用**状态的 antd 语义色**（`colorSuccess` / `colorError` / `colorPrimary` /
  `colorWarning` / `colorInfo` / 默认灰）按 `status_code` 映射，**不用字典的 `list_class`**
  —— `list_class` 是给 `DictTag` 用的**浅底预设色**，白字压上去看不清。
  映射表放 `src/components/pm/` 下，与 `DictTag` 并列，两边共用同一份「状态码 → 语义色」口径。

⇒ **主题切换（亮/暗）自动跟上**（CSS 变量跟着 token 变）。

### 5.7 加载 / 空态 / 错误

与看板页同款：`Spin`（加载中）、`Empty`（没有可排期的任务）、错误提示由请求层统一弹。

### 5.8 授权声明

仓库补第三方授权声明（MIT 要求保留原作者版权与许可文本）⇒ `docs/superpowers/specs/` 之外的
`THIRD-PARTY-NOTICES.md`（或 README 里一节）。

## 6. 留给实现者的部分

1. `GanttChart` 的 vanilla 生命周期：**配置先于 `init`**；卸载 `gantt.destructor()`；
   dhtmlx 是**单例** ⇒ 同一时刻只能有一个甘特（本项目只有一个页面用 ✓）。
2. 拖拽写回的失败回滚要能在「写失败」和「用户又拖了别的」两种情况下都回到自洽状态。
3. 分组行（项目/里程碑）**不可拖**（汇总条只反映子任务窗口）。
4. 单测覆盖：映射函数（日期缺失、id 前缀、层级）、拖拽 payload（只改两个日期、必填字段齐全）。
5. e2e 覆盖：甘特页能渲染出层级与条形、拖拽写回的是整对象 PUT、失败回滚。

## 7. 明确不做（再强调一次）

依赖连线、自动排期、关键路径、资源管理、撤销重做、导出 —— 全部不在这一版。
后端这一版**一行不改**。

## 8. 补充：甘特视图的增删改 + 中文化（2026-11-10）

第一版甘特只有「读 + 拖拽改期」，用户反馈「甘特图的新增和修改、删除不生效」。
排查后发现是**两件事**叠在一起：

### 8.1 根因：列表页一直显示「暂无数据」（不是甘特的问题）

`src/services/paginate.ts` 的 `toProTableRequest` 用 `res.success` 判成功：

```ts
success: res?.success ?? false,   // ← 后端的信封里没有 success 字段
```

后端的统一响应信封只有 `{ code, msg, data, status_code }` ⇒ `res.success` 永远是
`undefined` ⇒ `success: false` ⇒ **ProTable 认为每次请求都失败** ⇒ 所有列表页
（PM 四个 + 系统八个）一律显示「暂无数据」。

⇒ 写进去了、也真的生效了，只是**看不见** ⇒ 看着像「新增不生效」。
（e2e 抓不到：mock 的响应里带了 `success: true`，与真实后端不一致。）

**改法**：按**业务码**判成功（`code === 0 || code === 200`），复用请求层已有的
`isSuccess`（`src/services/response.ts`）⇒ 与全局口径一致。

### 8.2 甘特视图补齐增删改

| 动作 | 入口 | 实现 |
| --- | --- | --- |
| 新增 | 工具栏「新增任务」按钮 | 复用列表页的 `TaskModalForm` 与 `createTask` |
| 修改 | 行内「编辑」按钮 | 复用 `TaskModalForm`（编辑态）与 `updateTask` |
| 删除 | 行内「删除」按钮 | `App.useApp()` 的 `modal.confirm` 二次确认 + `deleteTasks` |

三条纪律：

1. **编辑必须拿原始任务行**：后端更新是**整对象 PUT**（缺必填字段就 422）⇒
   甘特行（只有标题/日期/状态）不能直接填表 ⇒ 用行 id 反查原始 `TaskOut`。
2. **分组行（项目/里程碑）没有操作**：它们不是任务对象，后端也没有对应的接口 ⇒
   不渲染点了必然 404 的按钮。
3. **没有 ProTable 的页面要自己给刷新回调**：`useCrudTable` 默认刷 ProTable 的
   actionRef ⇒ 甘特页不传 `reload` 的话，删完/改完页面纹丝不动 ⇒ 看着像「没生效」。
   ⇒ `useCrudTable` 增加可选的 `reload`，甘特页传 `useGanttTasks` 的 `reload`。

**事件委托的坑**：dhtmlx 在自己的网格上监听 click 并 `stopPropagation` ⇒
事件到不了 React 根容器 ⇒ React 的 `onClick` 根本不触发。
⇒ 改用**捕获阶段**的原生监听（`addEventListener(..., true)`），
并且在 `mousedown` 阶段也拦一道（不然 dhtmlx 会把这次按下当成拖条形的起点，
拖拽一开始，后续的 click 就不再派发）。

### 8.3 中文化

dhtmlx 的时间轴刻度与内置文案默认是英文（`January`、`Mon`、`Add task`）。
社区版没有中文语言包（语言包是 PRO 的能力），但留了 `i18n.setLocale()` 这个口子
⇒ 自己喂一份中文词表（`src/components/pm/gantt/locale.ts`）。

⚠️ **API 是 `gantt.i18n.setLocale(locale)`**，不是 `gantt.setLocale` ——
社区版的实例上没有后者（`.d.ts` 里那个声明在别的接口上），调用会抛
`setLocale is not a function`。

### 8.4 样式贴合现有页面

- 左表格表头：次级文字 + 半粗（与 antd 表格一致）；行悬浮有底色；
  分组行（项目/里程碑）字重加粗，层级一眼能分出来。
- 操作列的按钮用 token 变量上色（编辑=主色、删除=错误色），观感与 antd 的
  link 按钮一致。
- 空值给「-」占位，**不要套标签的边框与底色**（一个「-」会缩成看不出是什么的小方块）。
- PM 各列表页加 `scroll={{ x: 'max-content' }}`：内容区被右侧 AI 工作台占窄时，
  列宽被压到最小 ⇒ 表头被挤成竖排的一列字 ⇒ 改成横向滚动。
