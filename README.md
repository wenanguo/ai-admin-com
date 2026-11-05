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

### 后端证书过期时的本地临时开关（`PROXY_INSECURE_TLS`）

线上后端的 TLS 证书已于 **2026-11-04 23:59:59 过期**,证书校验失败会让**所有**
本地请求 502。`NODE_TLS_REJECT_UNAUTHORIZED=0` 对这条代理**无效**
（http-proxy 会显式把 `rejectUnauthorized` 设成 `true`）,
所以 `config/proxy.ts` 里留了一个**默认关闭**的开关:

```bash
# .env.local（不入库）
PROXY_TARGET=https://www.pmdict.cn
PROXY_INSECURE_TLS=true
```

| 变量                 | 默认值   | 作用                                                               |
| -------------------- | -------- | ------------------------------------------------------------------ |
| `PROXY_TARGET`       | 线上后端 | 代理目标（`/api/` 规则）                                           |
| `PROXY_INSECURE_TLS` | `false`  | **`true` = 跳过后端证书校验**（只影响 `/api/` 规则，其它行为不变） |

⚠️ 这个开关的名字里带 "INSECURE" 是故意的：它关掉的是 **TLS 校验**,
等于把通道降级成「不验证对端身份」。它**只在本地临时用**,
打开时 dev server 启动日志里会打一条醒目的警告。

**证书续签之后**:把 `.env.local` 里的 `PROXY_INSECURE_TLS` 那一行**删掉**即可
（默认值就是校验证书，不需要改 `config/proxy.ts`；`PROXY_TARGET` 那行也可以一并删掉）。

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

PM(项目管理)侧共 6 个路由,同样全部对接真实后端:

| 模块       | 路由              | 页面目录                                 |
| ---------- | ----------------- | ---------------------------------------- |
| 项目列表   | `/pm/project`     | `src/pages/module_pm/project/`           |
| 项目详情   | `/pm/project/:id` | `src/pages/module_pm/project/detail.tsx` |
| 里程碑     | `/pm/milestone`   | `src/pages/module_pm/milestone/`         |
| 任务列表   | `/pm/task`        | `src/pages/module_pm/task/`              |
| 任务看板   | `/pm/task/board`  | `src/pages/module_pm/task/board.tsx`     |
| 风险登记册 | `/pm/risk`        | `src/pages/module_pm/risk/`              |

> 项目详情**只在路由里注册**,菜单里没有这一项 —— 从项目列表点**项目名称**
> 的链接就进得去(`/pm/project/<id>`)。看板也**没有菜单项**(后端没种它),
> 入口是任务列表页工具栏上的「看板」按钮。风险是独立页面,不是列表页的 tab。

PM 的 6 个页面另有两组共享件:

| 共享件               | 路径                   |
| -------------------- | ---------------------- |
| 字典驱动的共享组件   | `src/components/pm/`   |
| PM 模块的 service 层 | `src/services/api/pm/` |

`src/components/pm/` 里是:

- `DictSelect` / `DictTag` / `useDictOptions` —— 字典驱动的选择器与标签
  (选项有模块级缓存,同一个字典只发一次请求)
- `toValueEnum` —— 字典选项 → ProTable 的 `valueEnum`
- `JsonTags` —— JSON 标签串 → Tag
- `riskLevel` —— 风险等级(后端只有 `score`,等级是派生量,阈值集中在这)

`src/services/api/pm/` 里是 `project` / `milestone` / `task` / `risk`
四个模块的接口与类型(字段逐条对齐后端 schema)。

## PM 菜单:后端已经种了,前端用重定向路由接住

PM 的 6 个路由在 `config/routes.ts` 注册,侧边栏里也有入口。

后端的菜单种子**已经交付** —— 它在后端自己的 `platform_menu` 表里
(菜单表就叫 `platform_menu`,后端**没有** `sys_menu` 这张表)。
实测后端 `current/info` 下发的 PM 菜单树是这么一棵:

| id  | 类型 | 标题     | `route_path`                      |
| --- | ---- | -------- | --------------------------------- |
| 339 | 目录 | 项目管理 | `/module_pm_project/pm_project`   |
| 340 | 菜单 | 项目清单 | `/module_pm_project/pm_project`   |
| 351 | 菜单 | 任务     | `/module_pm_project/pm_task`      |
| 362 | 菜单 | 里程碑   | `/module_pm_project/pm_milestone` |
| 372 | 目录 | pm_risk  | `/module_pm_risk/pm_risk`         |
| 373 | 菜单 | 风险     | `/module_pm_risk/pm_risk`         |

**菜单里的路径是后端的插件源码路径**(`/module_pm_*` 那种),不是前端的
`/pm/*` —— 这些菜单行是后端**按插件目录自动生成**的,路径就是插件的目录
结构本身。菜单适配器只认「已在前端路由表注册过」的路径
⇒ 前端在 `config/routes.ts` 里给这四条路径各注册了一条**重定向路由**:

| 后端菜单路径                      | 重定向到        |
| --------------------------------- | --------------- |
| `/module_pm_project/pm_project`   | `/pm/project`   |
| `/module_pm_project/pm_task`      | `/pm/task`      |
| `/module_pm_project/pm_milestone` | `/pm/milestone` |
| `/module_pm_risk/pm_risk`         | `/pm/risk`      |

⇒ 侧边栏点「项目清单」先命中后端那条路径,再由重定向落到真实页面。
(这四条重定向路由挂在**顶层**,与 `/pm` 平级 —— React Router 不允许子路由的
绝对路径脱离父路由路径,挂到 `/pm` 下面会直接抛错白屏。)

所以侧边栏里是**两组**:

- **「项目管理」** —— 项目清单 / 任务 / 里程碑
- **「pm_risk」** —— 风险

> ⚠️ **「pm_risk」这个英文组名是后端自动生成种子时留下的**,前端照原样显示
> (前端只显示后端下发的标题,自己不改名)。同源的还有 `pm_meeting`(会议记录)与
> `pm_comment`(评论)两个目录 —— 它们的菜单**也种下了**,但**本前端还没有页面**
> ⇒ 适配器把这两组整个跳过(控制台打印
> `[menu] 前端缺少路由: /module_pm_meeting/pm_meeting`)。这三个英文目录名
> **该找后端改**,前端这边不用动。

下面这四组是**这四个模块**(项目 / 里程碑 / 任务 / 风险)的 controller 里
`AuthPermission([...])` 校验的**全部**权限码 ——
不只是页面按钮用到的那几个(`export` / `import` / `download` 后端都有接口,
前端这轮还没做按钮,码照样要种下)。**这些码已经种进 `platform_menu` 了**
(是菜单下面的 type=3 按钮节点;菜单项自己那条 `*:query` 码也种了)。
码一般是**三段式**(`模块:实体:动作`),
与 `platform_menu.permission` 列的注释一致:

| 实体                 | 权限码前缀                       | 动作                                                                                                         |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 项目 `pm_project`    | `module_pm_project:pm_project`   | `query` `detail` `create` `update` `delete` `patch` `export` `import` `download` `transition` `member:write` |
| 里程碑`pm_milestone` | `module_pm_project:pm_milestone` | `query` `detail` `create` `update` `delete` `patch` `export` `import` `download`                             |
| 任务`pm_task`        | `module_pm_project:pm_task`      | `query` `detail` `create` `update` `delete` `patch` `export` `import` `download`                             |
| 风险`pm_risk`        | `module_pm_risk:pm_risk`         | `query` `detail` `create` `update` `delete` `patch` `export` `import` `download`                             |

> ⚠️ **后端还有两族权限码不在上面的清单里**:`module_pm_meeting:pm_meeting:*`
> (会议)与 `module_pm_comment:pm_comment:*`(评论)。这两个模块**在本前端还没有页面**
> ⇒ 它们的权限码不在上面这张表里。后端**已经**把这两族连菜单行一起种下了,
> 但前端没页面 ⇒ 适配器把这两组整个跳过(见上面那段)。
> 要开这两块得先补页面。

> ⚠️ **唯一一条没种上的码是 `module_pm_project:pm_project:transition`**
> (后端 `/transition/{id}` 状态推进端点要它)。本前端**不调**那个端点
> (项目状态走普通的更新接口)⇒ 对前端没有影响;哪天真要调它,
> 得让后端把这条码补进 `platform_menu`。

> **第一段是菜单目录**:里程碑与任务挂在 `module_pm_project` 目录下,风险挂在
> `module_pm_risk` 目录下;第二段是实体,第三段是动作 —— 别种成两段。
> **项目成员那条是四段**:`module_pm_project:pm_project:member:write` ——
> 别按上面那个三段式种。
> 任务看板拖拽写的是 `…:update`(不是 `…:patch`),两种码都要给。
> (这几条是**重新种种子**时的记账口径:现有种子就是这么写的。)

## 当前状态与已知限制

- **系统管理侧已经打通**:9 个页面全部走真实后端,列表 / 搜索 / 分页 / 新增 / 编辑 /
  删除 / 批量启停都经 `src/services/api/**`,按钮按后端权限码判定
- **PM 侧页面已经打通**:6 个路由全部走真实后端,侧边栏里也有入口 ——
  后端的菜单种子已交付,前端靠 `config/routes.ts` 里的**重定向路由**接住
  后端的插件源码路径,详见上面「PM 菜单:后端已经种了,前端用重定向路由接住」
- **平台侧与其它侧还没做**:后端菜单种子会下发 `/platform`(平台管理)、`/monitor`(监控管理)、
  `/generator`(代码管理)、`/ai`(AI 管理)、`/task`(任务管理)、`/example`(案例管理)这些目录,
  但前端没有注册对应的路由,`src/menu/adapter.ts` 会把它们跳过,控制台打印
  `[menu] 前端缺少路由: <path>` —— **这是既定行为,不是 bug**。
  将来补页面时只要在 `config/routes.ts` 注册同名路由,菜单就会自动出现,不用改后端
