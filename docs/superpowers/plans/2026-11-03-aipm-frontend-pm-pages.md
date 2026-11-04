# 前端 PM 页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `ai-admin-com` 里建成 PM 管理的 5 个页面（项目、里程碑、任务列表、任务看板、风险），
全部走真实后端 AiAdmin 的 PM 插件，字段与后端 schema 逐条对齐。

**Architecture:** 照本仓既有范式 —— `ProTable` + `ModalForm` + `@/components/CrudTable` 的
`useCrudTable`/`useCrudColumns`；service 层一模块一份，出入参类型**逐字对齐后端 schema**；
状态/类型/分类**字典驱动**（后端字典带 `list_class`）；权限用 `useAccess().hasPermission()`
门控，权限码是后端 controller 里的**三段式**。

**Tech Stack:** React 19 · antd 6 · ProComponents 3 · Umi Max 4 · TypeScript · Vitest · Playwright

**Spec:** [`docs/superpowers/specs/2026-11-03-aipm-frontend-design.md`](../specs/2026-11-03-aipm-frontend-design.md) §5、§6、§7
（逐页的列/字段/交互、路由与权限、组件清单、验收标准）

---

## Global Constraints

以下每条都来自 spec 与本仓既有约定，**所有任务隐含包含**：

- **只读后端**：本计划**不改** AiAdmin 后端的任何代码。PM 菜单种子（B1）**由后端写**，
  是本计划的**外部依赖**（见下方「外部依赖」）。
- **权限码用后端 controller 里的实际拼法**（三段式）：
  `module_pm_project:pm_project:*` · `module_pm_project:pm_milestone:*` ·
  `module_pm_project:pm_task:*` · `module_pm_risk:pm_risk:*`。
  **不是** `module_pm_task:list` 那种两段式。列表权限码是 **`query`**。
- **状态/类型/分类标签字典驱动**：选项来自 `getDictDataByType(dictType)`，
  标签颜色用字典项的 `list_class`。**不在前端硬编码状态色**。
- **表单校验必须逐条对齐后端 schema**（长度、范围、必填）。后端 422 要在前端变成表单错误。
- **页面不自己弹 `message.success`/`message.error`** —— 请求层统一弹。
  ProTable 必须传 `onRequestError={() => {}}`（否则 ProComponents v3 会 rethrow rejection）。
- **删除请求体是裸数组** `[1,2]`。
- **任务更新是整对象 PUT**（后端 `ModulePmTaskUpdateSchema` 继承创建 schema，全部必填，
  没有 PATCH）⇒ 任何部分更新都是「读-改-写」。
- **风险表单要算 `score`**（后端 `score` 必填且**不计算**，透传）。
- **里程碑表单不提供 `at_risk`/`missed`**（INV-13：规则引擎独占写权）。
- **单租户**：不做租户 UI、不加租户筛选。
- **不引入 Tailwind/shadcn/第二套设计语言**：只用 antd 6 的 token 与组件。
- **沿用既有范式**：`toProTableRequest`、`CRUD_PAGINATION`、`useCrudTable`、`useCrudColumns`、
  `ProFormSelect` 的 `fieldProps` 远程搜索。
- **提交**：中文提交信息；subject 不得以大写拉丁词开头；多行信息用 `git commit -F <file>`。
- **只对本计划改动的文件**跑 `npx biome check --write <paths>`。
- **不要 push**。

### 外部依赖（不由本计划交付，但会卡住页面）

| 依赖 | 归属 | 卡住什么 |
|---|---|---|
| **B1 PM 菜单种子**（`platform_menu` 里 PM 的菜单节点 + 按钮权限码） | **后端** | 没有种子，这 5 个页面**不会被菜单下发** ⇒ 页面路由注册了也进不去。Task 9 里要加一条检查 |
| PM 表单字典的 `list_class` 已种 | 后端 | 已有（`pm_v2_seed_v1.sql`），但若后端改动要回归 |

---

## Review Focus

