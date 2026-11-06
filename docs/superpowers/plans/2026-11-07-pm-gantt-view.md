# 任务管理「甘特视图」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在任务管理里加第三个视图 `/pm/task/gantt`：横轴是时间、条形是任务、层级是
项目 → 里程碑 → 任务，能拖拽改期并写回后端。

**Architecture:** 用 `dhtmlx-gantt` v10（**Community Edition，MIT**）做时间轴本体，
**vanilla 初始化**（`gantt.init(box)` + 自己同步数据，官方 React wrapper 是商业版用不了）；
React 侧只做三件事：把 `TaskOut` 映射成 dhtmlx 的行、把拖拽事件翻译成后端载荷、
把 dhtmlx 的皮肤拉到 antd token 上。纯逻辑（映射、写回载荷）拆成独立纯函数文件，
单测覆盖；vanilla 封装组件只测 DOM 结果。

**Tech Stack:** React 19 · antd 6 · ProComponents 3 · Umi Max 4 · TypeScript ·
`dhtmlx-gantt@10.0.3`（MIT）· Vitest（browser 模式）· Playwright

**Spec:** [`docs/superpowers/specs/2026-11-07-pm-gantt-view-design.md`](../specs/2026-11-07-pm-gantt-view-design.md)
（选型与探针实测 §4、做法 §5、非目标 §2.2）

---

## Global Constraints

以下每条都来自 spec 与本仓既有约定，**所有任务隐含包含**：

- **不改后端**：这一版后端**一行不改**（依赖连线不做 ⇒ 没有数据可画）。
- **dhtmlx 用 Community Edition（MIT）**：`dhtmlx-gantt@10.0.3`。
  ⚠️ **官方 React wrapper 是商业版**（npm 上只有 `@dhtmlx/trial-react-gantt` 评估版带水印）⇒
  **只能 vanilla 初始化**：`gantt.init(box)` / `gantt.parse()` / `gantt.destructor()`。
- ⚠️ **`config` 必须全部设完再 `gantt.init()`**：探针实测，先 init 再设 `config.columns`
  ⇒ 列宽被忽略（标题列被压成 90px）。`columns` / `scales` / `date_format` / `zoom` 全在 init 前设。
- **dhtmlx 是单例**（`gantt.init` 是全局的）⇒ 同一时刻只能有一个甘特实例；
  卸载必须 `gantt.destructor()`。
- **任务更新是整对象 PUT**（`TaskUpdateParams = Omit<TaskCreateParams,'reporter_id'|'sort_order'|'created_via_code'>`）
  ⇒ 必填 `project_id` / `title` / `type_code` / `status_code` / `priority_code`；
  **没有 PATCH** ⇒ 任何部分更新都是「读-改-写」，且**只改 `start_date` / `due_date`**。
- **MIT 版没有撤销重做** ⇒ 拖拽写失败**必须自己回滚**（`gantt.updateTask(id)`）。
- **权限码是四段式**：`module_pm_project:pm_task:query`（读）·
  `module_pm_project:pm_task:update`（拖拽改期）。**没有 update 就只读**
  （`gantt.config.readonly = true`）。
- **页面不自己弹 `message.success`/`message.error`** —— 请求层统一弹。
- **不静默截断**：后端一次给 100 条；超了要在页头提示「共 N 条，已显示前 100 条」。
- **缺起止日期的任务不进甘特**（dhtmlx v10 取消了 unscheduled tasks）⇒ 也要提示数量。
- **状态色用 antd 语义深色**（`colorSuccess`/`colorError`/`colorPrimary`/…），
  **不用**字典的 `list_class`（那是浅底预设色，白字压上去看不清）。
  ⚠️ `DictTag` 继续用 `list_class`，**这一版不动它**。
- **不引入第二套设计语言**：dhtmlx 的样式只能用 antd token 覆盖，不写死颜色。
- **提交**：中文提交信息；subject 不得以大写拉丁词开头；多行信息用 `git commit -F <file>`。
- **只对本计划改动的文件**跑 `npx biome check --write <paths>`（不能全仓跑）。
- **不要 push**。

### 探针实测（已核实，实现时直接用）

