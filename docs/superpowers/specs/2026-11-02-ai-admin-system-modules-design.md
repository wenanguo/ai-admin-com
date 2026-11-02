# AiAdmin 系统管理模块补齐 —— 设计规格

- 日期：2026-11-02
- 状态：待评审
- 上游规格：`docs/superpowers/specs/2026-10-30-ai-admin-frontend-template-design.md`
- 后端：`D:\project\AiAdmin\backend`（`app/api/v1/module_system`，已逐接口核实）
- 前端：本仓库（antd-pro v6 / Umi Max 4 / antd 6 / ProComponents 3 / React 19）

---

## 1. 背景

上游规格（2026-10-30）把范围限定在「保守：保留 antd-pro 全部页面，只换 service 层」，
验收范围是「最小闭环：登录 → 用户信息 → 菜单 → 用户管理页真实数据 → 退出」。
该闭环已跑通，v0.1.0 已打标签。

但上游规格同时把其余 20+ 个后端菜单对应的页面明确划为**非目标**：

> 不实现 `role` / `dept` / `dict` / `menu` 等其余 20+ 个后端菜单对应的页面
> （仅保留路由契约位置，后续按范式补）

这轮就是补这个「后续」。**不做新东西，只把已经跑通的范式复制到系统管理的其余 8 个模块**，
让这个仓库从「一个能跑通闭环的模板」变成「一个覆盖系统管理全模块的模板」。

### 1.1 现状盘点（已核实）

- 已实现：`/system/user` 一个业务页（`src/pages/module_system/user/`）
- 已实现：`src/services/api/system/{user,role}.ts`（`role.ts` 目前只有 `listRoles`，
  供用户表单选角色用）
- 已实现：菜单适配（`src/menu/adapter.ts`）、权限判定（`src/access.ts`）、
  请求层信封解析（`src/services/response.ts`）、ProTable 适配（`src/services/paginate.ts`）
- 后端菜单里 `/system` 下挂着 9 个子项，前端只注册了 `user` 一个：

| 后端 route_path | component_path | 前端路由 | 状态 |
|---|---|---|---|
| `dict` | `module_system/dict/index` | — | 待做 |
| `param` | `module_system/params/index` | — | 待做 |
| `dept` | `module_system/dept/index` | — | 待做 |
| `position` | `module_system/position/index` | — | 待做 |
| `role` | `module_system/role/index` | — | 待做 |
| `user` | `module_system/user/index` | `/system/user` | ✅ |
| `log` | `module_system/log/index` | — | 待做 |
| `notice` | `module_system/notice/index` | — | 待做 |
| `ticket` | `module_system/ticket/index` | — | 待做 |

其余 7 个菜单项现在会被 `src/menu/adapter.ts` 以
`[menu] 前端缺少路由: <path>` 跳过（同一 path 只提示一次）——**这是既定行为，不是 bug**。
前端路由注册后，它们会**自动出现在侧边栏**，不需要改任何后端代码。

---

## 2. 目标 / 非目标 / 反目标

### 2.1 目标

1. 系统管理下 8 个模块全部有可用的前端页面：列表、搜索、分页、新增、编辑、删除、批量启停。
2. 页面吃**真实后端数据**，全部通过 `src/services/api/**` 访问，不写 mock。
3. 每个页面的按钮级操作按后端权限码判定（`module_system:<mod>:<action>`）。
4. 补齐 2 个跨模块复用组件：部门树选择器、菜单权限树。
5. 顺带修掉一批已知的工程债（§10）。
6. 每个模块都有 e2e 用例（接口全部拦截，不需要真实账号）。

### 2.2 非目标

- **不做** `/platform`、`/monitor`、`/generator`、`/ai`、`/task`、`/example` 下的页面。
- **不做** PRD-v2 的 PM 业务模块（项目/里程碑/任务/风险/评论）——那是下一轮。
- **不做**多租户切换 UI（上游规格已划为非目标）。
- **不做**代码生成器对接（`/generator`）。
- **不做**字典模块的「全局字典缓存」机制（后端 `redis` 缓存由后端负责，前端只读）。

### 2.3 反目标（做到这些就算失败）

- ❌ 用 `any` / `as unknown as` 绕过类型检查来赶工。
- ❌ 在页面里直接写死中文枚举（后端有枚举的用 `valueEnum` 或常量表）。
- ❌ 复制粘贴式新增页面而不抽象共用部分 —— 8 个模块共用同一套骨架，差异只在数据。
- ❌ 为了让页面能显示，去改后端菜单表或后端代码。**这轮前端改动应完全自洽。**
- ❌ 引入新的 UI 库或新的状态管理（继续用 ProComponents 3 + umi request）。

---

## 3. 约束

| # | 约束 | 来源 |
|---|---|---|
| C1 | 业务错误走 HTTP 500 + 信封，请求层统一转 `BizError`，调用方读 `error.info.msg` | 上游规格 §2.2 |
| C2 | 成功判定 `code === 0`；分页参数 `page_no` / `page_size`，`page_size` 上限 100 | 后端 `BaseQueryParam` |
| C3 | 删除类接口的请求体是**裸数组** `[1,2]`，不是 `{ ids: [...] }` | 后端 controller 签名 |
| C4 | 批量状态接口一律是 **PATCH**（不是 PUT） | 后端 controller |
| C5 | 前端路由 `path` 必须与菜单 `route_path` 拼出的绝对路径一致，否则菜单被跳过 | 上游规格 D4 |
| C6 | 菜单图标取前端路由表，不取后端 `icon`（后端下的是 `ri:xxx`） | 上游规格 Task 10 裁决 |
| C7 | 成功/失败提示由请求层统一弹，**页面里不再弹第二次** | 现有 user 页的既定写法 |
| C8 | 登录接口是 form-urlencoded；分页/查询参数有正则校验，前端要先挡 | 上游规格 Task 12 裁决 |

