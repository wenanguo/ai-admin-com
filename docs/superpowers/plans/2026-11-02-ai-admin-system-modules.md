# AiAdmin 系统管理模块补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把后端 `/system` 下已有的 9 个模块（含已有的用户管理）全部变成可用的 React 页面，让这个仓库从「跑通一个闭环的模板」变成「覆盖系统管理全模块的模板」。

**Architecture:** 8 个新模块共用一套骨架（service 层 + ProTable 页面 + ModalForm + 路由注册 + i18n + 单测/e2e），差异只在数据与字段。页面吃真实后端数据，全部经 `src/services/api/**` 访问，不写 mock。分 8 批交付，每批独立可发布；最后一批做工程债专项与集成发布。

**Tech Stack:** Umi Max 4 / React 19 / TypeScript / antd 6 / ProComponents 3 / vitest / Playwright

**Spec:** `docs/superpowers/specs/2026-11-02-ai-admin-system-modules-design.md` —— **执行前必读**。本计划与其配套，spec 定义了范式、契约表与坑位。

---

## Global Constraints

以下每条都直接抄自 spec，实现时逐条对照：

- **C1** 业务错误走 HTTP 500 + 信封 `{ code, msg, data, status_code, success }`；请求层统一转 `BizError`，调用方读 `error.info.msg`。成功判定 `code === 0`。
- **C2** 分页参数是 `page_no`（≥1）/ `page_size`（1..100）；列表返回体是 `PageResult<T> = { items, total, page_no, page_size, has_next }` —— 字段名是 **`items`**，不是 `list`。
- **C3** 删除类接口的请求体是**裸数组** `[1, 2]`，不是 `{ ids: [...] }`。
- **C4** 批量启停接口一律是 **PATCH**（不是 PUT），请求体 `{ ids: number[], status: number }`。
- **C5** 前端路由 `path` 必须等于菜单 `route_path` 拼上父路径；否则菜单项被 `src/menu/adapter.ts` 跳过。
- **C6** 菜单图标取**前端路由表**的 antd 图标名；后端下发的 `ri:xxx` ProLayout 认不出来。
- **C7** 成功/失败提示由请求层统一弹，**页面里不再弹第二次**。
- **C8** 登录接口是 form-urlencoded；查询参数有正则校验，前端要先挡。

**命名与代码约定**

- 页面目录名必须等于后端菜单 `component_path` 去掉 `module_system/` 前缀和 `/index` 后缀。
  例外：**参数模块路由用单数 `/system/param`，目录用复数 `module_system/params`**。
- service 文件：`src/services/api/system/<mod>.ts`；列表类型 `<Mod>ListParams`；实体类型 `<Mod>Out`。
- 函数命名：`list<Plural>` / `get<Mod>Detail` / `create<Mod>` / `update<Mod>` / `delete<Plural>` / `batchSet<Plural>Status`。
- **新模块的类型定义放在自己的 `<mod>.ts` 里**；已存在的 `UserOut` / `UserCreateParams` / `RoleOut` 留在 `src/services/api/system/types.ts` 不动。
- ProComponents **v3** API：`hideInSearch: true` → **`search: false`**；列级 `rules: [...]` → **`formItemProps: { rules: [...] }`**。
- React 19：`useRef<T>()` **必须带初始值** → `useRef<ActionType | undefined>(undefined)`。
- `handleDelete` / `handleEdit` 必须声明在 `columns` **之前**（Biome `noInvalidUseBeforeDeclaration`）。
- 新建/修改文件后跑一次 `npx biome check --write` 归一行尾，提交前确认 `npm run biome:lint` 通过。
- **commit message 用中文，subject 不要以大写英文词开头**（commitlint `subject-case` 会拒）。
  写多行中文提交消息用 `git commit -F <file>`，不要用 `-m`。
- 单条提交只包含本任务的文件；不要把其它任务的改动顺手带进来。

**门禁**（每个任务结束都要过，全绿才算完成）

```bash
npm run lint      # biome + tsc，exit 0
npm test          # vitest，全绿
npm run build     # 构建成功
npm run e2e       # Playwright，全绿
```

> `npm run e2e` 会先 `npm run build` 再跑 Playwright（跑生产构建，不是 dev server —— 这是 v0.1.0 的既定修复）。
> `npm run e2e:only` 复用已有 `dist/`，迭代时用它更快。

**参考样板**（照抄它们，不要另创风格）

- 页面骨架：`src/pages/module_system/position/index.tsx`（Task 1 的产出，已改用共享脚手架）
- **共享 CRUD 脚手架（必须消费，不要再逐行复制岗位页）**：
  `src/components/CrudTable/` 的 `useCrudTable` / `getCrudColumns` / `CRUD_PAGINATION`
  —— 签名与用法见规格 §5.3（`docs/superpowers/specs/2026-11-02-ai-admin-system-modules-design.md`）
- 表单弹窗：`src/pages/module_system/user/ModalForm.tsx`
- service 单测：`src/services/api/system/user.test.ts`
- e2e 用例：`e2e/user-management.spec.ts`
- ProTable 适配器：`src/services/paginate.ts`（`toProTableRequest`）

---

## Review Focus

以下是 spec 隐含、但任何单一任务的常规测试都覆盖不到、且**最容易在真实使用中咬人**的输入与失败模式。每个都指派给了拥有相关代码的任务，由该任务自己的测试钉住。

| # | 场景 | 合理的行为期待 | 归属任务 | 钉住它的测试 |
|---|---|---|---|---|
| RF1 | 后端业务错误：HTTP 500 + 信封 `code:-1`（例：登录码错误、唯一键冲突） | 页面显示**后端的中文 msg**，不是英文的 "Request failed with status code 500" | Task 1 | `e2e/position.spec.ts` 里的「业务错误」用例 |
| RF2 | 账号缺 `module_system:<mod>:create` 权限码 | 新增/编辑/删除按钮 **disabled**，不是点了才报错 | Task 1 | `e2e/position.spec.ts` 里的「权限」用例 |
| RF3 | 后端返回空列表（`items: []`） | 表格显示空状态，**不白屏、不报错** | Task 2 | `e2e/param.spec.ts` 里的「空列表」用例 |
| RF4 | 表单提交被后端拒绝（例：role 的 `code` 不满足「字母开头，仅字母/数字/下划线」） | 弹窗**不关闭**，并显示后端返回的错误 msg | Task 5 | `e2e/role.spec.ts` 里的「表单被拒」用例 |
| RF5 | 部门树为空，或只有一个节点 | 树选择器正常渲染，**不抛异常**、不出现空指针 | Task 4 | `src/components/DeptTreeSelect/index.test.tsx` |

---

## 文件结构总览

**新建**

```
src/services/api/system/{position,param,log,dept,dict,notice,ticket}.ts
src/services/api/system/{position,param,log,dept,dict,notice,ticket}.test.ts
src/pages/module_system/{position,params,log,dept,role,dict,notice,ticket}/index.tsx
src/pages/module_system/{position,params,log,dept,role,dict,notice,ticket}/ModalForm.tsx
src/components/CrudTable/{index.tsx,index.test.tsx}
src/components/DeptTreeSelect/{index.tsx,index.test.tsx}
src/components/MenuPermissionTree/{index.tsx,index.test.tsx}
e2e/{position,param,log,dept,role,dict,notice,ticket}.spec.ts
```

**修改**

```
config/routes.ts                                  追加 8 条路由
src/locales/zh-CN/menu.ts                         追加 8 个 key
src/locales/en-US/menu.ts                         追加 8 个 key
src/components/index.ts                           登记 3 个新组件
src/pages/module_system/position/index.tsx        改用共享脚手架（Task 1 修复轮）
src/services/api/system/role.ts                   扩展（已有 listRoles）
src/services/api/system/types.ts                  追加 role 的两个类型
src/pages/module_system/user/ModalForm.tsx        部门 ID → 树选择器（Task 4）
src/auth/token.ts                                 加 try/catch（Task 9）
src/requestErrorConfig.ts                         静态 message → App.useApp（Task 9）
src/menu/adapter.ts                               type=4 外链区分（Task 9）
src/services/api/platform/menu.ts                 删除（Task 9）
src/app.tsx                                       包 <App>（Task 9）
skills-lock.json                                  修 hash（Task 9）
README.md                                         更新命令与模块清单（Task 10）
```

> **共享 CRUD 脚手架** `src/components/CrudTable/`（`useCrudTable` / `getCrudColumns` /
> `CRUD_PAGINATION`）由 **Task 1 的修复轮**产出 —— Task 1 的复审判定「整页复制用户页」
> 是 plan-mandated 的 Important，裁决是抽逻辑层。**Task 2-8 必须消费它，不要再逐行复制岗位页。**
> 规格见 `docs/superpowers/specs/2026-11-02-ai-admin-system-modules-design.md` §5.3 与 §8.4。

---

### Task 1: 岗位管理 position —— 流水线验证

> **⚠️ 本任务有一轮修复（fix round 1）**：复审判定「整页逐行复制用户页」是
> plan-mandated 的 Important。裁决（见规格 §5.3、§8.4）：抽出共享 CRUD 脚手架
> `src/components/CrudTable/`（`useCrudTable` / `getCrudColumns` / `CRUD_PAGINATION`），
> 并把岗位页改成消费它。**Task 2-8 直接消费该脚手架，不要再逐行复制岗位页。**

这一批的目的是把「一个模块 = 六件东西」跑通并固化成模板。后端契约最简单，代价最低。

**Files:**
- Create: `src/services/api/system/position.ts`
- Create: `src/services/api/system/position.test.ts`
- Create: `src/pages/module_system/position/index.tsx`
- Create: `src/pages/module_system/position/ModalForm.tsx`
- Create: `e2e/position.spec.ts`
- Modify: `config/routes.ts`
- Modify: `src/locales/zh-CN/menu.ts`
- Modify: `src/locales/en-US/menu.ts`