| 事实 | 数值/结论 |
|---|---|
| React 19 + Umi 4 + vanilla | ✅ 跑通 |
| 体积 | JS **169KB gzip** + CSS **49KB gzip**，**独立 chunk** ⇒ 只有甘特页加载 |
| 列宽 | `config.columns` 必须在 `init` 前设 |
| 缩放 | `gantt.ext.zoom.init({ levels: [...] })` + `gantt.ext.zoom.setLevel('week')` |
| 拖拽事件 | `gantt.attachEvent('onBeforeTaskDrag'\|'onAfterTaskDrag', fn)`，签名 `(id, mode, e)` |
| 今天线 | `gantt.addMarker({ start_date, css: 'today' })` |
| 回滚 | `gantt.updateTask(id)` |

---

## Review Focus

以下五类输入/故障模式是 spec 暗示、但任何单个任务的测试都不会覆盖的，**最容易咬人**，
按可能性排序。每一条都要在「Review Focus」对应行的任务里补上钉它的测试。

1. **任务缺 `start_date` 或 `due_date`** ⇒ 不能进甘特（画不出条），而且要**告诉用户有多少条被排除**，
   不能静默丢 —— 用户会以为「任务不见了」。
2. **拖拽写回失败**（后端 422/500/网络断）⇒ 条形**必须回到拖动前的位置**。
   MIT 版没有撤销重做，不回滚就等于数据与界面打架。
3. **整对象 PUT 把别的字段一起覆盖了** ⇒ 拖拽只允许改日期；状态/负责人/优先级必须是**拖动前的值**，
   否则用户在别处改的状态会被甘特悄悄改回去。
4. **AI 工作台常驻 400px** ⇒ 时间轴不能被挤成一条缝（网格分隔条可拖 + 提示 ⌘B 收面板）。
5. **拖动到没有 update 权限的角色手里** ⇒ 不能给拖（`readonly`），否则点下去必然 403。

---

## 文件结构（实现前先定死）

```
src/components/pm/gantt/
  mapping.ts        # 纯函数：TaskOut[] → dhtmlx 行 + 排除统计 + 状态色 class
  mapping.test.ts
  payload.ts        # 纯函数：拖拽 → TaskUpdateParams（只改两个日期）
  payload.test.ts
  GanttChart.tsx    # vanilla 封装组件（配置先于 init、销毁、事件、命令式 handle）
  GanttChart.test.tsx
  gantt.css         # antd token 变量驱动的皮肤覆盖
src/pages/module_pm/task/
  useGanttTasks.ts  # 取数 + 项目筛选 + 写回 + 回滚接线
  useGanttTasks.test.ts
  gantt.tsx         # 页面：加载态/空态/工具栏/组装
config/routes.ts                       # 加 /pm/task/gantt
src/pages/module_pm/task/index.tsx      # 工具栏加「甘特」按钮
e2e/pm-task-gantt.spec.ts               # e2e
THIRD-PARTY-NOTICES.md                  # MIT 声明
```

---

### Task 1: 映射层（`TaskOut[]` → dhtmlx 行）

**Files:**
- Create: `src/components/pm/gantt/mapping.ts`
- Test: `src/components/pm/gantt/mapping.test.ts`

**Interfaces:**
- Consumes: `TaskOut`（`@/services/api/pm/task`）
- Produces:
  ```ts
  export interface GanttRow {
    id: string;            // 项目 p-{id} / 里程碑 m-{id} / 任务 t-{id}
    text: string;
    parent?: string;       // 父行 id
    start_date?: string;   // YYYY-MM-DD（分组行为空）
    end_date?: string;     // YYYY-MM-DD（分组行为空）
    assignee?: string;
    priority?: string;     // 显示文本
    status?: string;       // 线上码
    css?: string;          // 条形 class（按状态）
  }
  export interface GanttMapping {
    data: GanttRow[];
    excludedCount: number;      // 缺起止日期而没进甘特的任务数
    excludedTitles: string[];   // 被排除的任务标题（最多 5 条，给提示用）
  }
  export function mapTasksToGantt(
    tasks: TaskOut[],
    names: { projects: Map<number, string>; milestones: Map<number, string> },
  ): GanttMapping;
  export function statusCssClass(status?: string | null): string;
  export function formatRange(start?: string, end?: string): string;  // "09-01 ~ 09-12"
  ```

