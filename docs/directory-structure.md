# 项目目录结构总览

> 面向新加入的同学与 AI 协作工具。约定类细节见仓库根目录 `README.md` 的「目录约定」、
> 「菜单约定」、「接口约定」三节，这里只回答**「东西放在哪」**。

## 技术栈速览

| 层次 | 选型 |
| ---- | ---- |
| 框架 | UmiJS Max 4（utoopack / Turbopack 构建） |
| UI | React 19 + antd 6 + ProComponents 3 + @ant-design/x |
| 样式 | Tailwind CSS v4 + antd-style + CSS Modules |
| 数据 | @tanstack/react-query + 自建 axios 服务层 |
| 规范 | TypeScript 7 + Biome（替代 ESLint/Prettier） |
| 测试 | Vitest（browser mode）+ Playwright |
| 后端 | 对接 AiAdmin FastAPI；`cloudflare-worker/` 是独立部署的演示 Mock API |

---

## 一、仓库根目录

```
ai-admin-com/
├── src/                  # ★ 业务源码，唯一需要日常改的地方
├── config/               # Umi 构建 / 路由 / 代理配置
├── mock/                 # 本地 Mock 数据（仅 antd-pro 演示页用）
├── cloudflare-worker/    # 独立的 Cloudflare Worker Mock API 服务
├── e2e/                  # Playwright 端到端测试用例
├── tests/                # Vitest 全局 setup 与通用 mock
├── types/                # 全局 TS 类型声明
├── scripts/              # 辅助脚本（i18n 清理 / 模板裁剪）
├── docs/                 # 文档（本文件、cheatsheet、roadmap、设计规格）
├── public/               # 静态资源（logo / icons / loading.js）
├── dist/ dist-dev/       # 构建产物（勿手动修改）
├── .agents/ .claude/     # 项目级 Skills（antd、pro-upgrade），两份副本需同步
├── .superpowers/sdd/     # Superpowers SDD 任务与评审记录
├── .husky/ .github/      # Git hooks 与 CI
└── biome.json / tailwind.config.js / tsconfig.json
    / vitest.config.ts / playwright.config.ts / package.json
```

---

## 二、`config/` — 配置

| 文件 | 作用 |
| ---- | ---- |
| `config/config.ts` | 主配置：插件、`outputPath`（按环境分 `dist` / `dist-dev`）、`proxy` 按 `UMI_ENV` 切换 |
| `config/routes.ts` | **路由表**（503 行）。前端「能点开什么」的唯一来源 |
| `config/routes.simple.ts` | `npm run simple` 精简模式用的路由表 |
| `config/proxy.ts` | 开发代理：`/api/` → 后端；含 `PROXY_INSECURE_TLS` 临时开关 |
| `config/defaultSettings.ts` | ProLayout 主题与布局设置 |
| `config/md-raw-loader.cjs` | Markdown raw 导入 loader |

---

## 三、`src/` — 源码

### 3.1 应用骨架（`src/` 根级）

| 文件 | 作用 |
| ---- | ---- |
| `app.tsx` | 应用入口、运行时配置、全局布局 |
| `access.ts` | 权限（access）定义，按后端权限码判定 |
| `requestErrorConfig.ts` | 全局请求 / 错误处理（业务错误 → `BizError`） |
| `global.tsx` `global.less` `global.style.ts` | 全局样式与运行时 |
| `loading.tsx` | 首屏加载态 |
| `service-worker.js` `manifest.json` | PWA 相关 |
| `typings.d.ts` | 全局类型补充 |
| `*.test.ts(x)` | 根级单测（`access` / `app` / `routes` / `requestErrorConfig`） |

### 3.2 `src/auth/` — 认证会话

| 文件 | 作用 |
| ---- | ---- |
| `token.ts` | token 存取、刷新、失效清理 |
| `session.ts` | 会话状态读写 |

> 登录态链路：401 → 静默刷新 token → 重放原请求；刷新自身失败才登出。

### 3.3 `src/services/` — 服务层（**唯一**访问真实后端的地方）

```
services/
├── http.ts            # axios 实例封装（token 注入、错误归一化）
├── response.ts        # 后端信封 {code,msg,data,...} → BizError
├── paginate.ts        # page_no / page_size（后端上限 100）
├── types.ts           # 公共类型
├── api/
│   ├── ai/            # base.ts / client.ts / sse.ts（流式）/ types.ts
│   ├── pm/            # project / task / risk / milestone + paths.ts
│   └── system/        # auth user role dept dict log notice param position ticket + types.ts
└── demo/              # antd-pro 演示页专用（api.ts / login.ts / typings.d.ts）
```

> 约定：**每个 `X.ts` 基本都配一个同名 `X.test.ts`**，单测就近维护。

### 3.4 `src/pages/` — 页面