spec 暗示、但任何任务的测试都容易漏掉的失败模式。后面标了**归属任务**。

1. **表单提交的字段集与后端必填项对不上**（Task 3–8）：
   风险的 `score`/`created_via_code`/`owner_id`/`status_code`、任务的
   `project_id`/`type_code`/`status_code`/`priority_code` 都是后端**必填**但用户不该看见的字段
   —— 漏一个就是 422。
2. **枚举提交的是展示文本而不是线上码**（Task 3–8）：
   `status_code` 要提交 `in_progress`，不是「进行中」；`type_code` 要提交 `feature`，
   不是「功能」。工单那页已经踩过这个坑（e2e 叫「按工单类型筛选时提交的是后端的线上的值」）。
3. **任务列表里的项目/里程碑名**（Task 6）：响应**没有** `project_by`/`milestone_by`
   ⇒ 必须侧载列表在户端映射，不能直接取字段。
4. **看板拖拽失败后卡片不回原位**（Task 7）：写失败要**回滚卡片位置**，不能让它凭空消失。
5. **里程碑状态被手工改成 `at_risk`**（Task 5）：表单里**不能**有这个选项；
   列表里读到它要显示为「规则判定」而不是普通状态。

---

---

### Task 1: PM service 层（4 个模块的出入参类型与请求函数）

**Files:**
- Create: `src/services/api/pm/project.ts`、`milestone.ts`、`task.ts`、`risk.ts`
- Test: `src/services/api/pm/project.test.ts`（四个模块各一份，文件名对应）

**Interfaces:**
- Consumes: `@/services/types` 的 `ApiResponse`、`PageQuery`、`PageResult`；
  `@/services/paginate` 的 `MAX_PAGE_SIZE`
- Produces（四个模块同形，`<M>` 分别是 Project/Milestone/Task/Risk）：

```ts
// src/services/api/pm/<entity>.ts
export interface <M>Out {
  id?: number | null;
  // ... 字段逐字照抄后端 ModulePm<M>OutSchema
  created_time?: string | null;
  updated_time?: string | null;
}
export interface <M>CreateParams { /* 逐字照抄后端 ModulePm<M>CreateSchema */ }
export interface <M>UpdateParams extends <M>CreateParams {}
export type <M>ListParams = Partial<PageQuery> & { /* 后端 ModulePm<M>QueryParam 的字段 */ };

export async function list<M>s(params: <M>ListParams): Promise<ApiResponse<PageResult<<M>Out>>>;
export async function get<M>Detail(id: number): Promise<ApiResponse<<M>Out>>;
export async function create<M>(params: <M>CreateParams): Promise<ApiResponse<<M>Out>>;
export async function update<M>(id: number, params: <M>UpdateParams): Promise<ApiResponse<<M>Out>>;
export async function delete<M>s(ids: number[]): Promise<ApiResponse<null>>;
```

**四个实体的字段（逐字照抄后端 schema，**已核实**）：**

| 模块 | 端点前缀 | 关键字段 |
|---|---|---|
| project | `/pm_project` | `code`(必填 `^[A-Z0-9_-]{2,32}$`)、`name`、`description`、`owner_id`(必填)、`template_id?`、`status_code`、`priority_code`、`start_date`、`due_date`、`visibility_code`、`tags`(JSON 字符串)、`extra_fields`(JSON 字符串)、`owner_by?` |
| milestone | `/pm_milestone` | `project_id`(必填)、`name`、`description`、`start_date`、`due_date`、`actual_start_date?`、`actual_end_date?`、`status_code`、`deliverables`(dict)、`sort_order`、`health_score?`、**`progress?`**、`project_by?` |
| task | `/pm_task` | `project_id`(必填)、`milestone_id?`、`parent_id?`、`title`、`description?`、`type_code`、`status_code`、`priority_code`、`estimate_hours?`、`actual_hours?`、`assignee_id?`、`reporter_id?`、`reviewers?`(字符串)、`labels?`(字符串)、`start_date?`、`due_date?`、`actual_start_date?`、`actual_end_date?`、`sort_order?`、`created_via_code?`、`blocked_reason?`、`assignee_by?`、`reporter_by?` |
| risk | `/pm_risk` | `project_id`(必填)、`title`、`description?`、`category_code`、`probability`(1-5)、`impact`(1-5)、**`score`(必填)**、`status_code`、`owner_id`(必填)、`mitigation_plan?`、`contingency_plan?`、`due_date?`、`trigger_date?`、`created_via_code`(必填)、`ai_suggestion?` |

