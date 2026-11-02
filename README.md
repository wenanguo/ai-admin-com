# AiAdmin 前端基础模板

基于 [Ant Design Pro](https://pro.ant.design/) v6(Umi Max 4 + antd 6 + ProComponents 3 + React 19)的后端管理前端模板,
对接 AiAdmin FastAPI 后端。

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

> 代理按环境挑选是靠 `config/config.ts` 里的 `proxy: proxy[UMI_ENV]` 这一行实现的,
> 改代理时不要动它。

### 构建产物目录

`config/config.ts` 里 `outputPath` 按环境分开了:

| 场景                                | 目录        | 说明                                          |
| ----------------------------------- | ----------- | --------------------------------------------- |
| `npm run build` / `npm run preview` | `dist/`     | 生产构建产物(49 个静态 HTML + 带 hash 的资源) |
| `npm start` / `npm run dev`         | `dist-dev/` | dev server 的 utoopack lazy-compilation chunk |

**不要让 dev 写进 `dist/`** —— umi 的 dev 与 build 共用同一个 `outputPath`
(`@umijs/preset-umi` 的 `commands/dev/dev.js` 与 `commands/build.js` 都是
`userConfig.outputPath || 'dist'`),所以历史上 `npm start` 会把构建产物冲掉。
build / preview 这一对命令统一用 `UMI_OUTPUT_PATH=dist` 显式约定,
`max preview` 的进程跑在 `NODE_ENV=development` 下,靠 NODE_ENV 判断会去找 `dist-dev`。

## 模块清单

系统管理侧共 9 个页面,全部对接真实后端(不走 mock):

| 模块     | 路由               | 页面目录                            |
| -------- | ------------------ | ----------------------------------- |
| 用户管理 | `/system/user`     | `src/pages/module_system/user/`     |
| 岗位管理 | `/system/position` | `src/pages/module_system/position/` |
| 参数管理 | `/system/param`    | `src/pages/module_system/params/`   |
| 日志管理 | `/system/log`      | `src/pages/module_system/log/`      |
| 部门管理 | `/system/dept`     | `src/pages/module_system/dept/`     |
| 角色管理 | `/system/role`     | `src/pages/module_system/role/`     |
| 字典管理 | `/system/dict`     | `src/pages/module_system/dict/`     |
| 公告管理 | `/system/notice`   | `src/pages/module_system/notice/`   |
| 工单管理 | `/system/ticket`   | `src/pages/module_system/ticket/`   |

> 参数管理的路由是单数 `param`(跟后端菜单 `route_path` 对齐),
> 目录是复数 `params`(跟后端 `component_path` 对齐)。

这 9 个页面不是各写各的,共用下面三样东西 —— 新增模块时照着抄:

| 复用件           | 路径                                 | 用途                                                                       |
| ---------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| 部门树选择器     | `src/components/DeptTreeSelect/`     | 选部门 id:部门页选上级部门、角色页自定义数据权限、用户表单选所属部门       |
| 菜单权限树       | `src/components/MenuPermissionTree/` | 角色授权时勾选菜单(含按钮)权限,数据源是 `current/info` 返回的 `menus` 树   |
| 共享 CRUD 脚手架 | `src/components/CrudTable/`          | `useCrudTable` / `useCrudColumns` / `useDeleteHandler` / `CRUD_PAGINATION` |

三者的出口都在 `src/components/index.ts`。

## 当前状态与已知限制

- **系统管理侧已经打通**:9 个页面全部走真实后端,列表 / 搜索 / 分页 / 新增 / 编辑 /
  删除 / 批量启停都经 `src/services/api/**`,按钮按后端权限码判定
- **平台侧与其它侧还没做**:后端菜单种子会下发 `/platform`(平台管理)、`/monitor`(监控管理)、
  `/generator`(代码管理)、`/ai`(AI 管理)、`/task`(任务管理)、`/example`(案例管理)这些目录,
  但前端没有注册对应的路由,`src/menu/adapter.ts` 会把它们跳过,控制台打印
  `[menu] 前端缺少路由: <path>` —— **这是既定行为,不是 bug**。
  将来补页面时只要在 `config/routes.ts` 注册同名路由,菜单就会自动出现,不用改后端
- **导出功能本轮没做**:后端有 `*:export` 权限码,但这 9 个页面都没有导出按钮
- **公告是纯文本**:公告正文用普通多行文本框录入,不是富文本编辑器

## 登录与登录态

- 登录接口是 **form-urlencoded**,验证码是一次性的:后端每次校验都会消耗掉它,
  密码错一次就得换一张图
- 登录成功后的落地页是 `config/routes.ts` 里 `path: '/'` 那条路由的 `redirect`,
  当前指向 `/system/user`(系统管理的第一项);换了菜单记得同步改这里
- 登录态失效的链路:401 → 静默刷新 token → 重放原请求。
  刷新接口自己失败时(后端返回 HTTP 500 + 业务信封),会清掉本地登录态并跳回登录页;
  纯网络故障则不登出,只把错误抛给调用方
- **新建用户要选角色**:后端 `UserCreateSchema.role_ids` 默认是 `[]`,
  没有角色的账号登录后是空的(既没有菜单也没有权限码)

## 目录约定

| 目录                                       | 说明                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/services/api/**`                      | **唯一**访问真实后端的地方,按后端模块分目录                                                           |
| `src/services/demo/**`                     | antd-pro 演示页专用的 mock 数据访问(已非自动生成)                                                     |
| `src/menu/adapter.ts`                      | 后端菜单树 → ProLayout 菜单的唯一转换处                                                               |
| `src/auth/**`                              | token 存取与会话操作                                                                                  |
| `src/pages/module_*/**`                    | 业务页面,目录名与后端菜单 `component_path` 对齐                                                       |
| `src/components/**`                        | 共用组件(部门树选择器、菜单权限树、CRUD 脚手架),统一出口是 `src/components/index.ts`                  |
| `.claude/skills/**` 与 `.agents/skills/**` | **两份副本,不是符号链接**:改了一处要同步另一处,否则会漂移(Windows 建符号链接要开发者模式或管理员权限) |

> `skills-lock.json` 里的 `computedHash` 是按**仓库提交的字节**(LF)算的:
> 技能工具(vercel-labs/skills)对技能目录里的原始字节做 sha256,
> 而 Windows 上 `core.autocrlf=true` 的检出是 CRLF —— 同一份技能在不同平台
> 算出来的摘要不一样,改技能文件后记得用同一套字节重算。

## 菜单约定

后端菜单决定**显示什么**,前端 `config/routes.ts` 决定**能点开什么**:

- 后端 `/system/user/current/info` 返回的 `menus` 已建好树
- 前端路由的 `path` 必须与菜单 `route_path`(相对父目录拼接后的绝对路径)一致
- 对不上的菜单项会被跳过,控制台打印 `[menu] 前端缺少路由: <path>`(同一条路径只提示一次)
- **菜单图标取前端路由表的**:后端下发的 `icon` 是 Remix Icon 类名(`ri:xxx`),
  ProLayout 认不出来,会当作文本直接显示

新增业务页面的步骤:

1. 在 `src/pages/<后端 component_path>/index.tsx` 建页面
2. 在 `config/routes.ts` 注册路由,`path` 与后端 `route_path` 一致
3. 在 `src/services/api/<模块>/` 加 service
4. 在后端菜单表里补上对应的 `route_path` / `component_path`

## 接口约定

后端统一返回信封 `{ code, msg, data, status_code, success }`,`code === 0` 才算成功。

- **业务错误走 HTTP 500 + 信封**(`code: -1`),请求层会统一转成 `BizError`,
  调用方拿 `error.info.msg` 就能拿到后端的中文提示
- 登录接口是 **form-urlencoded**,不是 JSON
- 分页参数是 `page_no` / `page_size`,`page_size` 上限 100
- `DELETE /system/user/delete` 的请求体是**裸数组** `[1, 2]`,不是 `{ ids: [...] }`

## 常用命令

| 命令                  | 说明                                                          |
| --------------------- | ------------------------------------------------------------- |
| `npm run dev`         | 开发(真实后端)                                                |
| `npm start`           | 开发(带演示页 mock)                                           |
| `npm run build`       | 构建                                                          |
| `npm run lint`        | Biome + tsc                                                   |
| `npm test`            | 单元测试                                                      |
| `npm run e2e`         | Playwright 端到端(先构建再跑,接口全部拦截,**不需要真实账号**) |
| `npm run e2e:only`    | 同上,但复用已有 `dist/`,不重新构建                            |
| `npm run biome`       | 自动修复格式                                                  |
| `npx antd lint ./src` | antd 专有检查(废弃用法等)                                     |

## 相关文档

- 设计规格:`docs/superpowers/specs/2026-10-30-ai-admin-frontend-template-design.md`
- 实现计划:`docs/superpowers/plans/2026-10-30-ai-admin-frontend-template.md`
- 系统管理补齐的设计规格:`docs/superpowers/specs/2026-11-02-ai-admin-system-modules-design.md`
- 系统管理补齐的实现计划:`docs/superpowers/plans/2026-11-02-ai-admin-system-modules.md`
- 修复记录:`docs/superpowers/plans/2026-10-31-ai-admin-frontend-template-fix-wave.md`、
  `docs/superpowers/plans/2026-10-31-ai-admin-frontend-template-review-round.md`
- 上游说明:`README.ant-design-pro.md`
