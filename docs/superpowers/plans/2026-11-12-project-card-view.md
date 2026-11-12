# 项目清单「卡片视图」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目清单做成工作台 —— 顶部 `Segmented` 切「列表 / 卡片」，两个视图读**同一份数据**、切视图**零请求**（与任务页的列表/看板/甘特同一套路）。

**Architecture:** 新增 `useProjectDataset`（react-query 取全量项目，缓存 5 分钟）+ `filterProjects`（本地筛选，语义照抄后端）；`ProjectListView`（表格）与 `ProjectCardView`（紧凑卡片）各自调用同一个 `useProjectDataset()` ⇒ react-query 按 queryKey 去重 ⇒ **只发一次请求**；`ProjectWorkspace` 用 `Segmented` 分发视图，视图状态放 `?view=list|card`。

**Tech Stack:** React 19 · Umi Max 4 · antd 6（Segmented / Card / Row / Col）· ProComponents 3（ProTable）· @tanstack/react-query（共享数据集）· Vitest（browser + node）· Playwright（e2e）

**Spec:** `docs/superpowers/specs/2026-11-12-project-card-view-design.md`

## Global Constraints

- 后端**不动**（数据契约不变）。
- 本地筛选语义**必须照后端** `ModulePmProjectQueryParam.__post_init__`
  （`~/project/AiAdmin/backend/app/plugin/module_pm_project/pm_project/schema.py`）：
  - **LIKE**（包含，大小写不敏感）：`code` / `name` / `status_code` / `priority_code` / `visibility_code`
  - **eq**（严格相等）：`owner_id` / `template_id` / `start_date` / `due_date` / `tags` / `extra_fields`
- 取数上限：封顶 **10 页 × 100 条 = 1000 条**；`total > items.length` ⇒ **显式提示**，不静默。
- 视图状态只放 **URL 的 `?view=`**（`replace`，不塞浏览器历史）；pathname 不变。
- 所有新代码 Biome 干净、`tsc --noEmit` 干净。
- 单测跑：`cd frontend && npx vitest run --config vitest.local.config.ts`（`NODE_ENV` 不能是 `production`）。
- e2e 跑：`cd frontend && npx playwright test`。
- 提交用 Conventional Commits（中文正文），走 husky 的 lint-staged。

## Review Focus

规格没写、但最可能咬人的五个输入/情形（各自的任务里要有对应的测试）：

1. **项目数超过 1000** ⇒ 数据集被封顶截断 ⇒ 页面必须**显式提示**「只拿到前 N 条」，
   不能让人以为看到了全部（`useProjectDataset` 的 `truncated` ⇒ 卡片与表格都要给提示）。
2. **搜索框里的大小写**（如 `aipm-core` vs `AIPM-CORE`）⇒ 与 MySQL 的 `utf8mb4_general_ci` 一致，
   **大小写不敏感**（`filterProjects` 的单测钉死）。
3. **筛选后没有任何项目** ⇒ 表格与卡片都要给**空态**，不是白屏（`filterProjects` 返回空数组 ⇒
   ProTable 空态 / 卡片空态文案）。
4. **「与 AI 讨论」机器人点在卡片上** ⇒ 打开 AI 工作台并带上**这个项目**的上下文，
   且**不进**详情页（机器人是名称链接的兄弟，不是嵌在链接里）。
5. **写操作（新增/编辑/删除）之后切视图** ⇒ 两个视图都要是**新数据**
   （写完 `dataset.reload()`；卡片视图不能还拿着旧缓存）。

---

## 文件结构

```
frontend/src/components/pm/project/
  filterProjects.ts        # 本地筛选（纯函数，语义照后端）
  filterProjects.test.ts   # 单测
  useProjectDataset.ts     # 共享数据集（react-query）
  useProjectDataset.test.ts# 单测
  ProjectListView.tsx      # 表格视图（从 pages 搬过来，改成本地 request）
  ProjectCardView.tsx      # 紧凑卡片视图
  ProjectModalForm.tsx     # 从 pages/module_pm/project/ModalForm.tsx 搬过来
  ProjectWorkspace.tsx     # Segmented + 视图分发 + ?view=
frontend/src/pages/module_pm/project/index.tsx   # 变成壳（渲染 <ProjectWorkspace />）
frontend/e2e/project-workspace.spec.ts           # 新增：切视图/同一份数据/URL 状态/机器人
frontend/e2e/pm-project.spec.ts                  # 改：page_size 断言（10 ⇒ 100）
```