- [ ] **Step 1: 写失败的测试**（`mapping.test.ts`）

  用例与断言（用 `describe`/`it`，vitest）：
  - `mapTasksToGantt` 对**一条完整任务**（`project_id: 1, milestone_id: 2, id: 10, title: 'A',
    start_date: '2026-09-01', due_date: '2026-09-12', status_code: 'in_progress', priority_code: 'high'`）
    ⇒ `data` 里有 **3 行**：项目行 `id === 'p-1'`、里程碑行 `id === 'm-2'`、任务行 `id === 't-10'`；
    里程碑行 `parent === 'p-1'`；任务行 `parent === 'm-2'`；任务行 `start_date === '2026-09-01'`
    且 `end_date === '2026-09-12'`。
  - 任务**没有 `milestone_id`** ⇒ 任务行的 `parent === 'p-{project_id}'`。
  - 任务**有 `parent_id`** ⇒ 该任务的 `parent === 't-{parent_id}'`（子任务挂父任务，不挂里程碑）。
  - 任务**缺 `start_date` 或 `due_date`** ⇒ 不产生任务行，且 `excludedCount === 1`、
    `excludedTitles` 含该任务标题。
  - `statusCssClass('in_progress')` 返回一个**非空且包含 'in_progress' 的字符串**；
    `statusCssClass(undefined)` 也有值（不能返回 undefined）。
  - `formatRange('2026-09-01','2026-09-12') === '09-01 ~ 09-12'`；
    `formatRange(undefined, undefined) === '-'`。

- [ ] **Step 2: 跑测试确认它失败**

  Run: `npx vitest run src/components/pm/gantt/mapping.test.ts`
  Expected: FAIL（`mapTasksToGantt` 未定义 / 模块不存在）

- [ ] **Step 3: 实现 `mapping.ts`**

  - 层级构造：先按 `project_id` 分组建项目行（`text` 用 `names.projects` 的名字，缺则 `'项目 {id}'`），
    再按 `milestone_id` 建里程碑行（`names.milestones`，缺则 `'里程碑 {id}'`），
    最后建任务行；任务的 `parent` 优先级：`parent_id` > `milestone_id` > `project_id`。
  - **只有任务行带 `start_date`/`end_date`**；分组行不写日期（dhtmlx 自动画汇总条）。
  - `excludedTitles` 最多 5 条。
  - `statusCssClass` 按状态线上码映射到一组 class 名（如 `pm-gantt-in_progress`），
    **具体颜色不进这个文件**（在 `gantt.css` 里按 token 写）。

- [ ] **Step 4: 跑测试确认它通过**

  Run: `npx vitest run src/components/pm/gantt/mapping.test.ts`
  Expected: PASS

- [ ] **Step 5: 提交**

  ```bash
  git add src/components/pm/gantt/mapping.ts src/components/pm/gantt/mapping.test.ts
  git commit -F <(printf 'feat(pm): 甘特映射层:TaskOut 转 dhtmlx 行\n')
  ```

---

### Task 2: 拖拽写回的载荷（只改两个日期）

**Files:**
- Create: `src/components/pm/gantt/payload.ts`
- Test: `src/components/pm/gantt/payload.test.ts`

**Interfaces:**
- Consumes: `TaskOut`、`TaskUpdateParams`（`@/services/api/pm/task`）
- Produces:
  ```ts
  export interface TaskDateChange { start_date: string; end_date: string; }
  export function toDateChange(task: { start_date?: string; end_date?: string }): TaskDateChange;
  export function buildDateUpdatePayload(
    before: TaskOut,
    change: TaskDateChange,
  ): TaskUpdateParams | null;   // null = 旧数据缺必填字段，不发这个注定 422 的请求
  ```