---

## 4. 方案对比与裁决

三条路线在讨论中对比过：

| 路线 | 顺序 | 优点 | 缺点 |
|---|---|---|---|
| **A1 流水线优先** | position → params → log → dict → dept → role → notice → ticket | 先用 3 个最便宜的模块把「加一个模块要写哪些东西」压到最低成本，再上难的；每批独立可发布 | 产品价值来得晚 |
| A2 价值优先 | role → dept → dict → 其余 | 角色/部门是权限骨架，能立刻改善已上线的用户表单 | 前两步就是最难的，起步慢；CRUD 模块没有现成选择器可用 |
| A3 一次性铺开 | 8 个页面模板批量生成 | 快 | 8 个模块契约各异，返工率高；没有逐个 review，质量不可控 |

**裁决：A1，并把 `dept` 提到第 4 批**（即 position → params → log → **dept** → role → dict → notice → ticket）。

理由：
1. A1 的核心价值是**先验证流水线**。前三个模块（岗位/参数/日志）后端契约最简单，
   用来把「一个模块 = 6 件东西」（§5）跑通并固化成模板，成本最低。
2. `dept` 提前的理由是它能**立刻修好一个已经上线的页面**：用户表单里部门目前是
   `<ProFormDigit name="dept_id" label="部门 ID" />`（让人填数字），
   有了部门树就该换成树选择器。
3. `role` 紧随 `dept`：菜单权限树和数据权限（5 档，第 5 档要选部门）都要用到部门树，
   放在 dept 之后做能直接复用。
4. A3 被否，因为它与上游规格 D2/D5 的既定决策（「保守」「手写分层」）相悖。

---

## 5. 范式：一个模块 = 哪些东西

**这是本规格的核心。** 8 个模块共用同一套骨架，差异只在数据与字段。
下面 6 项是「一个模块」的完整定义，实现者照此复制。

### 5.1 文件与目录

```
src/pages/module_system/<comp>/
├── index.tsx        # 页面主体：ProTable + 工具栏 + 弹窗入口
├── ModalForm.tsx    # 新增/编辑弹窗（ProForm）
└── columns.tsx      # 列定义与搜索项（可选；简单模块可留在 index.tsx）
```

`<comp>` **必须**等于后端菜单的 `component_path` 去掉 `module_system/` 前缀和 `/index` 后缀：

| 菜单 component_path | 前端目录 |
|---|---|
| `module_system/position/index` | `src/pages/module_system/position/` |
| `module_system/params/index` | `src/pages/module_system/params/` |
| `module_system/log/index` | `src/pages/module_system/log/` |
| `module_system/dept/index` | `src/pages/module_system/dept/` |
| `module_system/role/index` | `src/pages/module_system/role/` |
| `module_system/dict/index` | `src/pages/module_system/dict/` |
| `module_system/notice/index` | `src/pages/module_system/notice/` |
| `module_system/ticket/index` | `src/pages/module_system/ticket/` |

> 注意 `params`：菜单 `route_path` 是 `param`（单数），`component_path` 是 `params`（复数）。
> 两个词都会出现，别搞混：**路由用 `param`，目录用 `params`**。

### 5.2 Service 层

`src/services/api/system/<mod>.ts`，导出该模块的全部接口函数。
类型放在**同一个文件**里（不要往 `types.ts` 堆 —— 8 个模块会把那个文件撑爆，
而且 `types.ts` 里的 `User*` 类型被用户页和 `access.ts` 依赖，保持它稳定）。

```ts
// src/services/api/system/position.ts
import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/** 后端 PositionQueryParam */
export type PositionListParams = Partial<PageQuery> & {
  name?: string;
  status?: number;
};

/** 后端 PositionOutSchema */
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

export async function listPositions(params: PositionListParams) {
  return request<ApiResponse<PageResult<PositionOut>>>('/system/position/list', {
    method: 'GET',
    params,
  });
}

// ... detail / create / update / delete / batchStatus / export
```

规则：
- 列表类型 = `Partial<PageQuery> & { 该模块的搜索字段 }`，**与后端 `*QueryParam` 一一对应**。
- 列表返回类型固定是 `ApiResponse<PageResult<T>>`，其中
  `PageResult<T> = { items: T[]; total: number; page_no: number|null; page_size: number|null; has_next: boolean|null }`
  （见 `src/services/types.ts`）。注意是 **`items`** 不是 `list`。
- 删除函数固定叫 `delete<Plural>`，**请求体是裸数组**（C3）。
- 批量启停固定叫 `batchSet<Plural>Status`，**方法是 PATCH**（C4)。

> **类型放哪**：新模块的类型定义在**自己的 `<mod>.ts`** 里（`export interface XxxOut {...}`）。
> 但已存在的 `UserOut` / `UserCreateParams` / `RoleOut` 等**留在 `src/services/api/system/types.ts` 不动** ——
> `src/access.ts` 与用户页依赖它们，且 `role.ts` 已经在从 `./types` 导入 `RoleOut`。
> 两种放法并存是刻意的，不要为了「统一」去动 `types.ts`。

### 5.3 页面主体（index.tsx）

**共享脚手架 `src/components/CrudTable/`** —— 8 个模块的页面从它取三样东西，
页面文件里只剩「列定义 + service 调用 + 声明式 JSX」：