---

### Task 1: 本地筛选 `filterProjects`

**Files:**
- Create: `frontend/src/components/pm/project/filterProjects.ts`
- Create: `frontend/src/components/pm/project/filterProjects.test.ts`

**Interfaces:**
- Consumes: `ProjectOut`（`@/services/api/pm/project`）
- Produces:
  ```ts
  export const LIKE_FIELDS: readonly string[];    // ['code','name','status_code','priority_code','visibility_code']
  export const SEARCHABLE_FIELDS: readonly string[];// ['name','code','status_code','priority_code','owner_id']
  export function filterProjects(
    projects: ProjectOut[],
    filters: Record<string, unknown>,
  ): ProjectOut[];
  ```

- [ ] **Step 1: 写失败的单测**

`frontend/src/components/pm/project/filterProjects.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { ProjectOut } from '@/services/api/pm/project';
import { filterProjects } from './filterProjects';

function project(overrides: Partial<ProjectOut>): ProjectOut {
  return { id: 1, name: 'AIPM 核心项目', code: 'AIPM-CORE', ...overrides };
}

describe('filterProjects', () => {
  it('没有筛选条件 ⇒ 原样返回', () => {
    const projects = [project({}), project({ id: 2 })];
    expect(filterProjects(projects, {})).toHaveLength(2);
  });

  it('name 是「包含」不是「等于」', () => {
    const projects = [project({ id: 1 }), project({ id: 2, name: '订单中心' })];
    expect(filterProjects(projects, { name: '核心' }).map((p) => p.id)).toEqual([1]);
  });

  it('name/code 的模糊匹配大小写不敏感（与 MySQL 的 LIKE 一致）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { name: 'aipm' })).toHaveLength(1);
    expect(filterProjects(projects, { name: 'AIPM' })).toHaveLength(1);
    expect(filterProjects(projects, { code: 'aipm-core' })).toHaveLength(1);
  });

  it('owner_id 是严格相等（数字用字符串比 ⇒ 表单给的 "7" 能匹配 7）', () => {
    const projects = [project({ id: 1, owner_id: 7 }), project({ id: 2, owner_id: 8 })];
    expect(filterProjects(projects, { owner_id: '7' }).map((p) => p.id)).toEqual([1]);
  });

  it('空值条件不参与过滤（后端「参数为 None 就不加条件」）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { name: '' })).toHaveLength(1);
    expect(filterProjects(projects, { owner_id: undefined })).toHaveLength(1);
  });

  it('白名单之外的 key 不参与过滤（分页/版本号等塞进来的参数）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { __v: 123, current: 2 })).toHaveLength(1);
  });

  it('筛不出东西 ⇒ 空数组（不是保留全部）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { name: '不存在的项目' })).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/project/filterProjects.test.ts
```
Expected: FAIL —— `Cannot find module './filterProjects'`。

- [ ] **Step 3: 实现 `filterProjects`**

`frontend/src/components/pm/project/filterProjects.ts`：

- 照抄 `frontend/src/components/pm/task/filterTasks.ts` 的结构与注释口径（**逐字对齐**那份文件的
  「语义照后端」表格与两个 helper）：
  - `isEmptyValue(value)`：`undefined` / `null` / `''` / `[]` ⇒ 空。
  - `matchLike(actual, expected)`：`String(actual ?? '').toLowerCase().includes(String(expected).toLowerCase())`。
  - `matchEq(actual, expected)`：`String(actual ?? '') === String(expected)`（数字用字符串比）。
