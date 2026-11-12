# 任务界面三合一（Segmented 切换，切换零请求）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任务列表 / 看板 / 甘特合成一个页面，用 `Segmented` 切换；页面进入取一次数，切换视图**零请求**。

**Architecture:** 新增一个共享数据层 `useTaskDataset`（react-query 缓存一份「任务全集」），三个视图都从它取数；列表把 ProTable 的 `request` 改成**本地**过滤 + 分页。视图切换用 URL query（`?view=list|board|gantt`）驱动，切路由不触发取数（缓存命中）。

**Tech Stack:** React 19 · Umi Max 4 · antd 6（`Segmented`）· ProComponents 3 · `@tanstack/react-query` v5（umi 插件已装，全局 `QueryClientProvider` 已就位）

**Spec:** `docs/superpowers/specs/2026-11-11-task-workspace-segmented-design.md`

## Global Constraints

- **只改前端**（`frontend/`）。AiAdmin 后端（`~/project/AiAdmin`）**一行都不动**。
- 后端筛选语义（`~/project/AiAdmin/backend/app/plugin/module_pm_project/pm_task/schema.py` 的 `__post_init__`）：
  `title` / `status_code` / `priority_code` / `created_via_code` / `blocked_reason` = **LIKE %v%**（大小写不敏感）；其余 = **eq**。
- 前端可搜索字段只有 6 个：`title`、`project_id`、`status_code`、`priority_code`、`type_code`、`assignee_id`（其余列 `search: false`）。
- 后端 `page_size` 上限 100；数据集最多拉 **10 页（1000 条）**，超了必须**显式提示**（本仓「上限不静默」传统）。
- 写操作后端是 **PUT 整对象**（没有 PATCH）⇒ 缺必填字段会 422。
- Biome（不用 ESLint/Prettier）；`npm run lint` 与 `npx antd info <Component>` 都要过。
- vitest 用 `npx vitest run --config vitest.local.config.ts`（该文件不入库）。
- e2e：`npx playwright test`（前端 dev server 在 8001）。
- 提交信息用 Conventional Commits（中文正文，commitlint 强制）。

## Review Focus

以下五种输入/情形最容易咬人，各自有测试钉住：

1. **筛选值为空串 / undefined / null** ⇒ 不参与过滤（后端「参数为 None 就不加条件」）—— Task 2
2. **`title` 的模糊匹配是大小写不敏感的**（MySQL `utf8mb4_general_ci` 的 LIKE）—— Task 2
3. **数据集去重**：同一页/多页里出现重复 `id` 时只保留一条（并发插入会让分页错位）—— Task 1
4. **切换视图时不能有任何新请求**（含 `refetchOnMount` / `refetchOnWindowFocus`）—— Task 6
5. **看板拖拽改状态后，列表里那一行也跟着变**（同一份数据，不是两份）—— Task 6

---

### Task 1: 共享数据层 `useTaskDataset`

**Files:**
- Create: `frontend/src/components/pm/task/useTaskDataset.ts`
- Test: `frontend/src/components/pm/task/useTaskDataset.test.ts`

**Interfaces:**
- Consumes: `listTasks(params)` from `@/services/api/pm/task`；`useQuery` from `@tanstack/react-query`
- Produces:
  ```ts
  export const TASK_DATASET_PAGE_SIZE = 100;
  export const TASK_DATASET_MAX_PAGES = 10;
  export interface TaskDatasetResult {
    tasks: TaskOut[];
    total: number;          // 后端说的总数
    loading: boolean;
    error: Error | null;
    truncated: boolean;     // total > tasks.length（后端说还有更多）
    reload: () => void;
    patchTask: (task: TaskOut) => void;   // 本地改一条 ⇒ 三个视图立刻一致
  }
  export function useTaskDataset(options?: { projectId?: number }): TaskDatasetResult;
  export async function fetchAllTasks(options?: {
    projectId?: number;
  }): Promise<{ items: TaskOut[]; total: number }>;
  ```