| 导出 | 用途 | 签名要点 |
|---|---|---|
| `useCrudTable<T, V>` | CRUD 状态机：弹窗开关、编辑对象、删除处理、提交处理 | 入参 `{ create(values: V), update(id: number, values: V), remove(ids: number[]) }`；返回 `{ actionRef, modalOpen, editing, openCreate, openEdit, closeModal, handleDelete, handleSubmit }` |
| `useCrudColumns<T>` | 标准「操作」列（编辑 + 删除，按权限码门控） | 入参 `{ onEdit, onDelete, editPerm, deletePerm, entityName }`；内部自己调 `useAccess()`。<br>**必须以 `use` 开头** —— 它调了 hook，Rules of Hooks 的命名约定要求如此；这样 Biome 的 `useHookAtTopLevel` 规则自然通过，不需要 `biome-ignore` 压制 |
| `CRUD_PAGINATION` | 分页配置常量 | `{ defaultPageSize: 10, pageSizeOptions: [10,20,50,100], showSizeChanger: true }` |

页面文件长这样：

```tsx
const PositionManagement: React.FC = () => {
  const crud = useCrudTable<PositionOut, PositionCreateParams>({
    create: createPosition,
    update: updatePosition,
    remove: deletePositions,
  });

  const operationColumns = useCrudColumns<PositionOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_system:position:update',
    deletePerm: 'module_system:position:delete',
    entityName: '岗位',
  });

  const columns: ProColumns<PositionOut>[] = [ /* ...只放数据列... */ ];

  return (
    <>
      <ProTable<PositionOut>
        headerTitle="岗位管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestPositions}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        onRequestError={() => {}}
        toolBarRender={() => [ /* 新增按钮，按 createPerm 门控 */ ]}
      />
      <PositionModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </>
  );
};
```

**为什么只抽到「逻辑层」**：8 个模块的页面形态差异很大 —— 岗位/参数/公告/工单是普通表格，
日志是双 tab 只读，部门是树形，字典是主从分栏，角色多一个授权弹窗。
一个要同时伺候这 4 种形态的通用 wrapper，props 面会很大，每个页面都要跟它搏斗。
所以：**带风险的真逻辑**（权限门控、try/catch 吞异常、create-vs-update 分支、reload）
抽进共享件；**声明式 JSX**（ProTable props、工具栏按钮、弹窗元素）留在每个页面。

**为什么不抽整个 `CrudTable` 组件**：同上，按 YAGNI。
若将来页面形态趋同，再抽组件不迟。

硬性要求：

| 要求 | 原因 |
|---|---|
| 用 `toProTableRequest` 适配，不要手写 `request` | 它已经处理了 `page_no`/`page_size` 夹紧（1..100）、空值剔除和信封解包 |
| `pagination={CRUD_PAGINATION}`，不要自己写分页配置 | `page_size` 上限 100 是后端约束（C2），集中定义避免 8 个页面各写各的 |
| ProTable 必须传 `onRequestError={() => {}}` | ProComponents v3 在 `onRequestError` 未定义时会把 rejection **重新抛出成 unhandled promise rejection**（控制台噪音 + e2e flake）。错误提示由请求层统一弹（C7），这里只是阻止重抛 |
| 操作列用 `useCrudColumns` 统一实现 | 权限码写错会**静默禁用**按钮，是最难发现的一类 bug |
| 新增/编辑用 `ModalForm`，**编辑时不渲染创建专属字段** | 例：用户表单的密码框 |
| 页面里**不弹** `message.success/error` | 请求层已统一弹（C7） |
| 删除用 `Popconfirm` 二次确认 | 不可逆操作 |
| `import type React from 'react'` + `React.FC` | 与现有页面一致 |

#### ProComponents v3 的两个 API 差异（照抄 antd-pro v5 的文档会踩）

| v5 写法 | **v3 写法** |
|---|---|
| `hideInSearch: true` | `search: false` |
| 列上直接写 `rules: [...]` | `rules` 放进 `formItemProps: { rules: [...] }` |

现成的正确样例在 `src/pages/module_system/user/index.tsx` 的「手机号」「邮箱」两列。

#### React 19 的 `useRef` 必须带初始值

```ts
const actionRef = useRef<ActionType | undefined>(undefined);   // ✅
const actionRef = useRef<ActionType>();                        // ❌ TS 报错
```

### 5.4 路由注册

在 `config/routes.ts` 的 `/system` 父路由的 `routes` 数组里追加：

```ts
{
  path: '/system/position',
  name: 'position',
  icon: 'team',          // antd 图标名,取自 @ant-design/icons
  component: './module_system/position',
},
```

- `path` **必须**等于菜单 `route_path` 拼上父路径（`/system` + `position`）。
- `name` 用小写单词（i18n key 由它推导：`menu.system.position`）。
- `icon` 必须是 antd 能认的图标名；后端下发的 `ri:xxx` 不能用（C6）。
- 新增的 `menu.system.*` i18n key 要在 `src/locales/zh-CN/menu.ts` 与 `src/locales/en-US/menu.ts` 补齐
  （只有这两种语言，其余 6 种已在 v0.1.0 前删掉）。

### 5.5 i18n

`src/locales/zh-CN/menu.ts` 与 `src/locales/en-US/menu.ts` 里补 8 个 key。
**注意前缀是 `menu.`**（现有的是 `'menu.system'` / `'menu.system.user'`）：

```ts
// src/locales/zh-CN/menu.ts
'menu.system.position': '岗位管理',
'menu.system.param': '参数管理',
'menu.system.log': '日志管理',
'menu.system.dept': '部门管理',
'menu.system.role': '角色管理',
'menu.system.dict': '字典管理',
'menu.system.notice': '公告管理',
'menu.system.ticket': '工单管理',
```