- `LIKE_FIELDS = ['code','name','status_code','priority_code','visibility_code']`
- `SEARCHABLE_FIELDS = ['name','code','status_code','priority_code','owner_id']`
- `filterProjects(projects, filters)`：先按 `SEARCHABLE_FIELDS` 取 active 条件（空值剔除），
  active 为空 ⇒ 原样返回；否则每个项目要**全部**条件命中。

- [ ] **Step 4: 跑测试，确认通过**

```bash
cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/project/filterProjects.test.ts
```
Expected: PASS（7 个用例全过）。

- [ ] **Step 5: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/pm/project/
git commit -m "feat(pm): 项目本地筛选,语义照后端(LIKE/eq 的区别)"
```

---

### Task 2: 共享数据集 `useProjectDataset`

**Files:**
- Create: `frontend/src/components/pm/project/useProjectDataset.ts`
- Create: `frontend/src/components/pm/project/useProjectDataset.test.ts`

**Interfaces:**
- Consumes: `listProjects(params)`（`@/services/api/pm/project`）、`ProjectOut`
- Produces:
  ```ts
  export const PROJECT_DATASET_PAGE_SIZE = 100;   // 后端上限
  export const PROJECT_DATASET_MAX_PAGES = 10;     // 封顶 1000 条
  export interface ProjectDatasetPage { items: ProjectOut[]; total: number }
  export async function fetchAllProjects(): Promise<ProjectDatasetPage>;
  export interface ProjectDatasetResult {
    projects: ProjectOut[];
    total: number;
    loading: boolean;
    error: Error | null;
    truncated: boolean;       // total > projects.length ⇒ 被封顶截断了
    dataUpdatedAt: number;    // react-query 的版本号
    reload: () => void;
    patchProject: (project: ProjectOut) => void;
  }
  export function useProjectDataset(): ProjectDatasetResult;
  ```

- [ ] **Step 1: 写失败的单测**

`frontend/src/components/pm/project/useProjectDataset.test.ts`（照抄
`frontend/src/components/pm/task/useTaskDataset.test.ts` 的假后端写法）：

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ProjectOut } from '@/services/api/pm/project';
import {
  fetchAllProjects,
  PROJECT_DATASET_MAX_PAGES,
} from './useProjectDataset';

const mocks = vi.hoisted(() => ({ listProjects: vi.fn() }));
vi.mock('@/services/api/pm/project', () => ({ listProjects: mocks.listProjects }));

function envelope(data: unknown) {
  return { code: 0, msg: 'ok', data, status_code: 200, success: true };
}
function project(id: number): ProjectOut {
  return { id, name: `项目 ${id}`, code: `P-${id}` };
}

/** 假后端：按 page_no 切分 all，并记录实际被请求过的页码 */
function fakeBackend(all: ProjectOut[]) {
  const pages: number[] = [];
  mocks.listProjects.mockImplementation(async (params: { page_no?: number; page_size?: number }) => {
    const pageNo = params.page_no ?? 1;
    const size = params.page_size ?? 100;
    pages.push(pageNo);
    const start = (pageNo - 1) * size;
    return envelope({ items: all.slice(start, start + size), total: all.length });
  });
  return pages;
}

describe('fetchAllProjects', () => {
  it('总数一页装得下 ⇒ 只发 1 次请求', async () => {
    const pages = fakeBackend([project(1), project(2)]);
    const result = await fetchAllProjects();
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(pages).toEqual([1]);
  });

  it('装不下 ⇒ 把剩下的页并行补齐', async () => {
    const all = Array.from({ length: 250 }, (_, i) => project(i + 1));
    const pages = fakeBackend(all);
    const result = await fetchAllProjects();
    expect(result.items).toHaveLength(250);
    expect(result.total).toBe(250);
    expect(pages).toEqual([1, 2, 3]);
  });

  it('封顶 10 页 ⇒ 只拉 10 页，total 仍是后端说的数', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => project(i + 1));
    const pages = fakeBackend(all);
    const result = await fetchAllProjects();
    expect(result.items).toHaveLength(PROJECT_DATASET_MAX_PAGES * 100);
    expect(result.total).toBe(1200);
    expect(pages).toHaveLength(PROJECT_DATASET_MAX_PAGES);
  });

  it('多页里出现同一个 id ⇒ 只留一条', async () => {
    mocks.listProjects.mockImplementation(async (params: { page_no?: number; page_size?: number }) => {
      const pageNo = params.page_no ?? 1;
      const items = pageNo === 1 ? [project(1)] : [project(1), project(2)];
      return envelope({ items, total: 3 });
    });
    const result = await fetchAllProjects();
    expect(result.items.map((p) => p.id)).toEqual([1, 2]);
  });

  it('排序口径写死在请求里（不靠后端默认值）', async () => {
    const pages = fakeBackend([project(1)]);
    await fetchAllProjects();
    expect(mocks.listProjects.mock.calls[0][0]).toHaveProperty('order_by');
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/project/useProjectDataset.test.ts
```
Expected: FAIL —— `Cannot find module './useProjectDataset'`。