**Interfaces:**
- Consumes: `toProTableRequest`（`@/services/paginate`）、`useAccess().hasPermission`、`ApiResponse` / `PageQuery` / `PageResult`（`@/services/types`）
- Produces:
  ```ts
  // src/services/api/system/position.ts
  export interface PositionOut {
    id?: number | null;
    name?: string | null;
    code?: string | null;
    order?: number | null;
    status?: number | null;
    description?: string | null;
    created_time?: string | null;
    updated_time?: string | null;
  }
  export type PositionListParams = Partial<PageQuery> & {
    name?: string;
    status?: number;
  };
  export type PositionCreateParams = {
    name: string;
    code: string;
    order?: number;
    status?: number;
    description?: string | null;
  };
  export type PositionUpdateParams = PositionCreateParams;

  export function listPositions(params: PositionListParams): Promise<ApiResponse<PageResult<PositionOut>>>;
  export function getPositionDetail(id: number): Promise<ApiResponse<PositionOut>>;
  export function createPosition(params: PositionCreateParams): Promise<ApiResponse<PositionOut>>;
  export function updatePosition(id: number, params: PositionUpdateParams): Promise<ApiResponse<PositionOut>>;
  export function deletePositions(ids: number[]): Promise<ApiResponse<null>>;
  export function batchSetPositionsStatus(ids: number[], status: number): Promise<ApiResponse<null>>;
  ```

- [ ] **Step 1: 写失败的 service 单测**

创建 `src/services/api/system/position.test.ts`，照 `src/services/api/system/user.test.ts` 的结构（`vi.mock('@umijs/max', () => ({ request: vi.fn() }))`）：

```ts
import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchSetPositionsStatus,
  createPosition,
  deletePositions,
  getPositionDetail,
  listPositions,
  updatePosition,
} from './position';

vi.mock('@umijs/max', () => ({ request: vi.fn() }));

describe('system position service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(request).mockResolvedValue({
      code: 0, msg: 'ok', data: null, status_code: 200, success: true,
    });
  });

  it('lists positions with pagination params', async () => {
    await listPositions({ page_no: 1, page_size: 10, name: 'dev' });
    expect(request).toHaveBeenCalledWith('/system/position/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, name: 'dev' },
    });
  });

  it('gets a position detail by id', async () => {
    await getPositionDetail(7);
    expect(request).toHaveBeenCalledWith('/system/position/detail/7', { method: 'GET' });
  });

  it('creates a position', async () => {
    await createPosition({ name: '后端', code: 'backend' });
    expect(request).toHaveBeenCalledWith('/system/position/create', {
      method: 'POST',
      data: { name: '后端', code: 'backend' },
    });
  });

  it('updates a position by id', async () => {
    await updatePosition(7, { name: '后端', code: 'backend' });
    expect(request).toHaveBeenCalledWith('/system/position/update/7', {
      method: 'PUT',
      data: { name: '后端', code: 'backend' },
    });
  });

  it('deletes positions by a bare id array', async () => {
    await deletePositions([1, 2]);
    expect(request).toHaveBeenCalledWith('/system/position/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('batch sets status with PATCH', async () => {
    await batchSetPositionsStatus([1, 2], 1);
    expect(request).toHaveBeenCalledWith('/system/position/status/batch', {
      method: 'PATCH',
      data: { ids: [1, 2], status: 1 },
    });
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/services/api/system/position.test.ts
```
Expected: FAIL —— `Cannot find module './position'`。

- [ ] **Step 3: 实现 service**

创建 `src/services/api/system/position.ts`，导出上面 Interfaces 块里的 6 个函数与 4 个类型。
每个函数体只有一次 `request(...)` 调用，形如：

```ts
export async function deletePositions(ids: number[]) {
  return request<ApiResponse<null>>('/system/position/delete', {
    method: 'DELETE',
    data: ids,          // 裸数组，不是 { ids }
  });
}
```

批量启停的请求体是 `{ ids, status }` 两个平级字段，方法 `PATCH`。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/services/api/system/position.test.ts
```
Expected: PASS —— 6 个用例全绿。

- [ ] **Step 5: 写页面**

创建 `src/pages/module_system/position/index.tsx`，结构照 `src/pages/module_system/user/index.tsx`：

- `const requestPositions = toProTableRequest<PositionOut>(listPositions);`
- `const actionRef = useRef<ActionType | undefined>(undefined);`
- `const [modalOpen, setModalOpen] = useState(false);`
- `const [editing, setEditing] = useState<PositionOut | undefined>(undefined);`
- `handleDelete` / `handleEdit` / `handleCreate` 声明在 `columns` 之前

列定义（`columns`）：

| title | dataIndex | width | 备注 |
|---|---|---|---|
| ID | `id` | 80 | `search: false` |
| 岗位名称 | `name` | 160 | 可搜索 |
| 岗位编码 | `code` | 160 | `search: false` |
| 排序 | `order` | 100 | `search: false` |
| 状态 | `status` | 100 | `valueEnum`：`{ 0: { text: '正常', status: 'Success' }, 1: { text: '禁用', status: 'Default' } }` |
| 描述 | `description` | 200 | `search: false` |
| 创建时间 | `created_time` | 180 | `search: false` |
| 操作 | — | 160 | `valueType: 'option'` |

「操作」列渲染两个按钮，都用 `access.hasPermission()` 判定 `disabled`：
- 编辑 → `module_system:position:update`
- 删除 → `module_system:position:delete`，包在 `Popconfirm` 里

工具栏（`toolBarRender`）一个「新增」按钮，`disabled={!access.hasPermission('module_system:position:create')}`。

`pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 20, 50, 100], showSizeChanger: true }}`。

创建 `src/pages/module_system/position/ModalForm.tsx`，照 `src/pages/module_system/user/ModalForm.tsx`：

- 用 `ProForm` + `ModalForm`（ProComponents 的）
- 字段：`name`（`ProFormText`，必填）、`code`（`ProFormText`，必填）、`order`（`ProFormDigit`）、`status`（`ProFormSelect`，选项 正常/禁用）、`description`（`ProFormTextArea`）
- props：`open`、`record`（`PositionOut | undefined`）、`onOpenChange`、`onSubmit`
- `record` 有值时是编辑模式，标题改成「编辑岗位」，否则「新增岗位」
- **不渲染任何创建专属字段**（本模块没有）

页面里**不出现** `message.success` / `message.error`（C7）。

- [ ] **Step 6: 注册路由与 i18n**

`config/routes.ts` 的 `/system` 父路由 `routes` 数组里，在 `/system/user` 之后追加：

```ts
{
  path: '/system/position',
  name: 'position',
  icon: 'team',
  component: './module_system/position',
},
```

`src/locales/zh-CN/menu.ts` 追加 `'menu.system.position': '岗位管理',`，
`src/locales/en-US/menu.ts` 追加 `'menu.system.position': 'Positions',`。
两个文件都要改，位置紧跟 `'menu.system.user'`。

- [ ] **Step 7: 写 e2e 用例**

创建 `e2e/position.spec.ts`，照 `e2e/user-management.spec.ts`：

- 用 `page.route` 拦截 `**/api/v1/system/position/list**`，返回信封包裹的
  `{ items: [{ id: 1, name: '后端工程师', code: 'backend', order: 1, status: 0, created_time: '2026-06-21 17:56:33' }], total: 1, page_no: 1, page_size: 10, has_next: false }`
- 用 `page.addInitScript` 塞 `localStorage` 的 `remember_me` / `access_token` / `refresh_token`
- 用 `page.route` 拦截 `**/api/v1/system/user/current/info`，返回含 `menus` 树的信封。
  树里要有一条 `route_path: 'position'`、父目录 `route_path: '/system'` 的子项，
  否则侧边栏不会出现「岗位管理」
- **权限码怎么放进 fixture（RF2 的关键）**：
  权限集合来自 `collectPermissions(info.menus, info.roles)`（`src/app.tsx:62`），
  它遍历的是**原始**菜单树；而 `buildMenuItems`（`src/menu/adapter.ts:167`）会把
  `type: 3` 的按钮节点从**侧边栏**里剔掉。
  ⇒ **`type: 3` 的节点不进菜单、但进权限集合**。
  所以要让「新增」按钮 enabled，fixture 的 `menus` 里要放一个**按钮节点**，例如：
  ```json
  { "id": 30, "parent_id": 3, "name": "新增岗位", "type": 3,
    "route_path": "", "title": "新增岗位",
    "permission": "module_system:position:create",
    "status": 0, "hidden": false, "children": null }
  ```
  它挂在「岗位管理」节点下面。断言：
  - 表格有 1 行，单元格含「后端工程师」
  - 列表请求 URL 含 `page_no=1` 与 `page_size=10`
  - **RF1 业务错误**：把 `list` 的拦截改成返回 HTTP 500 + `{ code: -1, msg: '岗位名称已存在', ... }`，
    断言页面出现「岗位名称已存在」这行中文（不是 "Request failed with status code 500"）
  - **RF2 权限**：去掉上面那个 `type: 3` 按钮节点时，断言「新增」按钮 `toBeDisabled()`；
    放上时断言 `toBeEnabled()`

- [ ] **Step 8: 跑 e2e，确认通过**

```bash
npm run e2e
```
Expected: 全部通过（岗位的用例在内）。

- [ ] **Step 9: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```
Expected: 全部 exit 0 / 全绿。

- [ ] **Step 10: 提交**

```bash
git add src/services/api/system/position.ts src/services/api/system/position.test.ts \
        src/pages/module_system/position/ e2e/position.spec.ts \
        config/routes.ts src/locales/zh-CN/menu.ts src/locales/en-US/menu.ts
git commit -F <msgfile>
```
提交消息（写入文件后用 `-F`）：
```
feat(position): 新增岗位管理页

按系统管理模块补齐规格的第一批。后端契约:
列表 GET /system/position/list、详情 /detail/{id}、创建 /create、
更新 /update/{id}、删除 /delete(裸数组)、批量启停 /status/batch(PATCH)。

删除请求体是裸数组、批量启停是 PATCH,这两条在单测里钉住。
```
> subject 不能以大写英文词开头；`feat(position):` 后面接中文是安全的。

---

### Task 2: 参数管理 param