- [ ] **Step 1: 写失败的测试**（`payload.test.ts`）

  - `buildDateUpdatePayload(before, change)`：
    - 返回值的 `start_date === change.start_date`、`due_date === change.end_date`；
    - `title` / `type_code` / `status_code` / `priority_code` / `project_id` **等于 before 的值**；
    - `before` 里有 `description` / `assignee_id` ⇒ 返回值里**原样带着**（整对象 PUT 不能丢字段）。
    - 返回值**不含** `reporter_id` / `sort_order` / `created_via_code`（更新不带这三列）。
  - `before` 缺 `type_code`（必填之一）⇒ 返回 **`null`**（不是缺字段的半个对象）。
  - `toDateChange({ start_date: '2026-09-01', end_date: '2026-09-12' })` ⇒
    `{ start_date: '2026-09-01', end_date: '2026-09-12' }`。

- [ ] **Step 2: 跑测试确认它失败**

  Run: `npx vitest run src/components/pm/gantt/payload.test.ts`
  Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `payload.ts`**

  - 用 `before` 的字段铺一份 `TaskUpdateParams`，再覆盖 `start_date` / `due_date`；
  - 必填四项（`project_id`/`title`/`type_code`/`status_code`/`priority_code`）任一缺失 ⇒ 返回 `null`。

- [ ] **Step 4: 跑测试确认它通过**

  Run: `npx vitest run src/components/pm/gantt/payload.test.ts`
  Expected: PASS

- [ ] **Step 5: 提交**

  ```bash
  git add src/components/pm/gantt/payload.ts src/components/pm/gantt/payload.test.ts
  git commit -F <(printf 'feat(pm): 甘特拖拽载荷:只改起止日期的整对象 PUT\n')
  ```

---

### Task 3: `GanttChart` 组件（vanilla 封装）

**Files:**
- Create: `src/components/pm/gantt/GanttChart.tsx`
- Create: `src/components/pm/gantt/gantt.css`
- Test: `src/components/pm/gantt/GanttChart.test.tsx`

**Interfaces:**
- Consumes: `GanttRow`（Task 1）、`TaskDateChange`（Task 2）
- Produces:
  ```ts
  export interface GanttChartHandle {
    revertTask(rowId: string): void;                       // 回滚到拖动前的日期
    setZoom(level: 'day' | 'week' | 'month'): void;
    zoomToFit(): void;
    scrollToToday(): void;
  }
  export interface GanttChartProps {
    data: GanttRow[];
    readOnly?: boolean;                                     // 无 update 权限 ⇒ 只读
    onTaskDragEnd?: (rowId: string, change: TaskDateChange) => void;
    height?: number;                                        // 默认 520
  }
  export const GanttChart = forwardRef<GanttChartHandle, GanttChartProps>(...)
  ```

- [ ] **Step 1: 写失败的测试**（`GanttChart.test.tsx`，vitest browser 模式）

  - 渲染 3 行数据 ⇒ 容器里 `.gantt_row` 的数量 === 3。
  - 至少一个叶子行渲染出条形（`.gantt_task_line`）。
  - 卸载后 `document.querySelector('.gantt_container')` 为 `null`（**没有残留的旧实例**）。
  - `readOnly` ⇒ 组件把 `gantt.config.readonly` 设为 true（断言方式：条上**没有**拖拽手柄
    `.gantt_task_drag`，或暴露一个 `data-readonly` 属性供断言 —— 二选一，测试与实现对齐即可）。
  - `onTaskDragEnd` 回调：模拟 `gantt` 的 `onAfterTaskDrag` ⇒ 回调收到
    `{ rowId: 't-10', start_date: '2026-09-03', end_date: '2026-09-14' }`。
    （测试里用 `gantt.attachEvent` 的桩，或直接调用组件暴露的测试钩子。）