> `param` 用单数（跟菜单 route_path 一致），`dict` / `log` 等同理。
> 两个文件都要改，只改中文会漏掉英文环境。

### 5.6 e2e

每个模块一条用例，放 `e2e/<mod>.spec.ts`：

- 用 `page.route` 拦截该模块的全部接口，返回**信封格式**的假数据
  （`{ code: 0, msg: 'ok', data, status_code: 200, success: true }`）
- 用 `page.addInitScript` 塞 `localStorage` 的 token，让前端认为已登录
- 断言：页面标题、表格行数、搜索列存在、按钮按权限渲染/禁用
- **不需要真实账号**，也不需要真实后端

跑法见 `README.md`：`npm run e2e`（先构建再跑）、`npm run e2e:only`（复用已有 dist）。

---

## 6. 实施顺序

| 批次 | 模块 | 难度 | 为什么在这个位置 |
|---|---|---|---|
| 1 | 岗位 position | 低 | 纯 CRUD，最便宜的流水线验证 |
| 2 | 参数 param | 低 | 纯 CRUD + 一个布尔类型字段 |
| 3 | 日志 log | 低 | 只读（列表 + 详情抽屉），验证「非 CRUD 页」的骨架 |
| 4 | 部门 dept | 中-高 | 树形表格 + 产出「部门树选择器」组件 |
| 5 | 角色 role | 高 | 消费部门树 + 新增「菜单权限树」组件 |
| 6 | 字典 dict | 中 | 主从结构（类型 → 数据），本轮唯一的双资源页面 |
| 7 | 公告 notice | 低-中 | CRUD + 富文本；另有铃铛面板 API（本轮不做） |
| 8 | 工单 ticket | 中 | CRUD + 批量更新 + 状态流转 |

每个批次都是**独立可发布**的：做完一批，跑一遍门禁，提交一次。
批次之间不共享未完成的中间态。

---

## 7. 各模块规格

以下接口表**已逐个对着后端 controller 核实**（2026-11-02）。
请求体形状：删除一律裸数组，批量启停一律 PATCH。

### 7.1 岗位 position（第 1 批）

路由 `/system/position`，目录 `module_system/position`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/position/list` | 列表（分页） |
| GET | `/system/position/detail/{id}` | 详情 |
| POST | `/system/position/create` | 创建 |
| PUT | `/system/position/update/{id}` | 更新 |
| DELETE | `/system/position/delete` | 删除（裸数组） |
| PATCH | `/system/position/status/batch` | 批量启停 |
| GET | `/system/position/export` | 导出 |

- 搜索项：`name`、`status`
- 表单字段：`name`(必填)、`code`(必填)、`order`、`status`、`description`
- 权限码：`module_system:position:{query,detail,create,update,delete,patch,export}`
- 列：ID / 岗位名称 / 岗位编码 / 排序 / 状态 / 创建时间 / 操作
- 特殊：没有 `list` 之外的批量查询；导出接口返回什么格式**未核实**——
  本轮**不做导出按钮**（避免猜契约），等核清楚再加。

### 7.2 参数 param（第 2 批）

路由 `/system/param`，目录 `module_system/params`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/param/list` | 列表 |
| GET | `/system/param/detail/{id}` | 详情 |
| GET | `/system/param/key/{config_key}` | 按配置键取详情 |
| GET | `/system/param/value/{config_key}` | 按配置键取值 |
| POST | `/system/param/create` | 创建 |
| PUT | `/system/param/update/{id}` | 更新 |
| DELETE | `/system/param/delete` | 删除（裸数组） |
| PATCH | `/system/param/status/batch` | 批量启停 |
| GET | `/system/param/export` | 导出 |
| GET | `/system/param/info` | 初始化缓存参数 |

- 搜索项：`config_name`、`config_key`、`config_type`、`status`
- 表单字段：`config_name`(必填)、`config_key`(必填)、`config_value`、`config_type`(bool)、`status`、`description`
- 权限码：`module_system:param:{query,detail,create,update,delete,patch,export}`
- 特殊：
  - `config_type` 是 **bool**，展示成「系统内置 / 用户自定义」之类的开关。
  - `config_key` 是唯一键，编辑时**不允许改**（后端没放开，改了大概率 422/冲突）。
  - `/param/info` 是给「初始化缓存」用的，本轮不用。

### 7.3 日志 log（第 3 批）