**Files:**
- Create: `src/services/api/system/param.ts`
- Create: `src/services/api/system/param.test.ts`
- Create: `src/pages/module_system/params/index.tsx`
- Create: `src/pages/module_system/params/ModalForm.tsx`
- Create: `e2e/param.spec.ts`
- Modify: `config/routes.ts`
- Modify: `src/locales/zh-CN/menu.ts`
- Modify: `src/locales/en-US/menu.ts`

**Interfaces:**
- Consumes: Task 1 产出的共享脚手架 `src/components/CrudTable/`
  （`useCrudTable` / `getCrudColumns` / `CRUD_PAGINATION`，用法见规格 §5.3）
- Produces:
  ```ts
  // src/services/api/system/param.ts
  export interface ParamOut {
    id?: number | null;
    config_name?: string | null;
    config_key?: string | null;
    config_value?: string | null;
    config_type?: boolean | null;
    status?: number | null;
    description?: string | null;
    created_time?: string | null;
    updated_time?: string | null;
  }
  export type ParamListParams = Partial<PageQuery> & {
    config_name?: string;
    config_key?: string;
    config_type?: boolean;
    status?: number;
  };
  export type ParamCreateParams = {
    config_name: string;
    config_key: string;
    config_value?: string | null;
    config_type?: boolean;
    status?: number;
    description?: string | null;
  };
  export type ParamUpdateParams = ParamCreateParams;

  export function listParams(params: ParamListParams): Promise<ApiResponse<PageResult<ParamOut>>>;
  export function getParamDetail(id: number): Promise<ApiResponse<ParamOut>>;
  export function createParam(params: ParamCreateParams): Promise<ApiResponse<ParamOut>>;
  export function updateParam(id: number, params: ParamUpdateParams): Promise<ApiResponse<ParamOut>>;
  export function deleteParams(ids: number[]): Promise<ApiResponse<null>>;
  export function batchSetParamsStatus(ids: number[], status: number): Promise<ApiResponse<null>>;
  ```

- [ ] **Step 1: 写失败的 service 单测**

创建 `src/services/api/system/param.test.ts`，照 `position.test.ts` 的结构，6 个用例：

| 用例 | 断言 |
|---|---|
| 列表 | `request('/system/param/list', { method: 'GET', params: { page_no: 1, page_size: 10, config_name: 'site' } })` |
| 详情 | `request('/system/param/detail/7', { method: 'GET' })` |
| 创建 | `request('/system/param/create', { method: 'POST', data: { config_name: '站点名', config_key: 'site.name' } })` |
| 更新 | `request('/system/param/update/7', { method: 'PUT', data: {...} })` |
| 删除 | `request('/system/param/delete', { method: 'DELETE', data: [1, 2] })` |
| 批量启停 | `request('/system/param/status/batch', { method: 'PATCH', data: { ids: [1, 2], status: 1 } })` |

注意路径前缀是 **`/system/param`**（单数），不是 `/system/params`。

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/services/api/system/param.test.ts
```
Expected: FAIL —— `Cannot find module './param'`。

- [ ] **Step 3: 实现 service**

创建 `src/services/api/system/param.ts`，导出 Interfaces 块里的 6 个函数与 4 个类型。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/services/api/system/param.test.ts
```
Expected: PASS —— 6 个用例全绿。

- [ ] **Step 5: 写页面**

创建 `src/pages/module_system/params/index.tsx` 与 `ModalForm.tsx`。

**用共享脚手架，不要逐行复制岗位页**：

```tsx
const crud = useCrudTable<ParamOut, ParamCreateParams>({
  create: createParam, update: updateParam, remove: deleteParams,
});
const columns: ProColumns<ParamOut>[] = [ /* ...只放数据列... */ ];
// ProTable 上：columns={[...columns, ...getCrudColumns<ParamOut>({...})]}、
// pagination={CRUD_PAGINATION}、onRequestError={() => {}}、
// actionRef={crud.actionRef}；弹窗用 crud.modalOpen / crud.editing / crud.closeModal / crud.handleSubmit
```

权限码用 `module_system:param:*`（单数 `param`）。

列：

| title | dataIndex | 搜索 | 备注 |
|---|---|---|---|
| ID | `id` | 否 | |
| 参数名称 | `config_name` | 是 | |
| 参数键 | `config_key` | 是 | |
| 参数值 | `config_value` | 否 | |
| 系统内置 | `config_type` | 否 | `search: false`；用 `render: (_, record) => record.config_type ? '是' : '否'` 渲染，**不要用 `valueEnum` 配布尔 key**（`false` 是 falsy，valueEnum 匹配有坑） |
| 状态 | `status` | 是 | `valueEnum` 正常/禁用 |
| 描述 | `description` | 否 | |
| 创建时间 | `created_time` | 否 | |
| 操作 | — | — | 编辑 `module_system:param:update` / 删除 `module_system:param:delete` |

表单字段：`config_name`（必填）、`config_key`（必填）、`config_value`、`config_type`（`ProFormSwitch`）、`status`（`ProFormSelect`）、`description`（`ProFormTextArea`）。

**特殊规则**：
- 编辑模式下 **`config_key` 字段要 `disabled`** —— 它是唯一键，后端没放开修改。
- 权限码用 `module_system:param:*`（单数 `param`）。

- [ ] **Step 6: 注册路由与 i18n**

路由：`{ path: '/system/param', name: 'param', icon: 'fileText', component: './module_system/params' }`
（**path 单数、目录复数** —— 这是最容易搞混的一处。）

i18n：`'menu.system.param': '参数管理',` / `'menu.system.param': 'Parameters',`

- [ ] **Step 7: 写 e2e 用例**

创建 `e2e/param.spec.ts`，照 Task 1 的 e2e。要点：

- 拦截 `**/api/v1/system/param/list**`，返回 1 条数据
- `current/info` 的 `menus` 里加 `route_path: 'param'` 的子项
- **RF3 空列表**：把 `list` 的拦截返回 `{ items: [], total: 0, ... }`，
  断言表格渲染出空状态（`.ant-empty` 存在），且页面没有出现「页面出现错误」
- 断言列表请求 URL 含 `page_no=1`、`page_size=10`

- [ ] **Step 8: 跑 e2e，确认通过**

```bash
npm run e2e
```

- [ ] **Step 9: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 10: 提交**

```bash
git add src/services/api/system/param.ts src/services/api/system/param.test.ts \
        src/pages/module_system/params/ e2e/param.spec.ts \
        config/routes.ts src/locales/zh-CN/menu.ts src/locales/en-US/menu.ts
git commit -F <msgfile>
```
提交消息：
```
feat(param): 新增参数管理页

路由用单数 /system/param,目录用复数 module_system/params —— 跟后端菜单的
route_path / component_path 一致。

config_key 是唯一键,编辑模式下置为 disabled。
```

---

### Task 3: 日志管理 log（只读页）

本批验证「非 CRUD 页」的骨架：只有列表 + 详情抽屉，没有新增/编辑。

**Files:**
- Create: `src/services/api/system/log.ts`
- Create: `src/services/api/system/log.test.ts`
- Create: `src/pages/module_system/log/index.tsx`
- Create: `e2e/log.spec.ts`
- Modify: `config/routes.ts`
- Modify: `src/locales/zh-CN/menu.ts`
- Modify: `src/locales/en-US/menu.ts`

**Interfaces:**
- Consumes: Task 1 的范式
- Produces:
  ```ts
  // src/services/api/system/log.ts
  export interface LoginLogOut {
    id?: number | null;
    username?: string | null;
    status?: number | null;
    ip?: string | null;
    browser?: string | null;
    os?: string | null;
    message?: string | null;
    login_time?: string | null;
    created_time?: string | null;
  }
  export interface OperationLogOut {
    id?: number | null;
    title?: string | null;
    business_type?: number | null;
    method?: string | null;
    request_method?: string | null;
    request_url?: string | null;
    request_path?: string | null;
    operator?: string | null;
    username?: string | null;
    ip?: string | null;
    json_result?: string | null;
    status?: number | null;
    created_time?: string | null;
  }
  export type LoginLogListParams = Partial<PageQuery> & {
    username?: string;
    status?: number;
  };
  export type OperationLogListParams = Partial<PageQuery> & {
    username?: string;
    status?: number;
    request_path?: string;
    request_method?: string;
  };

  export function listLoginLogs(params: LoginLogListParams): Promise<ApiResponse<PageResult<LoginLogOut>>>;
  export function getLoginLogDetail(id: number): Promise<ApiResponse<LoginLogOut>>;
  export function deleteLoginLogs(ids: number[]): Promise<ApiResponse<null>>;
  export function listOperationLogs(params: OperationLogListParams): Promise<ApiResponse<PageResult<OperationLogOut>>>;
  export function getOperationLogDetail(id: number): Promise<ApiResponse<OperationLogOut>>;
  export function deleteOperationLogs(ids: number[]): Promise<ApiResponse<null>>;
  ```
  > 字段名以实现时读 `backend/app/api/v1/module_system/log/schema.py` 的
  > `LoginLogOutSchema` / `OperationLogOutSchema` 为准 —— 上面是按后端 schema 抄的**起始**版本，
  > 若实际字段名不同，**以 schema 为准并同步改单测断言**。

- [ ] **Step 1: 写失败的 service 单测**

创建 `src/services/api/system/log.test.ts`，6 个用例：

| 用例 | 断言 |
|---|---|
| 登录日志列表 | `request('/system/log/login/list', { method: 'GET', params: {...} })` |
| 登录日志详情 | `request('/system/log/login/detail/7', { method: 'GET' })` |
| 删除登录日志 | `request('/system/log/login/delete', { method: 'DELETE', data: [1, 2] })` |
| 操作日志列表 | `request('/system/log/operation/list', { method: 'GET', params: {...} })` |
| 操作日志详情 | `request('/system/log/operation/detail/7', { method: 'GET' })` |
| 删除操作日志 | `request('/system/log/operation/delete', { method: 'DELETE', data: [1, 2] })` |

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/services/api/system/log.test.ts
```
Expected: FAIL —— `Cannot find module './log'`。

- [ ] **Step 3: 实现 service**

创建 `src/services/api/system/log.ts`，导出 Interfaces 块里的 6 个函数与 4 个类型。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/services/api/system/log.test.ts
```