- [ ] **Step 2: 跑测试确认它失败**

  Run: `npx vitest run src/components/pm/gantt/GanttChart.test.tsx`
  Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现 `GanttChart.tsx`**

  - **顺序**：`useEffect` 里先设**全部** `gantt.config`（`date_format`/`columns`/`scales`/
    `row_height`/`scale_height`/`grid_width`/`min_column_width`/`autofit`/`readonly`/
    `drag_move`/`drag_resize`/`drag_progress`/`drag_links`/`show_links`），
    再 `gantt.ext.zoom.init({ levels: [...] })`，再 `gantt.init(box)`，最后 `gantt.parse({ data, links: [] })`。
  - `columns`：标题（`tree: true`）/ 负责人 / 状态 / 优先级 / 起止（合并列，模板用 `formatRange`）。
    状态与优先级用**列模板**渲染成 tag（class 由 `statusCssClass` 给）。
  - 缩放级别：`day`（`{ unit: 'day', step: 1, format: '%d' }`）、
    `week`（月 + 周两级刻度）、`month`（月）；默认 `setLevel('week')`。
  - 今天线：`gantt.addMarker({ start_date: dayjs().format('YYYY-MM-DD'), css: 'today' })`。
  - 拖拽：`onBeforeTaskDrag` 缓存该行**拖动前**的 `start_date`/`end_date`；
    `onAfterTaskDrag` 取新值 → `onTaskDragEnd(rowId, change)`；
    `revertTask(rowId)` 用缓存的旧值 `gantt.updateTask(rowId)` 恢复。
  - 卸载：`gantt.destructor()`。
  - `gantt.css`：只用 `var(--pm-gantt-*)` 变量；变量值由组件在容器上用
    `theme.useToken()` 的 token 注入（表头背景 `colorFillAlter`、边框 `colorBorderSecondary`、
    字体继承、条形圆角、状态色用 `colorSuccess`/`colorError`/`colorPrimary`/`colorWarning`/`colorInfo`）。

- [ ] **Step 4: 跑测试确认它通过**

  Run: `npx vitest run src/components/pm/gantt/GanttChart.test.tsx`
  Expected: PASS

- [ ] **Step 5: 提交**

  ```bash
  git add src/components/pm/gantt/GanttChart.tsx src/components/pm/gantt/gantt.css src/components/pm/gantt/GanttChart.test.tsx
  git commit -F <(printf 'feat(pm): 甘特图组件:vanilla 封装与 antd token 皮肤\n')
  ```

---

### Task 4: `useGanttTasks`（取数 + 筛选 + 写回 + 回滚）

**Files:**
- Create: `src/pages/module_pm/task/useGanttTasks.ts`
- Test: `src/pages/module_pm/task/useGanttTasks.test.ts`

**Interfaces:**
- Consumes: `listTasks` / `updateTask`（`@/services/api/pm/task`）、
  `mapTasksToGantt`（Task 1）、`buildDateUpdatePayload`（Task 2）
- Produces:
  ```ts
  export interface UseGanttTasksResult {
    mapping: GanttMapping;
    loading: boolean;
    total: number;          // 后端返回的总数
    truncated: boolean;     // total > 实际显示条数
    applyDateChange: (rowId: string, change: TaskDateChange) => Promise<boolean>;
    reload: () => void;
  }
  export function useGanttTasks(options?: { projectId?: number }): UseGanttTasksResult;
  ```

- [ ] **Step 1: 写失败的测试**（`useGanttTasks.test.ts`，mock `@/services/api/pm/task`）

  - 取数：`listTasks` 被调用时参数含 `{ page_no: 1, page_size: 100 }`；
    给了 `projectId` 时参数含 `project_id`。
  - 返回的 `mapping.data` 是映射后的行；`total` 取后端 `data.total`；
    后端 `total` 大于返回条数时 `truncated === true`。
  - `applyDateChange('t-10', change)`：
    - 成功 ⇒ 调用 `updateTask`，且**载荷只有 `start_date`/`due_date` 变了**
      （其余字段与行数据一致）⇒ 解析 `updateTask` 的入参断言。
    - `updateTask` reject ⇒ 解析为 **`false`**（不抛给调用方）。
  - `applyDateChange` 传一个**不存在的行 id** ⇒ 返回 `false`，**不发请求**。

- [ ] **Step 2: 跑测试确认它失败**

  Run: `npx vitest run src/pages/module_pm/task/useGanttTasks.test.ts`
  Expected: FAIL（hook 不存在）