- [ ] **Step 3: 实现 `useProjectDataset`**

`frontend/src/components/pm/project/useProjectDataset.ts` —— **照抄**
`frontend/src/components/pm/task/useTaskDataset.ts` 的结构，逐项对应：

| task 版 | project 版 |
| ------- | ---------- |
| `TASK_DATASET_PAGE_SIZE = 100` | `PROJECT_DATASET_PAGE_SIZE = 100` |
| `TASK_DATASET_MAX_PAGES = 10` | `PROJECT_DATASET_MAX_PAGES = 10` |
| `ORDER_BY = JSON.stringify([{ id: 'desc' }])` | 同（项目列表现在就是 id 倒序） |
| `QUERY_KEY_PREFIX = ['pm','task','dataset']` | `['pm','project','dataset']` |
| `STALE_TIME = 5 * 60 * 1000` | 同 |
| `fetchAllTasks` | `fetchAllProjects`（第 1 页拿 total ⇒ 并发拉第 2..N 页 ⇒ 按 id 去重） |
| `useTaskDataset({projectId})` | `useProjectDataset()`（**不传 projectId**：项目列表从不按项目限定） |
| `patchTask` | `patchProject`（改本地缓存里那一条） |

⚠️ `useProjectDataset` **不要** `projectId` 参数：项目清单永远看全部项目
（项目详情页里没有「项目列表」页签），加了就是没人用的参数。

- [ ] **Step 4: 跑测试，确认通过**

```bash
cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/project/useProjectDataset.test.ts
```
Expected: PASS（5 个用例全过）。