- [ ] **Step 5: 写页面**

创建 `src/pages/module_system/log/index.tsx`：

- 页面用 `Tabs` 分成「登录日志」「操作日志」两个 tab
- 两个 tab 各有自己的 `ProTable`、自己的 `actionRef`、自己的列定义
- 切 tab 时**不要**同时挂载两个表格（用 `destroyInactiveTabPane`），避免两个表格同时发请求
- 详情用 `Drawer`（只读），展示该行的全部字段；JSON 类字段（`json_result`）用 `<pre>` 展示
- **没有**「新增」按钮，**没有**编辑按钮
- 只有「删除」按钮，用 `Popconfirm`
- 权限码：
  - 登录日志 tab：`module_system:login_log:query`（查询）、`module_system:login_log:delete`（删除）
  - 操作日志 tab：`module_system:log:query`、`module_system:log:delete`
  > **两套码，命名不一致是真的**（登录日志是 `login_log`，操作日志是 `log`）。
  > 不要再统一，别想当然。

登录日志列：ID / 用户名 / 状态 / IP / 浏览器 / 操作系统 / 登录时间 / 操作（删除）
操作日志列：ID / 标题 / 请求方法 / 请求路径 / 操作人 / 状态 / 创建时间 / 操作（删除、详情）

- [ ] **Step 6: 注册路由与 i18n**

路由：`{ path: '/system/log', name: 'log', icon: 'fileSearch', component: './module_system/log' }`
i18n：`'menu.system.log': '日志管理',` / `'menu.system.log': 'Logs',`

- [ ] **Step 7: 写 e2e 用例**

创建 `e2e/log.spec.ts`：

- 拦截 `**/api/v1/system/log/login/list**` 与 `**/api/v1/system/log/operation/list**`
- `current/info` 的 `menus` 里加 `route_path: 'log'` 的子项
- 断言：默认 tab（登录日志）表格有 1 行；切到「操作日志」后表格有 1 行
- 断言：页面**没有**「新增」按钮

- [ ] **Step 8: 跑 e2e，确认通过**

```bash
npm run e2e
```

- [ ] **Step 9: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 10: 提交**

```bash
git add src/services/api/system/log.ts src/services/api/system/log.test.ts \
        src/pages/module_system/log/ e2e/log.spec.ts \
        config/routes.ts src/locales/zh-CN/menu.ts src/locales/en-US/menu.ts
git commit -F <msgfile>
```
提交消息：
```
feat(log): 新增日志管理页

两个 tab:登录日志与操作日志。权限码是两套 —— 登录日志用
module_system:login_log:*,操作日志用 module_system:log:*,命名不一致是后端现状。

页面只有列表与详情抽屉,没有新增与编辑。
```

---

### Task 4: 部门管理 dept + 部门树选择器

本批产出第一个共用组件 `DeptTreeSelect`，并用它修好已上线的用户表单。

**Files:**
- Create: `src/services/api/system/dept.ts`
- Create: `src/services/api/system/dept.test.ts`
- Create: `src/pages/module_system/dept/index.tsx`
- Create: `src/pages/module_system/dept/ModalForm.tsx`
- Create: `src/components/DeptTreeSelect/index.tsx`
- Create: `src/components/DeptTreeSelect/index.test.tsx`
- Create: `e2e/dept.spec.ts`
- Modify: `src/pages/module_system/user/ModalForm.tsx`（部门 ID → 树选择器）
- Modify: `src/components/index.ts`（登记新组件）
- Modify: `config/routes.ts`
- Modify: `src/locales/zh-CN/menu.ts`
- Modify: `src/locales/en-US/menu.ts`

**Interfaces:**
- Consumes: Task 1 的范式
- Produces:
  ```ts
  // src/services/api/system/dept.ts
  export interface DeptOut {
    id?: number | null;
    name?: string | null;
    code?: string | null;
    order?: number | null;
    leader?: string | null;
    phone?: string | null;
    email?: string | null;
    parent_id?: number | null;
    parent_name?: string | null;
    status?: number | null;
    description?: string | null;
    created_time?: string | null;
    children?: DeptOut[] | null;   // /tree 返回带 children
  }
  export type DeptCreateParams = {
    name: string;
    code: string;
    order?: number;
    leader?: string | null;
    phone?: string | null;
    email?: string | null;
    parent_id?: number | null;
    status?: number;
    description?: string | null;
  };
  export type DeptUpdateParams = DeptCreateParams;

  export function getDeptTree(): Promise<ApiResponse<DeptOut[]>>;
  export function getDeptDetail(id: number): Promise<ApiResponse<DeptOut>>;
  export function createDept(params: DeptCreateParams): Promise<ApiResponse<DeptOut>>;
  export function updateDept(id: number, params: DeptUpdateParams): Promise<ApiResponse<DeptOut>>;
  export function deleteDepts(ids: number[]): Promise<ApiResponse<null>>;
  export function batchSetDeptsStatus(ids: number[], status: number): Promise<ApiResponse<null>>;

  // src/components/DeptTreeSelect/index.tsx
  export interface DeptTreeSelectProps {
    value?: number | null;
    onChange?: (value: number | undefined) => void;
    placeholder?: string;
    disabled?: boolean;
    allowClear?: boolean;
    /** 排除某个节点及其子树（选父部门时用来防自引用） */
    excludeId?: number;
  }
  export default function DeptTreeSelect(props: DeptTreeSelectProps): JSX.Element;
  ```

- [ ] **Step 1: 写失败的 service 单测**

创建 `src/services/api/system/dept.test.ts`，6 个用例：

| 用例 | 断言 |
|---|---|
| 部门树 | `request('/system/dept/tree', { method: 'GET' })` —— **没有 `/list` 接口** |
| 详情 | `request('/system/dept/detail/7', { method: 'GET' })` |
| 创建 | `request('/system/dept/create', { method: 'POST', data: { name: '研发', code: 'rd' } })` |
| 更新 | `request('/system/dept/update/7', { method: 'PUT', data: {...} })` |
| 删除 | `request('/system/dept/delete', { method: 'DELETE', data: [1, 2] })` |
| 批量启停 | `request('/system/dept/status/batch', { method: 'PATCH', data: { ids: [1, 2], status: 1 } })` |

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/services/api/system/dept.test.ts
```
Expected: FAIL —— `Cannot find module './dept'`。

- [ ] **Step 3: 实现 service**

创建 `src/services/api/system/dept.ts`，导出 Interfaces 块里的 6 个函数与 3 个类型。
`getDeptTree` **不带 params**。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/services/api/system/dept.test.ts
```

- [ ] **Step 5: 写 DeptTreeSelect 组件 + 它的测试**

创建 `src/components/DeptTreeSelect/index.tsx`：

- 数据源：`getDeptTree()`
- 用 antd 的 `TreeSelect`（`treeData` 由部门树转成 `{ title, value, children }`）
- `value` 是部门 **id**（number），`onChange` 回传 number
- `excludeId` 传入时，从树里剪掉该节点**及其整棵子树**（选父部门时防自引用）
- 状态用 `TreeSelect` 的 `treeData` + `loading` 态；请求失败时降级为「没有选项」，**不抛异常**

创建 `src/components/DeptTreeSelect/index.test.tsx`（vitest + @testing-library）：

| 用例 | 断言 |
|---|---|
| **RF5 空树** | `getDeptTree` 解析为 `[]` 时，组件正常渲染，**不抛异常**，出现空选择框 |
| **RF5 单节点** | 解析为一条记录时，组件正常渲染 |
| 渲染选项 | 解析为两条父子记录时，展开后两个 `title` 都在 DOM 里 |
| `excludeId` | 传入父部门 id 后，它的子树不再出现在 DOM 里 |

测试里 `vi.mock('@/services/api/system/dept')` 把 `getDeptTree` 打桩。

- [ ] **Step 6: 跑组件测试，确认通过**

```bash
npx vitest run src/components/DeptTreeSelect/index.test.tsx
```

- [ ] **Step 7: 写部门页**

创建 `src/pages/module_system/dept/index.tsx` 与 `ModalForm.tsx`。

**页面形态**：用 `ProTable` 的树形表格（`childrenColumnName="children"`），
数据直接来自 `getDeptTree()`（**不经过 `toProTableRequest`，因为后端没有分页列表接口**）。

- 表格的 `request` 写成：
  ```ts
  request={async () => {
    const res = await getDeptTree();
    return { data: res?.data ?? [], success: res?.success ?? false, total: res?.data?.length ?? 0 };
  }}
  ```
- **搜索在前端做**：加一个 `search={false}`，改成工具栏里放一个 `Input.Search`，
  在 `onSearch` 里对已加载的树做名称过滤（后端没有带关键字的树接口）
- 列：ID / 部门名称 / 部门编码 / 排序 / 负责人 / 状态 / 创建时间 / 操作
- 表单里「上级部门」用 `<DeptTreeSelect />`，并传 `excludeId={editing?.id}` 防自引用
- 操作：编辑 `module_system:dept:update` / 删除 `module_system:dept:delete`
- 工具栏「新增」`module_system:dept:create`
- 批量启停按钮：选中行后调 `batchSetDeptsStatus(ids, status)`，`module_system:dept:patch`

- [ ] **Step 8: 修用户表单的部门字段**

`src/pages/module_system/user/ModalForm.tsx` 里把

```tsx
<ProFormDigit name="dept_id" label="部门 ID" />
```

换成部门树选择（用 `ProForm.Item` 包 `DeptTreeSelect`，或 `ProFormSelect` + `request`），
标签改成「部门」，并保证表单提交的字段名仍是 `dept_id`（number）。

改完跑一遍已有的用户页 e2e，确认没打破。

- [ ] **Step 9: 登记组件**

`src/components/index.ts` 追加：

```ts
export { default as DeptTreeSelect } from './DeptTreeSelect';
```

- [ ] **Step 10: 注册路由与 i18n**

路由：`{ path: '/system/dept', name: 'dept', icon: 'apartment', component: './module_system/dept' }`
i18n：`'menu.system.dept': '部门管理',` / `'menu.system.dept': 'Departments',`

