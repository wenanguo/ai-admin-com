# AiAdmin 前端基础模板 —— 设计规格

- 日期：2026-10-30
- 状态：待评审
- 后端：`D:\project\AiAdmin\backend`（FastAPI 0.115.2，340 个路由）
- 前端底座：Ant Design Pro v6（Umi Max 4 + antd 6 + ProComponents 3 + React 19 + Tailwind v4）

---

## 1. 背景与目标

`ai-admin-com` 是一个新的空仓库，目标是产出**一个可长期演进的前端开发基础模板**，并让前端**真实打通**已就绪的 AiAdmin 后端。

现有同源项目 `D:\project\AiAdmin\frontend\web` 是 Vue3 + Vite + Element-Plus 实现。本项目用 React + Ant Design Pro 重写同一套产品的管理端前端。

**成功标准**：浏览器中用真实后端账号登录 → 看到后端下发的菜单 → 点进业务页看到真实数据库数据 → 权限生效 → 退出登录。全程无 mock。

### 1.1 已确认的决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | 对接的后端 | `D:\project\AiAdmin\backend` |
| D2 | 模板范围 | **保守**：保留 antd-pro 全部页面，只换 service 层 |
| D3 | 权限菜单 | **后端下发菜单树** |
| D4 | 菜单落地 | **后端管显示，前端管路由**（静态注册 + path 对齐） |
| D5 | service 层 | **手写分层**，不用 OpenAPI 自动生成 |
| D6 | 验收范围 | **最小闭环**：登录 → 用户信息 → 菜单 → 用户管理页真实数据 → 退出 |
| D7 | 品牌 / i18n | 标题 `AiAdmin`；i18n 精简到 **zh-CN + en-US** |
| D8 | 登录页 | **保留**注册入口、**保留**三方登录、**保留并启用**验证码字段 |
| D9 | token 过期 | **保留** 401 静默刷新 + 原请求重放 |
| D10 | 目录结构 | `antd/` 内容**提到仓库根目录**，删除嵌套 `.git` |
| D11 | 代理目标 | **写死在 `config/proxy.ts`** |

---

## 2. 后端契约（已实测核实）

来源：后端源码 + 对公网部署 `https://www.pmdict.cn/api/v1` 的实际请求。

### 2.1 基址与路径前缀

- 开发（本地后端）：`http://127.0.0.1:8001/api/v1`
- 公网部署：`https://www.pmdict.cn/api/v1`
- 前缀 `/api/v1` 由 FastAPI 的 `root_path` 提供（`app/config/setting.py:44`）。Starlette 的 `get_route_path()` 会剥掉 `root_path` 再匹配路由，因此**前端直接请求 `/api/v1/xxx` 即可，nginx 与 umi 代理都不需要 rewrite**。
- 现有 nginx（`docker/nginx/nginx.conf:121`）用 `location /api/v1 { proxy_pass http://backend:8001; }`，同样不 rewrite —— 与本方案一致。

### 2.2 响应信封

```jsonc
{ "code": 0, "msg": "成功", "data": ..., "status_code": 200, "success": true }
```

- 定义：`app/common/response.py:25`（`ResponseSchema[T]`，PEP-695 泛型）
- **成功判定：`code === 0`**（`RET.OK = (0, "成功")`）。`RET.SUCCESS = 200` 也可能在个别接口出现，判定时兼容 `0` 与 `200`。
- 失败：`{ code: <业务码>, msg: "...", data: ..., status_code: <http>, success: false }`
- **⚠ 关键坑：业务错误可能返回 HTTP 500。** 实测 `POST /system/auth/login` 不带验证码 → **HTTP 500** + `{code: -1, msg: "验证码不能为空"}`。前端**必须读响应体信封**来判断业务失败，不能只看 HTTP 状态码。

### 2.3 认证

- 方式：JWT（HS256），`Authorization: Bearer <access_token>`（`app/core/security.py:45`）
- 有效期：access / refresh 均 12 小时（`ACCESS_TOKEN_EXPIRE_SECONDS = 12h`）
- Token 结构：`JWTOutSchema { access_token, refresh_token, token_type="Bearer", expires_in }`
- 登录响应另带：`tenants: TenantOption[]`、`user_info: dict`（`LoginWithTenantsSchema`，`auth/schema.py:62`）
- 认证失败 → `CustomException(code=10401, status_code=401)` → HTTP 401 + `{code:10401, msg:"认证失败,请登录后再试"}`
- 权限码格式：`module_<模块>:<资源>:<动作>`，如 `module_system:user:query`；租户套餐侧另有 `tenant:xxx`、`module_package:xxx`