> ⚠️ **`progress` 是后端缓存的派生字段**（由任务状态变更触发 `recalc_progress` 维护），
> **不在 Create/Update 里传**。
> ⚠️ **`health_score` 是里程碑的 0–100 分**（可写）。
> ⚠️ **`deliverables` 是 dict**，不是数组。

- [ ] **Step 1: 写失败的测试** —— 四个模块各一份，用 `vi.mock('@umijs/max')` 的 `request` 断言**请求的形状**：
  - `list 走 GET /pm_project/list 并带 page_no/page_size`
  - `detail 走 GET /pm_project/detail/{id}`
  - `create 走 POST /pm_project/create`
  - `update 走 PUT /pm_project/update/{id}`
  - `delete 的请求体是裸数组` —— 断言 `request` 收到的 data 是 `[1, 2]` 而不是 `{ids:[1,2]}`
  - `风险 create 的 body 含 score` —— 断言 `params.score` 原样进 body

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/services/api/pm`
  Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** —— 四个文件各自照上面的字段表写；类型**不发明中间层**，
  直接照抄后端 schema 的字段名与可空性。
  每个文件的顶部注释写清后端的坑（整对象 PUT、裸数组删除、派生字段不传、字符串化的数组字段）。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/services/api/pm && git commit -F - <<'EOF'
feat(pm): PM 四个模块的 service 层

- 出入参类型逐字对齐后端 ModulePm*Schema,不发明中间层
- 删除请求体是裸数组;更新是整对象 PUT(后端无 PATCH)
- 派生字段 progress 不进 create/update;风险 score 必填且由调用方算
EOF
```

---

### Task 2: 字典驱动的选项与状态标签

**Files:**
- Create: `src/components/pm/DictSelect.tsx`、`src/components/pm/DictTag.tsx`、
  `src/components/pm/useDictOptions.ts`、`src/components/pm/riskLevel.ts`
- Test: `src/components/pm/useDictOptions.test.ts`、`src/components/pm/riskLevel.test.ts`

**Interfaces:**
- Consumes: `getDictDataByType`（`@/services/api/system/dict`）、`DictDataOut`
- Produces:

```ts
// src/components/pm/useDictOptions.ts
export interface DictOption { label: string; value: string; listClass?: string | null; }
export function useDictOptions(dictType: string): { options: DictOption[]; loading: boolean };

// src/components/pm/DictSelect.tsx
export function DictSelect(props: { dictType: string; value?: string; onChange?: (v?: string) => void; placeholder?: string; allowClear?: boolean }): JSX.Element;

// src/components/pm/DictTag.tsx
export function DictTag(props: { dictType: string; value?: string | null }): JSX.Element;

// src/components/pm/riskLevel.ts   ← 项目详情页(Task 4)与风险页(Task 8)都要用,
// 所以放在共享件里,而不是风险页目录里
export type RiskLevel = 'SEVERE'|'HIGH'|'MEDIUM'|'LOW';
export function riskLevel(score: number): RiskLevel;
```