路由 `/system/log`，目录 `module_system/log`。**只读页面**，没有新增/编辑。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/log/login/list` | 登录日志列表 |
| GET | `/system/log/login/detail/{id}` | 登录日志详情 |
| DELETE | `/system/log/login/delete` | 删除（**裸数组**） |
| GET | `/system/log/operation/list` | 操作日志列表 |
| GET | `/system/log/operation/detail/{id}` | 操作日志详情 |
| DELETE | `/system/log/operation/delete` | 删除（**`{ ids: [...] }`**，不是裸数组） |

> ⚠️ **日志模块是「删除用裸数组」的唯一例外**（2026-11-02 核实）：
> `DELETE /system/log/operation/delete` 的入参是后端的 `BatchDelete` 模型
> （`backend/app/core/base_schema.py:85`）⇒ 请求体是 `{ ids: [1,2] }`；
> 而同模块的 `DELETE /system/log/login/delete` 入参是
> `ids: Annotated[list[int], Body(...)]` ⇒ 才是裸数组。
> 已逐个核实 `module_system` 下其余全部删除接口（dept / position / param / role /
> dict type / dict data / notice / ticket / user）——**都是裸数组**。

- 页面形态：**两个 Tab**（登录日志 / 操作日志），共用一个页面组件，按 Tab 切 service 函数。
- 登录日志搜索项：`username`、`status`
- 操作日志搜索项：`username`、`status`、`request_path`、`request_method`
- 权限码：`module_system:login_log:{query,delete}`、`module_system:log:{query,delete}`
  > **命名不一致是真的**：登录日志是 `login_log`，操作日志是 `log`。实现时不要想当然统一。
- **操作日志的「用户名」不能作为搜索项**：后端操作日志模型**没有 `username` 列**
  （查询参数里有，但模型里没有），传过去会 500。只保留后端模型上真实存在的搜索字段。
- **列表与详情的字段集不同**：操作日志的 JSON 字段是 `request_payload` 与 `response_json`，
  **列表接口不返回它们** ⇒ 详情抽屉要另调 `/log/operation/detail/{id}`。
- 详情用 `Drawer`（只读展示 + JSON 化），不用 ModalForm。

### 7.4 部门 dept（第 4 批）

路由 `/system/dept`，目录 `module_system/dept`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/dept/tree` | **部门树**（后端没有 `/list`） |
| GET | `/system/dept/detail/{id}` | 详情 |
| POST | `/system/dept/create` | 创建 |
| PUT | `/system/dept/update/{id}` | 更新 |
| DELETE | `/system/dept/delete` | 删除（裸数组） |
| PATCH | `/system/dept/status/batch` | 批量启停 |

- 搜索项：后端**没有列表查询接口**，所以搜索只在**前端**做（按名称过滤已加载的树）。
  这与其它模块不同，实现时不要去拼不存在的 query。
- 表单字段：`name`(必填)、`code`(必填)、`order`、`leader`、`phone`、`email`、
  `parent_id`(父部门)、`status`、`description`
- 权限码：`module_system:dept:{query,detail,create,update,delete,patch}`
- 页面形态：`ProTable` + `childrenColumnName` 的树形表格，或 antd `Tree` 卡片。
  **树形表格更贴近现有范式**，优先。
- **产出组件**：`src/components/DeptTreeSelect/index.tsx`
  - props：`value?: number | null`、`onChange`、`placeholder`、`disabled`
  - 数据源：`GET /system/dept/tree`
  - 行为：懒加载 or 全量加载（后端 `/tree` 返回全树，**先全量**）
  - 这个组件会被部门页自己、角色页的数据权限、以及**用户表单**复用

### 7.5 角色 role（第 5 批）

路由 `/system/role`，目录 `module_system/role`。
⚠️ `src/services/api/system/role.ts` 已存在且已有 `listRoles`（用户表单在用）——
**在它上面扩展，不要新建同名文件**。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/role/list` | 列表 |
| GET | `/system/role/detail/{id}` | 详情 |
| POST | `/system/role/create` | 创建 |
| PUT | `/system/role/update/{id}` | 更新 |
| DELETE | `/system/role/delete` | 删除（裸数组） |
| PATCH | `/system/role/status/batch` | 批量启停 |
| PUT | `/system/role/permission` | **角色授权** |
| GET | `/system/role/export` | 导出 |

- 搜索项：`name`、`code`、`status`
- 表单字段：`name`(必填)、`code`(必填)、`order`、`data_scope`(1..5)、`status`、`description`
- 权限码：`module_system:role:{query,detail,create,update,delete,patch,permission,export}`
- `code` 校验：后端要求**字母开头，2-64 位，仅字母/数字/下划线**，前端加同样的 `rules`。
- 授权弹窗（`PUT /system/role/permission`）入参
  `{ data_scope: number, role_ids: number[], menu_ids: number[], dept_ids: number[] }`
  - `menu_ids` 用**菜单权限树**选择
  - `data_scope === 5`（自定义）时，`dept_ids` 用**部门树选择器**选择
- **产出组件**：`src/components/MenuPermissionTree/index.tsx`
  - 数据源：`GET /system/user/current/info` 的 `menus`（**带 children 的树**）
    或 `GET /platform/menu/tree`（**扁平列表**，无 children —— 别用这个当树源**）
  - ⚠️ 这个坑上游已踩过：`/platform/menu/tree` 的 response_model 是 `list[MenuOutSchema]`，
    **没有 children 字段**，拿到的是扁平列表；只有 `current/info` 的 `menus` 才是树。

### 7.6 字典 dict（第 6 批）

路由 `/system/dict`，目录 `module_system/dict`。**双资源页面**。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/dict/type/list` | 字典类型列表 |
| GET | `/system/dict/type/detail/{id}` | 类型详情 |
| GET | `/system/dict/type/optionselect` | 全部类型（下拉用） |
| POST | `/system/dict/type/create` | 创建类型 |
| PUT | `/system/dict/type/update/{id}` | 更新类型 |
| DELETE | `/system/dict/type/delete` | 删除类型（裸数组） |
| PATCH | `/system/dict/type/status/batch` | 类型批量启停 |
| POST | `/system/dict/type/export` | 类型导出 |
| GET | `/system/dict/data/list` | 字典数据列表 |
| GET | `/system/dict/data/detail/{id}` | 数据详情 |
| POST | `/system/dict/data/create` | 创建数据 |
| PUT | `/system/dict/data/update/{id}` | 更新数据 |
| DELETE | `/system/dict/data/delete` | 删除数据（裸数组） |
| PATCH | `/system/dict/data/status/batch` | 数据批量启停 |
| POST | `/system/dict/data/export` | 数据导出 |
| GET | `/system/dict/data/info/{dict_type}` | 按类型取数据 |