- [ ] **Step 3: 实现 `useGanttTasks.ts`**

  - 取数：`listTasks({ page_no: 1, page_size: 100, ...(projectId ? { project_id: projectId } : {}) })`；
    项目名/里程碑名用 `useProjectNames()` 的侧载映射（已有 hook，见
    `src/pages/module_pm/task/useProjectNames.ts`）。
  - `applyDateChange`：按行 id 找到原始 `TaskOut` ⇒ `buildDateUpdatePayload` ⇒
    `null` 就直接返回 `false`（不发注定 422 的请求）⇒ 否则 `await updateTask(payload)`，
    成功返回 `true`，失败 catch 后返回 `false`（**错误提示由请求层统一弹**）。
  - `truncated`：**分页口径** —— `total > 本次取回的条数`（后端还有没取到的任务）。
    ⚠️ **不要**用 `total > taskCount`：`taskCount` 只数进了甘特的任务，
    「因缺起止日期被排除的任务」也会被算进去 ⇒ 页面会同时显示「被截断」和
    「N 个任务未显示」两条互相矛盾的提示。缺日期的排除由 `mapping.excludedCount` 单独表达。
    （`GanttMapping.taskCount` 仍保留：它给「实际显示了多少条任务」用。）

- [ ] **Step 4: 跑测试确认它通过**

  Run: `npx vitest run src/pages/module_pm/task/useGanttTasks.test.ts`
  Expected: PASS

- [ ] **Step 5: 提交**

  ```bash
  git add src/pages/module_pm/task/useGanttTasks.ts src/pages/module_pm/task/useGanttTasks.test.ts src/components/pm/gantt/mapping.ts src/components/pm/gantt/mapping.test.ts
  git commit -F <(printf 'feat(pm): 甘特数据 hook:取数、筛选与拖拽写回\n')
  ```

---

### Task 5: 页面 + 路由 + 列表页入口

**Files:**
- Create: `src/pages/module_pm/task/gantt.tsx`
- Modify: `config/routes.ts`（`/pm/task/board` 之后加 `/pm/task/gantt`）
- Modify: `src/pages/module_pm/task/index.tsx`（工具栏「看板」按钮旁加「甘特」）
- Create: `e2e/pm-task-gantt.spec.ts`

**Interfaces:**
- Consumes: `useGanttTasks`（Task 4）、`GanttChart` + `GanttChartHandle`（Task 3）
- Produces: 路由 `/pm/task/gantt`；列表页工具栏上的「甘特」按钮。

- [ ] **Step 1: 写失败的 e2e**（`e2e/pm-task-gantt.spec.ts`）

  用 `e2e/helpers.ts` 的 `seedAuthState` / `setupModulePage` / `gotoModulePage` 夹具
  （拦截 `**/api/v1/pm_project/pm_task/list**`，返回 3 条带日期的任务）：
  - 打开 `/pm/task/gantt` ⇒ 渲染出 `.gantt_container`，且行数 === 任务条数 + 分组行数。
  - 页面顶部出现**截断/排除提示**（当夹具给 `total` 大于返回条数时）。
  - 工具栏「甘特」按钮：从 `/pm/task` 点它能到 `/pm/task/gantt`。

- [ ] **Step 2: 跑 e2e 确认它失败**

  Run: `npx playwright test e2e/pm-task-gantt.spec.ts --workers=1`
  Expected: FAIL（路由不存在）

- [ ] **Step 3: 实现 `gantt.tsx` 与路由、入口**

  - 页面结构：`PageContainer`（或与看板页同款的头部）＋ 工具栏（按项目筛选 `Select`、
    缩放「日/周/月」`Segmented`、「今天」「适应」按钮）＋ `GanttChart`。
  - 加载中 `Spin`；没有可排期任务 `Empty`（文案说明「任务需要计划开始与截止日期」）。
  - 权限：`useAccess().hasPermission('module_pm_project:pm_task:update')` ⇒
    `readOnly={!canUpdate}`。
  - 拖拽回滚：`applyDateChange` 返回 `false` ⇒ `chartRef.current?.revertTask(rowId)`。
  - 入口按钮：与「看板」按钮同一个 `Dropdown`/`Button` 组，用
    `AppstoreOutlined` 之外的图标（如 `BarChartOutlined`）＋文字「甘特」。