- [x] **Step 1: 写失败的测试** —— `useTaskDataset.test.ts`：

  用 `vi.mock('@/services/api/pm/task')` 把 `listTasks` 换成可控的假实现，测 `fetchAllTasks`：

  - `总��� 93 条(第 1 页就够)` ⇒ 只发 **1 次**请求，返回 93 条
  - `总共 250 条` ⇒ 发 **3 次**请求（第 1、2、3 页），返回 250 条
  - `总共 1200 条` ⇒ 只发 **10 次**请求（封顶），`total=1200`、`items.length=1000`
  - `两页返回了同一个 id` ⇒ 去重后只剩 1 条

  文件里用 `vi.mock` + `describe/it/expect`（vitest）。**不引入新的测试库**。

- [x] **Step 2: 跑测试确认失败**

  Run: `cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/task/useTaskDataset.test.ts`
  Expected: FAIL（`fetchAllTasks` 不存在）

- [x] **Step 3: 实现 `frontend/src/components/pm/task/useTaskDataset.ts`**

  - `fetchAllTasks`：第 1 页 `page_size=100` ⇒ 拿 `total` ⇒ `pages = min(ceil(total/100), 10)` ⇒
    `Promise.all` 并行拉第 2..pages 页 ⇒ 合并 ⇒ **按 `id` 去重**（保留第一次出现的）。
  - 请求参数带 `order_by: JSON.stringify([{ id: 'desc' }])`（与后端默认排序一致，写出来才稳定）。
  - `useTaskDataset` 用 `useQuery({ queryKey: ['pm','task','dataset', projectId ?? 'all'], queryFn, staleTime: 5*60_000 })`。
  - `patchTask` 用 `queryClient.setQueryData` 把那条替换掉（`dataUpdatedAt` 随之变 ⇒ 列表会重跑本地 request）。
  - `truncated = total > tasks.length`。

- [x] **Step 4: 跑测试确认通过**

  Run: `cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/task/useTaskDataset.test.ts`
  Expected: PASS

- [x] **Step 5: 提交**

  ```bash
  git add frontend/src/components/pm/task/useTaskDataset.ts frontend/src/components/pm/task/useTaskDataset.test.ts
  git commit -m "feat(task): 共享任务数据集(一次取全量,带缓存与本地改单条)"
  ```

---

### Task 2: 本地筛选 `filterTasks`（照后端语义）

**Files:**
- Create: `frontend/src/components/pm/task/filterTasks.ts`
- Test: `frontend/src/components/pm/task/filterTasks.test.ts`

**Interfaces:**
- Consumes: `TaskOut` from `@/services/api/pm/task`
- Produces:
  ```ts
  export const LIKE_FIELDS = ['title','status_code','priority_code','created_via_code','blocked_reason'] as const;
  export const SEARCHABLE_FIELDS = ['title','project_id','status_code','priority_code','type_code','assignee_id'] as const;
  export function filterTasks(tasks: TaskOut[], filters: Record<string, unknown>): TaskOut[];
  ```

- [x] **Step 1: 写失败的测试** —— `filterTasks.test.ts`：

  - `filters` 为空 ⇒ 原样返回
  - `title: '登录'` ⇒ 只留 title 含「登录」的（**含**不是等于）
  - `title: 'LOGIN'`（大写）⇒ 与 `title: 'login'` 结果相同（大小写不敏感）
  - `title: ''` / `undefined` / `null` ⇒ 该条件**不参与**过滤
  - `project_id: 3` ⇒ 只留 `project_id === 3`（**严格相等**，不是包含）
  - `status_code: 'todo'` ⇒ 后端是 like ⇒ 用包含；给一条 `status_code: 'todo_x'` ⇒ **应当匹配**（与后端一致）
  - `assignee_id: '7'`（字符串）⇒ 匹配 `assignee_id: 7`（数字）⇒ 用字符串比较
  - 不在 `SEARCHABLE_FIELDS` 里的 key（如 `__v`）⇒ **忽略**（不参与过滤）