- [ ] **Step 11: 写 e2e 用例**

创建 `e2e/dept.spec.ts`：

- 拦截 `**/api/v1/system/dept/tree`，返回两级树
- `current/info` 的 `menus` 里加 `route_path: 'dept'` 的子项
- 断言：表格渲染出子部门行；列表请求路径是 `/system/dept/tree`（**不是 `/list`**）

- [ ] **Step 12: 跑 e2e，确认通过**

```bash
npm run e2e
```

- [ ] **Step 13: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 14: 提交**

```bash
git add src/services/api/system/dept.ts src/services/api/system/dept.test.ts \
        src/pages/module_system/dept/ src/components/DeptTreeSelect/ \
        src/pages/module_system/user/ModalForm.tsx src/components/index.ts \
        e2e/dept.spec.ts config/routes.ts \
        src/locales/zh-CN/menu.ts src/locales/en-US/menu.ts
git commit -F <msgfile>
```
提交消息：
```
feat(dept): 新增部门管理页与部门树选择器

后端只有 /system/dept/tree,没有列表接口,所以搜索在前端过滤已加载的树。

新增共用组件 DeptTreeSelect,并用它把用户表单里的「部门 ID」数字框
换成树选择器 —— 这是本轮唯一一处对已上线页面的改动。
```

---

### Task 5: 角色管理 role + 菜单权限树

本批产出第二个共用组件 `MenuPermissionTree`。注意 `src/services/api/system/role.ts` 已存在且有 `listRoles`（用户表单在用），**在它上面扩展，不要新建同名文件**。

**Files:**
- Modify: `src/services/api/system/role.ts`
- Modify: `src/services/api/system/types.ts`
- Create: `src/services/api/system/role.test.ts`
- Create: `src/pages/module_system/role/index.tsx`
- Create: `src/pages/module_system/role/ModalForm.tsx`
- Create: `src/pages/module_system/role/PermissionModal.tsx`
- Create: `src/components/MenuPermissionTree/index.tsx`
- Create: `src/components/MenuPermissionTree/index.test.tsx`
- Create: `e2e/role.spec.ts`
- Modify: `src/components/index.ts`
- Modify: `config/routes.ts`
- Modify: `src/locales/zh-CN/menu.ts`
- Modify: `src/locales/en-US/menu.ts`

**Interfaces:**
- Consumes: Task 4 的 `DeptTreeSelect`
- Produces:
  ```ts
  // src/services/api/system/types.ts（追加，与已有的 RoleOut 同居）
  export interface RoleCreateParams {
    name: string;
    code: string;
    order?: number | null;
    data_scope?: number | null;
    status?: number;
    description?: string | null;
  }
  export interface RoleUpdateParams extends RoleCreateParams {}
  export interface RolePermissionParams {
    data_scope: number;
    role_ids: number[];
    menu_ids: number[];
    dept_ids: number[];
  }

  // src/services/api/system/role.ts（追加，保留已有的 listRoles）
  export function getRoleDetail(id: number): Promise<ApiResponse<RoleOut>>;
  export function createRole(params: RoleCreateParams): Promise<ApiResponse<RoleOut>>;
  export function updateRole(id: number, params: RoleUpdateParams): Promise<ApiResponse<RoleOut>>;
  export function deleteRoles(ids: number[]): Promise<ApiResponse<null>>;
  export function batchSetRolesStatus(ids: number[], status: number): Promise<ApiResponse<null>>;
  export function setRolePermission(params: RolePermissionParams): Promise<ApiResponse<null>>;

  // src/components/MenuPermissionTree/index.tsx
  export interface MenuPermissionTreeProps {
    value?: number[];
    onChange?: (value: number[]) => void;
    disabled?: boolean;
  }
  export default function MenuPermissionTree(props: MenuPermissionTreeProps): JSX.Element;
  ```

- [ ] **Step 1: 写失败的 service 单测**

创建 `src/services/api/system/role.test.ts`（注意：`role.ts` 已存在，所以这一步测的是**新增的**函数）：

| 用例 | 断言 |
|---|---|
| 详情 | `request('/system/role/detail/7', { method: 'GET' })` |
| 创建 | `request('/system/role/create', { method: 'POST', data: { name: '管理员', code: 'admin' } })` |
| 更新 | `request('/system/role/update/7', { method: 'PUT', data: {...} })` |
| 删除 | `request('/system/role/delete', { method: 'DELETE', data: [1, 2] })` |
| 批量启停 | `request('/system/role/status/batch', { method: 'PATCH', data: { ids: [1, 2], status: 1 } })` |
| 授权 | `request('/system/role/permission', { method: 'PUT', data: { data_scope: 1, role_ids: [7], menu_ids: [1, 2], dept_ids: [] } })` |
| 列表（回归） | `request('/system/role/list', { method: 'GET', params: {...} })` —— 确认没打破已有的 `listRoles` |

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/services/api/system/role.test.ts
```
Expected: FAIL —— `getRoleDetail` 等导出不存在。

- [ ] **Step 3: 实现 service 与类型**

- `src/services/api/system/types.ts` 追加 `RoleCreateParams` / `RoleUpdateParams` / `RolePermissionParams`
- `src/services/api/system/role.ts` 追加 6 个函数，**保留**已有的 `listRoles` 与 `RoleListParams`
- `setRolePermission` 用 **PUT**，请求体是 `{ data_scope, role_ids, menu_ids, dept_ids }` 四个平级字段

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/services/api/system/role.test.ts
```

- [ ] **Step 5: 写 MenuPermissionTree 组件 + 测试**

创建 `src/components/MenuPermissionTree/index.tsx`：

- 数据源：`getCurrentUser()`（`@/services/api/system/user`）返回的 `menus` 树
  —— **不是** `getMenuTree`（那个返回扁平列表，且本轮会被删掉）
- 用 antd `Tree` 的 `checkable`，`checkedKeys` ↔ `value: number[]` 互转
- 半选的父节点要带上（`checkedKeys` 用 `{ checked: number[], halfChecked: number[] }` 处理，
  提交时把两者合并去重）
- 菜单节点 id 是 `BackendMenu.id`

创建 `src/components/MenuPermissionTree/index.test.tsx`：

| 用例 | 断言 |
|---|---|
| 渲染 | `getCurrentUser` 返回带 `children` 的菜单树时，父子节点标题都在 DOM 里 |
| 空树 | 返回空数组时不抛异常 |
| 受控值 | 传入 `value=[3]` 时，对应节点是勾选态 |

- [ ] **Step 6: 跑组件测试，确认通过**

```bash
npx vitest run src/components/MenuPermissionTree/index.test.tsx
```

- [ ] **Step 7: 写角色页与授权弹窗**

创建 `src/pages/module_system/role/index.tsx` / `ModalForm.tsx` / `PermissionModal.tsx`。

主页面列：

| title | dataIndex | 搜索 | 备注 |
|---|---|---|---|
| ID | `id` | 否 | |
| 角色名称 | `name` | 是 | |
| 角色编码 | `code` | 是 | |
| 排序 | `order` | 否 | |
| 数据权限 | `data_scope` | 否 | `valueEnum`：1 仅本人 / 2 本部门 / 3 本部门及以下 / 4 全部 / 5 自定义 |
| 状态 | `status` | 是 | 正常 / 禁用 |
| 描述 | `description` | 否 | |
| 创建时间 | `created_time` | 否 | |
| 操作 | — | — | 编辑 / 授权 / 删除 |

表单字段：`name`（必填）、`code`（必填）、`order`、`data_scope`（`ProFormSelect` 5 个选项）、`status`、`description`。

**`code` 的前端校验**（后端要求「字母开头，2-64 位，仅字母/数字/下划线」）：
```ts
rules: [{ pattern: /^[A-Za-z][A-Za-z0-9_]{1,63}$/, message: '角色编码需以字母开头,只能包含字母、数字和下划线' }]
```

授权弹窗 `PermissionModal.tsx`：

- 一个「数据权限」下拉（5 档）
- `data_scope === 5`（自定义）时才渲染 `<DeptTreeSelect />`（多选模式）
- 一个 `<MenuPermissionTree />`
- 提交调 `setRolePermission({ data_scope, role_ids: [editing.id], menu_ids, dept_ids })`

权限码：编辑 `module_system:role:update` / 授权 `module_system:role:permission` / 删除 `module_system:role:delete` / 新增 `module_system:role:create` / 批量启停 `module_system:role:patch`

- [ ] **Step 8: 登记组件**

`src/components/index.ts` 追加：
```ts
export { default as MenuPermissionTree } from './MenuPermissionTree';
```

- [ ] **Step 9: 注册路由与 i18n**

路由：`{ path: '/system/role', name: 'role', icon: 'safetyCertificate', component: './module_system/role' }`
i18n：`'menu.system.role': '角色管理',` / `'menu.system.role': 'Roles',`

- [ ] **Step 10: 写 e2e 用例**

创建 `e2e/role.spec.ts`：

- 拦截 `**/api/v1/system/role/list**`、`**/api/v1/system/role/permission`
- `current/info` 的 `menus` 里加 `route_path: 'role'` 的子项
- **RF4 表单被拒**：把 `role/create` 的拦截返回 HTTP 500 + 信封
  `{ code: -1, msg: '角色编码已存在', data: null, status_code: 500, success: false }`，
  断言：页面出现「角色编码已存在」，且**弹窗仍然打开**（`.ant-modal` 可见）
- 断言「授权」按钮存在

- [ ] **Step 11: 跑 e2e，确认通过**

```bash
npm run e2e
```

- [ ] **Step 12: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 13: 提交**

```bash
git add src/services/api/system/role.ts src/services/api/system/role.test.ts \
        src/services/api/system/types.ts src/pages/module_system/role/ \
        src/components/MenuPermissionTree/ src/components/index.ts \
        e2e/role.spec.ts config/routes.ts \
        src/locales/zh-CN/menu.ts src/locales/en-US/menu.ts
git commit -F <msgfile>
```
提交消息：
```
feat(role): 新增角色管理页与菜单权限树

role.ts 已有 listRoles(用户表单在用),在原文件上扩展,没有新建同名文件。

菜单树数据源用 current/info 的 menus —— 那里带 children;
//platform/menu/tree 返回的是扁平列表,不能当树源。
授权走 PUT /system/role/permission,入参是 data_scope/role_ids/menu_ids/dept_ids。
```