- [ ] **Step 5: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/pm/project/
git commit -m "feat(pm): 项目共享数据集(react-query),列表与卡片读同一份"
```

---

### Task 3: `ProjectListView`（表格改本地筛选）+ 搬 `ProjectModalForm`

**Files:**
- Create: `frontend/src/components/pm/project/ProjectListView.tsx`
- Create: `frontend/src/components/pm/project/ProjectModalForm.tsx`（从 `frontend/src/pages/module_pm/project/ModalForm.tsx` **移动**过来，内容不改，只改 import 路径）
- Create: `frontend/src/components/pm/project/useDiscussProject.ts`
- Modify: `frontend/src/pages/module_pm/project/index.tsx`（改成只渲染 `<ProjectListView />`）

**Interfaces:**
- Consumes: `filterProjects`（Task 1）、`useProjectDataset`（Task 2）、
  `useCrudTable` / `useCrudColumns`（`@/components/CrudTable`）、
  `useDictOptions`（`@/components/pm/useDictOptions`）、
  `buildAiProjectContext` / `mergeDictLabels`（`@/components/pm/aiContext`）
- Produces:
  ```ts
  // useDiscussProject.ts —— 列表页与卡片页共用同一个「与 AI 讨论」实现
  export function useDiscussProject(): (project: ProjectOut) => void;

  // ProjectListView.tsx
  export function ProjectListView(): React.ReactElement;

  // ProjectModalForm.tsx（从 pages 搬过来，default export）
  export default function ProjectModalForm(props: /* 原样 */): React.ReactElement;
  ```

- [ ] **Step 1: 搬 `ProjectModalForm`**

```bash
cd /Users/ruanying/project/ai-admin-com
git mv frontend/src/pages/module_pm/project/ModalForm.tsx frontend/src/components/pm/project/ProjectModalForm.tsx
```
然后把它的 import 里所有 `@/pages/module_pm/...` 的引用改成 `@/components/pm/...`；
若它 import 了 `@/pages/module_pm/project/...` 下的别的文件，一并改成新路径。

- [ ] **Step 2: 建 `useDiscussProject.ts`**

把现在 `pages/module_pm/project/index.tsx` 里那段 `discussProject`（`buildAiProjectContext`
→ `aiBridge.setContext` → `requestExpand` → `requestFocus`）**原样搬进**
`frontend/src/components/pm/project/useDiscussProject.ts`：

```ts
export function useDiscussProject(): (project: ProjectOut) => void
```

⚠️ **必须搬，不许抄两份**：列表页与卡片页要用**同一个**实现，
否则两边的「与 AI 讨论」迟早不一致（上下文字段、是否切到对话页签）。

- [ ] **Step 3: 建 `ProjectListView.tsx`**

从 `frontend/src/pages/module_pm/project/index.tsx`（搬之前的那一版）搬过来，**只做这些改动**：

1. 顶部注释改成说明「本组件是列表视图；卡片视图是 `ProjectCardView`；两个视图共用 `useProjectDataset`」。
   `discussProject` 改成 `const discussProject = useDiscussProject();`（本页自己那段删掉）。
2. 加 `const dataset = useProjectDataset();`
3. `useCrudTable({...})` 的 `reload` 传 `dataset.reload`（**不要**用默认的
   `actionRef.current.reload()`：本地筛选的数据源变了，重刷 ProTable 没用）。
4. ProTable 的 `request` 从 `requestProjects`（走后端）换成**本地**的：

```ts
const requestLocal = useCallback(
  async (params: { current?: number; pageSize?: number; [key: string]: unknown }) => {
    const { current, pageSize, ...filters } = params;
    const filtered = filterProjects(dataset.projects, filters);
    const size = pageSize ?? 10;
    const start = ((current ?? 1) - 1) * size;
    return { data: filtered.slice(start, start + size), total: filtered.length, success: true };
  },
  [dataset.projects],
);
```

5. ProTable 的 `params={{ __v: dataset.dataUpdatedAt }}`（数据变了 ⇒ 重跑一次本地切片）。
6. ProTable 的 `columns` 里，**可搜索**的字段必须与 `SEARCHABLE_FIELDS` 对得上：
   `name` / `code`（模糊）/ `status_code` / `priority_code`（下拉）/ `owner_id`（远程 select）——
   这几个保持现状（`search` 不为 false）；`id` / `start_date` / `tags` / `created_time`
   保持 `search: false`。
7. `import { requestProjects }` / `toProTableRequest` 不再需要 ⇒ 删掉这两个 import 与常量。
8. **`headerTitle` 去掉**（标题在工作台上，与 `TaskWorkspace` 同款）。
9. 顶部加**截断提示**（封顶 1000 条时不静默）：

```tsx
{dataset.truncated ? (
  <Alert
    type="info"
    showIcon
    title={`项目太多,一次最多取 ${dataset.projects.length} 条(共 ${dataset.total} 条),其余请用搜索缩小范围`}
  />
) : null}
```

10. `ProjectModalForm` 的 import 改成同目录：`./ProjectModalForm`。

- [ ] **Step 4: 改 `pages/module_pm/project/index.tsx` 成壳**

```tsx
/**
 * 项目管理页 —— 路由 `/pm/project`（菜单由后端下发）。
 *
 * ⚠️ 本页暂时只渲染列表视图；卡片视图与切换器在 Task 5 的 `ProjectWorkspace` 里
 * （列表 / 卡片两种视图，用 Segmented 切，共享同一份数据）。
 */