- [x] **Step 2: 跑测试确认失败**

  Run: `cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/task/filterTasks.test.ts`
  Expected: FAIL（模块不存在）

- [x] **Step 3: 实现 `frontend/src/components/pm/task/filterTasks.ts`**

  - 只看 `SEARCHABLE_FIELDS` 里的 key（白名单 ⇒ 未知参数不会把列表清空）。
  - 值判定：`undefined` / `null` / `''` / 空数组 ⇒ 跳过。
  - LIKE 字段：`String(value ?? '').toLowerCase().includes(String(raw).toLowerCase())`。
  - eq 字段：`String(value ?? '') === String(raw)`。

- [x] **Step 4: 跑测试确认通过**

  Run: `cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/task/filterTasks.test.ts`
  Expected: PASS

- [x] **Step 5: 提交**

  ```bash
  git add frontend/src/components/pm/task/filterTasks.ts frontend/src/components/pm/task/filterTasks.test.ts
  git commit -m "feat(task): 本地筛选语义照后端(LIKE/eq 分开)"
  ```

---

### Task 3: 列表改用共享数据（本地过滤 + 本地分页）

**Files:**
- Modify: `frontend/src/components/pm/task/TaskListView.tsx`

**Interfaces:**
- Consumes: `useTaskDataset()`、`filterTasks(tasks, filters)`（Task 1/2）
- Produces: 无新导出（`TaskListViewProps` 不变）

- [x] **Step 1: 把 ProTable 的 `request` 换成本地实现**

  - `const { tasks, total, loading, truncated, reload } = useTaskDataset({ projectId })`
  - `request` 改成：
    ```ts
    async (params) => {
      const { current, pageSize, ...filters } = params;
      const filtered = filterTasks(tasks, filters);
      const size = pageSize ?? 10;
      const start = ((current ?? 1) - 1) * size;
      return { data: filtered.slice(start, start + size), total: filtered.length, success: true };
    }
    ```
  - ⚠️ **数据变了要重跑本地 request**：ProTable 靠 `params` 变化触发重跑 ⇒
    `params={{ __v: dataUpdatedAt }}`（react-query 的 `dataUpdatedAt`；`patchTask` 也会让它变）。
    `filterTasks` 忽略 `__v`（白名单）⇒ 不会把列表清空。
  - 删掉 `params={projectId ? { project_id: projectId } : undefined}`（项目限定已经在取数时做了）。
  - 删掉 `requestTasks`（`toProTableRequest(listTasks)`）这个 import。
  - `truncated` 为真 ⇒ 在表格上方渲染一条 `Alert`（沿用「上限不静默」）。

- [x] **Step 2: 手动验证（dev server 在 8001）**

  - 打开 `/pm/task` ⇒ 表格出数据；翻页、搜索（标题/状态/项目）都正常。
  - 断网/后端 500 ⇒ 列表空 + 错误提示由请求层弹（不白屏）。

- [x] **Step 3: 跑相关测试**

  Run: `cd frontend && npx vitest run --config vitest.local.config.ts`
  Expected: 全部 PASS（若有依赖旧 `request` 行为的测试，按新语义改断言并在提交信息里说明）

- [x] **Step 4: 提交**

  ```bash
  git add frontend/src/components/pm/task/TaskListView.tsx
  git commit -m "refactor(task): 列表改用共享数据集,搜索与分页在本地做"
  ```

---

### Task 4: 看板与甘特改吃共享数据

**Files:**
- Modify: `frontend/src/pages/module_pm/task/useBoardColumns.ts`
- Modify: `frontend/src/pages/module_pm/task/useGanttTasks.ts`

**Interfaces:**
- Consumes: `useTaskDataset({ projectId })`（Task 1）
- Produces: 两者现有的返回类型**不变**（`BoardColumns` / `UseGanttTasksResult`）

