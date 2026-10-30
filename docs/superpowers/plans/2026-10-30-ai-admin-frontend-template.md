# AiAdmin 前端基础模板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `antd/` 里的 Ant Design Pro 模板改造为 AiAdmin 的前端基础模板,前端真实调用 `AiAdmin` FastAPI 后端,打通「登录 → 当前用户 → 后端菜单 → 用户管理真实数据 → 退出」闭环。

**Architecture:** 保留 antd-pro 全部页面与服务端框架,只替换「数据层」:新增手写 service 层(`src/services/api/**`)对真实后端,新增 `src/menu/adapter.ts` 把后端菜单树转成 ProLayout 菜单,重写 `src/requestErrorConfig.ts` 对齐后端 `{code,msg,data,status_code,success}` 信封并实现 401 静默刷新重放。后端菜单决定「显示什么」,前端 `config/routes.ts` 决定「能点开什么」,靠 `route_path` 对齐。

**Tech Stack:** Umi Max 4 · React 19 · antd 6 · ProComponents 3 · Tailwind CSS v4 · TypeScript 7(strict) · Biome · vitest 5(browser mode + Playwright chromium)

**Spec:** `docs/superpowers/specs/2026-10-30-ai-admin-frontend-template-design.md`

---

## Global Constraints

以下约束适用于本计划中的**每一个** Task,不再逐条重复:

- **后端基址**:开发代理目标 `https://www.pmdict.cn`(写死在 `config/proxy.ts`);前端 baseURL `/api/v1`,**路径一律不带 `/api/v1` 前缀**(由 baseURL 统一带)
- **响应信封**:后端返回 `{ code, msg, data, status_code, success }`;**成功判定 `code === 0`**(兼容 `200`);失败时 `success === false`
- **⚠ 业务错误可能返回 HTTP 500** —— 错误处理必须读响应体信封,不能只看 HTTP 状态码
- **鉴权**:`Authorization: Bearer <access_token>`;登录接口是 **form 编码**(`application/x-www-form-urlencoded`),字段 `username / password / captcha_key / captcha / login_type`
- **验证码**:`GET /system/auth/captcha/get` → `{ enable: boolean, key: string, img_base: string }`(base64 data URL)
- **分页**:请求参数 `page_no` / `page_size`(≤100);响应 `data` = `{ items, total, page_no, page_size, has_next }`
- **菜单来源**:`GET /system/user/current/info` 的 `data.menus`(后端已建好树);节点含 `children` / `parent_id` / `type`(1目录 2菜单 3按钮 4外链)/ `permission` / `route_path` / `component_path` / `icon` / `title` / `order` / `hidden` / `status`
- **权限码格式**:`module_<模块>:<资源>:<动作>`
- **component_path 约定**:`module_system/user/index` ↔ 前端 `src/pages/module_system/user/index.tsx`
- **代码风格**:Biome only(无 ESLint / Prettier);`npm run lint`(biome:lint + tsc)必须通过;conventional commits
- **测试**:`vitest` browser mode(chromium headless);测试文件放 `src/**/*.test.ts(x)`;service 层用 `vi.mock('@umijs/max')`
- **命令**:测试 `npx vitest run <path>`;类型检查 `npm run tsc`;lint `npm run biome:lint`;构建 `npm run build`
- **禁止**:不得把测试账号密码、token 等凭据写入任何入库文件

---

## File Structure

### 新增

| 文件 | 职责 |
|---|---|
| `src/services/http.ts` | `API_BASE_URL` 常量(唯一 baseURL 来源) |
| `src/services/types.ts` | `ApiResponse` / `PageQuery` / `PageResult` 公共类型 |
| `src/services/response.ts` | `isApiResponse` / `isSuccess` / `isUnauthorized` / `createBizError` 信封判定 |
| `src/services/paginate.ts` | ProTable 分页适配器(后端字段 ↔ ProTable 字段) |
| `src/services/api/system/types.ts` | 用户相关实体类型 |
| `src/services/api/system/auth.ts` | 验证码 / 登录 / 刷新 / 登出 |
| `src/services/api/system/user.ts` | 用户列表 / 详情 / 增删改 / 注册 |
| `src/services/api/platform/types.ts` | 菜单实体类型 |
| `src/services/api/platform/menu.ts` | 菜单树(平台侧管理用) |
| `src/auth/token.ts` | token 存取(remember_me 切换 localStorage / sessionStorage) |
| `src/auth/session.ts` | 会话操作:login / logout / refresh / fetchCurrentUser |
| `src/menu/adapter.ts` | 后端菜单树 → ProLayout 菜单;权限码收集;路径归一 |
| `src/pages/module_system/user/index.tsx` | 用户管理页(打通范例) |

### 修改

| 文件 | 改动 |
|---|---|
| `package.json` | `name: ai-admin-com`;删 `openapi` 脚本 |
| `config/config.ts` | 移除 openapi 插件与 `openAPI` 配置;`title: 'AiAdmin'`;`locale.baseNavigator: false`;移除 analytics |
| `config/proxy.ts` | dev 代理指向 `https://www.pmdict.cn` |
| `config/defaultSettings.ts` | `title: 'AiAdmin'`、`logo: '/logo.svg'` |
| `config/routes.ts` | 新增 `/system/user` 路由 |
| `src/app.tsx` | `getInitialState` 拉用户+菜单;`layout.menuDataRender`;`request.baseURL` |
| `src/access.ts` | `hasPermission(code)` + `canAdmin` |
| `src/requestErrorConfig.ts` | **完全重写** |
| `src/pages/user/login/index.tsx` | 验证码 + 真实登录 + 注册入口 + 三方登录 + OAuth 回跳处理 |
| `src/pages/user/register/index.tsx` + `service.ts` | 真实注册接口 |
| `src/components/RightContent/AvatarDropdown.tsx` | 退出登录调真实接口 |
| `vitest.config.ts` | coverage exclude 从 `src/services/ant-design-pro/**` 改为 `src/services/demo/**` |

### 删除

| 文件 | 原因 |
|---|---|
| `config/oneapi.json` | openapi 插件移除后无用 |
| `src/locales/{bn-BD,fa-IR,id-ID,ja-JP,pt-BR,zh-TW}/**` | i18n 精简到中英双语 |
| `src/services/ant-design-pro/**` | 改名为 `src/services/demo/**`(见 Task 13 Step 8) |

### 重命名

| 原路径 | 新路径 | 原因 |
|---|---|---|
| `src/services/ant-design-pro/api.ts` | `src/services/demo/api.ts` | 移除 openapi 插件后它已是普通手写代码,原名误导 |
| `src/services/ant-design-pro/login.ts` | `src/services/demo/login.ts` | 同上 |
| `src/services/ant-design-pro/typings.d.ts` | `src/services/demo/typings.d.ts` | 同上(保留全局 `API` namespace 供演示页使用) |
| `src/services/ant-design-pro/index.ts` | `src/services/demo/index.ts` | 同上 |

---

## Task 1: 项目骨架归位

把 `antd/` 的内容整体搬到仓库根,使 `ai-admin-com/` 本身成为前端项目根。

**Files:**
- Move: `antd/**` → 仓库根
- Modify: `package.json`
- Move: `antd/README.md` → `README.ant-design-pro.md`、`antd/README.zh-CN.md` → `README.ant-design-pro.zh-CN.md`(上游说明留存)

**Interfaces:**
- Consumes: 无
- Produces: 仓库根成为可运行的 umi 项目(`npm run tsc` / `npm run build` 通过)

- [ ] **Step 1: 确认 `antd/.git` 已由用户删除**

```bash
cd /d/project/ai-admin-com
ls -d antd/.git 2>/dev/null && echo "STILL EXISTS - STOP AND ASK USER" || echo "OK: antd/.git removed"
```

Expected: `OK: antd/.git removed`
(若仍存在,停止并告知用户——不要自行删除)

- [ ] **Step 2: 确认 `antd/` 内没有未提交改动会被丢弃**

```bash
cd /d/project/ai-admin-com/antd && git status --short && git log --oneline -1
```

Expected: `git status --short` 输出为空(干净工作区)。若非空,停止并向用户报告哪些文件有改动。

- [ ] **Step 3: 备份根目录会被覆盖的文件**

```bash
cd /d/project/ai-admin-com
cp .gitignore /tmp/root-gitignore.bak
cp README.md /tmp/root-readme.bak
```

- [ ] **Step 4: 移动 `antd/` 内容到根目录**

```bash
cd /d/project/ai-admin-com
shopt -s dotglob nullglob
# 排除 .claude / .agents(根目录已有,单独合并)与 .git(已删除)
for entry in antd/*; do
  base=$(basename "$entry")
  case "$base" in
    .claude|.agents) continue ;;
  esac
  mv "$entry" "./$base"
done
rmdir antd
```

- [ ] **Step 5: 合并 `.claude` / `.agents` 技能目录**

根目录已有 `.claude/skills/antd` → 符号链接指向 `.agents/skills/antd`,并且 `skills-lock.json` 锁定了其来源。**保留根目录版本**;只从 `antd/.claude/skills/` 取 antd-pro 独有的 `pro-upgrade` 技能。

```bash
cd /d/project/ai-admin-com
mkdir -p .claude/skills
cp -r antd/.claude/skills/pro-upgrade .claude/skills/pro-upgrade
rm -rf antd/.claude antd/.agents
ls .claude/skills/
```

Expected: 输出 `antd` 和 `pro-upgrade`

- [ ] **Step 6: 处理根 README 与 .gitignore**

`antd/.gitignore` 已随移动覆盖根 `.gitignore`(内容是 antd-pro 的,正确);根 `README.md` 已被 antd-pro 的覆盖,把上游说明改名留存,再写项目自己的 README。

```bash
cd /d/project/ai-admin-com
mv README.md README.ant-design-pro.md
mv README.zh-CN.md README.ant-design-pro.zh-CN.md
```

- [ ] **Step 7: 更新 package.json**

编辑 `package.json`:
- `"name": "ai-admin-com"`
- 删除 `"openapi": "max openapi",` 这一行
- 保持 `"start": "cross-env UMI_ENV=dev max dev"`(mock 开)、`"dev": "cross-env UMI_ENV=dev MOCK=none max dev"`(mock 关)

- [ ] **Step 8: 安装依赖**

先删掉旧的 `src/.umi`(里面是按旧路径 `D:/project/antd` 生成的绝对路径 import,移动后必然失效),再安装依赖——`npm install` 的 `prepare` 脚本会跑 `max setup` 重新生成。

```bash
cd /d/project/ai-admin-com
rm -rf src/.umi
npm install
npx playwright install chromium
```

Expected: 安装成功无报错(首次可能较慢)。`playwright install chromium` 是 vitest browser mode 的前置。

- [ ] **Step 9: 验证骨架可用**

```bash
cd /d/project/ai-admin-com
npm run tsc
```

Expected: 无类型错误输出,exit code 0。

- [ ] **Step 10: 提交**

```bash
cd /d/project/ai-admin-com
git add -A
git commit -m "chore: 将 antd-pro 模板内容归位到仓库根

- antd/ 内容整体移动到仓库根,antd/ 目录消失
- 合并 .claude/skills/pro-upgrade,保留根目录已有 antd 技能
- 上游 README 改名为 README.ant-design-pro.md
- package.json name 改为 ai-admin-com,移除 openapi 脚本

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: 响应信封工具与公共类型

后端信封是所有 service 与请求层的基础判断依据,先把它做成可单测的纯函数。

**Files:**
- Create: `src/services/http.ts`
- Create: `src/services/types.ts`
- Create: `src/services/response.ts`
- Test: `src/services/response.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `API_BASE_URL: string`(值 `'/api/v1'`)
  - `ApiResponse<T>`、`PageQuery`、`PageResult<T>`
  - `isApiResponse(value: unknown): value is ApiResponse`
  - `isSuccess(value: unknown): boolean`
  - `isUnauthorized(value: unknown): boolean`
  - `createBizError(res: ApiResponse): Error & { name: 'BizError'; info: { code: number; msg: string; data: unknown } }`

- [ ] **Step 1: 写失败测试**

创建 `src/services/response.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createBizError, isApiResponse, isSuccess, isUnauthorized } from './response';

describe('response envelope helpers', () => {
  describe('isApiResponse', () => {
    it('returns true for a valid envelope', () => {
      expect(isApiResponse({ code: 0, msg: '成功', data: null, status_code: 200, success: true })).toBe(true);
    });

    it('returns false for null', () => {
      expect(isApiResponse(null)).toBe(false);
    });

    it('returns false for a plain string', () => {
      expect(isApiResponse('ok')).toBe(false);
    });

    it('returns false when code is not a number', () => {
      expect(isApiResponse({ code: '0', msg: '' })).toBe(false);
    });
  });

  describe('isSuccess', () => {
    it('treats code 0 as success', () => {
      expect(isSuccess({ code: 0, msg: '', data: null, status_code: 200, success: true })).toBe(true);
    });

    it('treats code 200 as success', () => {
      expect(isSuccess({ code: 200, msg: '', data: null, status_code: 200, success: true })).toBe(true);
    });

    it('treats code 400 as failure even when success flag is true', () => {
      expect(isSuccess({ code: 400, msg: '订单状态异常', data: null, status_code: 200, success: true })).toBe(false);
    });

    it('treats code -1 as failure', () => {
      expect(isSuccess({ code: -1, msg: '验证码不能为空', data: null, status_code: 500, success: false })).toBe(false);
    });

    it('returns false for a non-envelope value', () => {
      expect(isSuccess(undefined)).toBe(false);
    });
  });

  describe('isUnauthorized', () => {
    it('detects code 401', () => {
      expect(isUnauthorized({ code: 401, msg: '未授权', data: null, status_code: 401, success: false })).toBe(true);
    });

    it('detects code 10401 (backend auth failure)', () => {
      expect(isUnauthorized({ code: 10401, msg: '认证失败,请登录后再试', data: null, status_code: 401, success: false })).toBe(true);
    });

    it('does not treat code 403 as unauthorized', () => {
      expect(isUnauthorized({ code: 403, msg: '访问受限', data: null, status_code: 403, success: false })).toBe(false);
    });
  });

  describe('createBizError', () => {
    it('creates a BizError carrying code, msg and data', () => {
      const error = createBizError({
        code: 4001,
        msg: '参数错误',
        data: { field: 'username' },
        status_code: 400,
        success: false,
      });

      expect(error.name).toBe('BizError');
      expect(error.message).toBe('参数错误');
      expect(error.info).toEqual({ code: 4001, msg: '参数错误', data: { field: 'username' } });
    });

    it('falls back to a default message when msg is empty', () => {
      const error = createBizError({ code: 1, msg: '', data: null, status_code: 400, success: false });
      expect(error.message).toBe('请求失败');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /d/project/ai-admin-com
npx vitest run src/services/response.test.ts
```

Expected: FAIL —— `Cannot find module './response'`

- [ ] **Step 3: 创建公共类型**

创建 `src/services/types.ts`:

```ts
/** 后端统一响应信封(后端 app/common/response.py 的 ResponseSchema) */
export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T | null;
  status_code: number;
  success: boolean;
}

/** 后端分页查询参数(app/core/base_params.py 的 PaginationQueryParam) */
export interface PageQuery {
  page_no: number;
  page_size: number;
  order_by?: string;
}

/** 后端分页结果(app/core/base_schema.py 的 PageResultSchema) */
export interface PageResult<T> {
  items: T[];
  total: number;
  page_no: number | null;
  page_size: number | null;
  has_next: boolean | null;
}
```

- [ ] **Step 4: 创建 baseURL 常量**

创建 `src/services/http.ts`:

```ts
/**
 * 后端 API 前缀。
 *
 * 后端 FastAPI 以 root_path='/api/v1' 暴露服务,nginx 与本地 dev 代理都不做 rewrite,
 * 因此前端统一以 /api/v1 作为 baseURL,service 层写路径时不再重复带上该前缀。
 */
export const API_BASE_URL = '/api/v1';
```

- [ ] **Step 5: 实现信封判定**

创建 `src/services/response.ts`:

```ts
import type { ApiResponse } from './types';

/** 后端成功业务码:RET.OK = 0,RET.SUCCESS = 200 */
const SUCCESS_CODES = [0, 200];

/** 后端未授权业务码:RET.UNAUTHORIZED = 401,认证失败 = 10401 */
const UNAUTHORIZED_CODES = [401, 10401];

export function isApiResponse(value: unknown): value is ApiResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    'code' in value &&
    typeof (value as { code?: unknown }).code === 'number'
  );
}

export function isSuccess(value: unknown): boolean {
  if (!isApiResponse(value)) return false;
  return SUCCESS_CODES.includes(value.code);
}

export function isUnauthorized(value: unknown): boolean {
  if (!isApiResponse(value)) return false;
  return UNAUTHORIZED_CODES.includes(value.code);
}

export type BizError = Error & {
  name: 'BizError';
  info: { code: number; msg: string; data: unknown };
};

export function createBizError(res: ApiResponse): BizError {
  const error = new Error(res.msg || '请求失败') as BizError;
  error.name = 'BizError';
  error.info = { code: res.code, msg: res.msg || '请求失败', data: res.data };
  return error;
}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd /d/project/ai-admin-com
npx vitest run src/services/response.test.ts
```