- [ ] **Step 4: 跑 e2e 确认它通过**

  Run: `npx playwright test e2e/pm-task-gantt.spec.ts --workers=1`
  Expected: PASS

- [ ] **Step 5: 提交**

  ```bash
  git add src/pages/module_pm/task/gantt.tsx config/routes.ts src/pages/module_pm/task/index.tsx e2e/pm-task-gantt.spec.ts
  git commit -F <(printf 'feat(pm): 任务甘特视图:页面、路由与列表页入口\n')
  ```

---

### Task 6: 授权声明 + 全量门禁

**Files:**
- Create: `THIRD-PARTY-NOTICES.md`

- [ ] **Step 1: 写第三方授权声明**

  `THIRD-PARTY-NOTICES.md` 记录：`dhtmlx-gantt` v10.0.3（DHTMLX Gantt Community Edition）、
  MIT 许可、`Copyright (c) 2026 XB Software`、用途（甘特视图）、许可证全文出处
  （`node_modules/dhtmlx-gantt/LICENSE.md`）。**MIT 要求保留原版权与许可文本。**

- [ ] **Step 2: 跑全量门禁**

  Run: `npm run lint && npm test && npm run build && npx playwright test --workers=3`
  Expected: lint 干净、单测全绿、build 成功、e2e 全绿。

- [ ] **Step 3: 人工验收（浏览器）**

  打开 `/pm/task/gantt`，确认：
  1. 层级是 项目 → 里程碑 → 任务；
  2. 拖动一条任务的条 ⇒ 位置变了、**刷新后还在**（写回成功）；
  3. 把后端 mock 成失败 ⇒ 条形**回到拖动前的位置**；
  4. 左侧表格与时间轴都有内容（AI 面板占 400px 时时间轴不被挤没，能拖分隔条）；
  5. 主题切暗色 ⇒ 甘特跟着变。

- [ ] **Step 4: 提交**

  ```bash
  git add THIRD-PARTY-NOTICES.md
  git commit -F <(printf 'docs(pm): 补 dhtmlx Gantt 的 MIT 授权声明\n')
  ```

---

## 自审记录

- **spec 覆盖**：§5.1 文件结构 → 文件结构段 + 各 Task；§5.1.1 数据范围/截断 → Task 4 + Task 5；
  §5.2 映射 → Task 1；§5.3 列 → Task 3；§5.4 拖拽写回 → Task 2 + Task 4 + Task 5；
  §5.5 时间轴 → Task 3；§5.6 视觉 → Task 3 + Task 6；§5.7 加载/空态 → Task 5；
  §5.8 授权 → Task 6。§2.2 非目标（无连线等）没有任务实现 ⇒ **这是有意的**（非目标）。
- **Review Focus 落点**：① Task 1（排除计数）+ Task 5（提示）；② Task 3（`revertTask`）+ Task 4（失败返回 false）；
  ③ Task 2（载荷只改两字段）；④ Task 3（分隔条/网格宽度）+ Task 5（提示 ⌘B）；⑤ Task 3（`readonly`）+ Task 5（权限门控）。
- **类型一致性**：`GanttRow` / `GanttMapping` / `TaskDateChange` / `GanttChartHandle` 只在 Task 1/2/3 定义一次，
  后续任务按名字引用；Task 4 补 `GanttMapping.taskCount` 时同步回 Task 1 的接口与测试（已在 Task 4 Step 3 写明）。
- **2026-11-06 订正（Task 4 复审）**：`truncated` 的口径从「`total > taskCount`」改成
  「`total > 本次取回的条数`」—— 前者把「分页截断」与「缺起止日期被排除」混成一条提示。
  spec §5.1.1 说的「不静默截断」指的是**分页**，故以 spec 为准。
- **与 spec 的一处偏差**：spec §5.6 说状态色「与 DictTag 共用同一份口径」——
  实现改为 **`DictTag` 不动**（继续用字典 `list_class`），甘特条形另用一套**语义深色**映射
  （`src/components/pm/gantt/mapping.ts` 的 `statusCssClass` + `gantt.css` 的 token 色）。
  理由：`list_class` 是浅底预设色，白字压上去看不清；改 `DictTag` 会波及全站，超出本计划范围。