- [x] **Step 1: 改 `useBoardColumns`**

  - 删掉内部的 `listTasks` 取数与 `reloadCount` state ⇒ 换成
    `const { tasks, total, loading, truncated, reload, patchTask } = useTaskDataset({ projectId })`。
  - `moveTask` 的乐观更新与回滚改用 `patchTask`（现在是改共享数据 ⇒ 列表视图立刻同步）。
  - `truncated` 的口径从 `total > page_size` 改成 `total > tasks.length`（= dataset 的 `truncated`）。

- [x] **Step 2: 改 `useGanttTasks`**

  - 同样删掉内部取数 ⇒ 用 `useTaskDataset({ projectId })`。
  - `applyDateChange` 写回成功后改用 `patchTask`（把新的日期写回共享数据）。
  - `tasks` 返回值改成 dataset 的 `tasks`（语义不变：原始任务行）。

- [x] **Step 3: 跑测试**

  Run: `cd frontend && npx vitest run --config vitest.local.config.ts`
  Expected: PASS

- [x] **Step 4: 提交**

  ```bash
  git add frontend/src/pages/module_pm/task/useBoardColumns.ts frontend/src/pages/module_pm/task/useGanttTasks.ts
  git commit -m "refactor(task): 看板与甘特改用共享数据集,拖拽写回同步到其他视图"
  ```

---

### Task 5: `TaskWorkspace`（Segmented）+ 路由 + 详情页接入

**Files:**
- Create: `frontend/src/components/pm/task/TaskWorkspace.tsx`
- Modify: `frontend/src/pages/module_pm/task/index.tsx`
- Modify: `frontend/src/pages/module_pm/project/detail.tsx`
- Modify: `frontend/config/routes.ts`

**Interfaces:**
- Consumes: `TaskListView`、`TaskBoard`（= 现在的 `pages/module_pm/task/board.tsx`）、`TaskGantt`（= 现在的 `pages/module_pm/task/gantt.tsx`）
- Produces:
  ```ts
  export type TaskView = 'list' | 'board' | 'gantt';
  export function TaskWorkspace(props: { projectId?: number }): React.ReactElement;
  ```

- [x] **Step 1: 先跑 `npx antd info Segmented`**（AGENTS.md 要求：写 antd 代码前先查 API）

  确认 `Segmented` 的 props（`options` / `value` / `onChange` / `size`）在本仓的 antd 6 里叫什么。

- [x] **Step 2: 新建 `TaskWorkspace.tsx`**

  - `const [searchParams, setSearchParams] = useSearchParams()`
  - `view` 从 `searchParams.get('view')` 解析（非法值 ⇒ `'list'`）。
  - 切视图：`setSearchParams`（`replace: true`，不往历史里塞垃圾）。
  - 渲染：`<Segmented options={[{label:'列表',value:'list'},{label:'看板',value:'board'},{label:'甘特',value:'gantt'}]} />`
    + 按 `view` 挂载对应视图（**只挂当前那个**，甘特图渲染贵）。
  - `TaskBoard` / `TaskGantt` 现在是**页面** ⇒ 要变成组件：
    把 `pages/module_pm/task/board.tsx` 与 `gantt.tsx` 移到 `components/pm/task/TaskBoard.tsx` / `TaskGantt.tsx`，
    改成 `export function TaskBoard({ projectId }: { projectId?: number })`（`projectId` 从 URL 的 `project_id` 取，
    或由 `TaskWorkspace` 传进来 —— **由 TaskWorkspace 传**，URL 参数由它统一读）。
  - ⚠️ 组件里不要再自己 `useSearchParams` 读 `project_id`（Task 4 之前加的那段）⇒ 改成 props。

- [x] **Step 3: 路由**

  - `config/routes.ts`：`/pm/task/board` 与 `/pm/task/gantt` 改成
    `redirect: '/pm/task?view=board'` / `redirect: '/pm/task?view=gantt'`。
  - 删掉这两条路由的 `component` 指向（页面文件已搬走）。