Expected: PASS —— 14 个用例全部通过

- [ ] **Step 7: 类型检查**

```bash
cd /d/project/ai-admin-com
npm run tsc
```

Expected: exit 0

- [ ] **Step 8: 提交**

```bash
git add src/services/http.ts src/services/types.ts src/services/response.ts src/services/response.test.ts
git commit -m "feat(services): 新增后端响应信封判定与公共类型

code 0/200 视为成功;401/10401 视为未授权。
业务码判定不依赖 success 标志,覆盖 SuccessResponse(code=400) 的情况。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: token 存取

**Files:**
- Create: `src/auth/token.ts`
- Test: `src/auth/token.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `AUTH_KEYS`(常量对象)
  - `isRememberMe(): boolean`
  - `getAccessToken(): string`
  - `getRefreshToken(): string`
  - `setTokens(accessToken: string, refreshToken: string, rememberMe: boolean): void`
  - `clearAuth(): void`

- [ ] **Step 1: 写失败测试**

创建 `src/auth/token.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_KEYS,
  clearAuth,
  getAccessToken,
  getRefreshToken,
  isRememberMe,
  setTokens,
} from './token';

describe('token storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('stores tokens in localStorage when rememberMe is true', () => {
    setTokens('access-1', 'refresh-1', true);

    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBe('access-1');
    expect(localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBe('refresh-1');
    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(isRememberMe()).toBe(true);
  });

  it('stores tokens in sessionStorage when rememberMe is false', () => {
    setTokens('access-2', 'refresh-2', false);

    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBe('access-2');
    expect(sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBe('refresh-2');
    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(isRememberMe()).toBe(false);
  });

  it('clears the other storage when switching rememberMe', () => {
    setTokens('a', 'r', true);
    setTokens('b', 'r2', false);

    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBe('b');
  });

  it('reads the token from the storage matching rememberMe', () => {
    setTokens('a', 'r', true);
    expect(getAccessToken()).toBe('a');
    expect(getRefreshToken()).toBe('r');

    setTokens('b', 'r2', false);
    expect(getAccessToken()).toBe('b');
    expect(getRefreshToken()).toBe('r2');
  });

  it('returns empty string when no token is stored', () => {
    expect(getAccessToken()).toBe('');
    expect(getRefreshToken()).toBe('');
  });

  it('clearAuth removes tokens from both storages', () => {
    setTokens('a', 'r', true);
    clearAuth();

    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REMEMBER_ME)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /d/project/ai-admin-com
npx vitest run src/auth/token.test.ts
```

Expected: FAIL —— `Cannot find module './token'`

- [ ] **Step 3: 实现**

创建 `src/auth/token.ts`:

```ts
export const AUTH_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  REMEMBER_ME: 'remember_me',
} as const;

/**
 * 是否勾选「记住我」。
 * 勾选 → token 存 localStorage(关掉浏览器仍在);未勾选 → 存 sessionStorage。
 */
export function isRememberMe(): boolean {
  return localStorage.getItem(AUTH_KEYS.REMEMBER_ME) === 'true';
}

export function getAccessToken(): string {
  return isRememberMe()
    ? localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN) || ''
    : sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN) || '';
}

export function getRefreshToken(): string {
  return isRememberMe()
    ? localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN) || ''
    : sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN) || '';
}

export function setTokens(
  accessToken: string,
  refreshToken: string,
  rememberMe: boolean,
): void {
  localStorage.setItem(AUTH_KEYS.REMEMBER_ME, String(rememberMe));

  if (rememberMe) {
    localStorage.setItem(AUTH_KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem(AUTH_KEYS.REFRESH_TOKEN, refreshToken);
    sessionStorage.removeItem(AUTH_KEYS.ACCESS_TOKEN);
    sessionStorage.removeItem(AUTH_KEYS.REFRESH_TOKEN);
    return;
  }

  sessionStorage.setItem(AUTH_KEYS.ACCESS_TOKEN, accessToken);
  sessionStorage.setItem(AUTH_KEYS.REFRESH_TOKEN, refreshToken);
  localStorage.removeItem(AUTH_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(AUTH_KEYS.REFRESH_TOKEN);
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(AUTH_KEYS.REFRESH_TOKEN);
  sessionStorage.removeItem(AUTH_KEYS.ACCESS_TOKEN);
  sessionStorage.removeItem(AUTH_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(AUTH_KEYS.REMEMBER_ME);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /d/project/ai-admin-com
npx vitest run src/auth/token.test.ts
```

Expected: PASS —— 6 个用例通过

- [ ] **Step 5: 提交**

```bash
git add src/auth/token.ts src/auth/token.test.ts
git commit -m "feat(auth): 新增 token 存取,按记住我切换 localStorage/sessionStorage

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 4: 菜单适配器

把后端菜单树转成 ProLayout 菜单项。这是「后端管显示、前端管路由」规则的落地点,纯函数,重点单测。

**Files:**
- Create: `src/menu/adapter.ts`
- Test: `src/menu/adapter.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface BackendMenu`(后端菜单节点)
  - `interface MenuItem`(ProLayout 菜单项)
  - `collectPermissions(menus: BackendMenu[], roles?: RoleLike[]): string[]`
  - `joinAbsolutePath(parentAbs: string, segment: string): string`
  - `collectPaths(items: RouteLike[]): Set<string>`
  - `buildMenuItems(backendMenus: BackendMenu[], knownPaths: Set<string>): MenuItem[]`

- [ ] **Step 1: 写失败测试**

创建 `src/menu/adapter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  buildMenuItems,
  collectPaths,
  collectPermissions,
  joinAbsolutePath,
  type BackendMenu,
} from './adapter';

const menu = (over: Partial<BackendMenu>): BackendMenu => ({
  id: 1,
  parent_id: null,
  name: '节点',
  type: 2,
  order: 1,
  permission: null,
  icon: null,
  route_name: null,
  route_path: '/x',
  component_path: null,
  hidden: false,
  status: 0,
  children: null,
  ...over,
});

describe('joinAbsolutePath', () => {
  it('joins a relative segment onto the parent', () => {
    expect(joinAbsolutePath('/system', 'user')).toBe('/system/user');
  });

  it('strips leading slashes from the segment', () => {
    expect(joinAbsolutePath('/system', '/user')).toBe('/system/user');
  });

  it('returns the parent when the segment is empty', () => {
    expect(joinAbsolutePath('/system', '')).toBe('/system');
  });

  it('does not double the separator', () => {
    expect(joinAbsolutePath('/system/', 'user')).toBe('/system/user');
  });
});

describe('collectPermissions', () => {
  it('collects permission codes from the whole tree', () => {
    const perms = collectPermissions([
      menu({ id: 1, type: 1, permission: 'module_system:user:query', children: [
        menu({ id: 2, type: 2, permission: 'module_system:user:create' }),
      ] }),
    ]);

    expect(perms.sort()).toEqual([
      'module_system:user:create',
      'module_system:user:query',
    ]);
  });

  it('includes permissions carried by roles', () => {
    const perms = collectPermissions(
      [menu({ id: 1, permission: 'a:query' })],
      [{ menus: [menu({ id: 9, permission: 'b:create' })] }],
    );

    expect(perms.sort()).toEqual(['a:query', 'b:create']);
  });

  it('deduplicates repeated permission codes', () => {
    const perms = collectPermissions([
      menu({ id: 1, permission: 'same' }),
      menu({ id: 2, permission: 'same' }),
    ]);

    expect(perms).toEqual(['same']);
  });

  it('ignores null permissions', () => {
    expect(collectPermissions([menu({ id: 1, permission: null })])).toEqual([]);
  });
});

describe('collectPaths', () => {
  it('collects paths including nested children', () => {
    const paths = collectPaths([
      { path: '/system', children: [{ path: '/system/user' }] },
    ]);

    expect([...paths].sort()).toEqual(['/system', '/system/user']);
  });
});