- [ ] **Step 1: 写失败的测试**
  - `useDictOptions.test.ts`：
    - `选项的 value 是 dict_value 不是 dict_label`（`dict_value: 'in_progress'`，`dict_label: '进行中'`）
      ⇒ 断言 `options[0].value === 'in_progress'`、`options[0].label === '进行中'`
    - `带上 list_class` —— 断言 `options[0].listClass === 'primary'`
    - `字典加载失败时返回空数组且不抛错`
  - `riskLevel.test.ts`：
    - `分数 16 是严重` / `15 是高` / `8 是中` / `3 是低`
    - `边界值 16/9/4` 各自落在正确等级

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/components/pm` → Expected: FAIL

- [ ] **Step 3: 实现**
  - `useDictOptions`：`useState` + `useEffect` 调 `getDictDataByType`；
    **失败返回空数组**并 `console.warn`，不抛（页面不能因字典挂掉而白屏）。
  - `DictTag`：按 `list_class` 映射到 antd `Tag` 的 `color`：
    `success→success`、`info→processing`、`warning→warning`、`danger→error`、
    `primary→processing`、`default→default`。
    **查不到字典项时显示原始 value**，不要显示空白。
  - `riskLevel`：`score >= 16 → SEVERE`；`>= 9 → HIGH`；`>= 4 → MEDIUM`；否则 `LOW`。
    文件头注释写明：**`level` 是派生量，后端只有 `score`**；
    阈值必须与 AI 服务侧（Plan A 的 `src/rule-engine/risk-matrix.ts`）保持一致。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/pm && git commit -F - <<'EOF'
feat(pm): 字典驱动的选项与状态标签

- 选项的 value 用后端的 dict_value(线上码),label 用 dict_label
- 标签颜色取字典项的 list_class,不在前端硬编码状态色
- 字典加载失败返回空数组并告警,不影响页面渲染
EOF
```

---

### Task 3: 项目管理列表页

**Files:**
- Create: `src/pages/module_pm/project/index.tsx`、`src/pages/module_pm/project/ModalForm.tsx`
- Test: `e2e/pm-project.spec.ts`

**Interfaces:**
- Consumes: `listProjects`/`createProject`/`updateProject`/`deleteProjects`（Task 1）、
  `useCrudTable`/`useCrudColumns`/`CRUD_PAGINATION`、`DictSelect`/`DictTag`、`toProTableRequest`
- Produces: 路由 `/pm/project`

- [ ] **Step 1: 写失败的测试** —— `e2e/pm-project.spec.ts`（用既有的 e2e mock 方式）：
  - `渲染后端返回的项目列表`
  - `新增项目提交的是后端的线上码` —— 断言 POST body 的 `status_code === 'planning'`、
    `priority_code === 'P1'`（不是「规划中」「高」）
  - `新增项目的 code 校验` —— 不符合 `^[A-Z0-9_-]{2,32}$` 时表单报错，**不发请求**
  - `编辑提交 owner_id`（后端必填）
  - `删除的请求体是裸数组`

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx playwright test e2e/pm-project.spec.ts`
  Expected: FAIL（页面不存在）

- [ ] **Step 3: 实现**
  - 列：ID(`search: false`)、项目名称(可搜)、项目编码(`search: false`)、
    状态(`DictTag`，`valueEnum` 用字典选项)、优先级(`DictTag`)、
    负责人(`owner_by?.name`)、计划区间(`start_date` ~ `due_date`)、
    标签(`tags` JSON 字符串 → `Tag` 串)、创建时间(`search: false`)。
  - 搜索项：`name`、`code`、`status_code`、`priority_code`、`owner_id`。
  - 表单字段：`code`(必填 + 正则)、`name`(必填)、`description`、`owner_id`(必填，`ProFormSelect`
    远程搜用户)、`template_id?`、`status_code`(必填，`DictSelect`)、`priority_code`(必填，`DictSelect`)、
    `start_date`(必填)、`due_date`(必填)、`visibility_code`(必填，`DictSelect`)、`tags`(JSON 数组字符串)。
  - 操作列权限码：`module_pm_project:pm_project:update` / `:delete`；
    新增按钮 `module_pm_project:pm_project:create`。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx playwright test e2e/pm-project.spec.ts` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/pages/module_pm e2e/pm-project.spec.ts && git commit -F - <<'EOF'
feat(pm): 项目管理列表页