### 2.4 接口清单（本轮用到的）

| 方法 | 路径 | 入参 | 出参 `data` |
|---|---|---|---|
| GET | `/system/auth/captcha/get` | — | `{ enable: bool, key: string, img_base: "data:image/png;base64,..." }` |
| POST | `/system/auth/login` | **form**：`username, password, captcha_key?, captcha?, login_type?` | `LoginWithTenantsSchema` |
| POST | `/system/auth/token/refresh` | JSON `{ refresh_token }` | `JWTOutSchema` |
| POST | `/system/auth/logout` | JSON `{ token }` | `null` |
| GET | `/system/user/current/info` | — | `UserOutSchema`（含 `menus` 树、`roles`） |
| GET | `/system/user/list` | query：`page_no, page_size, order_by?, username?, name?, mobile?, email?, dept_id?, status?` | `PageResultSchema<UserOutSchema>` |
| GET | `/system/user/detail/{id}` | — | `UserOutSchema` |
| POST | `/system/user/create` | JSON `UserCreateSchema` | `UserOutSchema` |
| PUT | `/system/user/update/{id}` | JSON `UserUpdateSchema` | `UserOutSchema` |
| DELETE | `/system/user/delete` | JSON `ids: number[]` | `null` |
| POST | `/system/user/register` | JSON `UserRegisterSchema { username, password, name?, mobile?, role_ids?, description? }` | `UserOutSchema` |
| GET | `/system/auth/oauth/{provider}/login?redirect_uri=` | provider ∈ `wechat｜qq｜github｜gitee` | 302 跳三方授权页 |
| POST | `/system/auth/select-tenant` | JSON `{ tenant_id }` | `{ access_token, token_type, expires_in }` |

**三方登录回调约定**：后端 302 回前端 `redirect_uri`，成功时带 `?access_token=&refresh_token=&token_type=`，失败时带 `?oauth_error=<消息>`（`app/api/v1/module_system/auth/oauth_service.py:49`）。

### 2.5 分页

- 查询参数：**`page_no`**（默认 1，≥1）、**`page_size`**（默认 10，1–100）、`order_by`（JSON 字符串，如 `[{"id":"desc"}]`）
- 响应 `data`：`PageResultSchema { page_no, page_size, total, has_next, items }`（`app/core/base_schema.py:151`）
- ⚠ **与 ProTable 期望的 `{ current, pageSize, total, list }` 不一致**，需要一层适配（见 §6.4）

### 2.6 菜单树

**数据源：`GET /system/user/current/info` 的 `data.menus`**（不是 `/platform/menu/tree` —— 后者需要平台级权限 `module_platform:menu:query`，普通租户用户拿不到）。

- 后端 `UserService.current_info()`（`user/service.py:165`）已经完成：按角色/套餐过滤 → `status=0` → `client='pc'` → `traversal_to_tree()` 建树
- **实测确认**：最终 JSON 中 `children` 嵌套树完整保留，`parent_id` 也保留（用后端 venv 跑真实序列化路径验证过）
- 节点字段：`id, parent_id, name, type, order, permission, icon, route_name, route_path, component_path, redirect, hidden, keep_alive, always_show, title, params, affix, client, link, is_iframe, is_hide_tab, active_path, show_badge, show_text_badge, scope, status, children`
- `type`：1=目录，2=菜单，3=按钮，4=外链
- `scope`：`platform`（仅平台可见）/ `tenant`（租户可用）
- `client`：`pc`（桌面端）/ `app`（移动端）；后端已过滤掉 `app`

**后端种子菜单结构**（220 条，其中约 31 个可导航项，从 `sql/mysql/*.dump.sql` 的 `platform_menu` 表解析）：