- [x] **Step 4: 接入**

  - `pages/module_pm/task/index.tsx` ⇒ `<TaskWorkspace />`
  - `pages/module_pm/project/detail.tsx` 的「任务」页签 ⇒ `<TaskWorkspace projectId={projectId} />`

- [x] **Step 5: 手动验证**

  - `/pm/task` ⇒ 列表；点 Segmented 的「看板」⇒ URL 变 `/pm/task?view=board`，看板出卡片，**Network 里没有新的 task 列表请求**。
  - 旧链接 `/pm/task/board` ⇒ 落到 `/pm/task?view=board` 且看板出卡片。
  - 项目详情 `/pm/project/6` 的任务页签 ⇒ Segmented 也在，切到看板只看这个项目。

- [x] **Step 6: 提交**

  ```bash
  git add frontend/src/components/pm/task frontend/src/pages/module_pm/task frontend/src/pages/module_pm/project/detail.tsx frontend/config/routes.ts
  git commit -m "feat(task): 列表/看板/甘特合成一个页面,Segmented 切换,旧地址重定向"
  ```

---

### Task 6: e2e 守卫

**Files:**
- Create: `frontend/e2e/task-workspace.spec.ts`
- Modify: `frontend/e2e/pm-task-board.spec.ts`（URL 常量与断言）
- Modify: `frontend/e2e/pm-task-gantt.spec.ts`（URL 常量与断言）

**Interfaces:**
- Consumes: 现有 e2e 辅助（`frontend/e2e/helpers.ts`）
- Produces: 无新导出

- [x] **Step 1: 写 `task-workspace.spec.ts`**

  拦截 `GET **/pm_project/pm_task/list*`，返回一个**固定**的数据集（`total` 与 `items` 数量一致 ⇒ 不触发补页请求），
  并**记录请求次数**。

  - **切视图零请求**：进 `/pm/task` ⇒ 记下请求数 ⇒ 依次点「看板」「甘特」「列表」⇒ 请求数**不变**。
  - **看板拖拽 ⇒ 列表同步**：在看板里把一张卡拖到另一列（沿用 `pm-task-board.spec.ts` 的拖拽写法）⇒
    切回列表 ⇒ 那一行的「状态」列已经是新状态（**同一份数据**）。
  - **旧地址重定向**：`/pm/task/board` ⇒ URL 变成 `/pm/task?view=board` 且看板渲染。

- [x] **Step 2: 修受影响的旧 e2e**

  - `pm-task-board.spec.ts` 的 `BOARD_PAGE_PATH` ⇒ `'/pm/task?view=board'`
  - `pm-task-gantt.spec.ts` 的 `GANTT_PAGE_PATH` ⇒ `'/pm/task?view=gantt'`，
    且第 445 行附近的 `await expect(page).toHaveURL(/\/pm\/task\/gantt$/)` ⇒ 改成 `/\/pm\/task\?view=gantt$/`。

- [x] **Step 3: 跑全套 e2e**

  Run: `cd frontend && npx playwright test --reporter=line`
  Expected: 全部 PASS

- [x] **Step 4: 提交**

  ```bash
  git add frontend/e2e
  git commit -m "test(task): 守卫「切视图零请求」与「看板拖拽同步到列表」"
  ```

---

## 自查（对照 spec）

| spec 要求 | 在哪个任务 |
| --------- | ---------- |
| 共享数据集、全量取数、10 页封顶、显式提示 | Task 1（提示在 Task 3） |
| 本地筛选照后端语义 | Task 2 |
| 列表本地过滤 + 本地分页 | Task 3 |
| 看板/甘特吃共享数据、写回同步 | Task 4 |
| Segmented + `?view=` + 旧地址重定向 + 详情页接入 | Task 5 |
| 守卫（单测 + e2e） | Task 1/2 的单测 + Task 6 的 e2e |
| 上下文的 5 条 Review Focus | Task 1（去重）、Task 2（空值/大小写）、Task 6（零请求、拖拽同步） |