- ProTable + ModalForm,照 module_system 的既有范式
- 状态与优先级用字典驱动,提交的是后端线上码
- code 有正则校验,owner_id 必填
EOF
```

---

### Task 4: 项目详情页

**Files:**
- Create: `src/pages/module_pm/project/detail.tsx`
- Test: `e2e/pm-project.spec.ts`（追加用例）

**Interfaces:**
- Consumes: `getProjectDetail`、Task 1 的其余函数、`DictTag`
- Produces: 路由 `/pm/project/:id`

- [ ] **Step 1: 写失败的测试** —— 追加用例：
  - `渲染项目的概览信息`
  - `里程碑 tab 显示进度条` —— 断言用 `progress` 字段（不是前端算）
  - `任务 tab 显示任务列表` —— 断言请求带了 `project_id` 过滤
  - `风险 tab 显示风险等级标签`

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx playwright test e2e/pm-project.spec.ts`
  Expected: FAIL

- [ ] **Step 3: 实现**
  - 用 `ProLayout` 的 `Tabs` 或 antd `Tabs`；**5 个 tab**：概览 / 里程碑 / 任务 / 风险 / 成员。
    （评论 tab v1 不做。）
  - 里程碑 tab：卡片（名称 + `DictTag` + `progress` 进度条 + 计划区间 + 实际区间）。
  - 任务 tab：精简表格（标题/状态/优先级/负责人/截止日）。
  - 风险 tab：列表 + 等级标签（等级用 `@/components/pm` 的 `riskLevel`）。
  - 成员 tab：调 `/pm_project/members/{id}`。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx playwright test e2e/pm-project.spec.ts` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/pages/module_pm e2e/pm-project.spec.ts && git commit -F - <<'EOF'
feat(pm): 项目详情页

- 概览/里程碑/任务/风险/成员 五个 tab
- 里程碑进度用后端缓存的 progress,不在前端算
- 子列表请求带 project_id 过滤
EOF
```

---

### Task 5: 里程碑管理页

**Files:**
- Create: `src/pages/module_pm/milestone/index.tsx`、`src/pages/module_pm/milestone/ModalForm.tsx`
- Test: `e2e/pm-milestone.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 milestone 函数、`DictSelect`/`DictTag`
- Produces: 路由 `/pm/milestone`

- [ ] **Step 1: 写失败的测试** —— `e2e/pm-milestone.spec.ts`：
  - `渲染里程碑列表与状态标签`
  - `状态选项只有五个` —— 断言下拉里**没有** `at_risk` 与 `missed`
  - `进度条显示 progress` —— 断言用后端的 progress，不是前端算的
  - `健康度显示 health_score`
  - `新增提交 project_id 与 status_code`

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx playwright test e2e/pm-milestone.spec.ts`
  Expected: FAIL

- [ ] **Step 3: 实现**
  - 列：ID、里程碑名称(可搜)、所属项目(`project_by?.name`)、状态(`DictTag`)、
    进度(`progress` 进度条)、健康度(`health_score`)、
    计划区间、实际区间、排序(`sort_order`)。
  - **竖排时间线**（不做甘特）。
  - 表单：`project_id`(必填，`ProFormSelect` 远程搜项目)、`name`(必填)、`description`、
    `start_date`(必填)、`due_date`(必填)、`status_code`(必填，`DictSelect`)、
    `deliverables`(JSON 对象，`ProFormTextArea` + JSON 校验)、`sort_order`(数字)。
  - **状态选项过滤**：从字典选项里**剔除** `at_risk` 与 `missed`（INV-13）。
    列表里若读到这两个值，`DictTag` 仍要显示，但**加 Tooltip**「由规则引擎判定，不可手工设置」。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx playwright test e2e/pm-milestone.spec.ts` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/pages/module_pm e2e/pm-milestone.spec.ts && git commit -F - <<'EOF'
feat(pm): 里程碑管理页

- 竖排时间线,不做甘特(v1.1 再做)
- 进度用后端缓存的 progress,健康度用 health_score
- 表单不提供 at_risk/missed(INV-13 规则独占写权);列表读到时加说明
EOF
```