- 页面形态：左侧**字典类型列表**（点选），右侧**该类型下的字典数据表格**。
  这是本轮唯一的非「一表一页」形态。
- 类型搜索项：`dict_name`、`dict_type`、`status`
- 数据搜索项：`dict_label`、`dict_type`、`status`
- 类型表单：`dict_name`(必填)、`dict_type`(必填)、`dict_sort`、`status`、`description`
- 数据表单：`dict_label`(必填)、`dict_value`(必填)、`dict_type_id`(必填)、
  `css_class`、`list_class`、`is_default`(bool)、`status`、`description`
- 权限码：`module_system:dict_type:{query,detail,create,update,delete,patch,export}`、
  `module_system:dict_data:{query,detail,create,update,delete,patch,export}`
  > 字典是**两套独立权限码**，不是一个 `dict:*`。

### 7.7 公告 notice（第 7 批）

路由 `/system/notice`，目录 `module_system/notice`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/notice/list` | 列表 |
| GET | `/system/notice/detail/{id}` | 详情 |
| POST | `/system/notice/create` | 创建 |
| PUT | `/system/notice/update/{id}` | 更新 |
| DELETE | `/system/notice/delete` | 删除（裸数组） |
| PATCH | `/system/notice/status/batch` | 批量启停 |
| POST | `/system/notice/export` | 导出 |
| GET | `/system/notice/available` | 全局启用公告 |
| GET | `/system/notice/panel` | 通知面板（铃铛） |
| POST | `/system/notice/read/{id}` | 标记已读 |
| POST | `/system/notice/read-all` | 全部已读 |
| GET | `/system/notice/unread-count` | 未读数量 |

- 搜索项：`notice_title`、`notice_type`、`status`
- 表单字段：`notice_title`(必填)、`notice_type`(必填)、`notice_content`(富文本)、`status`、`description`
- 权限码：`module_system:notice:{query,detail,create,update,delete,patch,export}`
- `notice_type` 后端是**普通字符串**，没有枚举。
  本轮用**可配置的下拉**（先给「通知/公告/提醒」三个常见值，允许管理员输入），
  不写死成受限枚举。
- `notice_content` 用富文本编辑器。**本轮用 antd `Input.TextArea`**
  （不引入新依赖）。若后续要富文本，单独一轮换。
- **铃铛面板相关接口（`/panel`、`/read`、`/read-all`、`/unread-count`、`/available`）本轮不做** ——
  它们属于顶栏通知功能，不是公告管理页面的职责。

### 7.8 工单 ticket（第 8 批）

路由 `/system/ticket`，目录 `module_system/ticket`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/system/ticket/list` | 列表 |
| GET | `/system/ticket/detail/{id}` | 详情 |
| POST | `/system/ticket/create` | 创建 |
| PUT | `/system/ticket/update/{id}` | 更新 |
| PUT | `/system/ticket/batch` | 批量更新（注意是 PUT） |
| DELETE | `/system/ticket/delete` | 删除（裸数组） |

- 搜索项：`title`、`ticket_type`、`assigned_id`、`status`
- 表单字段：`title`(必填)、`ticket_content`(必填)、`summary`、`ticket_type`(必填)、
  `images`、`description`
- `ticket_type` 枚举（后端 `app/common/enums.py` 的 `TicketTypeEnum`）：
  `suggestion` / `bug` / `optimize` / `other`
  → 前端 `valueEnum`：`建议 / 缺陷 / 优化 / 其他`
- 权限码：`module_system:ticket:{list,detail,create,update,delete}`
  > ⚠️ 列表权限码是 **`:list`**，不是 `:query`（其它模块都是 `:query`）。别搞混。
- `assigned_id` 是处理人 id → 用 `ProFormSelect` + `listUsers`（已有的 service）做远程搜索。
- 批量更新 `PUT /system/ticket/batch` 的入参是 `TicketBatchSchema`，
  字段**本轮未逐字核实** → 实现时先读 `backend/app/api/v1/module_system/ticket/schema.py`
  的 `TicketBatchSchema` 再写，不要照猜。

---

## 8. 共用组件

只有两个，都要放在 `src/components/` 下，**零业务耦合**（只用 antd + umi request）。

### 8.1 `DeptTreeSelect`

- 路径：`src/components/DeptTreeSelect/index.tsx`
- props：`value?: number | null`、`onChange?: (v: number | undefined) => void`、
  `placeholder?`、`disabled?`、`allowClear?`
- 数据源：`GET /system/dept/tree`
- 消费者：部门页（选父部门）、角色页（自定义数据权限）、**用户表单**（替换现在的「部门 ID」数字框）

### 8.2 `MenuPermissionTree`

- 路径：`src/components/MenuPermissionTree/index.tsx`
- props：`value?: number[]`、`onChange?: (v: number[]) => void`、`disabled?`
- 数据源：`GET /system/user/current/info` 的 `menus`（带 `children` 的树）
- 消费者：角色页的授权弹窗

> ⚠️ 不要用 `GET /platform/menu/tree` 当树源 —— 它返回**扁平列表**（无 `children`）。
> 若确实需要平台侧全量菜单树，要走 `current/info` 的 `menus`，
> 或让后端补一个返回 `MenuTreeOutSchema` 的接口（**本轮不改后端**）。

### 8.3 组件导出注册表

`src/components/index.ts` 是仓库的组件出口清单（注释写着「统一管理对外输出的组件」）。
新组件都要在那里登记：

```ts
export { default as DeptTreeSelect } from './DeptTreeSelect';
export { default as MenuPermissionTree } from './MenuPermissionTree';
export { useCrudColumns, useCrudTable, CRUD_PAGINATION } from './CrudTable';
```