| 顶级目录 | 二级 `route_path` | `component_path` |
|---|---|---|
| `/platform` | menu / tenant / package / email / order / invoice / workspace / plugin-market | `module_platform/{menu,tenant,package,email,order,invoice,self_service,plugin}/index` |
| `/system` | dict / param / dept / position / role / **user** / log / notice / ticket | `module_system/{dict,params,dept,position,role,user,log,notice,ticket}/index` |
| `/monitor` | online / server / cache / resource | `module_monitor/*/index` |
| `/swagger` | docs / redoc | `module_swagger/*/index` |
| `/generator` | gencode | `module_generator/gencode/index` |
| `/ai` | chat / memory | `module_ai/*/index` |
| `/task` | cronjob / workflow-mgr | `module_task/*/index` |
| `/example` | demo-center | `module_example/demo/index` |
| `/app/home` `/app/colleague` `/app/attendance` `/app/message` `/app/mine` | — | 移动端（`client='app'`，pc 端被后端过滤掉） |

> **★ 关键契约**：后端 `component_path` 的格式 `module_system/user/index` **恰好就是 umi `src/pages/` 的相对路径约定** —— 即 `src/pages/module_system/user/index.tsx`。前端页面目录按此命名，后端 `route_path` 与前端路由 path 对齐（`route_path` 是相对路径，挂在目录 `/system` 下 → 绝对路径 `/system/user`）。

---

## 3. 总体架构

```
浏览器
  │  ①  静态资源
  ▼
Nginx ── /api/v1/* ──► FastAPI (root_path=/api/v1, :8001)
  │                          │
  │  ②  index.html + JS      └─ 响应信封 {code,msg,data,status_code,success}
  ▼
React 19 + antd 6 + ProComponents 3 (Umi Max 4)
  ├─ src/services/api/**      手写 service 层（真实后端）
  ├─ src/menu/adapter.ts      后端菜单树 → ProLayout 菜单
  ├─ src/auth/**              token 存取 / 会话
  └─ src/requestErrorConfig.ts  信封适配 + token 注入 + 401 刷新重放
```

**分层原则**

- `src/services/api/**` 是**唯一**访问真实后端的地方，不含 UI 逻辑
- `src/pages/**` 只负责展示与交互，通过 `src/services/api/**` 取数据
- `src/menu/adapter.ts` 是**唯一**知道「后端菜单字段含义」的地方
- `src/auth/token.ts` 是**唯一**知道 token 存在哪的地方

---

## 4. 目录结构

```
ai-admin-com/                          ← 仓库根 = 前端项目根（antd/ 内容提到这里）
├── package.json                       # name: ai-admin-com
├── config/
│   ├── config.ts                      # title/logo、request、locale、移除 openapi 插件
│   ├── proxy.ts                       # dev 代理 → 后端
│   ├── routes.ts                      # 静态路由（与后端 route_path 对齐）
│   └── defaultSettings.ts             # AiAdmin 标题 / logo
├── src/
│   ├── app.tsx                        # getInitialState + layout + request
│   ├── access.ts                      # 权限判定
│   ├── auth/
│   │   ├── token.ts                   # token 存取
│   │   └── session.ts                 # login / logout / refresh / currentUser
│   ├── services/
│   │   ├── types.ts                   # ApiResponse / PageQuery / PageResult
│   │   ├── paginate.ts                # ProTable 分页适配器
│   │   ├── demo/                      # ← 原 src/services/ant-design-pro/（antd-pro 演示页专用，走 mock）
│   │   └── api/
│   │       ├── system/                # auth.ts user.ts role.ts dept.ts dict.ts …
│   │       ├── platform/              # menu.ts tenant.ts …
│   │       ├── monitor/
│   │       └── common/
│   ├── menu/
│   │   └── adapter.ts                 # 后端菜单树 → ProLayout 菜单
│   ├── pages/
│   │   ├── user/login/                # 改造：真实登录 + 验证码 + 注册 + 三方登录
│   │   ├── user/register/             # 改造：真实注册
│   │   ├── module_system/user/        # ★ 新增：打通范例页（ProTable CRUD）
│   │   ├── module_system/{role,dept,dict,param,position,log,notice,ticket}/   # 后续按需补
│   │   └── …其余 antd-pro 演示页原样保留
│   └── locales/                       # zh-CN + en-US（其余 6 种删除）
├── mock/ + src/pages/**/_mock.ts      # 保留：演示页数据源（路径 /api/rule 等，与 /api/v1/* 不冲突）
└── docs/superpowers/specs/            # 本规格
```