---

### Task 6: 字典管理 dict（主从结构）

本轮唯一的双资源页面：左侧字典类型，右侧该类型下的字典数据。

**Files:**
- Create: `src/services/api/system/dict.ts`
- Create: `src/services/api/system/dict.test.ts`
- Create: `src/pages/module_system/dict/index.tsx`
- Create: `src/pages/module_system/dict/TypeModalForm.tsx`
- Create: `src/pages/module_system/dict/DataModalForm.tsx`
- Create: `e2e/dict.spec.ts`
- Modify: `config/routes.ts`
- Modify: `src/locales/zh-CN/menu.ts`
- Modify: `src/locales/en-US/menu.ts`

**Interfaces:**
- Consumes: Task 1 的范式
- Produces:
  ```ts
  // src/services/api/system/dict.ts
  export interface DictTypeOut {
    id?: number | null;
    dict_name?: string | null;
    dict_type?: string | null;
    dict_sort?: number | null;
    status?: number | null;
    description?: string | null;
    created_time?: string | null;
  }
  export interface DictDataOut {
    id?: number | null;
    dict_label?: string | null;
    dict_value?: string | null;
    dict_type?: string | null;
    dict_type_id?: number | null;
    css_class?: string | null;
    list_class?: string | null;
    is_default?: boolean | null;
    status?: number | null;
    description?: string | null;
    created_time?: string | null;
  }
  export type DictTypeListParams = Partial<PageQuery> & {
    dict_name?: string;
    dict_type?: string;
    status?: number;
  };
  export type DictDataListParams = Partial<PageQuery> & {
    dict_label?: string;
    dict_type?: string;
    status?: number;
  };
  export type DictTypeCreateParams = {
    dict_name: string;
    dict_type: string;
    dict_sort?: number;
    status?: number;
    description?: string | null;
  };
  export type DictTypeUpdateParams = DictTypeCreateParams;
  export type DictDataCreateParams = {
    dict_label: string;
    dict_value: string;
    dict_type_id: number;
    css_class?: string | null;
    list_class?: string | null;
    is_default?: boolean;
    status?: number;
    description?: string | null;
  };
  export type DictDataUpdateParams = DictDataCreateParams;

  export function listDictTypes(params: DictTypeListParams): Promise<ApiResponse<PageResult<DictTypeOut>>>;
  export function getDictTypeDetail(id: number): Promise<ApiResponse<DictTypeOut>>;
  export function listDictTypeOptions(): Promise<ApiResponse<DictTypeOut[]>>;
  export function createDictType(params: DictTypeCreateParams): Promise<ApiResponse<DictTypeOut>>;
  export function updateDictType(id: number, params: DictTypeUpdateParams): Promise<ApiResponse<DictTypeOut>>;
  export function deleteDictTypes(ids: number[]): Promise<ApiResponse<null>>;
  export function batchSetDictTypesStatus(ids: number[], status: number): Promise<ApiResponse<null>>;
  export function listDictDatas(params: DictDataListParams): Promise<ApiResponse<PageResult<DictDataOut>>>;
  export function getDictDataDetail(id: number): Promise<ApiResponse<DictDataOut>>;
  export function getDictDataByType(dictType: string): Promise<ApiResponse<DictDataOut[]>>;
  export function createDictData(params: DictDataCreateParams): Promise<ApiResponse<DictDataOut>>;
  export function updateDictData(id: number, params: DictDataUpdateParams): Promise<ApiResponse<DictDataOut>>;
  export function deleteDictDatas(ids: number[]): Promise<ApiResponse<null>>;
  export function batchSetDictDatasStatus(ids: number[], status: number): Promise<ApiResponse<null>>;
  ```

- [ ] **Step 1: 写失败的 service 单测**

创建 `src/services/api/system/dict.test.ts`，**12 个用例**（6 个 type + 6 个 data）：

| 用例 | 断言 |
|---|---|
| 类型列表 | `request('/system/dict/type/list', { method: 'GET', params: {...} })` |
| 类型详情 | `request('/system/dict/type/detail/7', { method: 'GET' })` |
| 类型下拉选项 | `request('/system/dict/type/optionselect', { method: 'GET' })` |
| 创建类型 | `request('/system/dict/type/create', { method: 'POST', data: {...} })` |
| 更新类型 | `request('/system/dict/type/update/7', { method: 'PUT', data: {...} })` |
| 删除类型 | `request('/system/dict/type/delete', { method: 'DELETE', data: [1, 2] })` |
| 类型批量启停 | `request('/system/dict/type/status/batch', { method: 'PATCH', data: { ids: [1,2], status: 1 } })` |
| 数据列表 | `request('/system/dict/data/list', { method: 'GET', params: {...} })` |
| 数据详情 | `request('/system/dict/data/detail/7', { method: 'GET' })` |
| 按类型取数据 | `request('/system/dict/data/info/user_status', { method: 'GET' })` |
| 创建数据 | `request('/system/dict/data/create', { method: 'POST', data: {...} })` |
| 删除数据 | `request('/system/dict/data/delete', { method: 'DELETE', data: [1, 2] })` |

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/services/api/system/dict.test.ts
```
Expected: FAIL —— `Cannot find module './dict'`。

- [ ] **Step 3: 实现 service**

创建 `src/services/api/system/dict.ts`，导出 Interfaces 块里的 14 个函数与 8 个类型。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/services/api/system/dict.test.ts
```

- [ ] **Step 5: 写页面**

创建 `src/pages/module_system/dict/index.tsx`：

- **左右分栏**：左栏是字典类型列表（用简单 `Table` 或 `List`，点击切换选中的类型），
  右栏是当前选中类型下的字典数据 `ProTable`
- 首次进入时默认选中第一个类型；类型列表用 `listDictTypes({ page_no: 1, page_size: 100 })` 拉
- 右栏的数据列表要带上选中类型的筛选：请求参数里传 `dict_type: selectedType.dict_type`
- 左栏顶部一个「新增类型」按钮（`module_system:dict_type:create`）
- 右栏顶部一个「新增数据」按钮（`module_system:dict_data:create`）
- 类型行操作：编辑（`dict_type:update`）/ 删除（`dict_type:delete`）
- 数据行操作：编辑（`dict_data:update`）/ 删除（`dict_data:delete`）

`TypeModalForm.tsx`：`dict_name`（必填）、`dict_type`（必填）、`dict_sort`、`status`、`description`
`DataModalForm.tsx`：`dict_label`（必填）、`dict_value`（必填）、`dict_type_id`（必填，选当前类型）、
`css_class`、`list_class`、`is_default`（`ProFormSwitch`）、`status`、`description`

**权限码是两套**：`module_system:dict_type:*` 与 `module_system:dict_data:*`，不要混用。

- [ ] **Step 6: 注册路由与 i18n**

路由：`{ path: '/system/dict', name: 'dict', icon: 'book', component: './module_system/dict' }`
i18n：`'menu.system.dict': '字典管理',` / `'menu.system.dict': 'Dictionaries',`

- [ ] **Step 7: 写 e2e 用例**

创建 `e2e/dict.spec.ts`：

- 拦截 `**/api/v1/system/dict/type/list**` 与 `**/api/v1/system/dict/data/list**`
- `current/info` 的 `menus` 里加 `route_path: 'dict'` 的子项
- 断言：左栏出现类型名，右栏表格出现该类型下的数据行

- [ ] **Step 8: 跑 e2e，确认通过**

```bash
npm run e2e
```

- [ ] **Step 9: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 10: 提交**

```bash
git add src/services/api/system/dict.ts src/services/api/system/dict.test.ts \
        src/pages/module_system/dict/ e2e/dict.spec.ts config/routes.ts \
        src/locales/zh-CN/menu.ts src/locales/en-US/menu.ts
git commit -F <msgfile>
```
提交消息：
```
feat(dict): 新增字典管理页

双资源页面:左侧字典类型,右侧该类型下的字典数据。
权限码是两套 —— module_system:dict_type:* 与 module_system:dict_data:*。
```

---

### Task 7: 公告管理 notice

**Files:**
- Create: `src/services/api/system/notice.ts`
- Create: `src/services/api/system/notice.test.ts`
- Create: `src/pages/module_system/notice/index.tsx`
- Create: `src/pages/module_system/notice/ModalForm.tsx`
- Create: `e2e/notice.spec.ts`
- Modify: `config/routes.ts`
- Modify: `src/locales/zh-CN/menu.ts`
- Modify: `src/locales/en-US/menu.ts`

**Interfaces:**
- Consumes: Task 1 的范式
- Produces:
  ```ts
  // src/services/api/system/notice.ts
  export interface NoticeOut {
    id?: number | null;
    notice_title?: string | null;
    notice_type?: string | null;
    notice_content?: string | null;
    status?: number | null;
    description?: string | null;
    created_time?: string | null;
  }
  export type NoticeListParams = Partial<PageQuery> & {
    notice_title?: string;
    notice_type?: string;
    status?: number;
  };
  export type NoticeCreateParams = {
    notice_title: string;
    notice_type: string;
    notice_content?: string | null;
    status?: number;
    description?: string | null;
  };
  export type NoticeUpdateParams = NoticeCreateParams;

  export function listNotices(params: NoticeListParams): Promise<ApiResponse<PageResult<NoticeOut>>>;
  export function getNoticeDetail(id: number): Promise<ApiResponse<NoticeOut>>;
  export function createNotice(params: NoticeCreateParams): Promise<ApiResponse<NoticeOut>>;
  export function updateNotice(id: number, params: NoticeUpdateParams): Promise<ApiResponse<NoticeOut>>;
  export function deleteNotices(ids: number[]): Promise<ApiResponse<null>>;
  export function batchSetNoticesStatus(ids: number[], status: number): Promise<ApiResponse<null>>;
  ```