import type React from 'react';
import { ProjectListView } from '@/components/pm/project/ProjectListView';

const ProjectManagement: React.FC = () => <ProjectListView />;

export default ProjectManagement;
```

- [ ] **Step 5: 类型检查 + 单测 + 构建**

```bash
cd frontend && npx tsc --noEmit && npx vitest run --config vitest.local.config.ts && npm run build
```
Expected: tsc 无错、单测全过、构建成功。

- [ ] **Step 6: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/pm/project/ frontend/src/pages/module_pm/project/
git commit -m "refactor(pm): 项目列表搬进共享组件,筛选与分页改在本地做"
```

---

### Task 4: `ProjectCardView`（紧凑卡片）

**Files:**
- Create: `frontend/src/components/pm/project/ProjectCardView.tsx`

**Interfaces:**
- Consumes: `useProjectDataset`（Task 2）、`filterProjects`（Task 1）、
  `useCrudTable` / `useCrudColumns`、`useDictOptions`、`DictTag`、
  `useDiscussProject`（**Task 3 产出**）、`ProjectModalForm`（Task 3）
- Produces: `export function ProjectCardView(): React.ReactElement`

- [ ] **Step 1: 建 `ProjectCardView.tsx`**

结构（照 `TaskBoard` 的卡片写法，但**紧凑**）：

```
┌──────────────────────────────┐
│ AIPM 核心项目           🤖    │  名称（Link → /pm/project/:id）+ 机器人（与 AI 讨论）
│ 规划中 · 高 · 张三 · 12-31    │  状态 · 优先级 · 负责人 · 计划截止
└──────────────────────────────┘
```

- 顶部筛选行（antd `Input.Search` + 两个 `Select`）：名称/编码模糊搜索框、状态、优先级。
  - 状态/优先级的选项来自 `useDictOptions('module_pm_project_status')` /
    `useDictOptions('module_pm_priority')`（与表格共用同一套字典 ⇒ 标签一致）。
  - 筛选走 `filterProjects(dataset.projects, { name, code, status_code, priority_code })`
    —— **注意**：搜索框同时匹配 `name` 与 `code` ⇒ 调用两次 `filterProjects` 取交集
    （或直接写一个 `matchLike` 判 name/code 任一命中；**用后者**，并在自己的文件里
    写明「这是卡片视图自己的便捷筛选，不属于 `filterProjects` 的后端语义」）。
- 卡片网格：antd `Row gutter={[16,16]}` + `Col xs={24} sm={12} lg={8} xl={6}`。
- 每张卡片：antd `Card`（`size="small"`），**根元素带 `data-project-id={project.id}`**
  （e2e 要靠它数卡片、和表格的行数对比），
  `title` = 项目名（`Link`）+ 右上角机器人按钮
  （**机器人是标题链接的兄弟，不是嵌在链接里** ⇒ 点它不会顺手进详情页）；
  卡片正文第二行 = `DictTag` 状态 · `DictTag` 优先级 · `owner_by?.name` · 计划截止日期。
- 卡片右下角 hover 出现 **编辑 / 删除** 两个小按钮（`access.hasPermission` 判断与表格同一套：
  `module_pm_project:pm_project:update` / `:delete`）。
- 「新增」按钮放在筛选行右边（与甘特图自己带一个「新增任务」同款）。
- 空态：没有项目 ⇒ antd `Empty description="没有符合条件的项目"`。
- 截断提示同 `ProjectListView`（`dataset.truncated` ⇒ `Alert`）。
- 「与 AI 讨论」：`const discussProject = useDiscussProject();`（**Task 3 产出的共享 hook**）——
  列表页与卡片页调的是**同一个**实现 ⇒ 两边的行为不可能不一致。

- [ ] **Step 2: 浏览器模式组件测试**

`frontend/src/components/pm/project/ProjectCardView.test.tsx`（browser 模式，
照 `src/components/ai-workspace/AiWorkspaceShell.test.tsx` 的写法：`vi.hoisted` + `vi.mock`）：