> 这不是强制风格问题：`src/components/index.ts` 里已有一条「死代码 `DocLink`」
> 在 v0.1.0 前被清掉的记录，说明这个注册表会被审查，新组件不加会被当成遗漏。

### 8.4 `CrudTable`（共享 CRUD 脚手架）

- 路径：`src/components/CrudTable/index.tsx`
- 导出：`useCrudTable` / `useCrudColumns` / `CRUD_PAGINATION`（见 §5.3 的签名表）
- 消费者：**全部 8 个模块页**（只读页 `log` 只用 `useCrudColumns` 或不用）
- 自测：`src/components/CrudTable/index.test.tsx` —— 至少覆盖
  「权限码不足时按钮 disabled」「删除时调用 remove(ids)」「提交时按 editing 有无走 create/update」

### 8.5 用户表单的连带改动

`src/pages/module_system/user/ModalForm.tsx` 里：

```tsx
<ProFormDigit name="dept_id" label="部门 ID" />
```

改成：

```tsx
<ProFormSelect name="dept_id" label="部门" request={fetchDeptOptions} ... />
```

或直接用 `<DeptTreeSelect />`（视 ProForm 集成复杂度决定）。
**这是本轮唯一一处对已上线页面的改动**，放在第 4 批（dept 做完之后），
并单独提一次 commit。

---

## 9. 路由与菜单对齐

### 9.1 最终路由表（`config/routes.ts` 的 `/system` 段）

```ts
{
  path: '/system',
  name: 'system',
  icon: 'setting',
  routes: [
    { path: '/system', redirect: '/system/user' },   // 已有的 redirect 写法保持不变
    { path: '/system/user', name: 'user', icon: 'user', component: './module_system/user' },
    { path: '/system/position', name: 'position', icon: 'team', component: './module_system/position' },
    { path: '/system/param', name: 'param', icon: 'fileText', component: './module_system/params' },
    { path: '/system/log', name: 'log', icon: 'fileSearch', component: './module_system/log' },
    { path: '/system/dept', name: 'dept', icon: 'apartment', component: './module_system/dept' },
    { path: '/system/role', name: 'role', icon: 'safetyCertificate', component: './module_system/role' },
    { path: '/system/dict', name: 'dict', icon: 'book', component: './module_system/dict' },
    { path: '/system/notice', name: 'notice', icon: 'notification', component: './module_system/notice' },
    { path: '/system/ticket', name: 'ticket', icon: 'customerService', component: './module_system/ticket' },
  ],
}
```

> ⚠️ `redirect` 必须挂在**子路由**上。挂在父路由上时它的 redirect 会作用到所有子路径，
> `/system/user` 会被重定向到 `/system/user` 自己 → React Router 无限重定向（error #185，白屏）。
> 这是上游已踩过的坑，`routes.ts` 里有注释，改动时别动它。

### 9.2 菜单对齐

前端路由注册后，后端下发的菜单会自动出现。**不需要改后端菜单表。**
注册完成后，侧边栏应有 9 项：

```
系统管理
├── 用户管理    /system/user
├── 岗位管理    /system/position
├── 参数管理    /system/param
├── 日志管理    /system/log
├── 部门管理    /system/dept
├── 角色管理    /system/role
├── 字典管理    /system/dict
├── 公告管理    /system/notice
└── 工单管理    /system/ticket
```

> ⚠️ 菜单的**显示顺序与名称**由后端下发（`order` + `title`），
> 前端路由的顺序与 `icon` 只影响找不到对应项时的兜底。
> 若实际顺序与上表不同，是后端菜单数据决定的，不是 bug。

### 9.3 i18n key

`src/locales/{zh-CN,en-US}/menu.ts` 补 8 个 key（`system.position` … `system.ticket`）。
后端下发的菜单项 `locale: false`，所以**界面显示的是后端的 `title`（中文）**，
i18n key 主要是兜底 —— 但仍要补，否则英文环境下会显示 key 名。

---

## 10. 工程债专项

单独一个批次，**不与页面开发混在一起**。每条都已核实仍然存在。

| # | 文件 | 问题 | 处置 |
|---|---|---|---|
| D1 | `src/auth/token.ts` | 所有 storage 访问**无 try/catch**。隐私模式下 `localStorage` 抛错 → 请求拦截器抛 → **全站请求失败** | 读写都包 try/catch，失败时降级为「未登录」 |
| D2 | `src/requestErrorConfig.ts` | 7 处静态 `message.error/success`。antd v6 的静态 API **不消费 ConfigProvider context**，拿不到主题和 i18n | 改为 `App.useApp()` 的 `message` 实例。**这需要改 `src/app.tsx`（包一层 `<App>`）**，并同步修 `src/app.test.tsx`（该文件已有对 `getInitialState` 的断言，包 `<App>` 会影响渲染树） |
| D3 | `src/menu/adapter.ts` | type=4（外链）菜单被 `continue` 掉，与「路径未注册」混为一谈，告警文案有误导 | 外链单独识别并给出对应告警（**本轮只改告警，不渲染外链**） |
| D4 | `src/services/api/platform/menu.ts` | `getMenuTree` **无任何调用方**（死代码），且注释说「菜单树」但后端返回的是扁平列表 | 删除该函数与文件；`src/services/api/platform/` 若空则整目录删。**已核实安全**：`platform/types.ts` 只是 `export type { BackendMenu } from '@/menu/adapter'` 的转发，且全仓只有 `platform/menu.ts` 引用它 |
| D5 | `skills-lock.json` | `computedHash` 与文件实际摘要对不上 | 用技能工具重新计算并写入 |
| D6 | `.claude/skills/` ↔ `.agents/skills/` | 两份普通文件副本（上游是符号链接对），存在内容漂移风险 | 换成符号链接（Windows 需开发者模式/管理员），或写一条说明接受漂移 |
| D7 | `src/app.tsx` | `request.baseURL` / `AUTH_FREE_PATHS` 的取值来源是否单一，未复核 | 复核并收拢到 `src/services/http.ts` 之类的单一来源 |

