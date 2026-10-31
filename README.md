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

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发(真实后端) |
| `npm start` | 开发(带演示页 mock) |
| `npm run build` | 构建 |
| `npm run lint` | Biome + tsc |
| `npm test` | 单元测试 |
| `npm run biome` | 自动修复格式 |
| `npx antd lint ./src` | antd 专有检查(废弃用法等) |

## 相关文档

- 设计规格:`docs/superpowers/specs/2026-10-30-ai-admin-frontend-template-design.md`
- 实现计划:`docs/superpowers/plans/2026-10-30-ai-admin-frontend-template.md`
- 上游说明:`README.ant-design-pro.md`
