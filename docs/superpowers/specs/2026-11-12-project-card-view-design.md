# 项目清单加「卡片视图」——设计

日期：2026-11-12
状态：待批准

## 一句话

项目清单也做成**工作台**：顶部 `Segmented` 切「列表 / 卡片」，
两个视图读**同一份数据**、切视图**零请求** —— 与任务页（列表/看板/甘特）同一套路。

## 背景：任务页已经这么干了

`/pm/task` 现在是 `TaskWorkspace`：

| 部件 | 作用 |
| ---- | ---- |
| `useTaskDataset` | react-query 取**全量**任务（并发补页，封顶 10 页/1000 条），缓存 5 分钟 |
| `filterTasks` | **本地**筛选，语义照抄后端（LIKE / eq 的区别） |
| `TaskListView` | ProTable，`request` 读本地数据集 ⇒ 搜索与分页在浏览器里做 |
| `TaskBoard` / `TaskGantt` | 同一份数据的另外两种呈现 |
| `TaskWorkspace` | 顶部 Segmented，视图状态放 `?view=`（`replace`，不塞历史） |

⇒ 切视图**一个请求都不多发**；看板拖完状态，切回列表立刻看到变化。

**项目清单现在还是另一套**：ProTable 直接走后端（后端筛 + 后端分页），
所以「加一个卡片视图」如果照抄成两个各取各数的页面，就会出现：
切视图要重新取数、两个视图的筛选结果可能对不上。

## 决定

### 1. 数据层：照任务页整套搬

新增 `useProjectDataset`（react-query）+ `filterProjects`（本地筛选）：

- 取全量项目：第 1 页拿 `total`，剩下的页**并发**拉；封顶 10 页/1000 条，
  超出时**显式提示**（本仓传统：上限不静默）。
- `queryKey = ['pm','project','dataset']`，`staleTime` 5 分钟 ⇒ 切视图不 refetch。
- `patchProject` 改本地缓存 ⇒ 写操作后两个视图立刻一致。

**筛选语义照后端**（`ModulePmProjectQueryParam.__post_init__`，
`~/project/AiAdmin/backend/app/plugin/module_pm_project/pm_project/schema.py`）：

| 字段 | 后端 | 本地 |
| ---- | ---- | ---- |
| `code` / `name` / `status_code` / `priority_code` / `visibility_code` | `QueueEnum.like` ⇒ `LIKE %v%` | **包含**（大小写不敏感，与 MySQL 的 `utf8mb4_general_ci` 一致） |
| `owner_id` / `template_id` / `start_date` / `due_date` / `tags` / `extra_fields` | `QueueEnum.eq` ⇒ `=` | **严格相等** |

### 2. 视图切换

新增 `ProjectWorkspace`：

```
┌──────────────────────────────────────────────┐
│ 项目管理                    [ 列表 | 卡片 ]  │
├──────────────────────────────────────────────┤
│  （当前视图）                                 │
└──────────────────────────────────────────────┘
```

- 视图状态在 `?view=list|card`（与任务页同款：`replace`，认不出来回列表）。
- `/pm/project` 路由页变成**壳**（只渲染 `<ProjectWorkspace />`）。
- pathname 不变 ⇒ 侧边栏「项目列表」高亮不受影响。

### 3. 卡片（紧凑看板卡）

用户选定：**紧凑卡**（不是信息卡）。

```
┌──────────────────────────────┐
│ AIPM 核心项目           🤖    │  名称（点进去=详情页）+ 机器人（与 AI 讨论）
│ 规划中 · 高 · 张三 · 12-31    │  状态 · 优先级 · 负责人 · 计划截止
└──────────────────────────────┘
```

- 网格：`Row`/`Col`，`xs=24 sm=12 lg=8 xl=6`（窄屏一列）。
- 名称是**详情页入口**、机器人是**与 AI 讨论** —— 与列表页**同一个** `discussProject`
  函数 ⇒ 行为一致（点机器人不会顺手进详情页）。
- 卡片右下角 hover 出现 **编辑 / 删除**（权限判断与表格同一套）。
- 空态：没有项目 ⇒ 空状态提示。

### 4. 卡片视图的筛选行

任务页的看板没有筛选（它按状态分列，天然分组）。项目卡片没有分组 ⇒
**卡片视图自带一个精简筛选行**：名称/编码模糊搜索框 + 状态 + 优先级下拉，
本地筛同一份数据集。

（筛选是**每个视图自己的** UI 状态，与任务页一致：列表有 ProTable 的搜索表单，
甘特有项目筛选。）

### 5. 写操作

- 新增/编辑/删除仍走现有的 `useCrudTable` + `ProjectModalForm`（后端契约只有一份）。
- 写操作后 `dataset.reload()`（与任务列表同款：本地筛选的数据源变了，重刷 ProTable 没用）。
- 「新增」按钮：列表在 ProTable 工具栏里，卡片视图在自己的筛选行右边
  （与甘特图自己带一个「新增任务」同款）。

## 文件

```
frontend/src/components/pm/project/
  ProjectWorkspace.tsx     # Segmented + 视图分发
  ProjectListView.tsx      # 表格（从 pages 抽出来，改成本地筛选）
  ProjectCardView.tsx      # 紧凑卡片
  ProjectModalForm.tsx     # 从 pages/module_pm/project/ModalForm.tsx 搬过来
  useProjectDataset.ts     # 共享数据集
  filterProjects.ts        # 本地筛选（语义照后端）
frontend/src/pages/module_pm/project/index.tsx   # 变成壳
```

## 守卫

| 守卫 | 钉住什么 |
| ---- | -------- |
| `filterProjects.test.ts` | 本地筛选语义照后端（LIKE 大小写不敏感 / eq 严格 / 空值不参与） |
| `e2e/project-workspace.spec.ts`「切视图不重新取数」 | 切视图一个请求都不多发（与任务页同款） |
| 同上「两个视图是同一份数据」 | 卡片里的项目集合 == 列表里的行集合 |
| 同上「视图状态在 URL 上」 | `?view=card` 刷新保持 |
| 同上「卡片上的机器人」 | 点它打开 AI 工作台并带上项目上下文，**不进**详情页 |

⚠️ 现有 e2e「渲染后端菜单与项目列表,分页参数用 page_no / page_size」
断言的是 `page_size=10` ⇒ 改成共享数据集后首次请求是 `page_size=100` ⇒ **该断言要改**
（任务页当初也是这么改的）。

## 不做什么

- 不动后端（数据契约不变）。
- 不给项目做看板/甘特（用户只要了卡片视图）。
- 不把 `ProjectModalForm` 的表单拆开重写（只是搬位置）。