- 钉四件事：
  1. 渲染出项目名、状态标签、负责人；
  2. 点机器人 ⇒ 调用了 `setContext`（带上这个项目的上下文），**没有**导航到详情页；
  3. 筛选框输入 ⇒ 只剩匹配的项目；
  4. **筛不出东西 ⇒ 显示空态**（`Empty`，文案「没有符合条件的项目」），不是白屏。

⚠️ browser 模式的全局视口是 **414×896（手机宽）** ⇒ 卡片是 `xs={24}` 一列一行，
断言按窄屏写。

- [ ] **Step 3: 跑测试**

```bash
cd frontend && npx vitest run --config vitest.local.config.ts src/components/pm/project/ProjectCardView.test.tsx
```
Expected: PASS。

- [ ] **Step 4: 类型检查 + 提交**

```bash
cd frontend && npx tsc --noEmit && npx biome check --write src/components/pm/project/
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/pm/project/
git commit -m "feat(pm): 项目卡片视图(紧凑卡,与列表同一份数据)"
```

---

### Task 5: `ProjectWorkspace`（Segmented 切视图）

**Files:**
- Create: `frontend/src/components/pm/project/ProjectWorkspace.tsx`
- Modify: `frontend/src/pages/module_pm/project/index.tsx`（`<ProjectListView />` ⇒ `<ProjectWorkspace />`）

**Interfaces:**
- Consumes: `ProjectListView`、`ProjectCardView`（Task 3/4）
- Produces:
  ```ts
  export type ProjectView = 'list' | 'card';
  export function parseProjectView(raw: string | null): ProjectView;
  export function ProjectWorkspace(): React.ReactElement;
  ```

- [ ] **Step 1: 建 `ProjectWorkspace.tsx`**

照抄 `frontend/src/components/pm/task/TaskWorkspace.tsx` 的结构：

- `const [searchParams, setSearchParams] = useSearchParams();`
- `const view = parseProjectView(searchParams.get('view'));`
  （`parseProjectView`：`'card'` ⇒ `'card'`；`'list'` ⇒ `'list'`；其余 ⇒ `'list'`）
- `changeView(next)`：`params.set('view', String(next))` + `setSearchParams(params, { replace: true })`
- 顶栏：`项目管理`（标题）+ `Segmented`
  （选项：`{ label: '列表', value: 'list', icon: <UnorderedListOutlined /> }`、
  `{ label: '卡片', value: 'card', icon: <AppstoreOutlined /> }`）
- 下面：`view === 'list' ? <ProjectListView /> : null` / `view === 'card' ? <ProjectCardView /> : null`
  （只挂载当前视图 —— 两个视图各自调 `useProjectDataset()`，queryKey 相同 ⇒ **只发一次请求**）

- [ ] **Step 2: 改 `pages/module_pm/project/index.tsx`**

把 Task 3 留的 `<ProjectListView />` 换成 `<ProjectWorkspace />`（注释同步改成「列表 / 卡片两种视图」）。

- [ ] **Step 3: 类型检查 + 构建**

```bash
cd frontend && npx tsc --noEmit && npm run build
```
Expected: 无错、构建成功。

