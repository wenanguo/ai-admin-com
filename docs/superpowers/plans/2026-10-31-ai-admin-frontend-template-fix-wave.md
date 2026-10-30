# 最终合并修复波

前面 12 个任务各自复审时攒下的 Minor / Important,以及控制器在集成阶段新发现的问题,
在**一次**修复波里统一处理。范围严格限定在下表列出的条目 —— 不做顺手重构。

**执行方式**:一个 subagent 一次做完 → 一次任务级复审 → 提交。

## 待处理清单

| # | 文件 | 问题 | 级别 |
|---|---|---|---|
| W1 | `src/requestErrorConfig.ts` | 后端业务异常是 **HTTP 500 + 信封**,axios 会 reject 成原始 axios error,`error.info` 是 undefined ⇒ 调用方拿不到后端的 msg | Important |
| W2 | `src/services/api/system/auth.ts` | 登录请求的 toast 与页面内联提示重复 | Minor |
| W3 | `src/menu/adapter.ts` | `console.warn` 落在渲染热路径,每次渲染刷几百条 | Important |
| W4 | `src/menu/adapter.ts` | type=4(外链)没被单独识别,报出来的告警有误导性 | Minor |
| W5 | `src/menu/adapter.ts` | 没有子节点的 type=1 目录会被当成叶子菜单项推出来(路径没注册 → 死链) | Minor |
| W6 | `src/menu/adapter.ts` | `nodes.sort(...)` 是原地排序 | Minor |
| W7 | `src/access.ts` | `currentUser` 用索引签名 `{[key:string]: unknown}`,与 `UserOut`(interface,没有隐式索引签名)对不上;只靠 umi 生成文件的 `@ts-nocheck` 撑着 | Important |
| W8 | `src/app.tsx` | 返回类型重复声明了 `UserState` 的三个字段 | Minor |
| W9 | `src/app.tsx` | `info?.menus` / `info?.roles` 的可选链是死的 | Minor |
| W10 | `src/app.tsx` | `avatarProps.title` 的兜底 `'用户'` 是硬编码中文 | Minor |
| W11 | `src/services/api/platform/menu.ts` | `getMenuTree` 注释写「菜单树」,但后端这个接口返回的是**扁平列表**;`scope` 类型也过宽 | Minor |
| W12 | `src/services/api/system/user.ts` | `getUserDetail` / `registerUser` 没有单测 | Minor |
| W13 | `src/app.test.tsx` | 覆盖缺口 | Minor |
| W14 | `src/access.test.ts` | 覆盖缺口 | Minor |
| W15 | `config/routes.ts` | `/system` 父路由没有 `redirect`,直接访问会渲染空白内容区 | Minor |
| W16 | `src/requestErrorConfig.ts` | `throw createBizError(body as ApiResponse)` 的 cast 多余(`isApiResponse` 已经是类型守卫) | Minor |

## W1 —— 把「HTTP 500 + 信封」统一成 BizError(最重要的一条)

**问题**:后端的业务异常一律是 `CustomException` ⇒ **HTTP 500** + 信封
`{ code: -1, msg: "账号或密码错误", ... }`。已用公网接口实测:故意传空验证码调
`POST /system/auth/login`,返回 `http=500 code=-1 msg=验证码不能为空`。
axios 对 500 会 **reject**,于是请求层里 `responseInterceptors` 的 **fulfilled** 分支
根本不会执行,`createBizError` 也就不会被创建 —— 调用方拿到的是**原始 axios error**,
`error.info` 是 `undefined`,`error.message` 是英文的 "Request failed with status code 500"。

**后果**:登录页的 `error?.info?.msg || error?.message` 永远拿不到后端的中文提示,
内联提示会显示英文的 axios 报错。

**改法**:`src/requestErrorConfig.ts` 的 `responseInterceptors` 第二个(rejected)分支里,
在 `throw error` 之前把「带信封的 HTTP 错误」转成 `BizError`:

```ts
    async (error: any) => {
      // 未授权判定与 HTTP 状态码无关:后端可能用 500 携带 401/10401 业务码
      if (
        error?.response?.status === 401 ||
        isUnauthorized(error?.response?.data)
      ) {
        return handleUnauthorized(error.config);
      }

      // 后端的业务异常走 HTTP 500 + 信封,axios 会 reject 成原始错误。
      // 这里统一转成 BizError,调用方只需要认一种错误形态(error.info.msg)。
      const body = error?.response?.data;
      if (isApiResponse(body) && !isSuccess(body)) {
        throw createBizError(body);
      }

      throw error;
    },
```

`errorHandler` 里的 `BizError` 分支已经会弹 `message.error(info.msg)`,行为不变。

## W2 —— 登录请求不再重复弹提示

**问题**:登录失败时,请求层的 `errorHandler` 弹一次 toast,页面又用 `submitError`
渲染一个 `LoginMessage` Alert,两段文字一样。

**改法**:`src/services/api/system/auth.ts` 的 `login()` 加 `skipErrorHandler: true`,
让页面内联提示成为唯一出口:

```ts
export async function login(form: LoginForm) {
  const body = new URLSearchParams({ ... });

  return request<ApiResponse<LoginResult>>('/system/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: body.toString(),
    // 登录失败由登录页内联展示(error.info.msg),不要再弹一次全局 toast
    skipErrorHandler: true,
  });
}
```

> umi 的 request 在 `.catch` 里调 `handler(error, opts, config)`,
> 我们的 `errorHandler` 见到 `opts.skipErrorHandler` 会重新抛出,
> 错误照样传到调用方的 catch —— 不会吞掉。
> (`src/.umi/plugin-request/request.ts` 的 `.catch` 分支可以核对。)

## W3 —— `console.warn` 按 path 去重

**问题**:`menuDataRender` 是内联箭头函数,每次 `Layout` 渲染都是新身份,
ProLayout 的 `useMemo` 依赖它 ⇒ `buildMenuItems` 每次渲染都重跑 ⇒
**每次渲染刷几百条** `[menu] 前端缺少路由: …`(后端 220 条菜单 vs 前端 ~12 条路由)。

**改法**:`src/menu/adapter.ts` 加一个模块级的已警告 path 集合,同一条路径只警告一次:

```ts
/** 已经警告过的路径,避免每次渲染都刷屏 */
const warnedPaths = new Set<string>();
```

在 `buildMenuItems` 里:

```ts
      if (!isDirectory && !knownPaths.has(path)) {
        if (!warnedPaths.has(path)) {
          warnedPaths.add(path);
          console.warn(`[menu] 前端缺少路由: ${path}`);
        }
        continue;
      }
```

> 纯函数模块里放一个模块级可变集合,是为了「每个 path 只提醒一次」——
> 这是有意的取舍,`buildMenuItems` 的**返回值**仍然只依赖入参。

## W4 / W5 —— type=4 与空目录

**W4**:后端有 type=4(外链)节点(`/swagger` 下面挂着 Swagger文档 / Redoc文档)。
它们不是目录 ⇒ 现在走「路径未注册」分支被跳过,报出来的告警**有误导性**。
改法:在 `buildMenuItems` 里显式跳过 type=4:

```ts
const MENU_TYPE_DIRECTORY = 1;
const MENU_TYPE_BUTTON = 3;
const MENU_TYPE_EXTERNAL = 4;
```

```ts
      if (item.type === MENU_TYPE_EXTERNAL) continue;   // 外链本轮不渲染
```

> 不弹告警:外链跳过是**已知且有意**的行为,不是「前端缺路由」。
> 后续要做外链菜单时(渲染成 `<a>`),再单独处理。

**W5**:**没有子节点**的 type=1 目录现在会被当成叶子菜单项推出来 ——
它的路径通常没在前端注册,点进去就是 404。
改法:目录只有在「还有可见子项」**或**「自身路径已在前端注册」时才保留:

```ts
      // 目录只有在「还有可见子项」或「自身路径已在前端注册」时才保留,
      // 否则它就是一个点进去 404 的死链
      if (isDirectory && children.length === 0 && !knownPaths.has(path)) {
        continue;
      }
```

> 这条**替换**掉原来那句
> `if (isDirectory && hadChildren && children.length === 0) continue;`。
> 差别只在「本来就没有子节点」的目录上:原来留着(死链),现在丢掉。
> 现有种子数据里没有这种目录,改前后行为一致 —— 但边界被补上了。

## W6 —— 不要原地排序

`for (const node of nodes.sort((a, b) => a.order - b.order))` 是**原地排序**。
改成先拷贝再排:

```ts
      for (const node of [...nodes].sort((a, b) => a.order - b.order)) {
```

## W7 —— `access.ts` 用真实类型

`src/access.ts` 现在把 `currentUser` 声明成
`{ is_superuser?: boolean | null; [key: string]: unknown } | null`。
`UserOut` 是 **interface**,没有隐式索引签名,赋给它会报 TS2345;
现在没炸只是因为唯一的调用点 `src/.umi/plugin-access/runtime.tsx` 首行有 `// @ts-nocheck`。

改法:换成真实类型,不再依赖索引签名:

```ts
import type { BackendMenu } from '@/menu/adapter';
import type { UserOut } from '@/services/api/system/types';

export default function access(
  initialState:
    | {
        currentUser?: Partial<UserOut> | null;
        permissions?: string[];
        menus?: BackendMenu[];
      }
    | undefined,
) {
  const permissions = initialState?.permissions ?? [];

  return {
    canAdmin: Boolean(initialState?.currentUser?.is_superuser),
    hasPermission: (code: string) => permissions.includes(code),
  };
}
```

> `Partial<UserOut>` 的所有字段都是可选的,`src/access.test.ts` 里
> `access({ currentUser: { username: 'admin' } })` 这种写法仍然编译得过
> (`username` 是 `UserOut` 的字段,不会触发多余属性检查)。

## W8 / W9 / W10 —— `src/app.tsx` 的三处收拾

**W8**:返回类型改成组合 `UserState`,不要重复声明三个字段:

```ts
export async function getInitialState(): Promise<
  UserState & {
    settings?: Partial<LayoutSettings>;
    fetchUserInfo?: () => Promise<UserState | undefined>;
    settingDrawerOpen?: boolean;
  }
> {
```

**W9**:`fetchCurrentUser()` 在没有 data 时就抛异常,`info` 永远非空 ——
把 `info?.menus` / `info?.roles` 改成 `info.menus` / `info.roles`。

**W10**:`avatarProps.title` 的兜底 `'用户'` 换成 i18n:

```ts
      title:
        initialState?.currentUser?.name ??
        initialState?.currentUser?.username ??
        getIntl().formatMessage({
          id: 'app.user.defaultName',
          defaultMessage: '用户',
        }),
```

并在 `src/locales/zh-CN/app.ts` 与 `src/locales/en-US/app.ts` 里加
`'app.user.defaultName': '用户'` / `'User'`。
(`src/app.tsx` 已经 import 了 `getIntl` —— `import { getIntl, getRequestInstance, history } from '@umijs/max';`)

## W11 —— `getMenuTree` 的注释与类型

后端 `GET /platform/menu/tree` 的 response_model 是 `list[MenuOutSchema]`,
而 `MenuOutSchema` **没有 `children` 字段** ⇒ 客户端拿到的是**扁平列表**,不是树。

```ts
/**
 * 查询菜单列表(平台侧菜单管理,需要 module_platform:menu:query 权限)。
 *
 * 注意:后端这个接口的 response_model 是 list[MenuOutSchema],**没有 children 字段**,
 * 拿到的是扁平列表,不是树。要树形结构请用 /system/user/current/info 返回的 menus。
 */
export async function getMenuTree(params?: {
  menu_client?: 'pc' | 'app';
  scope?: 'tenant';
  status?: number;
}) {
```

(`scope` 收窄成 `'tenant'`:后端 `MenuQueryParam.scope` 是 `Literal["tenant"]`,传 `'platform'` 会 422。)

## W12 —— 补两个 service 单测

`src/services/api/system/user.test.ts` 里补:

```ts
  it('gets a user detail by id', async () => {
    await getUserDetail(7);

    expect(request).toHaveBeenCalledWith('/system/user/detail/7', {
      method: 'GET',
    });
  });

  it('registers a user', async () => {
    await registerUser({ username: 'u1', password: 'pw123456' });

    expect(request).toHaveBeenCalledWith('/system/user/register', {
      method: 'POST',
      data: { username: 'u1', password: 'pw123456' },
    });
  });
```

(记得把 `getUserDetail` / `registerUser` 加进文件顶部的 import 列表。)

## W13 / W14 —— 补测试覆盖

**W13** `src/app.test.tsx` 补三条:
- `initialState.menus` 为 undefined 时,`menuDataRender` 返回 `[]`
- `/user/register` 与 `/user/register-result` 也在 `authFreePaths` 里(不拉用户信息)
- 图标用 **ReactElement**(而不是字符串)时,`menuDataRender` 仍然把它原样带出来

**W14** `src/access.test.ts` 补三条:
- `currentUser: null` ⇒ `canAdmin` 为 false,`hasPermission` 全部 false
- `is_superuser: null` ⇒ `canAdmin` 为 false
- 传了 `currentUser` 但**没有** `permissions` ⇒ `hasPermission` 全部 false

## W15 —— `/system` 补 redirect

`config/routes.ts` 里 `/system` 是本文件**唯一**没有 `redirect` 的父路由
(其它父路由都有 `{ path: X, redirect: X/first-child }`)。
直接访问 `/system` 会渲染出空白内容区。加一行:

```ts
  {
    path: '/system',
    name: 'system',
    icon: 'setting',
    redirect: '/system/user',
    routes: [
      {
        path: '/system/user',
        name: 'user',
        icon: 'user',
        component: './module_system/user',
      },
    ],
  },
```

> 加了 `redirect` **不会**让菜单项消失:ProLayout 的菜单过滤
> (`defaultFilterMenuData` 里的 `!item.redirect`)只作用于路由派生的菜单,
> 而我们的侧边栏是 `menuDataRender` 用后端菜单重建的,根本不看路由的 `redirect`。

## W16 —— 去掉多余的 cast

`src/requestErrorConfig.ts`:`isApiResponse(body)` 已经是类型守卫,
`body` 已经被收窄成 `ApiResponse`,`as ApiResponse` 多余:

```ts
        throw createBizError(body);
```

## 验收门禁

```bash
cd /d/project/ai-admin-com
npm run tsc && npm run lint && npx antd lint ./src && npx vitest run
```

Expected: 全部 exit 0。`npx antd lint ./src` 的 33 条 deprecated 全在 `pages/list` 等**演示页**里,
本轮**不能新增**。

## 提交

拆成三个提交更清楚:

1. `fix(request): 业务异常统一转成 BizError,登录失败不再重复提示`(W1 + W2 + W16)
2. `fix(menu): 菜单告警去重,补 type=4 与空目录边界`(W3–W6 + W11 + W15)
3. `refactor(access): 用真实类型替代索引签名,并补测试覆盖`(W7–W10 + W12–W14)