| 目录 | 内容 |
| ---- | ---- |
| `module_system/` | **系统管理 9 页**：user / role / dept / position / dict / params / log / notice / ticket |
| `module_pm/` | **项目管理 6 路由**：project（含 `detail.tsx`）/ task（含 `board.tsx`）/ risk（含 `Heatmap.tsx`）/ milestone |
| `ai/workspace/` | AI 工作台：`index` / `WideChat` / `IntentGallery` / `RuleSplit` |
| `chatbot/` | 聊天机器人页（Ant Design X） |
| `dashboard/` | `analysis`（图表）/ `monitor`（监控+地图）/ `workplace`（工作台） |
| `account/` | `center`（个人中心）/ `settings`（base / binding / notification / security） |
| `form/` | `basic-form` / `advanced-form` / `step-form`（模板示例） |
| `list/` | `basic-list` / `card-list` / `search/*`（模板示例） |
| `profile/` `result/` `exception/` `table-list/` | 模板示例页 |
| `user/` | `login` / `register` / `register-result` |
| `Admin.tsx` `Welcome.tsx` | 管理页 / 首页 |

> 业务页目录名与后端菜单 `component_path` 对齐（如 `module_system/params`）；
> 路由 `path` 与后端 `route_path` 对齐（单数 `/system/param`）。
> 详情页与看板**只在路由里注册**，菜单中不出现。

### 3.5 `src/components/` — 通用组件

```
components/
├── CrudTable/            # ★ 共享 CRUD 脚手架：useCrudTable / useCrudColumns / useDeleteHandler / CRUD_PAGINATION
├── AntdOperationColumn/  # 表格操作列
├── DeptTreeSelect/       # 部门树选择器（用户/角色/部门页共用）
├── MenuPermissionTree/   # 菜单+按钮权限树（角色授权）
├── TagSelect/ StandardFormRow/ AvatarList/ ArticleListContent/
├── ErrorBoundary/ OfflineBanner/ Footer/ HeaderDropdown/
├── RightContent/         # 顶栏：AvatarDropdown / LangDropdown / VersionDropdown
├── AppMessageBridge.tsx  # 全局 message 桥接
├── pm/                   # PM 专用：DictSelect / DictTag / JsonTags / riskLevel / toValueEnum / useDictOptions
├── ai-workspace/         # AI 工作台组件族：ChatPanel / Composer / MessageBubble /
│                         #   PendingPanel / PendingCard / AuditPanel / CommandCard /
│                         #   useAgentStream / useWorkspace / useAiLists / storage / palette / paths
└── index.ts              # 统一出口（新增组件从这里导出）
```

### 3.6 `src/menu/` `src/locales/` `src/utils/`

| 目录 | 说明 |
| ---- | ---- |
| `src/menu/adapter.ts` | 后端菜单树 → ProLayout 菜单的**唯一**转换处；未注册路由的菜单会被跳过并打印 `[menu] 前端缺少路由: <path>` |
| `src/locales/zh-CN/` `en-US/` | 国际化：`component` / `menu` / `pages` / `globalHeader` / `network` / `settings` / `settingDrawer` |
| `src/utils/` | `appMessage.ts` / `format.ts` / `chinaDivision.ts` |

---

## 四、路由与菜单对照（`config/routes.ts`）

| 路径 | 页面目录 |
| ---- | -------- |
| `/user/login` `/user/register` | `src/pages/user/*`（`layout: false`） |
| `/welcome` | `src/pages/Welcome.tsx` |
| `/system/*` | `src/pages/module_system/*` |
| `/pm/*` | `src/pages/module_pm/*` |
| `/ai/workspace` | `src/pages/ai/workspace` |
| `/admin` | `src/pages/Admin.tsx` |
| `/dashboard/*` `/form/*` `/list/*` `/profile/*` `/result/*` `/exception/*` `/account/*` `/chatbot` | 模板示例页 |

另有四条**重定向路由**（`/module_pm_project/*`、`/module_pm_risk/*`）用于接住后端
按插件源码路径自动生成的菜单，详见 README「PM 菜单」一节。

---

## 五、测试体系

| 层级 | 工具 | 位置 |
| ---- | ---- | ---- |
| 单元 / 组件 | Vitest（browser mode） | 源码同目录 `*.test.ts(x)`；全局 setup 在 `tests/setupTests.ts`，通用 mock 在 `tests/__mocks__/` |
| E2E | Playwright | `e2e/*.spec.ts` + `e2e/helpers.ts`（覆盖 auth / system / pm / ai-workspace） |
| 规范 | Biome lint + `tsc --noEmit` + react-doctor | `npm run lint` / `npm run doctor` |

---

## 六、给新同学的三条实践要点

1. **加页面的顺序**：建 `src/pages/<component_path>/index.tsx` → `config/routes.ts` 注册路由
   → `src/services/api/<模块>/` 加 service → 后端菜单表补 `route_path` / `component_path`。
2. **不要动** `dist/`、`dist-dev/`、`src/.umi*`（Umi 自动生成）。
3. **`.claude/skills/**` 与 `.agents/skills/**` 是两份副本**，不是符号链接，改一处要同步另一处。

---

## 七、AI 部分另有一份文档

AI 是**独立服务**（`ai-admin-ai` 仓，pi agent + MiniMax），架构与事件映射见
[`docs/ai-architecture.md`](ai-architecture.md)。前端相关的位置：

| 位置 | 内容 |
| ---- | ---- |
| `src/services/api/ai/` | REST 客户端 / SSE 客户端 / 数据形状 / 前缀常量 |
| `src/components/ai-workspace/` | 流式状态机、会话管理、侧栏与面板 |
| `src/pages/ai/workspace/` | AI 工作台全宽页 |