- [ ] **Step 1: 写失败的 service 单测**

创建 `src/services/api/system/notice.test.ts`，6 个用例：

| 用例 | 断言 |
|---|---|
| 列表 | `request('/system/notice/list', { method: 'GET', params: {...} })` |
| 详情 | `request('/system/notice/detail/7', { method: 'GET' })` |
| 创建 | `request('/system/notice/create', { method: 'POST', data: {...} })` |
| 更新 | `request('/system/notice/update/7', { method: 'PUT', data: {...} })` |
| 删除 | `request('/system/notice/delete', { method: 'DELETE', data: [1, 2] })` |
| 批量启停 | `request('/system/notice/status/batch', { method: 'PATCH', data: { ids: [1,2], status: 1 } })` |

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/services/api/system/notice.test.ts
```
Expected: FAIL —— `Cannot find module './notice'`。

- [ ] **Step 3: 实现 service**

创建 `src/services/api/system/notice.ts`，导出 Interfaces 块里的 6 个函数与 4 个类型。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/services/api/system/notice.test.ts
```

- [ ] **Step 5: 写页面**

创建 `src/pages/module_system/notice/index.tsx` 与 `ModalForm.tsx`。

列：ID / 公告标题 / 公告类型 / 状态 / 创建时间 / 操作

表单字段：
- `notice_title`（`ProFormText`，必填）
- `notice_type`（`ProFormSelect`，**可配置下拉**：默认给「通知 / 公告 / 提醒」三项，
  且 `showSearch` + `allowClear`，让管理员能输入自定义值）
- `notice_content`（`ProFormTextArea`，**本轮用普通多行文本框，不引富文本依赖**）
- `status`（`ProFormSelect`，正常/禁用）
- `description`（`ProFormTextArea`）

权限码：`module_system:notice:{query,create,update,delete,patch}`

**本批不做**：顶栏铃铛相关接口（`/notice/panel`、`/notice/read/{id}`、`/notice/read-all`、
`/notice/unread-count`、`/notice/available`）—— 那是顶栏通知功能，不属于公告管理页。

- [ ] **Step 6: 注册路由与 i18n**

路由：`{ path: '/system/notice', name: 'notice', icon: 'notification', component: './module_system/notice' }`
i18n：`'menu.system.notice': '公告管理',` / `'menu.system.notice': 'Notices',`

- [ ] **Step 7: 写 e2e 用例**

创建 `e2e/notice.spec.ts`：拦截 `**/api/v1/system/notice/list**`，
`current/info` 的 `menus` 里加 `route_path: 'notice'` 的子项，断言表格渲染出公告标题。

- [ ] **Step 8: 跑 e2e，确认通过**

```bash
npm run e2e
```

- [ ] **Step 9: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 10: 提交**

```bash
git add src/services/api/system/notice.ts src/services/api/system/notice.test.ts \
        src/pages/module_system/notice/ e2e/notice.spec.ts config/routes.ts \
        src/locales/zh-CN/menu.ts src/locales/en-US/menu.ts
git commit -F <msgfile>
```
提交消息：
```
feat(notice): 新增公告管理页

notice_content 本轮用普通多行文本框,没有引入富文本编辑器依赖。
顶栏铃铛相关接口不在本批范围。
```

---

### Task 8: 工单管理 ticket

**Files:**
- Create: `src/services/api/system/ticket.ts`
- Create: `src/services/api/system/ticket.test.ts`
- Create: `src/pages/module_system/ticket/index.tsx`
- Create: `src/pages/module_system/ticket/ModalForm.tsx`
- Create: `e2e/ticket.spec.ts`
- Modify: `config/routes.ts`
- Modify: `src/locales/zh-CN/menu.ts`
- Modify: `src/locales/en-US/menu.ts`

**Interfaces:**
- Consumes: Task 1 的范式；`listUsers`（`@/services/api/system/user`）用于处理人下拉
- Produces:
  ```ts
  // src/services/api/system/ticket.ts
  export type TicketType = 'suggestion' | 'bug' | 'optimize' | 'other';

  export interface TicketOut {
    id?: number | null;
    title?: string | null;
    ticket_type?: TicketType | string | null;
    ticket_content?: string | null;
    summary?: string | null;
    images?: string | null;
    description?: string | null;
    assigned_id?: number | null;
    status?: number | null;
    created_time?: string | null;
  }
  export type TicketListParams = Partial<PageQuery> & {
    title?: string;
    ticket_type?: string;
    assigned_id?: number;
    status?: number;
  };
  export type TicketCreateParams = {
    title: string;
    ticket_content: string;
    ticket_type: TicketType;
    summary?: string | null;
    images?: string | null;
    description?: string | null;
  };
  export type TicketUpdateParams = TicketCreateParams;
  /** 后端 TicketBatchSchema:{ ids, status } */
  export interface TicketBatchParams {
    ids: number[];
    status: TicketStatus;
  }
  export type TicketStatus = 0 | 1 | 2 | 3;

  export function listTickets(params: TicketListParams): Promise<ApiResponse<PageResult<TicketOut>>>;
  export function getTicketDetail(id: number): Promise<ApiResponse<TicketOut>>;
  export function createTicket(params: TicketCreateParams): Promise<ApiResponse<TicketOut>>;
  export function updateTicket(id: number, params: TicketUpdateParams): Promise<ApiResponse<TicketOut>>;
  export function deleteTickets(ids: number[]): Promise<ApiResponse<null>>;
  export function batchUpdateTickets(params: TicketBatchParams): Promise<ApiResponse<null>>;
  ```

- [ ] **Step 1: 写失败的 service 单测**

创建 `src/services/api/system/ticket.test.ts`，6 个用例：

| 用例 | 断言 |
|---|---|
| 列表 | `request('/system/ticket/list', { method: 'GET', params: {...} })` |
| 详情 | `request('/system/ticket/detail/7', { method: 'GET' })` |
| 创建 | `request('/system/ticket/create', { method: 'POST', data: { title: '登录报错', ticket_content: '...', ticket_type: 'bug' } })` |
| 更新 | `request('/system/ticket/update/7', { method: 'PUT', data: {...} })` |
| 删除 | `request('/system/ticket/delete', { method: 'DELETE', data: [1, 2] })` |
| 批量更新 | `request('/system/ticket/batch', { method: 'PUT', data: { ids: [1, 2], status: 2 } })` —— **批量更新是 PUT，不是 PATCH** |

> 已核实后端 `TicketBatchSchema`（`backend/app/api/v1/module_system/ticket/schema.py:68`）
> 的字段就是 `{ ids: list[int], status: int }`，`status` 取值 0..3。
> 所以这里的批量更新**不是**通用的「批量改任意字段」，而是**批量改状态**。

- [ ] **Step 3: 跑测试，确认失败**

```bash
npx vitest run src/services/api/system/ticket.test.ts
```
Expected: FAIL —— `Cannot find module './ticket'`。

- [ ] **Step 4: 实现 service**

创建 `src/services/api/system/ticket.ts`，导出 Interfaces 块里的 6 个函数与 6 个类型。
`batchUpdateTickets` 的入参是 `TicketBatchParams`（`{ ids, status }`），方法 `PUT`。

- [ ] **Step 5: 跑测试，确认通过**

```bash
npx vitest run src/services/api/system/ticket.test.ts
```

- [ ] **Step 6: 写页面**

创建 `src/pages/module_system/ticket/index.tsx` 与 `ModalForm.tsx`。

列：ID / 标题 / 工单类型 / 处理人 / 状态 / 创建时间 / 操作

工单类型列用 `valueEnum`：
```ts
{ suggestion: { text: '建议' }, bug: { text: '缺陷' }, optimize: { text: '优化' }, other: { text: '其他' } }
```
（取值来自后端 `app/common/enums.py` 的 `TicketTypeEnum`）

状态列用 `valueEnum`：
```ts
{ 0: { text: '待处理', status: 'Default' }, 1: { text: '处理中', status: 'Processing' },
  2: { text: '已完成', status: 'Success' }, 3: { text: '已关闭', status: 'Default' } }
```
（取值来自后端 `TicketBatchSchema.status` 的 `0..3`）

表单字段：`title`（必填）、`ticket_content`（必填）、`ticket_type`（必填，`ProFormSelect` 四项）、
`summary`、`images`、`description`

**权限码**：`module_system:ticket:{list,detail,create,update,delete}`
> 列表权限码是 **`:list`**，不是 `:query`（其它模块都是 `:query`）。别搞混。

批量更新按钮（选中行后出现）：调 `batchUpdateTickets({ ids, status })`，
`status` 从一个下拉里选（待处理/处理中/已完成/已关闭）。

- [ ] **Step 7: 注册路由与 i18n**

路由：`{ path: '/system/ticket', name: 'ticket', icon: 'customerService', component: './module_system/ticket' }`
i18n：`'menu.system.ticket': '工单管理',` / `'menu.system.ticket': 'Tickets',`

- [ ] **Step 8: 写 e2e 用例**

创建 `e2e/ticket.spec.ts`：拦截 `**/api/v1/system/ticket/list**`，
`current/info` 的 `menus` 里加 `route_path: 'ticket'` 的子项，断言表格渲染出工单标题。

- [ ] **Step 9: 跑 e2e，确认通过**

```bash
npm run e2e
```

- [ ] **Step 10: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 11: 提交**

```bash
git add src/services/api/system/ticket.ts src/services/api/system/ticket.test.ts \
        src/pages/module_system/ticket/ e2e/ticket.spec.ts config/routes.ts \
        src/locales/zh-CN/menu.ts src/locales/en-US/menu.ts
git commit -F <msgfile>
```
提交消息：
```
feat(ticket): 新增工单管理页

列表权限码是 module_system:ticket:list,不是 :query —— 后端现状。
批量更新走 PUT /system/ticket/batch,入参按后端 TicketBatchSchema。
```

---

### Task 9: 工程债专项

7 条债务集中处理，**不与页面开发混在一起**。每条都有明确的验收标准。