### 4.1 文件改动清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `antd/**` → 根目录 | 移动 | 删除 `antd/.git`，保留其余全部内容 |
| `package.json` | 改 | `name: "ai-admin-com"`；删 `openapi` 脚本；**保持 `start` = `cross-env UMI_ENV=dev max dev`（mock 开启，演示页可用）、`dev` = `cross-env UMI_ENV=dev MOCK=none max dev`（全站纯真实后端，用于验收）** |
| `config/config.ts` | 改 | `title: 'AiAdmin'`；移除 `openAPI` 配置与 `@umijs/max-plugin-openapi` 插件；`locale.baseNavigator: false`；`analytics` 移除 GA |
| `config/proxy.ts` | 改 | `dev: { '/api/': { target: 'https://www.pmdict.cn', changeOrigin: true } }` |
| `config/defaultSettings.ts` | 改 | `title: 'AiAdmin'`，logo 换本地 `public/logo.svg` |
| `config/routes.ts` | 改 | 新增 `/system/user` 等业务路由；保留 antd-pro 演示路由 |
| `config/oneapi.json` | 删 | openapi schema，随插件一起移除 |
| `src/app.tsx` | 改 | `getInitialState` 拉取用户+菜单；`layout.menuDataRender` 渲染后端菜单；`request.baseURL='/api/v1'` |
| `src/access.ts` | 改 | `hasPermission(code)` + `canAdmin` |
| `src/requestErrorConfig.ts` | 重写 | 信封适配 / token 注入 / 401 刷新重放 |
| `src/auth/token.ts` | 新增 | token 存取 |
| `src/auth/session.ts` | 新增 | 会话操作 |
| `src/menu/adapter.ts` | 新增 | 菜单适配器 |
| `src/services/types.ts` | 新增 | 公共类型 |
| `src/services/paginate.ts` | 新增 | ProTable 分页适配 |
| `src/services/api/**` | 新增 | 手写 service 层 |
| `src/services/ant-design-pro/**` → `src/services/demo/**` | 移动+改 import | 演示页专用，走 mock；原路径名有误导性（它已不再由 openapi 生成） |
| `src/pages/user/login/index.tsx` | 改 | 真实登录 + 验证码 + 注册/三方登录入口 |
| `src/pages/user/register/**` | 改 | 真实注册 |
| `src/pages/module_system/user/**` | 新增 | 打通范例页 |
| `src/pages/**`（其余演示页） | 不动 | 继续走 mock |
| `src/locales/{bn-BD,fa-IR,id-ID,ja-JP,pt-BR,zh-TW}/**` | 删 | i18n 精简 |
| `src/components/RightContent/AvatarDropdown.tsx` | 改 | 退出登录调真实接口 |
| `src/components/RightContent/DocLink` / `VersionDropdown` | 改/删 | 移除指向 antd-pro 官网的链接 |
| `mock/**`、`src/pages/**/_mock.ts` | 不动 | 演示页数据源 |

---

## 5. 请求层设计（`src/requestErrorConfig.ts`）

### 5.1 信封适配

```ts
// 成功判定：后端 code === 0（兼容 200）
const isSuccess = (res: ApiResponse) =>
  res?.code === 0 || res?.code === 200;
```

**业务码校验统一放在 `responseInterceptors` 的 fulfilled 分支**，不使用 umi 的 `errorThrower`。原因：umi 内置的 errorThrower 只在 `data.success === false` 时才被调用，而后端存在 `SuccessResponse(data=..., code=400)` 这种 **`success=true` 但 code 是错误值** 的响应（`app/api/v1/module_platform/order/controller.py:145`），走 errorThrower 会漏判。

```ts
responseInterceptors: [
  async (response) => {
    const body = response.data as ApiResponse;
    if (body && typeof body === 'object' && 'code' in body) {
      if (!isSuccess(body)) {
        if (isUnauthorized(body)) {
          // 业务层未授权：走 §5.3 的刷新重放
          return handleUnauthorized(response.config);
        }
        const error: any = new Error(body.msg);
        error.name = 'BizError';
        error.info = { code: body.code, msg: body.msg, data: body.data };
        throw error;
      }
    }
    return response;
  },
  async (error) => { /* §5.3 HTTP 401 路径 */ },
]
```