---

### Task 6: 任务列表页

**Files:**
- Create: `src/pages/module_pm/task/index.tsx`、`src/pages/module_pm/task/ModalForm.tsx`
- Create: `src/pages/module_pm/task/useProjectNames.ts`
- Test: `e2e/pm-task.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 task 函数、`DictSelect`/`DictTag`
- Produces: 路由 `/pm/task`

- [ ] **Step 1: 写失败的测试** —— `e2e/pm-task.spec.ts`：
  - `渲染任务列表`
  - `项目名来自侧载列表` —— 任务的响应**没有** `project_by` ⇒ 断言页面上的项目名
    来自另一个 `GET /pm_project/list` 请求的结果
  - `新增任务提交 type_code/status_code/priority_code 的线上码`
  - `任务表单提交全部必填字段` —— 断言 body 含 `project_id`、`title`、`type_code`、
    `status_code`、`priority_code`
  - `编辑任务做读-改-写` —— 断言先 GET 再 PUT，PUT 的 body 含**所有**必填字段

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx playwright test e2e/pm-task.spec.ts`
  Expected: FAIL

- [ ] **Step 3: 实现**
  - 列：ID、标题(可搜)、所属项目(**侧载映射**)、所属里程碑(**侧载映射**)、
    状态(`DictTag`)、优先级、类型、负责人(`assignee_by?.name`)、报告人(`reporter_by?.name`)、
    计划起止、实际起止、估时、实际工时、排序、阻塞原因、创建方式。
  - `useProjectNames`：一次拉项目与里程碑列表，返回 `id → name` 的 Map，
    **在列的 `render` 里查表**（不在每行发请求）。
  - 表单：`project_id`(必填)、`milestone_id?`、`parent_id?`、`title`(必填)、`description`、
    `type_code`(必填)、`status_code`(必填)、`priority_code`(必填)、
    `estimate_hours?`、`actual_hours?`、`assignee_id?`、`reporter_id?`、`reviewers?`、
    `labels?`、`start_date?`、`due_date?`、`sort_order?`、`created_via_code?`、`blocked_reason?`。
  - 编辑时**读-改-写**：先 GET 详情填表，保存时把**所有**必填字段一起 PUT。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx playwright test e2e/pm-task.spec.ts` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/pages/module_pm e2e/pm-task.spec.ts && git commit -F - <<'EOF'
feat(pm): 任务列表页

- 响应没有 project_by/milestone_by,项目名与里程碑名侧载列表在户端映射
- 状态/类型/优先级提交线上码
- 编辑是读-改-写:PUT 带全部必填字段(后端无 PATCH)
EOF
```

---

### Task 7: 任务看板页

**Files:**
- Create: `src/pages/module_pm/task/board.tsx`、`src/pages/module_pm/task/useBoardColumns.ts`
- Test: `e2e/pm-task-board.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 task 函数、`DictTag`
- Produces: 路由 `/pm/task/board`

- [ ] **Step 1: 写失败的测试** —— `e2e/pm-task-board.spec.ts`：
  - `渲染六列` —— 断言列标题是 待规划/待办/进行中/阻塞/评审/已完成
  - `看板不含已取消列` —— 断言**没有**「已取消」列
  - `拖到已完成列会写 status_code=done` —— 断言 PUT body 的 `status_code === 'done'`
  - `拖拽写失败时卡片回到原列` —— 让 PUT 返回 500 ⇒ 断言卡片回到原位

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx playwright test e2e/pm-task-board.spec.ts`
  Expected: FAIL