> 账本里记过的「行尾不统一」**经核实不成立**：仓库内所有 blob 都是 LF，
> 工作区的 CRLF 是 `core.autocrlf=true` 的 checkout 结果，提交时会归一。
> 不动 `.gitattributes`。

---

## 11. 测试策略

| 层 | 手段 | 覆盖 |
|---|---|---|
| 单元 | vitest（`src/**/*.test.ts`） | service 层的**契约形状**（URL、method、请求体）。参照 `src/services/api/system/user.test.ts` |
| 单元 | vitest | `toProTableRequest` 的参数夹紧、`access.hasPermission` 的判定 |
| 组件 | vitest + @testing-library | 参照 `src/pages/account/settings/components/base.test.tsx` |
| e2e | Playwright（`e2e/<mod>.spec.ts`） | 页面挂载、列表渲染、搜索参数正确、权限按钮、弹窗提交 |
| 端到端（人工） | 真实后端 + 真实账号 | 每轮批次结束后人工过一遍新增/编辑/删除 |

**每个模块的最低测试门槛**（低于此不算完成）：

1. 一个单测文件 `src/services/api/system/<mod>.test.ts`，覆盖该模块 service 的
   **全部导出函数**：断言请求的 URL、method、请求体形状（尤其是删除的裸数组、
   批量启停的 PATCH）。
2. 一条 e2e 用例 `e2e/<mod>.spec.ts`：页面能挂载、表格渲染出拦截数据、
   搜索参数按 `page_no` / `page_size` 发出。

**凭据约束**：人工端到端验收用的真实账号由人提供，**不写进仓库、不进脚本、不进提交**。
测试一律用拦截接口的方式做（`e2e/` 下的用例全部如此）。

**门禁**（每批次结束都要过）：

```
npm run lint      # biome + tsc,exit 0
npm test          # vitest,全绿
npm run build     # 构建成功
npm run e2e       # Playwright 全绿
```

**门禁不新增**：CI 里 `biome lint` / `tsc` / `build` 已有；e2e 已在 v0.1.0 修好并跑生产构建。

---

## 12. 门禁与发布

- 每批次一个提交（commit message 用中文，`fix/feat` 前缀，**subject 不要以大写英文词开头** —— commitlint 的 `subject-case` 会拒）。
- 全部 8 批 + 工程债批完成后，打 `v0.2.0` 标签。
- v0.2.0 的验收标准：**9 个系统管理页面全部能用真实后端数据走通新增/编辑/删除**，
  且侧边栏出现完整的 9 项。

---

## 13. 留给实现者的决定

以下是有多种合理做法、且**不改变整体设计**的，实现者自己定即可：

1. 部门树用 ProTable 的 `childrenColumnName` 还是 antd `Tree` 卡片 —— 取决于实现者对
   ProComponents 3 树形表格 API 的熟悉度。
2. 部门树的搜索是在前端过滤已加载的树，还是调后端（后端**没有**带关键字的树接口，只能前端过滤）。
3. 字典页左右分栏的具体宽度与响应式断点。
4. 工单详情的展示布局（Drawer vs 独立详情页）。
5. 各页面 `columns` 定义是放 `columns.tsx` 还是留在 `index.tsx` —— 字段少的模块留在 `index.tsx` 更省事。

**以下不在本轮，需要时另开规格**：
- 顶栏通知铃铛（`/notice/panel` 等接口）
- 导出功能（后端导出接口的返回格式未核实）
- 平台侧菜单管理页（`/platform/menu`）
- 租户切换 UI
- PRD-v2 的 PM 业务模块

---

## 附录 A：后端契约速查

**统一信封**：`{ code, msg, data, status_code, success }`，`code === 0` 才是成功。
业务错误走 **HTTP 500 + 信封**（`code: -1`），请求层统一转 `BizError`。

**删除请求体**：裸数组 `[1, 2]`。

**批量启停**：`PATCH`，请求体 `{ ids: number[], status: number }`。

**分页**：`page_no`（≥1）、`page_size`（1..100）。

**权限码**：`module_system:<模块>:<动作>`。

| 模块 | 列表权限码 | 路由 path | 目录 | 特殊之处 |
|---|---|---|---|---|
| 用户 | `module_system:user:query` | `/system/user` | `user` | ✅ 已实现 |
| 岗位 | `module_system:position:query` | `/system/position` | `position` | — |
| 参数 | `module_system:param:query` | `/system/param` | `params` | 路由单数、目录复数 |
| 日志 | `module_system:login_log:query` / `module_system:log:query` | `/system/log` | `log` | 两套码；只读 |
| 部门 | `module_system:dept:query` | `/system/dept` | `dept` | 只有 `/tree`，无 `/list` |
| 角色 | `module_system:role:query` | `/system/role` | `role` | 有 `/permission` 授权 |
| 字典 | `module_system:dict_type:query` / `module_system:dict_data:query` | `/system/dict` | `dict` | 双资源、双套码 |
| 公告 | `module_system:notice:query` | `/system/notice` | `notice` | `notice_type` 无枚举 |
| 工单 | `module_system:ticket:list` | `/system/ticket` | `ticket` | 列表码是 `:list` 不是 `:query` |