- `BizError` 抛出后进入 axios 的 rejected 链 → umi `errorHandler` → 按 §5.4 分级提示
- **业务错误可能带 HTTP 500**，因此 `errorHandler` 必须同时处理「有 response 但状态码非 2xx」的情况，读 `error.response.data` 信封，而不是只看状态码

### 5.2 token 注入（requestInterceptors）

```ts
requestInterceptors: [
  (config) => {
    const url = String(config.url ?? '');
    const skip = ['/system/auth/login', '/system/auth/token/refresh', '/system/auth/captcha/get'];
    if (!skip.some((p) => url.includes(p))) {
      const token = getAccessToken();
      if (token) config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
    }
    return config;
  },
],
```

### 5.3 401 静默刷新 + 原请求重放

**触发路径有两条，必须统一处理**：

| 触发 | 场景 | 拦截器位置 |
|---|---|---|
| HTTP 401 | 后端 `CustomException(code=10401, status_code=401)`（token 缺失/过期/无效） | `responseInterceptors` 的 **rejected 分支** |
| HTTP 200 + `code` 为未授权值 | 业务层未授权（当前后端未使用，但保留兼容） | `responseInterceptors` 的 **fulfilled 分支** |

两条路径都调用同一个 `handleUnauthorized(config)`，避免逻辑分叉。

**关键能力**：`getRequestInstance` 从 `@umijs/max` 导出，可拿到 axios 实例用于重发请求。

```ts
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;   // 并发请求共享同一次刷新
}
```

**`handleUnauthorized(config)` 流程**

1. 排除重试自身：`config.__retried` 为真 → 直接失败（防止无限递归）
2. 排除刷新接口自身（URL 含 `/system/auth/token/refresh`）→ 直接失败
3. `await refreshAccessToken()` 成功 → 用 `getRequestInstance().request({ ...config, __retried: true, headers: { ...config.headers, Authorization: 'Bearer ' + newToken } })` 重发原请求
4. 刷新失败（refresh_token 也过期）→ 清空本地 token → 跳转 `/user/login?redirect=<当前路径>`，并发场景只提示一次

**并发去重**：刷新期间的多个 401 共享同一个 `refreshPromise`；刷新成功后各请求各自重放（等价于 Vue 端的 `pendingRequests` 队列实现）。

> ⚠ 实现注意：重发时用 `getRequestInstance().request(config)` 会再次走完整拦截器链，因此 `__retried` 标记必须随 config 一起带过去，否则刷新后若仍 401 会无限递归。

### 5.4 错误提示分级

| 条件 | 行为 |
|---|---|
| `BizError` + `code === 401` | 静默刷新路径，不弹窗 |
| `BizError` + `code === 403` | `message.error('无权限访问')` |
| `BizError` 其他 | `message.error(res.msg)` |
| HTTP 401 且已重试过 | 清 token → 跳登录（提示一次） |
| HTTP 5xx / 网络错误 | `message.error('服务异常，请稍后重试')` / `'网络连接异常'` |
| 离线 | `message.error('网络不可用，请检查连接')` |

**成功提示**：非 GET 且路径不含 `login` / `logout` 的请求成功后 `message.success(res.msg)`（与现有 Vue 前端行为一致）。

---

## 6. 认证、会话、菜单、权限

### 6.1 token 存取（`src/auth/token.ts`）

对齐现有 Vue 前端 `utils/auth/index.ts`：

| Key | 值 |
|---|---|
| `ACCESS_TOKEN` | `access_token` |
| `REFRESH_TOKEN` | `refresh_token` |
| `REMEMBER_ME` | `remember_me` |

- 勾选「记住我」→ `localStorage`；否则 → `sessionStorage`
- `setTokens(accessToken, refreshToken, rememberMe)` / `getAccessToken()` / `getRefreshToken()` / `clearAuth()` / `getRememberMe()`

### 6.2 登录页（`src/pages/user/login/index.tsx`）

字段：**用户名、密码、验证码、记住我**