- [ ] **Step 3: 实现**
  - 六列：`backlog`/`todo`/`in_progress`/`blocked`/`review`/`done`。
    **`cancelled` 不进看板**（已取消的任务退出工作流）。
  - 卡片：标题 + 优先级标签 + 负责人 `Avatar` + 估时 + 截止日（逾期标红）。
  - 拖拽**只改 `status_code` 一个维度**（不跨里程碑/负责人）。
  - 拖拽写的是**整对象 PUT**：用**卡片自带**的任务对象拼出全部必填字段（**不发详情请求** ——
    列表/看板返回的 `ModulePmTaskOutSchema` 继承创建 schema，字段已齐；也少一个 `:detail` 依赖）。
    `reporter_id` / `sort_order` / `created_via_code` 不提交（后端 `exclude_unset` 保留原值）。
  - **失败回滚**：把卡片放回原列并提示（`message.error` 由请求层统一弹，这里只管位置）。

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx playwright test e2e/pm-task-board.spec.ts` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/pages/module_pm e2e/pm-task-board.spec.ts && git commit -F - <<'EOF'
feat(pm): 任务看板页

- 六列,已取消的任务不进看板
- 拖拽只改 status_code 一个维度,写的是整对象 PUT(先 GET 再合并再 PUT)
- 写失败时卡片回滚到原列
EOF
```

---

### Task 8: 风险登记册页

**Files:**
- Create: `src/pages/module_pm/risk/index.tsx`、`src/pages/module_pm/risk/ModalForm.tsx`、
  `src/pages/module_pm/risk/Heatmap.tsx`
- Test: `e2e/pm-risk.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 risk 函数、`DictSelect`/`DictTag`、**`riskLevel`（Task 2 的共享件）**
- Produces: 路由 `/pm/risk`

- [ ] **Step 1: 写失败的测试** —— `e2e/pm-risk.spec.ts`：
  - `渲染风险列表与等级标签`
  - `新增风险提交 score` —— 断言 POST body 的 `score === 15`（概率 3 × 影响 5）
  - `表单提交 created_via_code=manual 与 owner_id`
  - `表单不出现 score 输入框` —— 用户看到的是概率与影响，score 由前端算
  - `热力图按格子显示风险数` —— 断言某格的数量文本

- [ ] **Step 2: 跑测试确认失败** —— Run: `npx playwright test e2e/pm-risk.spec.ts`
  Expected: FAIL

- [ ] **Step 3: 实现**
  - 等级直接用 `import { riskLevel } from '@/components/pm/riskLevel'`（Task 2 已实现）。
  - 列：ID、标题(可搜)、所属项目、分类(`DictTag`)、概率、影响、分数、**等级(本地算)**、
    状态(`DictTag`)、负责人、缓解措施截止、创建方式。
  - 表单：`project_id`(必填)、`title`(必填)、`description`、`category_code`(必填)、
    `probability`(必填 1–5)、`impact`(必填 1–5)、`status_code`(必填)、`owner_id`(必填)、
    `mitigation_plan`、`contingency_plan`、`due_date`、`trigger_date`。
    **提交时自动补**：`score = probability * impact`；`created_via_code` 新增固定 `'manual'`、
    编辑**原样回传行里的值**（后端 `ModulePmRiskUpdateSchema` 继承 CreateSchema，
    这一列必填，不带就 422）。
  - `Heatmap.tsx`：5×5 网格（纵=概率，横=影响），每格显示落入该格的**风险数**，
    颜色按该格**最高 score** 的等级；点格子过滤下面的列表。**只读，不做拖拽建风险。**

- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run && npx playwright test e2e/pm-risk.spec.ts`
  → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/pages/module_pm e2e/pm-risk.spec.ts && git commit -F - <<'EOF'
feat(pm): 风险登记册页