- [ ] **Step 4: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/pm/project/ frontend/src/pages/module_pm/project/
git commit -m "feat(pm): 项目清单合成一个页面,列表/卡片用 Segmented 切"
```

---

### Task 6: e2e 守卫 + 修旧断言

**Files:**
- Create: `frontend/e2e/project-workspace.spec.ts`
- Modify: `frontend/e2e/pm-project.spec.ts`（那条 `page_size=10` 的断言）

**Interfaces:**
- Consumes: `ProjectWorkspace`（Task 5）、`useProjectDataset`（Task 2）
- Produces: 无（只有守卫）

- [ ] **Step 1: 改旧断言**

`frontend/e2e/pm-project.spec.ts` 里「渲染后端菜单与项目列表,分页参数用 page_no / page_size」那条：
`expect(listRequests[0]).toContain('page_size=10')` ⇒ 改成 `page_size=100`
（共享数据集一次取 100 条；表格的分页是**本地**切片）。
同时把该测试的名字里的「分页参数用 page_no / page_size」保留即可，但补一句注释说明
「第一次请求取 100 条（共享数据集），表格分页在本地做」。

- [ ] **Step 2: 写新的 e2e**

`frontend/e2e/project-workspace.spec.ts`（照 `frontend/e2e/task-workspace.spec.ts` 的写法：
`page.route` 拦 `CURRENT_INFO_URL`、`PROJECT_LIST_URL`、两个字典接口）：

四条用例：

1. **切视图不重新取数**
   - 进 `/pm/project`，记录 `requests.length`；
   - 点「卡片」⇒ 断言 `page` 的 URL 是 `/pm/project?view=card`；
   - 点「列表」⇒ URL 是 `/pm/project?view=list`；
   - 断言 `requests.length` **没有增加**。
2. **两个视图是同一份数据**
   - 列表视图里数表格行数（`tableRows(page).count()`）；
   - 切到卡片视图，数卡片（给卡片一个 `data-project-id` 属性）⇒ 两个数量相等。
3. **视图状态在 URL 上，刷新保持**
   - 进 `/pm/project?view=card` ⇒ 断言渲染的是卡片（表格不存在）；
   - `page.reload()` ⇒ 仍然是卡片。
4. **卡片上的机器人**
   - 切到卡片视图，点卡片标题旁的机器人；
   - 断言 AI 工作台打开（`aipm.workspace` 的 `open` 为 true，或工作台元素可见）；
   - 断言**没有**导航到 `/pm/project/:id`（URL 仍是 `/pm/project?view=card`）。

再补两条（对应规格里的「Review Focus」）：

5. **项目超过 1000 条 ⇒ 显式提示只取到前 N 条**
   - 假后端按 `page_no` 分页返回，`total = 1200`；
   - 进 `/pm/project` ⇒ 断言页面上有那条 `Alert`，且文案里出现 `1200`。
6. **写操作之后切视图 ⇒ 两个视图都是新数据**
   - 假后端维护一份可变的项目列表（`PUT` 改名字，`GET` 读它）；
   - 列表视图里把项目名改成「改名后的项目」；
   - 切到卡片视图 ⇒ 卡片上显示「改名后的项目」（不是旧名字）。

- [ ] **Step 3: 跑 e2e**

```bash
cd frontend && npx playwright test e2e/project-workspace.spec.ts e2e/pm-project.spec.ts
```
Expected: 全过。

⚠️ 若「切视图不重新取数」失败 ⇒ 两个视图的 `queryKey` 不一致
（检查 `useProjectDataset` 里的 key 是否都带同一个前缀与同样的参数）。

- [ ] **Step 4: 跑全套 + 提交**

```bash
cd frontend && npx vitest run --config vitest.local.config.ts && npm run lint && npx playwright test
cd /Users/ruanying/project/ai-admin-com
git add frontend/e2e/
git commit -m "test(pm): 项目工作台的守卫(切视图零请求/同一份数据/URL 状态)"
```

---

## 自检（对照规格）

| 规格条目 | 在哪个任务 |
| -------- | ---------- |
| `useProjectDataset`（全量、并发补页、封顶 1000、显式提示） | Task 2、Task 3（Alert）、Task 4（Alert） |
| `filterProjects`（LIKE/eq 照后端） | Task 1 |
| 本地筛选 + 本地分页的表格 | Task 3 |
| `?view=list\|card` + Segmented + pathname 不变 | Task 5 |
| 紧凑卡（名称/状态/优先级/负责人/截止） | Task 4 |
| 卡片的机器人 = 与 AI 讨论（同一份 `discussProject`） | Task 4（`useDiscussProject`） |
| 卡片的编辑/删除（同一套权限） | Task 4 |
| 卡片视图的精简筛选行 | Task 4 |
| 写操作后 `dataset.reload()` | Task 3（列表）、Task 4（卡片） |
| `page_size` 断言要改 | Task 6 |
| 不动后端 / 不做看板甘特 / 不重写表单 | 全程 |