- **验证码**：`GET /system/auth/captcha/get` → `{ enable, key, img_base }`
  - `enable === true` → 渲染 base64 图片（`<img src={img_base} />`）+ 输入框
  - 提交时带 `captcha_key = key`、`captcha = 输入值`
  - 校验失败时（msg 含「验证码」）自动刷新验证码
- **登录**：`POST /system/auth/login`，**`Content-Type: application/x-www-form-urlencoded`**（FastAPI `OAuth2PasswordRequestForm`），字段 `username / password / captcha_key / captcha / login_type=PC端`
- **注册**：保留入口 → `/user/register`，提交 `POST /system/user/register`
- **三方登录**：保留按钮组 → `GET {baseURL}/system/auth/oauth/{provider}/login?redirect_uri={encodeURIComponent(location.origin + location.pathname)}`
  - provider：`github` / `gitee` / `wechat` / `qq`
  - 回跳时登录页解析 URL：`access_token` → 存 token → 跳首页；`oauth_error` → 显示错误
- **登录后跳转**：跳「第一个渲染成功的菜单项」的 path；无可用菜单则兜底 `/welcome`

### 6.3 会话（`src/auth/session.ts`）

```
login(form)          → POST /system/auth/login       → 存 token + rememberMe
fetchCurrentUser()   → GET  /system/user/current/info → { currentUser, menus, permissions }
logout()             → POST /system/auth/logout {token} → 清 token → 跳登录
refresh()            → POST /system/auth/token/refresh {refresh_token} → 覆盖 token
```

### 6.4 `getInitialState`（`src/app.tsx`）

```ts
export async function getInitialState() {
  // 非登录页才拉取用户信息
  if (!isAuthPage(location.pathname)) {
    try {
      const info = await fetchCurrentUser();      // 含 menus
      return {
        currentUser: info,
        menus: info.menus,
        permissions: collectPermissions(info),     // 菜单树 + roles[].menus 里所有 permission
        settings: defaultSettings,
      };
    } catch {
      history.replace(`/user/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
    }
  }
  return { settings: defaultSettings };
}
```

`collectPermissions`：递归遍历菜单树 + `roles[].menus`，收集所有非空 `permission` 去重成 `string[]`（对齐 Vue 端 `setPermissions`）。

### 6.5 菜单适配器（`src/menu/adapter.ts`）

输入：后端菜单树（已嵌套）。输出：ProLayout 菜单项数组。

处理步骤：

1. **过滤按钮**：`type === 3` 的节点不生成菜单项，但其 `permission` 仍进权限集合
2. **过滤停用/隐藏**：`status === 1` 或 `hidden === true` 跳过
3. **排序**：按 `order` 升序（后端已排，此处兜底）
4. **路径归一**：`route_path` 相对路径拼父级绝对路径（`joinAbsolutePath`，照搬 Vue 端 `normalizeMenuNestedPaths`）
5. **路由存在性校验**：用前端路由表（`routes.ts` 导出的 path 集合）检查；**找不到对应路由的菜单项跳过并 `console.warn('[menu] 前端缺少路由: <path>')`**
6. **空目录剔除**：目录下所有子项都被跳过时，该目录也不渲染
7. **映射**：`{ path, name: route_name || title, icon, locale: false }`

> **落地边界**：umi 不支持运行时注入新的页面组件。因此「后端管显示」= 后端决定**显示哪些**；「前端管路由」= 前端 `config/routes.ts` 决定**能点开什么**。两者通过 `route_path` 对齐，对不上的菜单项不渲染。

### 6.6 权限（`src/access.ts`）

```ts
export default function access(initialState) {
  const perms = initialState?.permissions ?? [];
  return {
    canAdmin: Boolean(initialState?.currentUser?.is_superuser),
    hasPermission: (code: string) => perms.includes(code),
  };
}
```

- 路由级：`config/routes.ts` 的 `access: 'canAdmin'`（保留 antd-pro 原有写法）
- 按钮级：组件内 `const { hasPermission } = useAccess();` → `hasPermission('module_system:user:create')`

---

## 7. service 层规范

### 7.1 类型（`src/services/types.ts`）

```ts
export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T | null;
  status_code: number;
  success: boolean;
}

