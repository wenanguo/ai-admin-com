# 任务界面：列表 / 看板 / 甘特 三合一（Segmented 切换，切换零请求）

- 日期：2026-11-11
- 状态：已定稿（用户选了方案 A）

## 为什么要做

现在三个视图是**三个路由**：

| 路由 | 组件 | 取数方式 |
| ---- | ---- | -------- |
| `/pm/task` | `TaskListView` | ProTable 的 `request` ⇒ **服务端**分页 + 搜索 |
| `/pm/task/board` | `TaskBoard` | `useBoardColumns` ⇒ `listTasks(page_size=100)` |
| `/pm/task/gantt` | `TaskGantt` | `useGanttTasks` ⇒ `listTasks(page_size=100)` |

从列表点「看板」= **跳路由 + 组件重新挂载 + 重新发一次请求** ⇒ 用户说的「太慢」。
慢的根源不是渲染，是**每次切换都重新取数**。

目标：任务界面合成**一个页面**，顶部用 `Segmented` 切三种展现形式；
**页面进入时取一次数，之后切换视图零请求**。

## 方案（用户选的 A）

一个页面 + 一个 Segmented + 三视图共用**同一份数据**。

```
┌────────────────────────────────────────────────────┐
│  任务管理                          [列表│看板│甘特]  │  ← Segmented
├────────────────────────────────────────────────────┤
│  （按需挂载视图；数据来自共享缓存 ⇒ 切换零请求）      │
└────────────────────────────────────────────────────┘
```

### 数据层：共享的数据集

新增 `src/components/pm/task/useTaskDataset.ts`：

- 用 umi 已有的 **react-query**（`config/config.ts` 的 `reactQuery: {}` ⇒ 全局
  `QueryClientProvider` 已就位）缓存一份「任务全集」。
- **取全量，不受后端 100 条/页的限制**：
  1. 第 1 页 `page_size=100` ⇒ 拿到 `total`
  2. 若 `total > 100` ⇒ **并行**把剩下的页补齐（`ceil(total/100) - 1` 个请求）
  3. 合并成一份数组
- **上限保护**：最多拉 10 页（1000 条）。超了 ⇒ `truncated = true`，
  页面**显式提示**（沿用本仓「上限不静默」的传统），不假装数据是全的。
- queryKey：`['pm', 'task', 'dataset', projectId ?? 'all']`
- `staleTime: 5 分钟` ⇒ 切视图（组件重新挂载）**不会**触发 refetch；
  离开页面超过 5 分钟再回来会刷新（新鲜度）。

暴露：`{ tasks, total, loading, error, truncated, reload, patchTask }`

- `patchTask(task)`：本地改一条 ⇒ 三个视图立刻一致（看板拖拽改状态 ⇒
  列表里立刻能看到变化，这是现在两个页面做不到的）。

### 三个视图怎么吃这份数据

| 视图 | 改法 |
| ---- | ---- |
| 列表 | ProTable 的 `request` 改成**本地** request：从 dataset 里按搜索参数过滤 + 分页 |
| 看板 | `useBoardColumns` 不再自己发请求，改吃 dataset 的 `tasks` |
| 甘特 | `useGanttTasks` 不再自己发请求，改吃 dataset 的 `tasks` |

看板/甘特原来的 `page_size=100` 上限**因此消失**（它们能看到全部任务）；
`truncated` 改成「dataset 本身被上限截断」才为 true。

### 本地筛选必须复刻后端语义

后端 `ModulePmTaskQueryParam.__post_init__`（`~/project/AiAdmin/backend/app/plugin/module_pm_project/pm_task/schema.py`）：

| 字段 | 语义 |
| ---- | ---- |
| `title` | **LIKE %v%** |
| `status_code` | **LIKE %v%** |
| `priority_code` | **LIKE %v%** |
| `created_via_code` | **LIKE %v%** |
| `blocked_reason` | **LIKE %v%** |
| 其余（`project_id` / `milestone_id` / `type_code` / `assignee_id` …） | **eq** |

前端可搜索的字段只有 6 个：**标题、项目、状态、优先级、类型、负责人**
（其余列都是 `search: false`）⇒ 本地筛选实现：

- `title` / `status_code` / `priority_code`：`String(value).includes(关键字)`（LIKE %v%）
- `project_id` / `type_code` / `assignee_id`：严格相等

⚠️ **空值/未填的筛选条件不参与过滤**（与后端「参数为 None 就不加条件」一致）。

### 路由

- `/pm/task` 承载 Segmented；当前视图放在 URL query：`?view=list|board|gantt`
  （刷新保持、深链接可用；pathname 仍是 `/pm/task` ⇒ 侧边栏「任务」高亮不受影响）
- `/pm/task/board`、`/pm/task/gantt` 保留成**重定向**到 `/pm/task?view=board|gantt`
  ⇒ 老链接不失效
- 侧边栏菜单**不动**（后端只下发了「任务」这一项，看板/甘特从来不是菜单项）
- 列表页工具栏上的「看板」「甘特」两个按钮**删掉**（Segmented 就是切换器）

### 项目详情页的「任务」页签

同一套组件 ⇒ 也挂同样的 Segmented（`projectId` 传进去，dataset 按项目限定）。
视图状态同样放 URL query（`?view=board`）。

### 目标与不目标

**目标**

- 切视图**零请求、零闪烁**
- 三个视图看的是**同一份数据**（写操作互相可见）
- 列表的搜索结果与现在**语义一致**

**不目标**

- 不改后端（AiAdmin FastAPI 不动）
- 不改看板/甘特的交互（拖拽改状态、改期照旧）
- 不做任务数据的实时推送

## 风险与取舍

| 风险 | 处置 |
| ---- | ---- |
| 数据量大时进入页面要多个请求 | 100 条/页并行补齐；10 页（1000 条）封顶，超了显式提示 |
| 列表搜索从服务端变本地 | 语义照后端实现；因为加载的是全集，结果与服务端一致 |
| 别人改了数据，本地缓存不新鲜 | `staleTime` 5 分钟 + 窗口聚焦刷新 + 写操作后 `reload()` |
| 旧的看板/甘特深链接 | 改成重定向，老链接仍能到 |

## 守卫

- **单测**：本地筛选的 like/eq 语义（对照后端 `__post_init__`）
- **e2e**：切视图时**不新增任何请求**（拦截请求计数）
- **e2e**：看板拖拽改状态后，列表里那一行的状态也变了（同一份数据）

## 交付步骤（见 plan）

1. `useTaskDataset`（react-query + 全量取数 + 上限提示）
2. 列表改本地筛选/分页（语义照后端）
3. 看板/甘特改吃共享数据
4. `TaskWorkspace`（Segmented + 三视图）+ 路由重定向 + 详情页页签接入
5. 守卫（单测 + e2e）