- **导出功能本轮没做**:后端有 `*:export` 权限码,但这 9 个系统管理页面与 6 个 PM 页面
  都没有导出按钮
- **任务页/风险页的名字是侧载的**:后端的任务与风险响应里**没有**项目名/里程碑名,
  前端把项目表与里程碑表各拉一次做映射。后端分页上限是 100 条 ⇒ 侧载只覆盖
  **最新的 100 条**,更早的实体在表格里显示为 `-`(风险页显示为项目 id)。
  这条上限**不静默**:侧载被截断时页面上会给一条提示。
  任务表单的「所属里程碑」下拉是**按所选项目单独拉**的(只含所选项目的里程碑),
  但它自己也受后端 100 条上限约束 —— 所选项目的里程碑超过 100 个时,下拉里只有
  最新的 100 个
- **项目详情页的三个子列表也是一次拉满 100 条**:里程碑 / 任务 / 风险各只拉后端
  上限那一页,不翻页 ⇒ 超过 100 条时只显示最新的一段。这条上限**不静默**:
  被截断的那个 tab 里会给一条提示(说清总数、加载数与未显示的条数)
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
| `src/services/api/**`                      | **唯一**访问真实后端的地方,按后端模块分目录(`pm/` 下是项目 / 里程碑 / 任务 / 风险)                    |
| `src/services/demo/**`                     | antd-pro 演示页专用的 mock 数据访问(已非自动生成)                                                     |
| `src/menu/adapter.ts`                      | 后端菜单树 → ProLayout 菜单的唯一转换处                                                               |
| `src/auth/**`                              | token 存取与会话操作                                                                                  |
| `src/pages/module_*/**`                    | 业务页面,目录名与后端菜单 `component_path` 对齐                                                       |
| `src/components/**`                        | 共用组件(部门树选择器、菜单权限树、CRUD 脚手架),统一出口是 `src/components/index.ts`                  |
| `src/components/pm/**`                     | PM 侧专用共享件(字典选择器 / 标签、JSON 标签、风险等级),只被 PM 页面用                                |
| `.claude/skills/**` 与 `.agents/skills/**` | **两份副本,不是符号链接**:改了一处要同步另一处,否则会漂移(Windows 建符号链接要开发者模式或管理员权限) |

> `skills-lock.json` 里的 `computedHash` 是**上游源文件**的摘要 ——
> 由技能工具(vercel-labs/skills)按它自己的算法算出来。
>
> ⚠️ **在本地复算不出这个值**:仓库提交的字节(LF 的 git blob)与 Windows 上
> `core.autocrlf=true` 检出的字节(CRLF)分别做 sha256,都对不上 `computedHash` ——
> 所以「对技能目录里的原始字节做 sha256」这类说法是**不成立**的,
> 算出来的值不一样是正常的,别拿它当校验基线。
>
> 改了技能文件之后,用**官方的技能工具**重新生成 `skills-lock.json`,
> 不要手改里面的哈希。

## 菜单约定

后端菜单决定**显示什么**,前端 `config/routes.ts` 决定**能点开什么**:

- 后端 `/system/user/current/info` 返回的 `menus` 已建好树
- 前端路由的 `path` 必须与菜单 `route_path`(相对父目录拼接后的绝对路径)一致
  —— **唯一的例外**:后端的菜单路径是**插件源码路径**时,前端给它注册一条
  **重定向路由**接住(PM 就是这么做的,见「PM 菜单」那一节)
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

> **内存吃紧的机器上跑 e2e 要降并发**:`npm run e2e -- --workers=3`。
> Playwright 的默认 worker 数是**逻辑核数的一半**(12 核 ⇒ 6 个),
> 每个 worker 一个 Chromium —— 在本机上 6 个 worker 会把可用内存从
> 4.2 GB 压到 1.8 GB,内存再紧一点浏览器就会被系统杀掉(用例随机失败)。
> `playwright.config.ts` 里**故意不写死** `workers`:CI 机器内存更多,
> 6 个并发更快(实测 1.5 分钟 vs 3 个 worker 的 1.8 分钟),
> 把本地这个坑写进配置会让 CI 一起变慢。

## 相关文档

- 设计规格:`docs/superpowers/specs/2026-10-30-ai-admin-frontend-template-design.md`
- 实现计划:`docs/superpowers/plans/2026-10-30-ai-admin-frontend-template.md`
- 系统管理补齐的设计规格:`docs/superpowers/specs/2026-11-02-ai-admin-system-modules-design.md`
- 系统管理补齐的实现计划:`docs/superpowers/plans/2026-11-02-ai-admin-system-modules.md`
- PM 页面的设计规格:`docs/superpowers/specs/2026-11-03-aipm-frontend-design.md`
- PM 页面的实现计划:`docs/superpowers/plans/2026-11-03-aipm-frontend-pm-pages.md`
- 修复记录:`docs/superpowers/plans/2026-10-31-ai-admin-frontend-template-fix-wave.md`、
  `docs/superpowers/plans/2026-10-31-ai-admin-frontend-template-review-round.md`
- 上游说明:`README.ant-design-pro.md`