**Files:**
- Modify: `src/auth/token.ts`
- Modify: `src/auth/token.test.ts`（若已存在则追加用例）
- Modify: `src/requestErrorConfig.ts`
- Modify: `src/menu/adapter.ts`
- Modify: `src/app.tsx`
- Modify: `src/app.test.tsx`
- Delete: `src/services/api/platform/menu.ts`
- Delete: `src/services/api/platform/types.ts`（若删完 `menu.ts` 后无引用则一并删）
- Modify: `skills-lock.json`
- Modify: `.claude/skills/**`（D6）

**Interfaces:**
- Consumes: 前 8 个任务产出的所有页面
- Produces: 无新接口；本任务只改行为

- [ ] **Step 1: D1 —— token 存储加 try/catch**

`src/auth/token.ts` 的 5 个导出函数（`isRememberMe` / `getAccessToken` / `getRefreshToken` /
`setTokens` / `clearAuth`）里，所有 `localStorage` / `sessionStorage` 访问都包 try/catch：

- 读失败 → 返回 `''` 或 `false`（等价于「未登录」）
- 写失败 → 静默忽略（不抛）

**追加**单测到已有的 `src/auth/token.test.ts`：把 `localStorage.getItem` 打桩成抛异常，
断言 `getAccessToken()` 返回 `''` 而不是抛出。

- [ ] **Step 2: D2 —— 静态 message 换成 App.useApp()**

`src/requestErrorConfig.ts` 里 7 处 `message.error` / `message.success` 换成
从 `App.useApp()` 拿到的实例 `message`。

由于 `errorHandler` 是模块级导出的对象里的函数、**不是 React 组件**，
不能直接调 hook。做法：

1. 在 `src/app.tsx` 里用 antd 的 `<App>` 包住根节点，并在其内部用一个
   「把 message 实例挂到模块级变量」的小组件把 `message` 实例导出
   （例如新建 `src/components/AppMessageBridge.tsx`，在 `useEffect` 里
   `setAppMessage(message)`，组件卸载时置空）
2. `src/requestErrorConfig.ts` 从该模块导入 `getAppMessage()`，
   拿不到实例时**退回** `antd` 的静态 `message`（保证不崩）
3. 更新 `src/app.test.tsx`：断言渲染树仍然正常（包 `<App>` 会多一层 DOM）

验收：页面上的错误提示仍然出现，且**能被 antd 的 ConfigProvider 主题影响**。

- [ ] **Step 3: D3 —— type=4 外链菜单单独识别**

`src/menu/adapter.ts` 里 `MENU_TYPE_EXTERNAL`（type=4）的分支，
从「与路径未注册混为一谈」改成独立分支，输出可区分的告警文案，例如：
`[menu] 外链菜单暂不支持渲染: <path>`。

同时**追加**一条单测到已有的 `src/menu/adapter.test.ts`（该文件第 210 行已有 type=4 的用例）：
给一个 type=4 的菜单项，断言它被跳过、且**不**产生「前端缺少路由」的告警。

- [ ] **Step 4: D4 —— 删除死代码 `getMenuTree`**

删除 `src/services/api/platform/menu.ts`。
若 `src/services/api/platform/types.ts` 删掉 `menu.ts` 后没有别的引用，一并删除，
空目录也删掉。

验证没有残留引用：
```bash
grep -rn "getMenuTree\|api/platform" src/
```
Expected: 无输出。

- [ ] **Step 5: D5 —— 修 `skills-lock.json` 的 hash**

用技能工具重新计算 `.agents/skills/antd` 与 `.agents/skills/pro-upgrade` 的摘要，
写回 `skills-lock.json` 的 `computedHash`。
（若技能工具的哈希算法无法复现，则**删掉** `computedHash` 字段而不是留一个错的。）

- [ ] **Step 6: D6 —— 统一 `.claude/skills` 与 `.agents/skills`**

两处目前是两份普通文件副本。改成符号链接（指向 `.agents/skills` 下的同名目录）。
Windows 上创建符号链接需要开发者模式或管理员权限 —— **若当前环境没有权限**，
则跳过这一步，并在 `README.md` 里写一行说明：
「`.claude/skills` 与 `.agents/skills` 是两份副本，可能存在漂移」。

- [ ] **Step 7: D7 —— 复核 `baseURL` 与免鉴权路径的单一来源**

检查 `src/app.tsx` 的 `request.baseURL` 与 `src/requestErrorConfig.ts` 的
`AUTH_FREE_PATHS`：确认 `baseURL` 来自 `src/services/http.ts` 的 `API_BASE_URL`，
且**只有一处**定义。若发现散落，收拢到 `src/services/http.ts`。

- [ ] **Step 8: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -F <msgfile>
```
提交消息：
```
refactor: 清理工程债

D1 token 存储的读写加 try/catch —— 隐私模式下 localStorage 抛错会让
   全站请求失败。
D2 7 处静态 message 换成 App.useApp() 的实例,让提示能吃到主题与 i18n。
D3 type=4 外链菜单单独识别,告警文案不再与「路径未注册」混淆。
D4 删除无调用方的 getMenuTree(platform 目录整体删除)。
D5 修正 skills-lock.json 的 computedHash。
D6 统一 .claude/skills 与 .agents/skills(无符号链接权限时改为写明)。
D7 复核 baseURL 与免鉴权路径的单一来源。
```

---

### Task 10: 集成验收与 v0.2.0 发布

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-02-ai-admin-system-modules-design.md`（把状态改成「已实施」）

**Interfaces:**
- Consumes: 前 9 个任务的全部产出
- Produces: `v0.2.0` 标签

- [ ] **Step 1: 核对侧边栏**

启动 dev server（`npm run dev`），用真实账号登录，确认侧边栏「系统管理」下
出现 **9 项**：用户管理、岗位管理、参数管理、日志管理、部门管理、角色管理、
字典管理、公告管理、工单管理。

> 菜单显示顺序与名称由后端下发（`order` + `title`），与前端路由顺序无关。

- [ ] **Step 2: 逐个模块人工走查真实后端**

对 9 个模块各走一遍：列表有数据 → 搜索 → 新增 → 编辑 → 删除。
异常要当场记录并修。

- [ ] **Step 3: 核对后端菜单不再有「缺少路由」告警**

浏览器控制台不应出现 `[menu] 前端缺少路由: /system/xxx`（除了平台侧那 7 个
本轮范围外的目录：`/platform` `/monitor` `/swagger` `/generator` `/ai` `/task` `/example`）。

- [ ] **Step 4: 更新 README**

- 模块清单表里补上 9 个页面的路由路径
- 「常用命令」表里补 `npm run e2e:only`
- 「已知限制」从 v0.1.0 的「侧边栏只有一项」更新为「系统管理 9 项已打通，
  平台侧与监控侧仍未实现」

- [ ] **Step 5: 跑全部门禁**

```bash
npm run lint && npm test && npm run build && npm run e2e
```

- [ ] **Step 6: 提交并打标签**

```bash
git add -A
git commit -F <msgfile>

git tag -a v0.2.0 -F <tagmsgfile>
```

标签消息要写清：
- 9 个系统管理页面全部可用真实后端数据
- 新增 2 个共用组件（部门树选择器、菜单权限树）
- 7 条工程债的处置
- 门禁与 e2e 状态
- 已知限制（平台侧/监控侧仍未实现；导出功能本轮未做；公告是纯文本非富文本）

---

## 执行提示

**不要并行跑多个任务。** 10 个任务里，Task 1-8 都改 `config/routes.ts`、
`src/locales/zh-CN/menu.ts`、`src/locales/en-US/menu.ts` 三个共享文件，
并发改必然冲突。必须串行。

另外，本仓库此前的会话记录里出现过并发 agent 触发 API 限流（`已达到 Token Plan 用量上限`），
中断了两个收尾中的任务。**一次只跑一个 agent。**

写完计划后对着 spec 逐条核对：

**1. 规格覆盖** —— spec 的每一节都有对应任务：
- §2.1 目标 1-6 → Task 1-8（页面）、Task 4-5（组件）、Task 9（工程债）、Task 10（测试与发布）
- §5 范式六件东西 → Task 1 建立，后续 7 个任务逐条复制
- §7.1-7.8 八个模块 → Task 1-8，一一对应
- §8 共用组件 → Task 4（DeptTreeSelect）、Task 5（MenuPermissionTree）、Task 4 Step 8（用户表单连带改动）、Task 5 Step 8（组件登记）
- §9 路由与菜单 → 每个模块任务的「注册路由与 i18n」步骤 + Task 10 Step 1
- §10 工程债 D1-D7 → Task 9 Step 1-7
- §11 测试策略 → 每个任务的单测 + e2e 步骤 + Task 10 的人工走查
- §13 留给实现者的决定 → 已分派到具体任务（部门树形态 → Task 4 Step 7；
  字典分栏 → Task 6 Step 5；工单详情布局 → Task 8 Step 6 用 Drawer）

**2. 步骤扫描** —— 每一步都能写出「恰好一件合理的事」：
- 测试步骤给出文件名、用例名、断言的 URL 与请求体
- 实现步骤给出文件路径、函数签名、要用的请求方法与路径
- 验证步骤给出命令与期望输出
- 没有 "TBD"、没有 "写适当的测试"、没有留空类型

**3. 类型一致性** —— 跨任务引用的名字逐个核对过：
- `toProTableRequest<T>`、`PageResult<T>.items`、`ApiResponse<T>` 与现有代码一致
- `listPositions` / `deletePositions` / `batchSetPositionsStatus` 等命名在 Task 1 定义，
  Task 2-8 同规则推导，无拼写漂移
- `DeptTreeSelect` 的 props 在 Task 4 定义，Task 5 的角色页引用同一份
- `RoleOut` 留在 `types.ts`，Task 5 只**追加**不搬家

**4. Review Focus** —— RF1-RF5 五条都指派到了具体任务的具体测试（见表格）。

**5. 比例** —— 计划 1819 行 vs 规格 753 行。比值 2.4，主要多在 8 个模块各自的
接口表与断言表（那是「不能猜」的部分）。没有把页面代码整段抄进计划 ——
页面骨架一律指向 `src/pages/module_system/user/index.tsx` 这个样板。