describe('buildMenuItems', () => {
  it('builds nested items and resolves relative child paths', () => {
    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 1,
          name: '系统管理',
          route_path: '/system',
          children: [
            menu({ id: 2, type: 2, name: '用户管理', route_path: 'user', permission: 'module_system:user:query' }),
          ],
        }),
      ],
      new Set(['/system', '/system/user']),
    );

    expect(items).toHaveLength(1);
    expect(items[0].path).toBe('/system');
    expect(items[0].children?.[0].path).toBe('/system/user');
    expect(items[0].children?.[0].name).toBe('用户管理');
  });

  it('skips button type menus', () => {
    const items = buildMenuItems(
      [menu({ id: 1, type: 3, name: '新增', route_path: '' })],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(0);
  });

  it('skips disabled and hidden menus', () => {
    const items = buildMenuItems(
      [
        menu({ id: 1, type: 2, route_path: '/a', status: 1 }),
        menu({ id: 2, type: 2, route_path: '/b', hidden: true }),
      ],
      new Set(['/a', '/b']),
    );

    expect(items).toHaveLength(0);
  });

  it('skips menus whose route is not registered in the frontend and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = buildMenuItems(
      [menu({ id: 1, type: 2, route_path: '/system/nope' })],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[menu] 前端缺少路由: /system/nope');
    warn.mockRestore();
  });

  it('keeps a directory even when its path is not a frontend route', () => {
    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 1,
          route_path: '/system',
          children: [menu({ id: 2, type: 2, route_path: '/system/user' })],
        }),
      ],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(1);
    expect(items[0].children?.[0].path).toBe('/system/user');
  });

  it('drops a directory whose children were all skipped', () => {
    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 1,
          route_path: '/system',
          children: [menu({ id: 2, type: 2, route_path: '/system/missing' })],
        }),
      ],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(0);
  });

  it('uses the backend title as the menu label', () => {
    const items = buildMenuItems(
      [menu({ id: 1, type: 2, name: '用户管理', title: '用户管理', route_path: '/system/user' })],
      new Set(['/system/user']),
    );

    expect(items[0].name).toBe('用户管理');
  });

  it('sorts siblings by order ascending', () => {
    const items = buildMenuItems(
      [
        menu({ id: 1, type: 2, name: 'B', route_path: '/b', order: 2 }),
        menu({ id: 2, type: 2, name: 'A', route_path: '/a', order: 1 }),
      ],
      new Set(['/a', '/b']),
    );

    expect(items.map((i) => i.name)).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /d/project/ai-admin-com
npx vitest run src/menu/adapter.test.ts
```

Expected: FAIL —— `Cannot find module './adapter'`

- [ ] **Step 3: 实现适配器**

创建 `src/menu/adapter.ts`:

```ts
/** 后端菜单节点(后端 backend/app/api/v1/module_system/menu/schema.py 的 MenuOutSchema) */
export interface BackendMenu {
  id?: number | null;
  parent_id?: number | null;
  name?: string | null;
  /** 1=目录 2=菜单 3=按钮 4=外链 */
  type?: number | null;
  order?: number | null;
  permission?: string | null;
  icon?: string | null;
  route_name?: string | null;
  route_path?: string | null;
  component_path?: string | null;
  hidden?: boolean | null;
  /** 后端是字符串("0" 启用 / "1" 停用),不是数字 */
  status?: number | string | null;
  title?: string | null;
  children?: BackendMenu[] | null;
}

/** 角色(后端 UserOutSchema.roles),菜单挂在角色下 */
export interface RoleLike {
  menus?: BackendMenu[] | null;
}

/** ProLayout 菜单项 */
export interface MenuItem {
  path: string;
  name: string;
  icon?: string;
  locale: false;
  children?: MenuItem[];
}

/** 前端路由派生的菜单节点(ProLayout 的 menuData) */
export interface RouteLike {
  path?: string;
  children?: RouteLike[];
}

const MENU_TYPE_DIRECTORY = 1;
const MENU_TYPE_BUTTON = 3;

/** 拼接绝对路径:parentAbs + 相对段 */
export function joinAbsolutePath(parentAbs: string, segment: string): string {
  const seg = segment.replace(/^\/+/, '');
  const base = parentAbs.replace(/\/$/, '');
  if (!seg) return base;
  return `${base}/${seg}`;
}

/** 递归收集权限码:菜单树 + 各角色携带的菜单 */
export function collectPermissions(
  menus: BackendMenu[],
  roles?: RoleLike[],
): string[] {
  const set = new Set<string>();

  const walk = (items: BackendMenu[] | null | undefined) => {
    for (const item of items ?? []) {
      if (item.permission) set.add(item.permission);
      if (item.children?.length) walk(item.children);
    }
  };

  walk(menus);
  for (const role of roles ?? []) walk(role.menus);

  return [...set];
}

/** 从前端路由派生的菜单中收集全部 path */
export function collectPaths(items: RouteLike[]): Set<string> {
  const paths = new Set<string>();

  const walk = (list: RouteLike[]) => {
    for (const item of list ?? []) {
      if (item.path) paths.add(item.path);
      if (item.children?.length) walk(item.children);
    }
  };

  walk(items);
  return paths;
}

/** 把后端菜单的 route_path 归一为绝对路径(相对路径拼父级) */
function normalizePaths(
  items: BackendMenu[],
  parentAbs = '',
): BackendMenu[] {
  return items.map((item) => {
    const raw = (item.route_path ?? '').trim();
    const canonical = raw
      ? raw.startsWith('/')
        ? raw
        : parentAbs
          ? joinAbsolutePath(parentAbs, raw)
          : `/${raw}`
      : parentAbs;

    const children = item.children?.length
      ? normalizePaths(item.children, canonical)
      : item.children;

    return { ...item, route_path: canonical, children };
  });
}

/**
 * 后端菜单树 → ProLayout 菜单项。
 *
 * 规则:
 * - 按钮(type=3)不生成菜单项
 * - 停用(status=1)与隐藏(hidden)跳过
 * - 目录(type=1)允许路径不在前端路由表中(它只是分组);
 *   菜单(type=2)路径必须已在前端注册,否则跳过并告警
 * - 目录下所有子项都被跳过时,目录本身也不渲染
 */
export function buildMenuItems(
  backendMenus: BackendMenu[],
  knownPaths: Set<string>,
): MenuItem[] {
  const normalized = normalizePaths(backendMenus);

  const build = (items: BackendMenu[]): MenuItem[] => {
    const result: MenuItem[] = [];

    for (const item of items) {
      if (item.type === MENU_TYPE_BUTTON) continue;
      if (String(item.status) === '1') continue;
      if (item.hidden) continue;

      const path = (item.route_path ?? '').trim();
      const hadChildren = (item.children?.length ?? 0) > 0;
      const children = build(item.children ?? []);

      const isDirectory = item.type === MENU_TYPE_DIRECTORY;

      if (!isDirectory && !knownPaths.has(path)) {
        console.warn(`[menu] 前端缺少路由: ${path}`);
        continue;
      }

      // 目录的所有子项都被跳过 → 目录也没有存在的意义
      if (isDirectory && hadChildren && children.length === 0) continue;

      if (!path && !isDirectory) continue;

      result.push({
        path,
        name: item.title || item.name || item.route_name || path,
        icon: item.icon || undefined,
        locale: false,
        ...(children.length > 0 ? { children } : {}),
      });
    }

    return result.sort((a, b) => 0);
  };

  const items = build(normalized);

  // 按 order 排序(后端已排序,这里兜底)
  const withOrder = normalized;
  void withOrder;

  return sortByOrder(items, normalized);
}

/** 依据原始菜单的 order 排序(顶层) */
function sortByOrder(items: MenuItem[], source: BackendMenu[]): MenuItem[] {
  const orderMap = new Map<number, number>();
  source.forEach((item, index) => {
    if (item.id != null) orderMap.set(item.id, item.order ?? index);
  });

  const orderOf = (item: MenuItem): number => {
    const found = source.find((s) => s.route_path === item.path);
    return found?.order ?? Number.MAX_SAFE_INTEGER;
  };

  return [...items].sort((a, b) => orderOf(a) - orderOf(b));
}
```

> ⚠ 上面 `build` 里那句 `.sort((a, b) => 0)` 是占位噪音,实现时**删掉它**,排序统一由 `sortByOrder` 负责(见 Step 3 的修正版)。为避免歧义,最终实现中 `build` 函数体内**不含任何 sort 调用**,`buildMenuItems` 末尾只调用一次 `sortByOrder(items, normalized)`。

- [ ] **Step 4: 修正排序实现**

上一步的 `sortByOrder` 通过 `route_path` 反查原始节点,遇到同路径会取第一个。更稳妥的做法是在归一化阶段就把 `order` 挂在结果对象上重写 `buildMenuItems`。**请按下面的最终版本替换整个 `buildMenuItems` + `sortByOrder`**(替换掉 Step 3 中的同名函数):

```ts
interface InternalMenu {
  item: BackendMenu;
  path: string;
  children: InternalMenu[];
  order: number;
}

function toInternal(items: BackendMenu[], parentAbs = ''): InternalMenu[] {
  return items.map((item) => {
    const raw = (item.route_path ?? '').trim();
    const path = raw
      ? raw.startsWith('/')
        ? raw
        : parentAbs
          ? joinAbsolutePath(parentAbs, raw)
          : `/${raw}`
      : parentAbs;

    return {
      item,
      path,
      children: item.children?.length ? toInternal(item.children, path) : [],
      order: item.order ?? 999,
    };
  });
}

export function buildMenuItems(
  backendMenus: BackendMenu[],
  knownPaths: Set<string>,
): MenuItem[] {
  const build = (nodes: InternalMenu[]): MenuItem[] => {
    const result: MenuItem[] = [];

    for (const node of nodes.sort((a, b) => a.order - b.order)) {
      const { item, path } = node;

      if (item.type === MENU_TYPE_BUTTON) continue;
      if (String(item.status) === '1') continue;
      if (item.hidden) continue;

      const children = build(node.children);
      const isDirectory = item.type === MENU_TYPE_DIRECTORY;
      const hadChildren = node.children.length > 0;

      if (!isDirectory && !knownPaths.has(path)) {
        console.warn(`[menu] 前端缺少路由: ${path}`);
        continue;
      }

      if (isDirectory && hadChildren && children.length === 0) continue;
      if (!path && !isDirectory) continue;

      result.push({
        path,
        name: item.title || item.name || item.route_name || path,
        icon: item.icon || undefined,
        locale: false,
        ...(children.length > 0 ? { children } : {}),
      });
    }

    return result;
  };

  return build(toInternal(backendMenus));
}
```

并**删除** `normalizePaths`、`sortByOrder` 两个函数(已被 `toInternal` 取代)。

- [ ] **Step 5: 运行测试确认通过**

```bash
cd /d/project/ai-admin-com
npx vitest run src/menu/adapter.test.ts
```

Expected: PASS —— 全部用例通过

- [ ] **Step 6: 类型检查 + 提交**

```bash
cd /d/project/ai-admin-com
npm run tsc && git add src/menu/adapter.ts src/menu/adapter.test.ts && git commit -m "feat(menu): 新增后端菜单树适配器

按钮/停用/隐藏节点跳过;菜单路径未在前端注册时跳过并告警;
目录下子项全被跳过时目录也不渲染;相对 route_path 拼父级归一。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 5: service 层

按后端模块手写 service。路径不带 `/api/v1`。

**Files:**
- Create: `src/services/api/system/types.ts`
- Create: `src/services/api/system/auth.ts`
- Create: `src/services/api/system/user.ts`
- Create: `src/services/api/platform/types.ts`
- Create: `src/services/api/platform/menu.ts`
- Test: `src/services/api/system/auth.test.ts`
- Test: `src/services/api/system/user.test.ts`

**Interfaces:**
- Consumes: `ApiResponse` / `PageQuery` / `PageResult`(`@/services/types`)
- Produces:
  - `getCaptcha(): Promise<ApiResponse<CaptchaOut>>`
  - `login(form: LoginForm): Promise<ApiResponse<LoginResult>>`
  - `refreshToken(refreshToken: string): Promise<ApiResponse<TokenPair>>`
  - `logout(token: string): Promise<ApiResponse<null>>`
  - `registerUser(params: UserRegisterParams): Promise<ApiResponse<UserOut>>`
  - `getCurrentUser(): Promise<ApiResponse<UserOut>>`
  - `listUsers(params): Promise<ApiResponse<PageResult<UserOut>>>`
  - `getUserDetail(id: number): Promise<ApiResponse<UserOut>>`
  - `createUser(params: UserCreateParams): Promise<ApiResponse<UserOut>>`
  - `updateUser(id: number, params: UserUpdateParams): Promise<ApiResponse<UserOut>>`
  - `deleteUsers(ids: number[]): Promise<ApiResponse<null>>`
  - `getMenuTree(params?): Promise<ApiResponse<BackendMenu[]>>`

- [ ] **Step 1: 写失败测试(auth)**

创建 `src/services/api/system/auth.test.ts`:

```ts
import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCaptcha, login, logout, refreshToken } from './auth';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system auth service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(request).mockResolvedValue({ code: 0, msg: 'ok', data: null, status_code: 200, success: true });
  });

  it('fetches the captcha from /system/auth/captcha/get', async () => {
    await getCaptcha();

    expect(request).toHaveBeenCalledWith('/system/auth/captcha/get', {
      method: 'GET',
    });
  });

  it('posts the login form as urlencoded body', async () => {
    await login({ username: 'admin', password: 'pw', captcha_key: 'k', captcha: '1234' });

    // umi 的 IRequest 是重载签名,Parameters<IRequest> 会塌缩成 [url: string],
    // 所以拆解 mock.calls[0] 需要显式标注元组类型
    type RequestCall = [string, Record<string, unknown> | undefined];
    const [url, options] = vi.mocked(request).mock.calls[0] as unknown as RequestCall;
    expect(url).toBe('/system/auth/login');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(String(options?.data)).toContain('username=admin');
    expect(String(options?.data)).toContain('password=pw');
    expect(String(options?.data)).toContain('captcha_key=k');
    expect(String(options?.data)).toContain('captcha=1234');
    // URLSearchParams 会把中文百分号编码,PC端 → PC%E7%AB%AF
    expect(String(options?.data)).toContain('login_type=PC%E7%AB%AF');
  });

  it('refreshes the token with the refresh token in the body', async () => {
    await refreshToken('refresh-1');

    expect(request).toHaveBeenCalledWith('/system/auth/token/refresh', {
      method: 'POST',
      data: { refresh_token: 'refresh-1' },
    });
  });

  it('logs out with the token in the body', async () => {
    await logout('access-1');

    expect(request).toHaveBeenCalledWith('/system/auth/logout', {
      method: 'POST',
      data: { token: 'access-1' },
    });
  });
});
```

- [ ] **Step 2: 写失败测试(user)**

创建 `src/services/api/system/user.test.ts`:

```ts
import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createUser,
  deleteUsers,
  getCurrentUser,
  listUsers,
  updateUser,
} from './user';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system user service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(request).mockResolvedValue({ code: 0, msg: 'ok', data: null, status_code: 200, success: true });
  });

  it('lists users with pagination params', async () => {
    await listUsers({ page_no: 1, page_size: 10, username: 'ad' });

    expect(request).toHaveBeenCalledWith('/system/user/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, username: 'ad' },
    });
  });

  it('gets the current user info', async () => {
    await getCurrentUser();

    expect(request).toHaveBeenCalledWith('/system/user/current/info', {
      method: 'GET',
    });
  });

  it('creates a user', async () => {
    await createUser({ username: 'u1', password: 'pw123456' });

    expect(request).toHaveBeenCalledWith('/system/user/create', {
      method: 'POST',
      data: { username: 'u1', password: 'pw123456' },
    });
  });

  it('updates a user by id', async () => {
    await updateUser(7, { username: 'u1' });

    expect(request).toHaveBeenCalledWith('/system/user/update/7', {
      method: 'PUT',
      data: { username: 'u1' },
    });
  });

  it('deletes users by id list', async () => {
    await deleteUsers([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/user/delete', {
      method: 'DELETE',
      data: { ids: [1, 2] },
    });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd /d/project/ai-admin-com
npx vitest run src/services/api/system/auth.test.ts src/services/api/system/user.test.ts
```

Expected: FAIL —— `Cannot find module './auth'` / `'./user'`

- [ ] **Step 4: 创建系统模块实体类型**

创建 `src/services/api/system/types.ts`:

```ts
import type { BackendMenu } from '@/menu/adapter';

/** 后端 UserOutSchema.roles(角色下挂菜单树) */
export interface UserRole {
  id?: number | null;
  name?: string | null;
  code?: string | null;
  /** 角色下挂的菜单树(collectPermissions 会连同顶层 menus 一起遍历) */
  menus?: BackendMenu[] | null;
}

/** 后端 UserOutSchema(用户列表/详情返回) */
export interface UserOut {
  id?: number | null;
  uuid?: string | null;
  username?: string | null;
  name?: string | null;
  mobile?: string | null;
  email?: string | null;
  gender?: string | null;
  avatar?: string | null;
  status?: number | null;
  description?: string | null;
  dept_id?: number | null;
  dept_name?: string | null;
  dept?: { id: number; name: string } | null;
  position_ids?: number[] | null;
  positions?: { id: number; name: string }[] | null;
  role_ids?: number[] | null;
  roles?: UserRole[] | null;
  /** 当前用户可见的菜单树(后端 UserOutSchema.menus) */
  menus?: BackendMenu[] | null;
  is_superuser?: boolean | null;
  tenant_id?: number | null;
  created_time?: string | null;
  updated_time?: string | null;
}

/** 后端 UserCreateSchema */
export interface UserCreateParams {
  username?: string;
  password?: string;
  name?: string;
  mobile?: string;
  email?: string;
  gender?: string;
  status?: number;
  description?: string;
  dept_id?: number | null;
  role_ids?: number[];
  position_ids?: number[];
  tenant_id?: number | null;
}

/** 后端 UserUpdateSchema */
export interface UserUpdateParams {
  username?: string;
  name?: string;
  mobile?: string;
  email?: string;
  gender?: string;
  status?: number;
  description?: string;
  dept_id?: number | null;
  role_ids?: number[];
  position_ids?: number[];
}

/** 后端 UserRegisterSchema */
export interface UserRegisterParams {
  username: string;
  password: string;
  name?: string;
  mobile?: string;
  role_ids?: number[];
  description?: string;
}

/** 后端 CaptchaOutSchema */
export interface CaptchaOut {
  /** 是否启用验证码 */
  enable: boolean;
  /** 验证码唯一标识,登录时作为 captcha_key 回传 */
  key: string;
  /** base64 编码的验证码图片(data URL) */
  img_base: string;
}

/** 后端 JWTOutSchema */
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/** 后端 TenantOptionSchema */
export interface TenantOption {
  id: number;
  name: string;
  code: string;
}

/** 后端 LoginWithTenantsSchema */
export interface LoginResult extends TokenPair {
  tenants: TenantOption[];
  user_info: Record<string, unknown>;
}

/** 登录表单 */
export interface LoginForm {
  username: string;
  password: string;
  captcha_key?: string;
  captcha?: string;
  login_type?: string;
}
```

- [ ] **Step 5: 实现 auth service**

创建 `src/services/api/system/auth.ts`:

```ts
import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/types';
import type { CaptchaOut, LoginForm, LoginResult, TokenPair } from './types';

/** 获取图形验证码 */
export async function getCaptcha() {
  return request<ApiResponse<CaptchaOut>>('/system/auth/captcha/get', {
    method: 'GET',
  });
}

/**
 * 登录。
 * 后端用的是 OAuth2PasswordRequestForm,必须以 form-urlencoded 提交,JSON 会 422。
 */
export async function login(form: LoginForm) {
  const body = new URLSearchParams({
    username: form.username,
    password: form.password,
    captcha_key: form.captcha_key ?? '',
    captcha: form.captcha ?? '',
    login_type: form.login_type ?? 'PC端',
  });

  return request<ApiResponse<LoginResult>>('/system/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: body.toString(),
  });
}

/** 刷新 token */
export async function refreshToken(token: string) {
  return request<ApiResponse<TokenPair>>('/system/auth/token/refresh', {
    method: 'POST',
    data: { refresh_token: token },
  });
}

/** 退出登录 */
export async function logout(token: string) {
  return request<ApiResponse<null>>('/system/auth/logout', {
    method: 'POST',
    data: { token },
  });
}
```

- [ ] **Step 6: 实现 user service**

创建 `src/services/api/system/user.ts`:

```ts
import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';
import type {
  UserCreateParams,
  UserOut,
  UserRegisterParams,
  UserUpdateParams,
} from './types';

export type UserListParams = Partial<PageQuery> & {
  username?: string;
  name?: string;
  mobile?: string;
  email?: string;
  dept_id?: number;
  status?: number;
};

/** 查询当前登录用户信息(含 menus 菜单树) */
export async function getCurrentUser() {
  return request<ApiResponse<UserOut>>('/system/user/current/info', {
    method: 'GET',
  });
}

/** 用户列表 */
export async function listUsers(params: UserListParams) {
  return request<ApiResponse<PageResult<UserOut>>>('/system/user/list', {
    method: 'GET',
    params,
  });
}

/** 用户详情 */
export async function getUserDetail(id: number) {
  return request<ApiResponse<UserOut>>(`/system/user/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建用户 */
export async function createUser(params: UserCreateParams) {
  return request<ApiResponse<UserOut>>('/system/user/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新用户 */
export async function updateUser(id: number, params: UserUpdateParams) {
  return request<ApiResponse<UserOut>>(`/system/user/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除用户(批量) */
export async function deleteUsers(ids: number[]) {
  return request<ApiResponse<null>>('/system/user/delete', {
    method: 'DELETE',
    data: { ids },
  });
}

/** 注册用户 */
export async function registerUser(params: UserRegisterParams) {
  return request<ApiResponse<UserOut>>('/system/user/register', {
    method: 'POST',
    data: params,
  });
}
```

- [ ] **Step 7: 创建平台菜单 service 与类型**

创建 `src/services/api/platform/types.ts`:

```ts
export type { BackendMenu } from '@/menu/adapter';
```

创建 `src/services/api/platform/menu.ts`:

```ts
import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/types';
import type { BackendMenu } from './types';

/** 查询菜单树(平台侧菜单管理,需要 module_platform:menu:query 权限) */
export async function getMenuTree(params?: {
  menu_client?: 'pc' | 'app';
  scope?: 'platform' | 'tenant';
  status?: number;
}) {
  return request<ApiResponse<BackendMenu[]>>('/platform/menu/tree', {
    method: 'GET',
    params,
  });
}
```

- [ ] **Step 8: 运行测试确认通过**

```bash
cd /d/project/ai-admin-com
npx vitest run src/services/api/system/auth.test.ts src/services/api/system/user.test.ts
```

Expected: PASS —— 全部通过

- [ ] **Step 9: 类型检查 + 提交**

```bash
cd /d/project/ai-admin-com
npm run tsc && git add src/services/api && git commit -m "feat(services): 新增 system / platform 手写 service 层

登录使用 form-urlencoded(后端 OAuth2PasswordRequestForm);
所有路径不带 /api/v1 前缀,由 baseURL 统一带。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 6: ProTable 分页适配器

后端分页字段与 ProTable 期望的不一致,统一在一层转换。

**Files:**
- Create: `src/services/paginate.ts`
- Test: `src/services/paginate.test.ts`

**Interfaces:**
- Consumes: `ApiResponse` / `PageQuery` / `PageResult`(`@/services/types`)
- Produces: `toProTableRequest<T>(api: (params: PageQuery) => Promise<ApiResponse<PageResult<T>>>) => (params: ProTableParams) => Promise<{ data: T[]; total: number; success: boolean }>`

- [ ] **Step 1: 写失败测试**

创建 `src/services/paginate.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { toProTableRequest } from './paginate';

describe('toProTableRequest', () => {
  it('maps ProTable current/pageSize to backend page_no/page_size', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [{ id: 1 }], total: 1, page_no: 2, page_size: 20, has_next: false },
      status_code: 200,
      success: true,
    });

    const request = toProTableRequest(api);
    await request({ current: 2, pageSize: 20 });

    expect(api).toHaveBeenCalledWith({ page_no: 2, page_size: 20 });
  });

  it('defaults to page 1 and 10 rows', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
      success: true,
    });

    await toProTableRequest(api)({});

    expect(api).toHaveBeenCalledWith({ page_no: 1, page_size: 10 });
  });

  it('maps backend items/total to ProTable data/total', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [{ id: 7 }], total: 42, page_no: 1, page_size: 10, has_next: true },
      status_code: 200,
      success: true,
    });

    const result = await toProTableRequest(api)({});

    expect(result.data).toEqual([{ id: 7 }]);
    expect(result.total).toBe(42);
    expect(result.success).toBe(true);
  });

  it('tolerates a null data payload', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: null,
      status_code: 200,
      success: true,
    });

    const result = await toProTableRequest(api)({});

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('passes through extra search params', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
      success: true,
    });

    await toProTableRequest(api)({ current: 1, pageSize: 10, username: 'ad' });

    expect(api).toHaveBeenCalledWith({ username: 'ad', page_no: 1, page_size: 10 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /d/project/ai-admin-com
npx vitest run src/services/paginate.test.ts
```

Expected: FAIL —— `Cannot find module './paginate'`

- [ ] **Step 3: 实现**

创建 `src/services/paginate.ts`:

```ts
import type { ApiResponse, PageQuery, PageResult } from './types';

/** ProTable request 回调收到的参数 */
export interface ProTableParams {
  current?: number;
  pageSize?: number;
  [key: string]: unknown;
}

/**
 * 把 ProTable 的 request 回调适配到后端分页协议。
 *
 * 后端分页参数是 page_no / page_size,响应是 { items, total };
 * ProTable 期望 current / pageSize 与 { data, total, success }
 * (见 @ant-design/pro-components 的 RequestData<T> = { data, success?, total? })。
 */
export function toProTableRequest<T>(
  api: (params: PageQuery) => Promise<ApiResponse<PageResult<T>>>,
) {
  return async (params: ProTableParams) => {
    const { current, pageSize, ...rest } = params;

    const res = await api({
      ...(rest as object),
      page_no: current ?? 1,
      page_size: pageSize ?? 10,
    });

    return {
      data: res?.data?.items ?? [],
      total: res?.data?.total ?? 0,
      success: res?.success ?? false,
    };
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /d/project/ai-admin-com
npx vitest run src/services/paginate.test.ts
```

Expected: PASS —— 5 个用例通过

- [ ] **Step 5: 提交**

```bash
git add src/services/paginate.ts src/services/paginate.test.ts
git commit -m "feat(services): 新增 ProTable 分页适配器

current/pageSize → page_no/page_size;items/total → data/total。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 7: 请求层重写

这是整个模板最核心的一环:对齐后端信封 + token 注入 + 401 静默刷新重放。

**Files:**
- Modify: `src/requestErrorConfig.ts`(完全重写)
- Modify: `src/requestErrorConfig.test.ts`(完全重写)

**Interfaces:**
- Consumes: `isApiResponse` / `isSuccess` / `isUnauthorized` / `createBizError`(`@/services/response`)、`getAccessToken` / `getRefreshToken` / `setTokens` / `clearAuth` / `isRememberMe`(`@/auth/token`)、`refreshToken`(`@/services/api/system/auth`)
- Produces: `errorConfig: RequestConfig`(导出名不变)

- [ ] **Step 1: 写失败测试**

**完全替换** `src/requestErrorConfig.test.ts`:

```ts
import { message } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorConfig } from './requestErrorConfig';

const mockRequest = vi.fn();
const mockHistoryReplace = vi.fn();

vi.mock('antd', () => ({
  message: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  notification: {
    open: vi.fn(),
  },
}));

vi.mock('@umijs/max', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
  getIntl: vi.fn(() => ({
    formatMessage: vi.fn(({ defaultMessage }: { defaultMessage: string }) => defaultMessage),
  })),
  history: {
    replace: (...args: unknown[]) => mockHistoryReplace(...args),
  },
  getRequestInstance: vi.fn(() => ({
    request: vi.fn().mockResolvedValue({ data: { code: 0, success: true } }),
  })),
}));

vi.mock('@/auth/token', () => ({
  AUTH_KEYS: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
    REMEMBER_ME: 'remember_me',
  },
  isRememberMe: vi.fn(() => true),
  getAccessToken: vi.fn(() => 'access-1'),
  getRefreshToken: vi.fn(() => 'refresh-1'),
  setTokens: vi.fn(),
  clearAuth: vi.fn(),
}));

describe('requestErrorConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requestInterceptors', () => {
    const interceptor = errorConfig.requestInterceptors?.[0] as (config: {
      url?: string;
      headers?: Record<string, unknown>;
    }) => { headers?: Record<string, unknown> };

    it('attaches the bearer token', () => {
      const result = interceptor({ url: '/system/user/list' });

      expect(result.headers?.Authorization).toBe('Bearer access-1');
    });

    it('does not attach a token to the login request', () => {
      const result = interceptor({ url: '/system/auth/login' });

      expect(result.headers?.Authorization).toBeUndefined();
    });

    it('does not attach a token to the refresh request', () => {
      const result = interceptor({ url: '/system/auth/token/refresh' });

      expect(result.headers?.Authorization).toBeUndefined();
    });

    it('does not attach a token to the captcha request', () => {
      const result = interceptor({ url: '/system/auth/captcha/get' });

      expect(result.headers?.Authorization).toBeUndefined();
    });
  });

  describe('responseInterceptors', () => {
    it('throws a BizError for a failed business code even on HTTP 200', async () => {
      const onFulfilled = errorConfig.responseInterceptors?.[0] as (
        response: unknown,
      ) => Promise<unknown>;

      await expect(
        onFulfilled({
          data: { code: 400, msg: '订单状态异常', data: null, status_code: 200, success: true },
          config: {},
        }),
      ).rejects.toMatchObject({ name: 'BizError', message: '订单状态异常' });
    });

    it('passes a successful envelope through untouched', async () => {
      const onFulfilled = errorConfig.responseInterceptors?.[0] as (
        response: unknown,
      ) => Promise<unknown>;

      const response = {
        data: { code: 0, msg: 'ok', data: { id: 1 }, status_code: 200, success: true },
        config: {},
      };

      await expect(onFulfilled(response)).resolves.toBe(response);
    });

    it('passes a non-envelope payload through untouched', async () => {
      const onFulfilled = errorConfig.responseInterceptors?.[0] as (
        response: unknown,
      ) => Promise<unknown>;

      const response = { data: 'plain text', config: {} };

      await expect(onFulfilled(response)).resolves.toBe(response);
    });
  });

  describe('errorHandler', () => {
    const errorHandler = errorConfig.errorConfig?.errorHandler as (
      error: unknown,
      opts?: unknown,
    ) => void;

    it('rethrows when skipErrorHandler is set', () => {
      expect(() => errorHandler(new Error('boom'), { skipErrorHandler: true })).toThrow('boom');
    });

    it('shows the backend message for a BizError', () => {
      const error: any = new Error('验证码不能为空');
      error.name = 'BizError';
      error.info = { code: -1, msg: '验证码不能为空', data: null };

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('验证码不能为空');
    });

    it('shows a permission specific message for code 403', () => {
      const error: any = new Error('访问受限');
      error.name = 'BizError';
      error.info = { code: 403, msg: '访问受限', data: null };

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('无权限访问');
    });

    it('reads the envelope of an HTTP 500 business error', () => {
      const error: any = new Error('Request failed');
      error.response = {
        status: 500,
        data: { code: -1, msg: '验证码不能为空', data: null, status_code: 500, success: false },
      };

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('验证码不能为空');
    });

    it('falls back to a status message when the error body has no envelope', () => {
      const error: any = new Error('Request failed');
      error.response = { status: 502, data: {} };

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('服务异常 (502)');
    });

    it('reports offline errors', () => {
      const error: any = new Error('Network error');
      error.request = {};

      const originalOnLine = navigator.onLine;
      Object.defineProperty(navigator, 'onLine', { writable: true, value: false });

      try {
        errorHandler(error, {});
        expect(message.error).toHaveBeenCalledWith(
          '网络不可用，请检查连接后重试。',
        );
      } finally {
        Object.defineProperty(navigator, 'onLine', { writable: true, value: originalOnLine });
      }
    });

    it('reports generic network errors', () => {
      const error: any = new Error('Network error');
      error.request = {};

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('网络连接异常，请稍后重试');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /d/project/ai-admin-com
npx vitest run src/requestErrorConfig.test.ts
```

Expected: FAIL —— 旧实现没有 `responseInterceptors`,token 也没注入

- [ ] **Step 3: 重写请求层**

**完全替换** `src/requestErrorConfig.ts`:

```ts
import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { getIntl, getRequestInstance, history } from '@umijs/max';
import { message } from 'antd';
import { clearAuth, getAccessToken, isRememberMe, setTokens } from '@/auth/token';
import { refreshToken } from '@/services/api/system/auth';
import {
  createBizError,
  isApiResponse,
  isSuccess,
  isUnauthorized,
} from '@/services/response';
import type { ApiResponse } from '@/services/types';

/** 不需要注入 token 的接口 */
const AUTH_FREE_PATHS = [
  '/system/auth/login',
  '/system/auth/token/refresh',
  '/system/auth/captcha/get',
];

/** 重放标记:防止刷新后仍然 401 时无限递归 */
const RETRIED_FLAG = '__aiadminRetried';

/** 刷新中的 promise,让并发 401 共享同一次刷新 */
let refreshPromise: Promise<string> | null = null;

function redirectToLogin() {
  const { pathname, search, hash } = window.location;

  // 已经在登录页就不再跳,避免叠加 redirect 参数
  if (pathname === '/user/login') return;

  history.replace(
    `/user/login?redirect=${encodeURIComponent(pathname + search + hash)}`,
  );
}

function createUnauthorizedError() {
  const error = new Error('登录状态已失效，请重新登录') as Error & {
    name: string;
  };
  error.name = 'UnauthorizedError';
  return error;
}

/** 用 refresh_token 换新的 access_token */
async function doRefresh(): Promise<string> {
  const res = await refreshToken(getRefreshTokenForRefresh());
  const pair = res?.data;

  if (!pair?.access_token) {
    throw new Error('刷新令牌失败');
  }

  setTokens(pair.access_token, pair.refresh_token, isRememberMe());
  return pair.access_token;
}

// 单独抽出,便于测试时 mock
function getRefreshTokenForRefresh(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return getRefreshTokenImpl();
}

// 运行时绑定,避免顶层 import 循环
let getRefreshTokenImpl: () => string = () => '';

export function __setRefreshTokenProvider(fn: () => string) {
  getRefreshTokenImpl = fn;
}

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * 未授权的统一处理:刷新 token → 重放原请求。
 * 刷新失败则清理登录态并跳转登录页。
 */
async function handleUnauthorized(config: any): Promise<any> {
  const url = String(config?.url ?? '');

  if (config?.[RETRIED_FLAG]) throw createUnauthorizedError();
  if (url.includes('/system/auth/token/refresh')) throw createUnauthorizedError();

  let token: string;
  try {
    token = await refreshAccessToken();
  } catch (error) {
    // 刷新接口有响应 = 服务端明确拒绝 = 登录态确实失效 → 清 token 跳登录
    // 刷新接口无响应 = 纯网络故障 → 不登出,把错误抛给调用方
    if (error?.response) throw createUnauthorizedError();
    throw error;
  }

  return getRequestInstance().request({
    ...config,
    [RETRIED_FLAG]: true,
    headers: {
      ...(config?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

export const errorConfig: RequestConfig = {
  errorConfig: {
    /**
     * 错误接收及处理。
     *
     * 注意:业务码判定放在 responseInterceptors 的 fulfilled 分支,
     * 因为后端存在 success=true 但 code 是错误值(如 SuccessResponse(code=400))的响应,
     * umi 内置的 errorThrower 只在 success === false 时触发,会漏判。
     */
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error;

      // 刷新失败导致的未授权
      if (error?.name === 'UnauthorizedError') {
        clearAuth();
        redirectToLogin();
        return;
      }

      // 业务错误
      if (error?.name === 'BizError') {
        const info = error.info;
        if (info?.code === 403) {
          message.error('无权限访问');
          return;
        }
        message.error(info?.msg || '请求失败');
        return;
      }

      // axios 错误:可能有业务信封(后端业务错误常返回 HTTP 500)
      if (error?.response) {
        const body = error.response.data;
        if (isApiResponse(body)) {
          message.error(body.msg || '请求失败');
          return;
        }
        message.error(`服务异常 (${error.response.status})`);
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        message.error(
          getIntl().formatMessage({
            id: 'app.request.offline',
            defaultMessage: '网络不可用，请检查连接后重试。',
          }),
        );
        return;
      }

      message.error('网络连接异常，请稍后重试');
    },
  },

  // 请求拦截器:注入 Bearer token
  requestInterceptors: [
    (config: RequestOptions) => {
      const url = String(config.url ?? '');

      if (!AUTH_FREE_PATHS.some((path) => url.includes(path))) {
        const token = getAccessToken();
        if (token) {
          config.headers = {
            ...(config.headers as Record<string, unknown> | undefined),
            Authorization: `Bearer ${token}`,
          } as RequestOptions['headers'];
        }
      }

      return config;
    },
  ],

  // 响应拦截器:业务码校验 + 401 静默刷新重放
  responseInterceptors: [
    async (response: any) => {
      const body = response?.data;

      if (isApiResponse(body) && !isSuccess(body)) {
        if (isUnauthorized(body)) {
          return handleUnauthorized(response.config);
        }
        throw createBizError(body as ApiResponse);
      }

      // 成功提示:非 GET 且不是登录/登出/刷新这类机制性接口
      const method = String(response?.config?.method ?? 'GET').toUpperCase();
      const url = String(response?.config?.url ?? '');
      if (
        isApiResponse(body) &&
        body.msg &&
        method !== 'GET' &&
        !url.includes('login') &&
        !url.includes('logout') &&
        !url.includes('token/refresh')
      ) {
        message.success(body.msg);
      }

      return response;
    },
    async (error: any) => {
      if (
        error?.response?.status === 401 ||
        isUnauthorized(error?.response?.data)
      ) {
        return handleUnauthorized(error.config);
      }
      throw error;
    },
  ],
};
```

- [ ] **Step 4: 简化 refresh token 取值(移除占位 provider)**

上面的 `getRefreshTokenForRefresh` / `__setRefreshTokenProvider` 是过渡产物,**请改为直接从 `@/auth/token` 导入 `getRefreshToken`**,并删除这两个辅助函数:

```ts
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  isRememberMe,
  setTokens,
} from '@/auth/token';
```

`doRefresh` 改为:

```ts
async function doRefresh(): Promise<string> {
  const res = await refreshToken(getRefreshToken());
  const pair = res?.data;

  if (!pair?.access_token) {
    throw new Error('刷新令牌失败');
  }

  setTokens(pair.access_token, pair.refresh_token, isRememberMe());
  return pair.access_token;
}
```

同时删除 `getRefreshTokenForRefresh` 与 `__setRefreshTokenProvider` 两个函数。

- [ ] **Step 5: 运行测试确认通过**

```bash
cd /d/project/ai-admin-com
npx vitest run src/requestErrorConfig.test.ts
```

Expected: PASS —— 全部通过

- [ ] **Step 6: 补充 401 刷新重放的专项测试**

在 `src/requestErrorConfig.test.ts` 末尾追加:

```ts
describe('401 silent refresh and replay', () => {
  it('refreshes the token and replays the original request on HTTP 401', async () => {
    const { getRequestInstance } = await import('@umijs/max');
    const instanceRequest = vi.fn().mockResolvedValue({ data: { code: 0, success: true } });
    vi.mocked(getRequestInstance).mockReturnValue({
      request: instanceRequest,
    } as any);

    mockRequest.mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 43200 },
      status_code: 200,
      success: true,
    });

    const onRejected = errorConfig.responseInterceptors?.[1] as (
      error: unknown,
    ) => Promise<unknown>;

    await onRejected({
      response: { status: 401 },
      config: { url: '/system/user/list', headers: {} },
    });

    expect(mockRequest).toHaveBeenCalledWith(
      '/system/auth/token/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(instanceRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/system/user/list',
        // token 在 headers 里 —— axios 只从 config.headers.Authorization 读取
        headers: expect.objectContaining({
          Authorization: 'Bearer new-access',
        }),
      }),
    );
  });

  it('does not replay twice when the retried request is still unauthorized', async () => {
    const onRejected = errorConfig.responseInterceptors?.[1] as (
      error: unknown,
    ) => Promise<unknown>;

    await expect(
      onRejected({
        response: { status: 401 },
        config: { url: '/system/user/list', __aiadminRetried: true },
      }),
    ).rejects.toMatchObject({ name: 'UnauthorizedError' });
  });
});
```

- [ ] **Step 7: 运行全部测试**

```bash
cd /d/project/ai-admin-com
npx vitest run
```

Expected: 全部通过(包含 antd-pro 自带的既有测试)

- [ ] **Step 8: 类型检查 + 提交**

```bash
cd /d/project/ai-admin-com
npm run tsc && npm run biome:lint && git add src/requestErrorConfig.ts src/requestErrorConfig.test.ts && git commit -m "feat(request): 重写请求层,对齐后端响应信封

- 业务码判定放 responseInterceptors fulfilled 分支,覆盖 success=true 但 code 错误的情况
- 错误处理读响应体信封,兼容业务错误返回 HTTP 500
- requestInterceptors 注入 Bearer token,登录/刷新/验证码接口跳过
- 401 静默刷新 + 并发去重 + 原请求重放,__aiadminRetried 防递归

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 8: 会话层

**Files:**
- Create: `src/auth/session.ts`
- Test: `src/auth/session.test.ts`

**Interfaces:**
- Consumes: `login` / `refreshToken` / `logout` / `getCurrentUser`(`@/services/api/system/*`)、`setTokens` / `clearAuth` / `getAccessToken` / `isRememberMe`(`@/auth/token`)
- Produces:
  - `loginWithSession(form: LoginForm, rememberMe: boolean): Promise<ApiResponse<LoginResult>>`
  - `fetchCurrentUser(): Promise<UserOut>`
  - `logoutAndClear(): Promise<void>`
  - `refreshSession(): Promise<string>`

- [ ] **Step 1: 写失败测试**

创建 `src/auth/session.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loginWithSession, logoutAndClear } from './session';

const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockSetTokens = vi.fn();
const mockClearAuth = vi.fn();

vi.mock('@/services/api/system/auth', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
  refreshToken: vi.fn(),
}));

vi.mock('@/services/api/system/user', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

vi.mock('@/auth/token', () => ({
  AUTH_KEYS: { ACCESS_TOKEN: 'access_token', REFRESH_TOKEN: 'refresh_token', REMEMBER_ME: 'remember_me' },
  isRememberMe: vi.fn(() => true),
  getAccessToken: vi.fn(() => 'access-1'),
  getRefreshToken: vi.fn(() => 'refresh-1'),
  setTokens: (...args: unknown[]) => mockSetTokens(...args),
  clearAuth: (...args: unknown[]) => mockClearAuth(...args),
}));

describe('session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loginWithSession', () => {
    it('stores the tokens with the rememberMe flag', async () => {
      mockLogin.mockResolvedValue({
        code: 0,
        msg: 'ok',
        data: {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 43200,
          tenants: [],
          user_info: {},
        },
        status_code: 200,
        success: true,
      });

      await loginWithSession({ username: 'admin', password: 'pw' }, true);

      expect(mockSetTokens).toHaveBeenCalledWith('access-1', 'refresh-1', true);
    });

    it('throws when the backend returns no access token', async () => {
      mockLogin.mockResolvedValue({
        code: 0,
        msg: 'ok',
        data: null,
        status_code: 200,
        success: true,
      });

      await expect(
        loginWithSession({ username: 'admin', password: 'pw' }, false),
      ).rejects.toThrow('登录响应缺少 access_token');
    });
  });

  describe('logoutAndClear', () => {
    it('calls the backend and clears local auth', async () => {
      mockLogout.mockResolvedValue({ code: 0, msg: 'ok', data: null, status_code: 200, success: true });

      await logoutAndClear();

      expect(mockLogout).toHaveBeenCalledWith('access-1');
      expect(mockClearAuth).toHaveBeenCalled();
    });

    it('clears local auth even when the backend call fails', async () => {
      mockLogout.mockRejectedValue(new Error('network down'));

      await logoutAndClear();

      expect(mockClearAuth).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /d/project/ai-admin-com
npx vitest run src/auth/session.test.ts
```

Expected: FAIL —— `Cannot find module './session'`

- [ ] **Step 3: 实现**

创建 `src/auth/session.ts`:

```ts
import {
  getAccessToken,
  getRefreshToken,
  clearAuth,
  isRememberMe,
  setTokens,
} from '@/auth/token';
import {
  login as loginApi,
  logout as logoutApi,
  refreshToken as refreshTokenApi,
} from '@/services/api/system/auth';
import { getCurrentUser } from '@/services/api/system/user';
import type { LoginForm, LoginResult, UserOut } from '@/services/api/system/types';
import type { ApiResponse } from '@/services/types';

/**
 * 登录:调后端拿 token 并落盘。
 * rememberMe 决定 token 存 localStorage 还是 sessionStorage。
 */
export async function loginWithSession(
  form: LoginForm,
  rememberMe: boolean,
): Promise<ApiResponse<LoginResult>> {
  const res = await loginApi(form);
  const result = res?.data;

  if (!result?.access_token) {
    throw new Error('登录响应缺少 access_token');
  }

  setTokens(result.access_token, result.refresh_token, rememberMe);
  return res;
}

/** 取当前登录用户(含 menus 菜单树) */
export async function fetchCurrentUser(): Promise<UserOut> {
  const res = await getCurrentUser();
  return res.data as UserOut;
}

/** 退出登录:先通知后端,再清本地登录态(后端失败也要清) */
export async function logoutAndClear(): Promise<void> {
  try {
    await logoutApi(getAccessToken());
  } catch {
    // 后端不可达时也要清掉本地登录态
  } finally {
    clearAuth();
  }
}

/** 刷新 token,成功返回新的 access_token */
export async function refreshSession(): Promise<string> {
  const res = await refreshTokenApi(getRefreshToken());
  const pair = res?.data;

  if (!pair?.access_token) {
    throw new Error('刷新令牌失败');
  }

  setTokens(pair.access_token, pair.refresh_token, isRememberMe());
  return pair.access_token;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /d/project/ai-admin-com
npx vitest run src/auth/session.test.ts
```

Expected: PASS —— 4 个用例通过

- [ ] **Step 5: 提交**

```bash
git add src/auth/session.ts src/auth/session.test.ts
git commit -m "feat(auth): 新增会话层(登录/取用户/登出/刷新)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 9: 权限判定与前端路由表

**Files:**
- Modify: `src/access.ts`
- Modify: `src/access.test.ts`(完全重写)
- Modify: `config/routes.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `access(initialState)` 返回 `{ canAdmin: boolean; hasPermission: (code: string) => boolean }`
  - `config/routes.ts` 新增 `/system/user` 路由,菜单 key 为 `system` / `user`

- [ ] **Step 1: 写失败测试**

**完全替换** `src/access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import access from './access';

describe('access', () => {
  it('grants a permission code present in the permission list', () => {
    const result = access({
      currentUser: { username: 'admin' },
      permissions: ['module_system:user:query', 'module_system:user:create'],
    });

    expect(result.hasPermission('module_system:user:query')).toBe(true);
    expect(result.hasPermission('module_system:user:create')).toBe(true);
  });

  it('denies a permission code that is absent', () => {
    const result = access({
      currentUser: { username: 'u' },
      permissions: ['module_system:user:query'],
    });

    expect(result.hasPermission('module_system:user:create')).toBe(false);
  });

  it('denies everything when there are no permissions', () => {
    const result = access({ currentUser: { username: 'u' }, permissions: [] });

    expect(result.hasPermission('module_system:user:query')).toBe(false);
  });

  it('denies everything when initialState is undefined', () => {
    const result = access(undefined);

    expect(result.hasPermission('module_system:user:query')).toBe(false);
    expect(result.canAdmin).toBe(false);
  });

  it('treats a superuser as admin', () => {
    const result = access({ currentUser: { is_superuser: true } });

    expect(result.canAdmin).toBe(true);
  });

  it('does not treat a normal user as admin', () => {
    const result = access({ currentUser: { is_superuser: false } });

    expect(result.canAdmin).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /d/project/ai-admin-com
npx vitest run src/access.test.ts
```

Expected: FAIL —— 旧实现没有 `hasPermission`

- [ ] **Step 3: 重写 access.ts**

**完全替换** `src/access.ts`:

```ts
import type { BackendMenu } from '@/menu/adapter';

/**
 * umi access 插件的权限判定。
 *
 * - canAdmin:超级管理员
 * - hasPermission(code):按钮级权限码,取自后端菜单的 permission 字段
 */
export default function access(initialState:
  | {
      currentUser?: { is_superuser?: boolean | null; [key: string]: unknown } | null;
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

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /d/project/ai-admin-com
npx vitest run src/access.test.ts
```

Expected: PASS —— 6 个用例通过

- [ ] **Step 5: 在 config/routes.ts 增加业务路由**

编辑 `config/routes.ts`,在导出的路由数组中**加入**下面这段(放在 `/welcome` 之后、`/admin` 之前):

```ts
  {
    path: '/system',
    name: 'system',
    icon: 'setting',
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

> `name` 必须与后端菜单的 `route_name` 对齐(`system` / `user`),这样 ProLayout 的 i18n key `menu.system` / `menu.user` 才不会串。

- [ ] **Step 6: 补齐 i18n 菜单文案**

编辑 `src/locales/zh-CN/menu.ts` 与 `src/locales/en-US/menu.ts`,追加:

```ts
  'menu.system': '系统管理',
  'menu.system.user': '用户管理',
```

(en-US 里对应写 `'System Management'` / `'Users'`)

- [ ] **Step 7: 类型检查 + 提交**

```bash
cd /d/project/ai-admin-com
npm run tsc && git add src/access.ts src/access.test.ts config/routes.ts src/locales && git commit -m "feat(access): 权限判定改为后端权限码,并新增 /system/user 路由

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 10: app.tsx 集成

把前面所有部件接到 umi 运行时上:拉用户信息、渲染后端菜单、设置 baseURL。

**Files:**
- Modify: `src/app.tsx`
- Modify: `src/pages/user/login/index.tsx`(登录成功后要把 menus/permissions 一起写回 initialState)
- Modify: `src/app.test.tsx`(原用例 mock 的是 `@/services/ant-design-pro/api`,必须整体重写)
- Modify: `src/menu/adapter.ts` + `src/menu/adapter.test.ts`(菜单图标改用前端路由表的图标,见 Step 2)

**Interfaces:**
- Consumes: `fetchCurrentUser`(`@/auth/session`)、`collectPermissions` / `collectPaths` / `collectRouteIcons` / `buildMenuItems`(`@/menu/adapter`)、`API_BASE_URL`(`@/services/http`)、`UserOut`(`@/services/api/system/types`)
- Produces: `getInitialState()` 返回 `{ currentUser?, menus?, permissions?, settings?, fetchUserInfo? }`;`layout` 暴露 `menuDataRender`

- [ ] **Step 1: 改写 src/app.tsx 的 import 与 getInitialState**

编辑 `src/app.tsx`:

```ts
import { LinkOutlined } from '@ant-design/icons';
import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history, Link } from '@umijs/max';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import React from 'react';

import { fetchCurrentUser } from '@/auth/session';
import {
  AvatarDropdown,
  ErrorBoundary,
  Footer,
  LangDropdown,
  OfflineBanner,
  VersionDropdown,
} from '@/components';
import {
  buildMenuItems,
  collectPaths,
  collectPermissions,
  collectRouteIcons,
} from '@/menu/adapter';
import type { BackendMenu } from '@/menu/adapter';
import { API_BASE_URL } from '@/services/http';
import type { UserOut } from '@/services/api/system/types';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

const isDev = process.env.NODE_ENV === 'development';
const loginPath = '/user/login';
const authFreePaths = [loginPath, '/user/register', '/user/register-result'];

/** 与后端用户信息绑定的初始状态片段 */
export interface UserState {
  currentUser?: UserOut;
  menus?: BackendMenu[];
  permissions?: string[];
}

/**
 * @see https://umijs.org/docs/api/runtime-config#getinitialstate
 */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: UserOut;
  menus?: BackendMenu[];
  permissions?: string[];
  fetchUserInfo?: () => Promise<UserState | undefined>;
  settingDrawerOpen?: boolean;
}> {
  const loadUserInfo = async (): Promise<UserState | undefined> => {
    try {
      const info = await fetchCurrentUser();
      return {
        currentUser: info,
        menus: info?.menus ?? [],
        permissions: collectPermissions(info?.menus ?? [], info?.roles ?? []),
      };
    } catch (_error) {
      const { pathname, search, hash } = history.location;
      history.replace(
        `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
      );
    }
    return undefined;
  };

  const { location } = history;

  const base = {
    fetchUserInfo: loadUserInfo,
    settings: defaultSettings as Partial<LayoutSettings>,
    settingDrawerOpen: false,
  };

  if (authFreePaths.includes(location.pathname)) {
    return base;
  }

  const userState = await loadUserInfo();
  return { ...base, ...userState };
}
```

> 说明:`currentUser` 用后端的 `UserOut`(`@/services/api/system/types`),不要用 antd-pro 遗留的
> `API.CurrentUser`(那个命名空间来自 `src/services/ant-design-pro/typings.d.ts`,Task 13 会把它改名,
> 而且里面没有 `is_superuser` / `menus`)。

- [ ] **Step 2: 菜单图标改用前端路由表的图标(改 src/menu/adapter.ts)**

**为什么**:后端下发的 `icon` 是 **Remix Icon 类名**(如 `ri:user-line`、`ri:settings-2-line`),
antd/ProLayout 不认识。ProLayout 的 `getIcon()`
(`node_modules/@ant-design/pro-components/es/layout/components/SiderMenu/BaseMenu.js:44-61`)
只对「URL / 图片 / `icon-` 前缀的 iconfont」做特殊处理,其余字符串**原样返回**,
于是 `ri:user-line` 会作为**文本**渲染在侧边栏里。

而前端路由表的图标是可用的:umi 的 `patchRoutes`(`src/.umi/plugin-layout/runtime.tsx`)
会把路由上的 antd 图标名(`user` → `UserOutlined`)换成真正的图标 ReactElement,
所以 ProLayout 派生出来的 `menuData` 里 `icon` 已经是 **ReactNode**。

⇒ **图标归前端路由表管**,后端只管「显示哪些 / 标题 / 排序」。

改 `src/menu/adapter.ts`:

```ts
import type { ReactNode } from 'react';
```

把 `MenuItem` 与 `RouteLike` 改成:

```ts
/** ProLayout 菜单项 */
export interface MenuItem {
  path: string;
  name: string;
  icon?: ReactNode;
  locale: false;
  children?: MenuItem[];
}

/** 前端路由派生的菜单节点(ProLayout 的 menuData) */
export interface RouteLike {
  path?: string;
  icon?: ReactNode;
  children?: RouteLike[];
}
```

新增一个收集函数(放在 `collectPaths` 后面):

```ts
/**
 * 收集前端路由派生的菜单图标:path → ReactNode。
 *
 * 图标由前端路由表决定:后端下发的 icon 是 Remix Icon 类名(ri:xxx),
 * ProLayout 认不出来,会当作文本直接显示。
 */
export function collectRouteIcons(items: RouteLike[]): Map<string, ReactNode> {
  const icons = new Map<string, ReactNode>();

  const walk = (list: RouteLike[]) => {
    for (const item of list ?? []) {
      if (item.path && item.icon) icons.set(item.path, item.icon);
      if (item.children?.length) walk(item.children);
    }
  };

  walk(items);
  return icons;
}
```

把 `buildMenuItems` 的签名与 `icon` 赋值改成:

```ts
export function buildMenuItems(
  backendMenus: BackendMenu[],
  knownPaths: Set<string>,
  routeIcons?: Map<string, ReactNode>,
): MenuItem[] {
  // ... 其余逻辑不变 ...
        result.push({
          path,
          name: item.title || item.name || item.route_name || path,
          icon: routeIcons?.get(path),
          locale: false,
          ...(children.length > 0 ? { children } : {}),
        });
```

> `routeIcons` 是可选参数,不传时菜单项没有图标 —— 老调用方(`adapter.test.ts` 里已有的 22 个用例)
> 不受影响。`icon` 不再取后端的 `item.icon`。

在 `src/menu/adapter.test.ts` 里补两条用例(同时把 `collectRouteIcons` 加进文件顶部的 import):

```ts
import {
  type BackendMenu,
  buildMenuItems,
  collectPaths,
  collectPermissions,
  collectRouteIcons,
  joinAbsolutePath,
} from './adapter';
```

```ts
  it('collects the route icons by path', () => {
    const icons = collectRouteIcons([
      { path: '/system', icon: 'SettingOutlined' },
      { path: '/system/user', icon: 'UserOutlined' },
    ]);

    expect(icons.get('/system')).toBe('SettingOutlined');
    expect(icons.get('/system/user')).toBe('UserOutlined');
  });

  it('uses the frontend route icon instead of the backend icon', () => {
    const items = buildMenuItems(
      [menu({ route_path: '/system/user', icon: 'ri:user-line' })],
      new Set(['/system/user']),
      new Map([['/system/user', 'UserOutlined']]),
    );

    expect(items[0].icon).toBe('UserOutlined');
  });
```

(`menu()` 是该测试文件里已有的造数辅助函数,`icon` 字段名与 `BackendMenu` 一致。)

跑测试:

```bash
cd /d/project/ai-admin-com
npx vitest run src/menu/adapter.test.ts
```

Expected: 全部通过(22 + 2 = 24 条)。

- [ ] **Step 3: 在 layout 中接入 menuDataRender**

在 `export const layout: RunTimeLayoutConfig = ({ initialState, setInitialState }) => {` 的返回对象里,**加入** `menuDataRender`:

```ts
    /**
     * 菜单由后端下发:后端决定「显示哪些」,前端路由表决定「能点开什么」。
     * menuData 是 ProLayout 从 config/routes.ts 派生的菜单,用它做前端路由存在性校验,
     * 顺便取前端路由表的图标(后端的 icon 是 Remix Icon 名,ProLayout 渲染不出来)。
     */
    menuDataRender: (menuData) => {
      const knownPaths = collectPaths(menuData);
      const routeIcons = collectRouteIcons(menuData);
      return buildMenuItems(initialState?.menus ?? [], knownPaths, routeIcons);
    },
```

> 若 `collectPaths(menuData)` 报类型不兼容(`MenuDataItem[]` → `RouteLike[]` 的递归 children),
> 改成 `collectPaths(menuData as unknown as RouteLike[])` 并 `import type { RouteLike } from '@/menu/adapter'`。

- [ ] **Step 4: 设置 request.baseURL**

把 `src/app.tsx` 底部的 request 配置改为:

```ts
export const request: RequestConfig = {
  baseURL: API_BASE_URL,
  ...errorConfig,
};
```

(删除原来 `baseURL: isDev ? '' : 'https://pro-api.ant-design-demo.workers.dev'` 的写法)

- [ ] **Step 5: avatarProps 改成真实用户信息**

`layout` 里现在写死了 `'ProUser'`,改成后端返回的用户:

```ts
    avatarProps: {
      // UserOut.avatar 是 string | null,ProLayout 的 src 只接受 string | undefined
      src: initialState?.currentUser?.avatar ?? undefined,
      title:
        initialState?.currentUser?.name ??
        initialState?.currentUser?.username ??
        '用户',
      render: (_, avatarChildren) => (
        <AvatarDropdown>{avatarChildren}</AvatarDropdown>
      ),
    },
```

- [ ] **Step 6: 移除指向 antd-pro 官网的链接**

在 `layout` 的 `actionsRender` 中删掉 `<DocLink key="doc" />`,并从 `@/components` 的 import 列表里移除 `DocLink`。

在 `links` 里把 antd-pro OpenAPI 文档链接换成后端的 Swagger 地址:

```ts
    links: isDev
      ? [
          <a
            key="swagger"
            href="https://www.pmdict.cn/api/v1/docs"
            target="_blank"
            rel="noreferrer"
          >
            <LinkOutlined />
            <span>接口文档</span>
          </a>,
        ]
      : [],
```

> **必须用原生 `<a href>` 而不是 umi 的 `<Link to>`**:项目里的 react-router 是 6.3,
> 它的 `Link` 没有「绝对 URL 直通」的处理,`to="https://..."` 会被解析成
> `/https://www.pmdict.cn/api/v1/docs` 这种坏路径。`rel="noreferrer"` 是 Biome 的
> `suspicious/noBlankTarget` 规则要求的。

- [ ] **Step 7: 移除 app.tsx 中对生成 service 的引用**

确认 `src/app.tsx` 里**没有**任何 `import ... from '@/services/ant-design-pro/...'`(原来的 `currentUser as queryCurrentUser` 已经不用了,直接删掉那行 import)。

- [ ] **Step 8: 登录页把 menus/permissions 一起写回 initialState**

`fetchUserInfo` 现在返回的是 `{ currentUser, menus, permissions }` 这一整块,登录页原来只写
`currentUser`,会导致登录后侧边栏菜单是空的。改 `src/pages/user/login/index.tsx`:

```ts
  const fetchUserInfo = async () => {
    const userInfo = await initialState?.fetchUserInfo?.();
    if (userInfo) {
      startTransition(() => {
        setInitialState((s) => ({
          ...s,
          ...userInfo,
        }));
      });
    }
  };
```

- [ ] **Step 9: 重写 src/app.test.tsx**

旧用例 mock 的是 `@/services/ant-design-pro/api` 的 `currentUser`,`src/app.tsx` 换成
`@/auth/session` 的 `fetchCurrentUser` 之后这些用例会全部失败,必须整体重写。

新的 `src/app.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();
const mockHistory = {
  location: {
    pathname: '/welcome',
    search: '',
    hash: '',
  },
  replace: mockReplace,
};

const mockFetchCurrentUser = vi.fn();

vi.mock('@umijs/max', () => ({
  history: mockHistory,
  Link: ({ children }: any) => children,
}));

vi.mock('@/auth/session', () => ({
  fetchCurrentUser: (...args: unknown[]) => mockFetchCurrentUser(...args),
}));

vi.mock('@/components', () => ({
  AvatarDropdown: () => null,
  ErrorBoundary: ({ children }: any) => children,
  Footer: () => null,
  LangDropdown: () => null,
  OfflineBanner: () => null,
  VersionDropdown: () => null,
}));

vi.mock('@ant-design/pro-components', () => ({
  SettingDrawer: () => null,
}));

vi.mock('@ant-design/icons', () => ({
  LinkOutlined: () => null,
}));

vi.mock('./requestErrorConfig', () => ({
  errorConfig: {},
}));

vi.mock('../config/defaultSettings', () => ({
  default: { navTheme: 'light' },
}));

const backendUser = {
  id: 1,
  username: 'admin',
  name: '管理员',
  is_superuser: true,
  menus: [
    {
      id: 10,
      name: 'system',
      type: 1,
      route_path: '/system',
      route_name: 'system',
      title: '系统管理',
      status: '0',
      order: 1,
      children: [
        {
          id: 11,
          name: 'user',
          type: 2,
          route_path: 'user',
          route_name: 'user',
          title: '用户管理',
          status: '0',
          order: 1,
          permission: 'module_system:user:query',
        },
      ],
    },
  ],
};

describe('app getInitialState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHistory.location = {
      pathname: '/welcome',
      search: '',
      hash: '',
    };
  });

  it('fetches the current user when not on the login page', async () => {
    const { getInitialState } = await import('./app');
    mockFetchCurrentUser.mockResolvedValue(backendUser);

    const state = await getInitialState();

    expect(mockFetchCurrentUser).toHaveBeenCalled();
    expect(state.currentUser).toEqual(backendUser);
    expect(state.menus).toEqual(backendUser.menus);
    expect(state.permissions).toEqual(['module_system:user:query']);
    expect(state.settingDrawerOpen).toBe(false);
    expect(state.fetchUserInfo).toBeDefined();
  });

  it('redirects to login when fetching the current user fails', async () => {
    const { getInitialState } = await import('./app');
    mockFetchCurrentUser.mockRejectedValue(new Error('401 Unauthorized'));

    const state = await getInitialState();

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('/user/login?redirect='),
    );
    expect(state.currentUser).toBeUndefined();
  });

  it('does not fetch the current user on the login page', async () => {
    const { getInitialState } = await import('./app');
    mockHistory.location = {
      pathname: '/user/login',
      search: '',
      hash: '',
    };

    const state = await getInitialState();

    expect(mockFetchCurrentUser).not.toHaveBeenCalled();
    expect(state.currentUser).toBeUndefined();
    expect(state.fetchUserInfo).toBeDefined();
  });

  it('encodes the redirect path correctly', async () => {
    const { getInitialState } = await import('./app');
    mockHistory.location = {
      pathname: '/admin/users',
      search: '?page=2',
      hash: '#section',
    };
    mockFetchCurrentUser.mockRejectedValue(new Error('401'));

    await getInitialState();

    expect(mockReplace).toHaveBeenCalledWith(
      `/user/login?redirect=${encodeURIComponent('/admin/users?page=2#section')}`,
    );
  });

  it('includes the default settings in the initial state', async () => {
    const { getInitialState } = await import('./app');
    mockFetchCurrentUser.mockResolvedValue(backendUser);

    const state = await getInitialState();

    expect(state.settings).toEqual({ navTheme: 'light' });
  });

  it('fetchUserInfo returns the user state patch', async () => {
    const { getInitialState } = await import('./app');
    mockFetchCurrentUser.mockResolvedValue(backendUser);

    const state = await getInitialState();
    const userState = await state.fetchUserInfo?.();

    expect(userState).toEqual({
      currentUser: backendUser,
      menus: backendUser.menus,
      permissions: ['module_system:user:query'],
    });
  });
});

describe('app layout menuDataRender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders backend menus and drops the ones without a frontend route', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { layout } = await import('./app');

    const config = layout({
      initialState: {
        menus: [
          {
            id: 10,
            name: 'system',
            type: 1,
            route_path: '/system',
            route_name: 'system',
            title: '系统管理',
            icon: 'ri:settings-2-line',
            status: '0',
            order: 1,
            children: [
              {
                id: 11,
                name: 'user',
                type: 2,
                route_path: 'user',
                route_name: 'user',
                title: '用户管理',
                icon: 'ri:user-line',
                status: '0',
                order: 1,
              },
              {
                id: 12,
                name: 'unknown',
                type: 2,
                route_path: 'unknown',
                route_name: 'unknown',
                title: '未注册页面',
                status: '0',
                order: 2,
              },
            ],
          },
        ],
      },
      setInitialState: vi.fn(),
    } as any);

    const items = config.menuDataRender?.([
      { path: '/system', icon: 'SettingOutlined' },
      { path: '/system/user', icon: 'UserOutlined' },
    ] as any);

    expect(items).toEqual([
      {
        path: '/system',
        name: '系统管理',
        // 图标取前端路由表的,不是后端的 ri:xxx
        icon: 'SettingOutlined',
        locale: false,
        children: [
          { path: '/system/user', name: '用户管理', icon: 'UserOutlined', locale: false },
        ],
      },
    ]);
    expect(warn).toHaveBeenCalledWith('[menu] 前端缺少路由: /system/unknown');
    warn.mockRestore();
  });
});
```

跑测试:

```bash
cd /d/project/ai-admin-com
npx vitest run src/app.test.tsx
```

Expected: 全部通过,且输出里**没有**未捕获的 `console.warn`(上面用例里的 `console.warn` 已被
`vi.spyOn` 接管并断言)。

- [ ] **Step 10: 类型检查**

```bash
cd /d/project/ai-admin-com
npm run tsc
```

Expected: exit 0。若 `initialState?.menus` 类型不匹配,检查 `getInitialState` 的返回类型声明里 `menus?: BackendMenu[]` 是否存在。

- [ ] **Step 11: 提交**

```bash
git add src/app.tsx src/app.test.tsx src/pages/user/login/index.tsx src/menu/adapter.ts src/menu/adapter.test.ts
git commit -m "feat(app): 接入后端用户信息与菜单渲染

- getInitialState 拉取 /system/user/current/info,收集 menus 与 permissions
- layout.menuDataRender 用后端菜单树渲染侧边栏,并校验前端路由是否存在
- 菜单图标改用前端路由表的图标,后端下发的 ri:xxx ProLayout 渲染不出来
- request.baseURL 统一为 /api/v1

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 11: 登录页改造

**Files:**
- Modify: `src/pages/user/login/index.tsx`

**Interfaces:**
- Consumes: `getCaptcha` / `login`(`@/services/api/system/auth`)、`loginWithSession`(`@/auth/session`)、`setTokens`(`@/auth/token`)、`API_BASE_URL`(`@/services/http`)
- Produces: 登录页支持 图形验证码 / 记住我 / 注册入口 / 三方登录 / OAuth 回跳

- [ ] **Step 1: 改写登录页的 import**

编辑 `src/pages/user/login/index.tsx`,把 antd-pro 的 demo 相关 import 替换掉:

```ts
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import {
  LoginForm,
  ProFormCheckbox,
  ProFormText,
} from '@ant-design/pro-components';
import { FormattedMessage, Helmet, SelectLang, useIntl, useModel } from '@umijs/max';
import { Alert, App, Button } from 'antd';
import { createStyles } from 'antd-style';
import React, { startTransition, useCallback, useEffect, useState } from 'react';
import { Footer } from '@/components';
import { loginWithSession } from '@/auth/session';
import { setTokens } from '@/auth/token';
import { getCaptcha } from '@/services/api/system/auth';
import type { CaptchaOut } from '@/services/api/system/types';
import { API_BASE_URL } from '@/services/http';
import Settings from '../../../../config/defaultSettings';
```

**同时删掉 `ActionIcons` 组件**(它在原文件里渲染支付宝/淘宝/微博三个图标,现在没有调用方了,
Biome 的 `noUnusedVariables` 会报错)。删掉之后 `useStyles` 里的 `action` 这一条样式也没人用了,
一并删掉:

```ts
const useStyles = createStyles(({ token }) => {
  return {
    // 删掉 action 这一条
    lang: { ... },
    container: { ... },
  };
});
```

- [ ] **Step 2: 在组件内加入验证码状态与加载逻辑**

在 `const Login: React.FC = () => {` 内,把 `userLoginState` / `type` 的声明替换为:

```ts
  const [captcha, setCaptcha] = useState<CaptchaOut | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const { initialState, setInitialState } = useModel('@@initialState');
  const { styles } = useStyles();
  const { message } = App.useApp();
  const intl = useIntl();

  const loadCaptcha = useCallback(async () => {
    try {
      const res = await getCaptcha();
      setCaptcha(res?.data ?? null);
    } catch {
      setCaptcha(null);
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);
```

- [ ] **Step 3: 处理三方登录回跳**

在同一个组件内,`useEffect(() => { loadCaptcha(); }, [loadCaptcha]);` 之后追加:

```ts
  /**
   * 三方登录回跳:后端 302 回来看板会带上 access_token / refresh_token,
   * 失败时带 oauth_error。
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const oauthError = params.get('oauth_error');

    if (oauthError) {
      message.error(oauthError);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (accessToken && refreshToken) {
      setTokens(accessToken, refreshToken, true);
      window.location.href = '/';
    }
  }, [message]);
```

- [ ] **Step 4: 替换提交逻辑**

把原 `handleSubmit` 整个替换为:

```ts
  const handleSubmit = async (values: {
    username?: string;
    password?: string;
    captcha?: string;
    autoLogin?: boolean;
  }) => {
    setSubmitError(null);

    try {
      await loginWithSession(
        {
          username: values.username ?? '',
          password: values.password ?? '',
          captcha_key: captcha?.key ?? '',
          captcha: values.captcha ?? '',
          login_type: 'PC端',
        },
        Boolean(values.autoLogin),
      );

      message.success(
        intl.formatMessage({ id: 'pages.login.success', defaultMessage: '登录成功！' }),
      );

      // 用本文件里的局部 fetchUserInfo(Task 10 已经改成整块回写 currentUser/menus/permissions)
      await fetchUserInfo();

      const urlParams = new URL(window.location.href).searchParams;
      const redirectUrl = getSafeRedirectUrl(urlParams.get('redirect'));
      window.location.href = redirectUrl;
    } catch (error: any) {
      const msg = error?.info?.msg || error?.message || '登录失败，请重试！';
      setSubmitError(msg);
      // 验证码可能已失效,重新拉一张
      loadCaptcha();
    }
  };
```

- [ ] **Step 5: 替换表单体(去掉手机号 Tab,加验证码)**

把 `<Tabs ...>` 整段和 `{type === 'account' && (...)}` / `{type === 'mobile' && (...)}` 两段,替换为:

```tsx
          <ProFormText
            name="username"
            fieldProps={{
              size: 'large',
              prefix: <UserOutlined />,
            }}
            placeholder={intl.formatMessage({
              id: 'pages.login.username.placeholder',
              defaultMessage: '请输入用户名',
            })}
            rules={[
              {
                required: true,
                message: (
                  <FormattedMessage
                    id="pages.login.username.required"
                    defaultMessage="请输入用户名!"
                  />
                ),
              },
            ]}
          />

          <ProFormText.Password
            name="password"
            fieldProps={{
              size: 'large',
              prefix: <LockOutlined />,
            }}
            placeholder={intl.formatMessage({
              id: 'pages.login.password.placeholder',
              defaultMessage: '请输入密码',
            })}
            rules={[
              {
                required: true,
                message: (
                  <FormattedMessage
                    id="pages.login.password.required"
                    defaultMessage="请输入密码！"
                  />
                ),
              },
            ]}
          />

          {captcha?.enable && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ProFormText
                name="captcha"
                style={{ flex: 1 }}
                fieldProps={{
                  size: 'large',
                  prefix: <LockOutlined />,
                }}
                placeholder="请输入验证码"
                rules={[
                  {
                    required: true,
                    message: '请输入验证码！',
                  },
                ]}
              />
              <img
                src={captcha.img_base}
                alt="点击刷新验证码"
                onClick={loadCaptcha}
                style={{
                  height: 40,
                  cursor: 'pointer',
                  borderRadius: 4,
                  border: '1px solid rgba(0,0,0,0.15)',
                }}
              />
            </div>
          )}
```

- [ ] **Step 6: 替换 actions(注册 + 三方登录)**

把 `actions={[...]}` 整段替换为:

```tsx
          actions={[
            <FormattedMessage
              key="loginWith"
              id="pages.login.loginWith"
              defaultMessage="其他登录方式"
            />,
            <div key="oauth" style={{ display: 'flex', gap: 8 }}>
              {(['github', 'gitee', 'wechat', 'qq'] as const).map((provider) => (
                <Button
                  key={provider}
                  type="link"
                  loading={oauthLoading === provider}
                  onClick={() => {
                    setOauthLoading(provider);
                    const redirectUri = `${window.location.origin}/user/login`;
                    window.location.href = `${API_BASE_URL}/system/auth/oauth/${provider}/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
                  }}
                >
                  {provider}
                </Button>
              ))}
              <Button type="link" href="/user/register">
                注册
              </Button>
            </div>,
          ]}
```

- [ ] **Step 7: 替换错误提示区**

把原来基于 `status === 'error'` 的两段 `<LoginMessage>` 替换为:

```tsx
          {submitError && <LoginMessage content={submitError} />}
```

并把 `const { status, type: loginType } = userLoginState;` 这一行删除。

- [ ] **Step 8: fetchUserInfo 局部函数与 onFinish 的类型**

- 本文件里的局部 `fetchUserInfo` **保留**,Task 10 已经把它改成整块回写
  (`setInitialState((s) => ({ ...s, ...userInfo }))`,`userInfo` 是
  `{ currentUser, menus, permissions }`)。Step 4 的 `handleSubmit` 直接 `await fetchUserInfo();`。
  **不要**在 `handleSubmit` 里再内联一份 —— 那会让局部 `fetchUserInfo` 变成未使用变量。
- `LoginForm` 的 `onFinish` 不要再 cast 成 `API.LoginParams`(那是 antd-pro 遗留的类型命名空间,
  Task 13 会把 `src/services/ant-design-pro` 改名)。改成直接传:

```tsx
          onFinish={async (values) => {
            await handleSubmit(values);
          }}
```

  `handleSubmit` 的入参类型是
  `{ username?: string; password?: string; captcha?: string; autoLogin?: boolean }`,
  ProForm 的 `onFinish` 给的是 `Record<string, any>`,直接传即可。

- [ ] **Step 9: 类型检查 + lint + 全量测试**

```bash
cd /d/project/ai-admin-com
npm run tsc && npm run lint && npx antd lint ./src && npx vitest run
```

Expected: 全部 exit 0。`npx antd lint ./src` 的 33 条 deprecated 全在 `pages/list` 等**演示页**里,
登录页不能新增;`npx vitest run` 是全量套件,本任务不新增用例,但**不能弄坏已有的 135 条**。

- [ ] **Step 10: 提交**

```bash
git add src/pages/user/login/index.tsx
git commit -m "feat(login): 登录页接入真实接口

- 图形验证码(base64)从 /system/auth/captcha/get 获取,点击可刷新
- 登录改为 form-urlencoded 提交 /system/auth/login
- 保留注册入口与 GitHub/Gitee/微信/QQ 三方登录,支持 OAuth 回跳取 token
- 去掉后端不支持的手机号登录 Tab

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 12: 用户管理页(打通范例)

**Files:**
- Create: `src/pages/module_system/user/index.tsx`
- Create: `src/pages/module_system/user/ModalForm.tsx`
- Modify: `src/services/api/system/user.ts` + `src/services/api/system/user.test.ts`(删除接口的请求体格式与后端对不上)
- Modify: `src/services/paginate.ts` + `src/services/paginate.test.ts`(分页参数越界 / 空查询参数会打后端 422)

**Interfaces:**
- Consumes: `listUsers` / `createUser` / `updateUser` / `deleteUsers`(`@/services/api/system/user`)、`toProTableRequest`(`@/services/paginate`)、`useAccess`(`@umijs/max`)
- Produces: 路由 `/system/user` 对应的页面组件

- [ ] **Step 1: 修正 deleteUsers 的请求体(后端要的是裸数组)**

后端 `DELETE /system/user/delete` 的入参是 `ids: Annotated[list[int], Body(...)]`,
**整个请求体就是一个整数数组**(公网 OpenAPI 已核实:
`requestBody.content['application/json'].schema = {type: 'array', items: {type: 'integer'}}`),
不是 `{ ids: [...] }`。现在 `src/services/api/system/user.ts` 发的是 `{ ids }` → 后端 422。

把 `deleteUsers` 改成:

```ts
/** 删除用户(后端请求体是裸数组,不是 { ids }) */
export async function deleteUsers(ids: number[]) {
  return request<ApiResponse<null>>('/system/user/delete', {
    method: 'DELETE',
    data: ids,
  });
}
```

同时改 `src/services/api/system/user.test.ts` 里那条锁错了契约的用例:

```ts
  it('deletes users by id list', async () => {
    await deleteUsers([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/user/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });
```

- [ ] **Step 2: 加固 toProTableRequest(分页越界与空查询参数都会打后端 422)**

后端 `page_no` 约束是 `minimum: 1`,`page_size` 是 `minimum: 1 / maximum: 100`
(公网 OpenAPI 已核实);而 `UserQueryParam.mobile` / `.email` 带**严格正则**约束
(`^1[3-9]\d{9}$` 与邮箱正则),后端对查询参数也做校验,传不合法值直接 422。

所以 `src/services/paginate.ts` 要做三件事:夹紧分页参数、丢掉空查询值。

把 `toProTableRequest` 改成:

```ts
/** 后端 page_size 上限(公网 OpenAPI: maximum = 100) */
const MAX_PAGE_SIZE = 100;

/** 丢掉空查询值:后端对部分查询参数有严格正则,空串也会 422 */
function pruneEmpty(params: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === '' || value === undefined || value === null) continue;
    result[key] = value;
  }
  return result;
}

export function toProTableRequest<T>(
  api: (params: PageQuery) => Promise<ApiResponse<PageResult<T>>>,
) {
  return async (params: ProTableParams) => {
    const { current, pageSize, ...rest } = params;

    const res = await api({
      ...pruneEmpty(rest),
      page_no: Math.max(1, current ?? 1),
      page_size: Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? 10)),
    });

    return {
      data: res?.data?.items ?? [],
      total: res?.data?.total ?? 0,
      success: res?.success ?? false,
    };
  };
}
```

在 `src/services/paginate.test.ts` 里补三条用例:

```ts
  it('clamps page_no and page_size into the range the backend accepts', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
      success: true,
    });

    await toProTableRequest(api)({ current: 0, pageSize: 500 });

    expect(api).toHaveBeenCalledWith({ page_no: 1, page_size: 100 });
  });

  it('drops empty search values so the backend does not reject them', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
      success: true,
    });

    await toProTableRequest(api)({
      current: 1,
      pageSize: 10,
      username: '',
      mobile: undefined,
      name: 'ad',
    });

    expect(api).toHaveBeenCalledWith({ name: 'ad', page_no: 1, page_size: 10 });
  });
```

跑测试:

```bash
cd /d/project/ai-admin-com
npx vitest run src/services/paginate.test.ts src/services/api/system/user.test.ts
```

Expected: 全部通过。

- [ ] **Step 3: 创建页面**

创建 `src/pages/module_system/user/index.tsx`:

```tsx
import { PlusOutlined } from '@ant-design/icons';
import type { ActionType } from '@ant-design/pro-components';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Popconfirm } from 'antd';
import { useRef, useState } from 'react';
import type React from 'react';
import {
  createUser,
  deleteUsers,
  listUsers,
  updateUser,
} from '@/services/api/system/user';
import type { UserCreateParams, UserOut } from '@/services/api/system/types';
import { toProTableRequest } from '@/services/paginate';
import UserModalForm from './ModalForm';

const requestUsers = toProTableRequest<UserOut>(listUsers);

/**
 * 用户管理 —— 后端菜单 route_path=/system/user,component_path=module_system/user/index。
 * 后续新增业务页面按同一范式复制本文件。
 */
const UserManagement: React.FC = () => {
  const access = useAccess();
  const actionRef = useRef<ActionType>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserOut | undefined>(undefined);

  const handleDelete = async (record: UserOut) => {
    if (!record.id) return;
    await deleteUsers([record.id]);
    // 成功提示由请求层统一弹(后端信封里的 msg),这里不要再弹一次
    actionRef.current?.reload();
  };

  const handleEdit = (record: UserOut) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditing(undefined);
    setModalOpen(true);
  };

  const columns: ProColumns<UserOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, hideInSearch: true },
    {
      title: '用户名',
      dataIndex: 'username',
      width: 160,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    { title: '姓名', dataIndex: 'name', width: 120 },
    {
      title: '手机号',
      dataIndex: 'mobile',
      width: 140,
      // 后端 UserQueryParam.mobile 有严格正则,这里先在前端挡掉非法值,避免请求直接 422
      rules: [
        {
          pattern: /^1[3-9]\d{9}$/,
          message: '手机号格式不正确',
        },
      ],
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 200,
      rules: [
        {
          pattern: /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/,
          message: '邮箱格式不正确',
        },
      ],
    },
    { title: '部门', dataIndex: 'dept_name', width: 140, hideInSearch: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        0: { text: '正常', status: 'Success' },
        1: { text: '禁用', status: 'Default' },
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_time',
      width: 180,
      hideInSearch: true,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, record) => [
        <Button
          key="edit"
          type="link"
          size="small"
          disabled={!access.hasPermission('module_system:user:update')}
          onClick={() => handleEdit(record)}
        >
          编辑
        </Button>,
        <Popconfirm
          key="delete"
          title="确认删除该用户?"
          onConfirm={() => handleDelete(record)}
          disabled={!access.hasPermission('module_system:user:delete')}
        >
          <Button
            type="link"
            size="small"
            danger
            disabled={!access.hasPermission('module_system:user:delete')}
          >
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <>
      <ProTable<UserOut>
        headerTitle="用户管理"
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        request={requestUsers}
        search={{ labelWidth: 80 }}
        pagination={{
          defaultPageSize: 10,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
        }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!access.hasPermission('module_system:user:create')}
            onClick={handleCreate}
          >
            新增
          </Button>,
        ]}
      />
      <UserModalForm
        open={modalOpen}
        record={editing}
        onOpenChange={setModalOpen}
        onSubmit={async (values: UserCreateParams) => {
          try {
            if (editing?.id) {
              await updateUser(editing.id, values);
            } else {
              await createUser(values);
            }
            actionRef.current?.reload();
            return true;
          } catch {
            return false;
          }
        }}
      />
    </>
  );
};

export default UserManagement;
```

> 说明:
> - `ProFormDigit` / `ProFormSelect` / `ProFormText` / `ProFormTextArea` 只在 `ModalForm.tsx` 里用,
>   **不要**在 `index.tsx` 里 import(Biome 的 `noUnusedImports` 会报错)。
> - `handleDelete` / `handleEdit` 必须写在 `columns` **之前** —— `columns` 的 `render` 里引用了它们,
>   Biome 的 `noInvalidUseBeforeDeclaration` 会把「先声明后使用」当错误。
> - **不要**在页面里再弹一次 `message.success` —— 请求层(`src/requestErrorConfig.ts`)对非 GET 请求
>   已经会用后端信封里的 `msg` 弹一次成功提示,页面再弹就是两条提示。

- [ ] **Step 4: 实现新增/编辑弹窗**

**新增文件** `src/pages/module_system/user/ModalForm.tsx`:

```tsx
import {
  ModalForm,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import type { UserCreateParams, UserOut } from '@/services/api/system/types';

export type UserModalProps = {
  open: boolean;
  record?: UserOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UserCreateParams) => Promise<boolean>;
};

const UserModalForm: React.FC<UserModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<UserCreateParams>
      title={record?.id ? '编辑用户' : '新增用户'}
      open={open}
      initialValues={record as UserCreateParams}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(values);
      }}
    >
      <ProFormText name="username" label="用户名" rules={[{ required: true }]} />
      {!record?.id && (
        <ProFormText.Password
          name="password"
          label="密码"
          rules={[{ required: true, min: 6 }]}
        />
      )}
      <ProFormText name="name" label="姓名" />
      <ProFormText name="mobile" label="手机号" />
      <ProFormText name="email" label="邮箱" />
      <ProFormDigit name="dept_id" label="部门 ID" />
      <ProFormSelect
        name="status"
        label="状态"
        options={[
          { label: '正常', value: 0 },
          { label: '禁用', value: 1 },
        ]}
      />
      <ProFormTextArea name="description" label="备注" fieldProps={{ rows: 3 }} />
    </ModalForm>
  );
};

export default UserModalForm;
```

> 说明:
> - `onFinish` 返回 `true` 关闭弹窗、返回 `false` 保持打开(ProComponents 的语义)。
>   不要再在弹窗里弹 `message.success` —— 请求层已经弹过后端信封里的 `msg`。
> - antd v6(本仓库 6.6.7)的 `Modal` 把 `destroyOnClose` 标成了 `@deprecated`,
>   新名字是 `destroyOnHidden`(`node_modules/antd/es/modal/interface.d.ts:79-84`)。
>   `npx antd lint ./src` 会挑出废弃用法。

- [ ] **Step 5: 类型检查 + lint**

```bash
cd /d/project/ai-admin-com
npm run tsc && npm run lint && npx antd lint ./src
```

Expected: 全部 exit 0。`npx antd lint ./src` 会挑出 antd 的废弃用法
(例如 `destroyOnClose`),提交前必须过。

- [ ] **Step 6: 提交**

```bash
git add src/pages/module_system/user src/services/api/system/user.ts src/services/api/system/user.test.ts src/services/paginate.ts src/services/paginate.test.ts
git commit -m "feat(page): 新增用户管理页(打通范例)

ProTable + 分页适配器 + 按钮级权限控制;
新增/编辑走 ModalForm,删除走 /system/user/delete。
同时修正删除接口的请求体(后端要裸数组)与分页参数越界。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 13: 品牌、代理、注册页、退出登录、i18n 精简

**Files:**
- Modify: `config/defaultSettings.ts`
- Modify: `config/config.ts`
- Modify: `config/proxy.ts`
- Modify: `src/pages/user/register/service.ts`
- Modify: `src/pages/user/register/index.tsx`
- Modify: `src/components/RightContent/AvatarDropdown.tsx`
- Delete: `src/locales/{bn-BD,fa-IR,id-ID,ja-JP,pt-BR,zh-TW}/**`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `registerUser`(`@/services/api/system/user`)、`logoutAndClear`(`@/auth/session`)
- Produces: 品牌标题 `AiAdmin`;代理指向公网后端;i18n 只剩中英双语

- [ ] **Step 1: 更新品牌设置**

编辑 `config/defaultSettings.ts`:

```ts
const Settings: ProLayoutProps & {
  logo?: string;
} = {
  navTheme: 'light',
  colorPrimary: '#1677ff',
  layout: 'mix',
  contentWidth: 'Fluid',
  fixedHeader: false,
  fixSiderbar: true,
  colorWeak: false,
  title: 'AiAdmin',
  logo: '/logo.svg',
  iconfontUrl: '',
  token: {},
};
```

再把另外两处硬编码的「Ant Design Pro」改掉:

- `src/components/Footer/index.tsx` 的 `<div className={styles.copyright}>Ant Design Pro &copy; {year}</div>`
  → `AiAdmin &copy; {year}`
- `src/pages/user/login/index.tsx` 的 `<LoginForm ... title="Ant Design" ...>`
  → `title="AiAdmin"`

(`config/defaultSettings.ts` 的 `title` 已经被登录页的 `Settings.title` 引用,改一处即可。)

- [ ] **Step 2: 更新 config/config.ts**

- `title: 'Ant Design Pro'` → `title: 'AiAdmin'`
- 删除整个 `analytics: { ga_v2: 'G-59NF1VHHPF' }` 配置块
- `locale` 改为:

```ts
  locale: {
    // 默认中文
    default: 'zh-CN',
    antd: true,
    // 不跟随浏览器语言,避免非中文环境被切到英文
    baseNavigator: false,
  },
```

- 删除 `openAPI: [...]` 整块
- `plugins` 改为 `plugins: ['@umijs/request-record'],`(移除 `@umijs/max-plugin-openapi`)
- **删除 `config/oneapi.json`** —— 它只是 openapi 插件的 schema 来源,插件移除后就是死文件
- `define` 里的 `__UTOO_VERSION__` **保持不变**(`src/components/Footer/index.tsx` 在用它,
  `src/typings.d.ts` 里的 `declare const __UTOO_VERSION__` 也一并保留)

- [ ] **Step 3: 更新代理配置**

**完全替换** `config/proxy.ts`:

```ts
/**
 * @name 代理配置
 * @description 本地开发时把 /api/ 转发到后端。
 *
 * 后端 FastAPI 以 root_path='/api/v1' 暴露服务,nginx 与此代理都不做 rewrite,
 * 因此这里不需要 pathRewrite —— 前端 baseURL 已经是 /api/v1。
 *
 * 换成本地后端:把 target 改成 http://127.0.0.1:8001
 */
export default {
  dev: {
    '/api/': {
      target: 'https://www.pmdict.cn',
      changeOrigin: true,
    },
  },
  test: {
    '/api/': {
      target: 'https://www.pmdict.cn',
      changeOrigin: true,
    },
  },
  pre: {
    '/api/': {
      target: 'https://www.pmdict.cn',
      changeOrigin: true,
    },
  },
};
```

- [ ] **Step 4: 注册页改真实接口**

**不要**在页面里再写一份 `registerUser` —— `src/services/api/system/user.ts` 里已经有了
(Task 5 建的),直接复用。

1. **删除** `src/pages/user/register/service.ts`(页面本地的假 service)
2. **删除** `src/pages/user/register/_mock.ts`(它 mock 的是 `/api/register`,真实接口是
   `/api/v1/system/user/register`,根本不会被命中,留着只会误导)
3. 编辑 `src/pages/user/register/index.tsx`:
   - 把 `import { fakeRegister } from './service';`
     改为 `import { registerUser } from '@/services/api/system/user';`
   - **表单字段对齐后端 `UserRegisterSchema`**
     (必填 `username` 3–32、`password` 6–128;可选 `name`、`mobile`):
     - 把原来的 `mail` 字段(`name="mail"`,规则 `type: 'email'`)改名为 `username`,
       规则改为 `{ required: true, min: 3 }`
     - 保留 `password` 字段(后端要求 ≥ 6 位)
     - 删除 `confirm`(后端无此字段)、删除 `captcha`(后端注册接口不校验验证码)、
       删除 `prefix`(手机号区号)
     - 保留 `mobile` 字段(后端 `mobile_validator` 要求 11 位数字,前端也加同样的规则更友好)
   - 把 `mutationFn` / `onSuccess` 改成下面这样(原代码里有三处对不上后端):

```ts
  const { isPending: submitting, mutate: register } = useMutation({
    mutationFn: (formValues: Store) => {
      const payload: UserRegisterParams = {
        username: formValues.username,
        password: formValues.password,
        name: formValues.name,
        mobile: formValues.mobile,
      };
      return registerUser(payload);
    },
    onSuccess: (_data, params) => {
      // 后端返回的是 { code, msg, data } 信封,请求层已经弹过成功提示了,这里不要再弹
      queryClient.invalidateQueries({ queryKey: ['current-user'] });
      history.push({
        pathname: `/user/register-result?account=${params.username}`,
      });
    },
  });
```

     > 原代码的三个坑:
     > 1. `mail: formValues.email` —— 取的根本不是表单里的 `mail` 字段;
     > 2. `payload` 里带着 `confirm` / `captcha` / `prefix` —— 后端 `UserRegisterSchema` 没有这三个字段;
     > 3. `onSuccess` 里判 `data.status === 'ok'` —— 那是假 service 的返回格式,真接口返回的是
     >    `{ code, msg, data }` 信封,`data.status` 永远是 undefined,会走到「注册成功」分支之外。
     >    真接口失败时请求层会直接抛 `BizError`,`onSuccess` 根本不会执行。
     >    同时 `message.success('注册成功！')` 要删掉 —— 请求层已经弹过后端信封里的 `msg`。

- [ ] **Step 5: 退出登录改真实接口**

编辑 `src/components/RightContent/AvatarDropdown.tsx`:

- 把 `import { outLogin } from '@/services/ant-design-pro/api';` 改为
  `import { logoutAndClear } from '@/auth/session';`
- 把 `loginOut` 函数替换为:

```ts
const loginOut = async () => {
  await logoutAndClear();

  const { search, pathname } = window.location;
  const urlParams = new URL(window.location.href).searchParams;
  const searchParams = new URLSearchParams({
    redirect: pathname + search,
  });
  const redirect = urlParams.get('redirect');
  if (window.location.pathname !== '/user/login' && !redirect) {
    history.replace({
      pathname: '/user/login',
      search: searchParams.toString(),
    });
  }
};
```

- 删除 `outLogin` 的 try/catch(现在 `logoutAndClear` 内部已处理后端失败)
- `onMenuClick` 里退出登录时清 initialState 的那行,
  从 `setInitialState((s) => ({ ...s, currentUser: undefined }))` 改成
  `setInitialState((s) => ({ ...s, currentUser: undefined, menus: [], permissions: [] }))`
  —— 只清 `currentUser` 的话,后端下发的菜单树还留在内存里

- [ ] **Step 6: 精简 i18n**

`src/locales/` 下每个语言有**两份东西**:`<lang>/` 目录(分模块的文案)和 `<lang>.ts`
(把这些模块汇总起来的入口文件)。**两样都要删**,只删目录的话 `<lang>.ts` 会 import
到不存在的文件,`npm run tsc` 直接报错。

```bash
cd /d/project/ai-admin-com
rm -rf src/locales/bn-BD src/locales/fa-IR src/locales/id-ID src/locales/ja-JP src/locales/pt-BR src/locales/zh-TW
rm -f src/locales/bn-BD.ts src/locales/fa-IR.ts src/locales/id-ID.ts src/locales/ja-JP.ts src/locales/pt-BR.ts src/locales/zh-TW.ts
ls src/locales/
```

Expected: 只剩 `en-US/` `en-US.ts` `zh-CN/` `zh-CN.ts`

- [ ] **Step 7: 修正 coverage 排除路径**

编辑 `vitest.config.ts`,把

```ts
        'src/services/ant-design-pro/**',
```

改为

```ts
        'src/services/demo/**',
```

- [ ] **Step 8: 清理上游残留的元信息**

- `package.json` 的 `description` 与 `repository` 仍指向 antd-pro,改为:

```json
  "description": "AiAdmin 前端基础模板 —— 基于 Ant Design Pro v6,对接 AiAdmin FastAPI 后端",
  "repository": "",
```

(或删掉 `repository` 字段)

- `README.ant-design-pro.zh-CN.md` 第一行的 `Language : [English](./README.md)` 指向的是项目自己的 README,改为 `[English](./README.ant-design-pro.md)`
- `skills-lock.json` 只登记了 `antd` 技能,合并进来的 `pro-upgrade` 未登记。补一条同结构的记录(`name`/`source`/`sourceType`/`skillPath`/`computedHash`);若无法确定正确的 `computedHash`,至少补上前四项并说明 `computedHash` 需用 skills 工具重新生成

- [ ] **Step 9: 重命名 service 目录并修正 import**

```bash
cd /d/project/ai-admin-com
mkdir -p src/services/demo
git mv src/services/ant-design-pro/api.ts src/services/demo/api.ts
git mv src/services/ant-design-pro/login.ts src/services/demo/login.ts
git mv src/services/ant-design-pro/typings.d.ts src/services/demo/typings.d.ts
git mv src/services/ant-design-pro/index.ts src/services/demo/index.ts
rmdir src/services/ant-design-pro 2>/dev/null || true
grep -rl "services/ant-design-pro" src/ | head -20
```

对 grep 出来的每个文件,把 `from '@/services/ant-design-pro/api'` 改成 `from '@/services/demo/api'`,`from '@/services/ant-design-pro/login'` 改成 `from '@/services/demo/login'`。

- [ ] **Step 10: 全量校验**

```bash
cd /d/project/ai-admin-com
npm run tsc && npm run biome:lint && npx vitest run && npm run build
```

Expected: 全部通过

- [ ] **Step 11: 提交**

> ⚠ **Windows 上 pre-commit hook 会失败**:上游 `.husky/pre-commit` 跑 `lint-staged`,当暂存文件多时拼出的命令行超过 cmd.exe 的 8191 字符上限。本任务 `git add -A` 会一次性暂存大量文件,**必然复现**。处理方式二选一:
> (a) 临时把 `.lintstagedrc` 的 `--max-arg-length` 调小(例如 6000),让 hook **完整跑通**后再还原文件(提交内容保持原样);
> (b) 用 `--no-verify` 跳过 hook,并在报告中说明。
>
> 无论哪种,提交后都要确认 `git show HEAD:.lintstagedrc` 是预期内容。

```bash
git add -A
git commit -m "feat: 品牌改为 AiAdmin,代理指向后端,精简 i18n 与 service 目录

- config: title/logo=AiAdmin,移除 analytics 与 openapi 插件
- proxy: dev/test/pre 统一指向 https://www.pmdict.cn
- 注册页改调 /system/user/register,退出登录改调 /system/auth/logout
- i18n 精简到 zh-CN + en-US
- src/services/ant-design-pro 改名为 src/services/demo(已非自动生成)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 14: 验收走查

按规格 §11 的清单逐条验证。这是唯一需要真实浏览器与真实后端的任务。

**Files:**
- Modify: `README.md`(写项目说明)

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 一份可交付的基础模板

- [ ] **Step 1: 启动开发服务器(纯真实后端)**

```bash
cd /d/project/ai-admin-com
npm run dev
```

Expected: dev server 启动,输出本地地址(默认 http://localhost:8000 或 umi 指定端口)

- [ ] **Step 2: 打开登录页**

浏览器访问 dev server 地址 → 应重定向到 `/user/login`。

**检查点**:
- 页面显示**验证码图片**(base64 渲染)
- Network 中 `GET /api/v1/system/auth/captcha/get` 返回 200,`data.enable === true`
- 控制台无报错

- [ ] **Step 3: 登录**

输入测试账号与验证码 → 提交。

**检查点**:
- Network 中 `POST /api/v1/system/auth/login` 的 **Request Payload 是 form-urlencoded**(不是 JSON)
- 响应 200,`data.access_token` 非空
- 浏览器跳转到首页(第一个可用菜单的 path)

- [ ] **Step 4: 检查侧边栏**

**检查点**:
- 侧边栏显示后端下发的菜单(至少包含「系统管理 → 用户管理」)
- 控制台出现 `[menu] 前端缺少路由: ...` 的告警(后端有 220 条菜单,前端只实现了 1 个页面,其余会被跳过)——这是**预期行为**
- 没有任何菜单项点了 404

- [ ] **Step 5: 检查用户管理页**

点击「用户管理」。

**检查点**:
- Network 中 `GET /api/v1/system/user/list?page_no=1&page_size=10` 返回 200
- 表格展示真实数据(不是 mock 的「Rule」假数据)
- 翻页 / 搜索生效,请求参数是 `page_no` / `page_size`
- 无 `module_system:user:create` 权限时「新增」按钮为禁用态

- [ ] **Step 6: 检查退出登录**

点击右上角头像 → 退出登录。

**检查点**:
- Network 中 `POST /api/v1/system/auth/logout` 返回 200
- `localStorage` / `sessionStorage` 中的 `access_token` 已清除
- 跳回 `/user/login`

- [ ] **Step 7: 检查 401 静默刷新**

把 `localStorage.access_token` 改成一个无效值(DevTools → Application → Local Storage),刷新页面。

**检查点**:
- Network 中先出现一个 401 的 `/system/user/current/info`
- 紧接着出现 `POST /api/v1/system/auth/token/refresh`
- 刷新成功后 `/system/user/current/info` 自动重发并返回 200
- 页面**没有**跳回登录页,也没有整页刷新

- [ ] **Step 8: 检查刷新也失败时的降级**

把 `access_token` 和 `refresh_token` 都改成无效值,刷新页面。

**检查点**:
- 跳转到 `/user/login?redirect=<原路径>`
- 只弹一次提示

- [ ] **Step 9: 构建校验**

```bash
cd /d/project/ai-admin-com
npm run build
```

Expected: 构建成功,`dist/` 产物生成

- [ ] **Step 10: 全量 lint 与测试**

```bash
cd /d/project/ai-admin-com
npm run lint && npx vitest run
```

Expected: 全部通过

- [ ] **Step 11: 写项目 README**

**完全替换** `README.md`:

```markdown
# AiAdmin 前端基础模板

基于 [Ant Design Pro](https://pro.ant.design/) v6(Umi Max 4 + antd 6 + ProComponents 3 + React 19)的后端管理前端模板,
对接 [AiAdmin](https://github.com/) FastAPI 后端。

## 技术栈

- Umi Max 4 / React 19 / TypeScript
- antd 6 + ProComponents 3
- Tailwind CSS v4 + antd-style
- vitest(browser mode)+ Playwright

## 快速开始

```bash
npm install
npx playwright install chromium
npm run dev      # 纯真实后端(MOCK=none)
npm start        # 带 antd-pro 演示页 mock
```

默认后端地址见 `config/proxy.ts` 的 `target`(当前指向 `https://www.pmdict.cn`),
换成本地后端改成 `http://127.0.0.1:8001` 即可。

## 目录约定

| 目录 | 说明 |
|---|---|
| `src/services/api/**` | **唯一**访问真实后端的地方,按后端模块分目录 |
| `src/services/demo/**` | antd-pro 演示页专用的 mock 数据访问(已非自动生成) |
| `src/menu/adapter.ts` | 后端菜单树 → ProLayout 菜单的唯一转换处 |
| `src/auth/**` | token 存取与会话操作 |
| `src/pages/module_*/**` | 业务页面,目录名与后端菜单 `component_path` 对齐 |

## 菜单约定

后端菜单决定**显示什么**,前端 `config/routes.ts` 决定**能点开什么**:

- 后端 `/system/user/current/info` 返回的 `menus` 已建好树
- 前端路由的 `path` 必须与菜单 `route_path`(相对父目录拼接后的绝对路径)一致
- 对不上的菜单项会被跳过,控制台打印 `[menu] 前端缺少路由: <path>`

新增业务页面的步骤:

1. 在 `src/pages/<后端 component_path>/index.tsx` 建页面
2. 在 `config/routes.ts` 注册路由,`path` 与后端 `route_path` 一致
3. 在 `src/services/api/<模块>/` 加 service
4. 在后端菜单表里补上对应的 `route_path` / `component_path`

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发(真实后端) |
| `npm start` | 开发(带演示页 mock) |
| `npm run build` | 构建 |
| `npm run lint` | Biome + tsc |
| `npm test` | 单元测试 |
| `npm run biome` | 自动修复格式 |

## 相关文档

- 设计规格:`docs/superpowers/specs/2026-10-30-ai-admin-frontend-template-design.md`
- 上游说明:`README.ant-design-pro.md`
```

- [ ] **Step 12: 提交**

```bash
git add README.md
git commit -m "docs: 补充项目 README(启动方式、目录约定、菜单约定、新增页面步骤)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review

### 1. 规格覆盖检查

| 规格章节 | 对应任务 |
|---|---|
| §2.1 基址与前缀 | Task 2(`API_BASE_URL`)、Task 13(proxy) |
| §2.2 响应信封 | Task 2、Task 7 |
| §2.3 认证 | Task 3、Task 7、Task 8 |
| §2.4 接口清单 | Task 5 |
| §2.5 分页 | Task 5、Task 6 |
| §2.6 菜单树 | Task 4、Task 10 |
| §3 总体架构 | Task 1–13 |
| §4 目录结构 / §4.1 文件改动清单 | Task 1、Task 13 |
| §5.1 信封适配 | Task 7 Step 3–4 |
| §5.2 token 注入 | Task 7 |
| §5.3 401 刷新重放 | Task 7 Step 3、Step 6 |
| §5.4 错误分级 | Task 7 |
| §6.1 token 存取 | Task 3 |
| §6.2 登录页 | Task 11 |
| §6.3 会话 | Task 8 |
| §6.4 getInitialState | Task 10 |
| §6.5 菜单适配器 | Task 4、Task 10 |
| §6.6 权限 | Task 9 |
| §7 service 规范 | Task 5、Task 6 |
| §8 用户管理页 | Task 12 |
| §9 环境代理 | Task 13 |
| §10 品牌 i18n | Task 13 |
| §11 验收清单 | Task 14 |
| §12 不做的事 | 全部任务均未越界 |
| §13 风险 | Task 7(500 错误)、Task 4(菜单单薄)、Task 11(OAuth token 在 URL) |

### 2. 占位符扫描

- Task 4 的 `sortByOrder` 已被 Step 4 的 `toInternal` 版本取代,Step 3 明确要求删除旧函数 ✅
- Task 12 的 `ModalForm` `valuesRef` 未定义问题已在 Step 3 的修正版中解决 ✅
- Task 7 的 `getRefreshTokenForRefresh` / `__setRefreshTokenProvider` 过渡产物已在 Step 4 中删除 ✅
- Task 11 的 `handleEdit` 占位提示在 Task 12 Step 4 被真实弹窗替换 ✅
- 无 "TBD" / "implement later" / "Similar to Task N" ✅

### 3. 类型与命名一致性

| 名称 | 定义处 | 使用处 |
|---|---|---|
| `API_BASE_URL` | Task 2 `src/services/http.ts` | Task 10 `app.tsx`、Task 11 登录页 |
| `ApiResponse<T>` | Task 2 `src/services/types.ts` | Task 5、6、7、8 |
| `isSuccess` / `isUnauthorized` / `createBizError` | Task 2 `src/services/response.ts` | Task 7 |
| `AUTH_KEYS` / `setTokens` / `getAccessToken` / `getRefreshToken` / `clearAuth` / `isRememberMe` | Task 3 `src/auth/token.ts` | Task 7、8、11、13 |
| `BackendMenu` / `MenuItem` / `collectPermissions` / `collectPaths` / `buildMenuItems` | Task 4 `src/menu/adapter.ts` | Task 9、10 |
| `toProTableRequest` | Task 6 `src/services/paginate.ts` | Task 12 |
| `loginWithSession` / `fetchCurrentUser` / `logoutAndClear` | Task 8 `src/auth/session.ts` | Task 10、11、13 |
| `hasPermission` | Task 9 `src/access.ts` | Task 12 |
| `UserOut` / `UserCreateParams` / `CaptchaOut` / `LoginForm` / `LoginResult` | Task 5 `src/services/api/system/types.ts` | Task 8、11、12 |
| `RETRIED_FLAG = '__aiadminRetried'` | Task 7 | Task 7 Step 6 测试 |

命名全部一致,无冲突。