export interface PageQuery {
  page_no: number;
  page_size: number;
  order_by?: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page_no: number | null;
  page_size: number | null;
  has_next: boolean | null;
}
```

**实体类型**放在各模块内：`src/services/api/system/types.ts`（`UserOut` / `UserCreate` / `UserUpdate` / `UserRegister`）、`src/services/api/platform/types.ts`（`MenuOut`）等。字段与后端 Pydantic schema 一一对应（`app/api/v1/module_system/user/schema.py`）。

### 7.2 写法约定

- 每个文件导出具名函数，统一 `import { request } from '@umijs/max'`
- **路径不带 `/api/v1`**（由 `request.baseURL` 统一带）
- 返回类型统一 `Promise<ApiResponse<T>>`；调用方取 `.data`

```ts
// src/services/api/system/user.ts
import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

export async function listUsers(params: Partial<PageQuery> & Record<string, unknown>) {
  return request<ApiResponse<PageResult<UserOut>>>('/system/user/list', {
    method: 'GET',
    params,
  });
}
```

### 7.3 ProTable 分页适配（`src/services/paginate.ts`）

后端分页字段与 ProTable 不一致，统一在此转换：

```ts
export function toProTableRequest<T>(
  api: (params: PageQuery) => Promise<ApiResponse<PageResult<T>>>,
) {
  return async (params: { current?: number; pageSize?: number; [k: string]: unknown }) => {
    const res = await api({
      ...params,
      page_no: params.current ?? 1,
      page_size: params.pageSize ?? 10,
    });
    return {
      list: res.data?.items ?? [],
      total: res.data?.total ?? 0,
      success: res.success,
    };
  };
}
```

---

## 8. 打通范例页：用户管理（`src/pages/module_system/user/`）

**路由**：`/system/user`（与后端菜单 `route_path=user` + 父目录 `/system` 对齐）
**后端**：`GET /system/user/list`、`POST /system/user/create`、`PUT /system/user/update/{id}`、`DELETE /system/user/delete`

- **列表列**：用户名 `username`、姓名 `name`、手机号 `mobile`、邮箱 `email`、部门 `dept_name`、状态 `status`（0 正常 / 1 禁用）、创建时间 `created_time`
- **搜索项**：用户名、姓名、手机号、邮箱、状态
- **新增/编辑弹窗**：字段取自 `UserCreateSchema` / `UserUpdateSchema` —— `username, password(新增必填,≥6), name, mobile, email, dept_id, role_ids, position_ids, status, description`
- **按钮权限**：新增 `module_system:user:create`、编辑 `module_system:user:update`、删除 `module_system:user:delete`、导出 `module_system:user:export`
- **删除**：`DELETE /system/user/delete`，body `{ ids: [id] }`

> 本页是**模板范例**，后续 `role` / `dept` / `dict` 等页面按同一范式复制。

---

## 9. 环境、代理与构建

```ts
// config/proxy.ts
export default {
  dev: {
    '/api/': {
      target: 'https://www.pmdict.cn',   // 本地后端则改为 http://127.0.0.1:8001
      changeOrigin: true,
    },
  },
};
```

- **不 rewrite**（后端 `root_path` 已处理前缀）
- `src/app.tsx`：`request.baseURL = '/api/v1'`（dev 与 prod 一致，同源部署）
- **两种启动模式并存**（这是本模板的关键设计点）：

| 命令 | mock | 用途 |
|---|---|---|
| `npm start` | **开**（antd-pro 默认） | 日常开发：antd-pro 演示页有数据可看，新业务页照常走真实后端 |
| `npm run dev` | **关**（`MOCK=none`） | 验收 / 纯真实后端联调：全站请求都打到真实后端，演示页会报错（预期） |

- **两者不冲突**：antd-pro mock 注册的路径是 `/api/rule`、`/api/currentUser`、`/api/login/account` 等；真实后端请求一律带 `/api/v1/` 前缀。umi mock 是 express 中间件，未匹配的路径会 `next()` 放行给代理，因此同一套 dev server 下两套数据源可共存。
- 演示页仍需 mock 数据时：保留 `mock/` 与 `src/pages/**/_mock.ts`；其路径为 `/api/rule`、`/api/currentUser` 等，**与真实后端 `/api/v1/*` 不冲突**
  - ⚠ umi mock 会拦截匹配的路径，真实请求统一带 `/api/v1/` 前缀即可天然隔离

---

## 10. 品牌与国际化

- `config/defaultSettings.ts`：`title: 'AiAdmin'`，`logo: '/logo.svg'`（新增 `public/logo.svg`）
- `config/config.ts`：`title: 'AiAdmin'`；移除 `analytics`（GA）
- `src/locales/`：保留 `zh-CN`、`en-US`，删除 `bn-BD` / `fa-IR` / `id-ID` / `ja-JP` / `pt-BR` / `zh-TW`
- `config/config.ts` → `locale: { default: 'zh-CN', antd: true, baseNavigator: false }`（避免浏览器语言自动切英文）
- `src/components/RightContent/DocLink`（指向 antd.pro 官网）移除；`VersionDropdown` 保留

---

## 11. 验收清单

| # | 步骤 | 期望 |
|---|---|---|
| 1 | `npm install && npm run dev` | dev server 启动，无 TS / lint 报错；Network 中所有请求打到 `https://www.pmdict.cn/api/v1`（mock 关闭，证明真实链路） |
| 2 | 访问 `/user/login` | 显示验证码图片（base64）、用户名、密码、记住我、注册链接、三方登录按钮 |
| 3 | 用测试账号 + 正确验证码登录 | 成功跳转；Network 中 `POST /api/v1/system/auth/login` 200 |
| 4 | 侧边栏 | 来自后端菜单树；只渲染前端有路由的项；缺失路由的项在 console 有 warn |
| 5 | 进入 `/system/user` | ProTable 展示真实用户数据，分页/搜索正常；请求参数为 `page_no` / `page_size` |
| 6 | 权限 | 无 `module_system:user:create` 的账号看不到「新增」按钮 |
| 7 | 退出登录 | `POST /api/v1/system/auth/logout` 200；token 已清；回登录页 |
| 8 | token 过期 | 静默刷新成功 → 原请求自动重放 → 页面无报错无重复请求 |
| 9 | 刷新 token 后再次过期 | 跳登录页并带 `redirect` 参数 |
| 10 | `npm run build` | 构建通过，产物可部署到 nginx |
| 11 | `npm run lint` | Biome + tsc 全部通过 |

**测试环境**：公网部署 `https://www.pmdict.cn/api/v1`。测试账号由使用者单独提供，**不写入本仓库**（建议放 `.env.local`，该文件已在 `.gitignore` 中）。

---

## 12. 本轮明确不做

- 不改 antd-pro 演示页（dashboard / form / list / profile / chatbot）的 service —— 继续走自带 mock（`npm start` 下可用；`npm run dev` 下这些页会报错，属预期）
- 不实现 `role` / `dept` / `dict` / `menu` 等其余 20+ 个后端菜单对应的页面（仅保留路由契约位置，后续按范式补）
- 不做租户切换 UI（`/system/auth/select-tenant` 接口已确认存在，留作后续）
- 不做 `auto-login`（免登录）功能
- 不做后端菜单管理界面（前端只消费）
- 不做前端单元测试的新增（antd-pro 自带 vitest 保留）
- 不做 GitHub/Gitee/微信/QQ 的 OAuth 应用配置（依赖后端 `OAUTH_*` 环境变量）

---

## 13. 风险与未决

| 风险 | 影响 | 缓解 |
|---|---|---|
| 后端业务错误返回 HTTP 500 | 容易被误判为服务端故障 | 错误处理统一读响应体信封（§5.1） |
| 后端菜单 220 条 vs 前端只实现 1 个页面 | 侧边栏看起来很单薄 | 这是「最小闭环」的预期结果；未实现的菜单按 §6.5 规则跳过 |
| `/app/*` 首页菜单是移动端 | pc 端没有首页入口 | 登录后跳第一个可用菜单；兜底 `/welcome` |
| 三方登录把 token 放在 URL query | token 会进浏览器历史 / Referer | 沿用后端既有设计；若要收紧需后端改用一次性票据 |
| 验证码强开（公网 `enable: true`） | 登录页必须实现验证码 | §6.2 已纳入 |
| `page_size` 上限 100 | ProTable 分页 size 需限制 | 页面里设置 `pageSizeOptions` 并钳制到 ≤100 |