- 等级用共享件 riskLevel(后端只有 score,等级是派生量)
- 表单提交 score(概率×影响)与 created_via_code=manual,用户看不到这两个字段
- 5×5 热力图按格子显示风险数,颜色取该格最高分,只读
EOF
```

---

### Task 9: 路由核对 · README · 收尾清理

> **裁决（路由注册随页面走）**：六个 PM 路由由 Task 3–8 各自的页面任务在提交自己页面时
> 同时注册（Task 3 → `/pm/project`；Task 4 → `/pm/project/:id`；Task 5 → `/pm/milestone`；
> Task 6 → `/pm/task`；Task 7 → `/pm/task/board`；Task 8 → `/pm/risk`）。
> **本任务不再注册路由**，只做**核对**；六个路由的 e2e 覆盖也归各页自己的 spec ——
> **不新建 `e2e/pm-routes.spec.ts`**（另写一份「打开六个路由」的用例与现有用例重复）。

**Files:**
- Modify: `README.md`（B1 菜单种子的说明）
- Verify（只读）：`config/routes.ts` 里 `/pm` 目录下的六个路由
- 路由覆盖在（不新建）：`e2e/pm-project.spec.ts`（`/pm/project` + `/pm/project/:id`）、
  `e2e/pm-milestone.spec.ts`、`e2e/pm-task.spec.ts`、`e2e/pm-task-board.spec.ts`、
  `e2e/pm-risk.spec.ts`

**Interfaces:**
- Consumes: Task 3–8 的页面
- Produces: 六个 PM 路由的**核对结论**（不新增代码）

- [ ] **Step 1: 核对六个路由齐全** —— `config/routes.ts` 的 `/pm` 目录下应当有
  `/pm/project`、`/pm/project/:id`、`/pm/milestone`、`/pm/task`、`/pm/task/board`、`/pm/risk`；
  缺哪个就在**对应页面任务**里补，不在本任务里加。

- [ ] **Step 2: 核对路由的 e2e 覆盖** —— 五个页面 spec 各自访问自己的路由
  （`pm-project.spec.ts` 同时覆盖 `/pm/project` 与 `/pm/project/:id`）
  ⇒ 六个路由都有用例能打开，不必另起一份路由 spec。

- [ ] **Step 3: README 写清 B1 的依赖**
  - **菜单由后端下发**（既有机制：`src/menu/adapter.ts`）⇒ 前端**只注册路由**，
    不在前端写菜单数据。
  - **⚠️ 外部依赖检查**：本任务**无法**验证 B1 是否已交付（后端写）。
    ⇒ 在 `README.md` 里加一段「PM 页面依赖后端菜单种子 B1，未下发时页面路由可用但菜单里看不到入口」，
    并列出后端要种下的菜单节点与按钮权限码。

- [ ] **Step 4: 全量门禁** —— Run: `npm run lint && npm test && npm run build && npm run e2e`
  Expected: 全绿；**既有的 279 单测 + 80 e2e 零回归**

- [ ] **Step 5: 提交**

```bash
git add README.md && git commit -F - <<'EOF'
docs(pm): 核对六个 PM 路由并记下菜单种子依赖

- 六个 PM 路由由各页面任务注册，本任务只核对齐全
- README 记下 PM 页面依赖后端菜单种子 B1，未下发时菜单里看不到入口
EOF
```

---

## 完成判据

- [ ] `npm run lint` 干净（biome + tsc）
- [ ] `npm test` 全绿，且**既有用例零回归**
- [ ] `npm run build` 成功
- [ ] `npm run e2e` 全绿，且**既有 80 条零回归**
- [ ] spec §8 的 U7–U12 逐条验过：
  - U7 字段与后端 schema 逐条一致（Task 1 的类型 + 各页 e2e）
  - U8 标签字典驱动（Task 2）
  - U9/U9.1/U9.2 风险等级与提交体（Task 8）
  - U10 里程碑表单无 `at_risk`/`missed`（Task 5）
  - U11/U11.1 看板拖拽与回滚（Task 7）
  - U12 零回归

## 后续（不在本计划内）

- **Plan C = 前端 AI 工作台**（F1/F2）：依赖 Plan A（AI 服务）的契约落地。
  见 [`2026-11-03-aipm-frontend-design.md`](../specs/2026-11-03-aipm-frontend-design.md) §3、§4。
- 评论、会议纪要、仪表盘、甘特图、项目模板：spec 已定 v1.1。
