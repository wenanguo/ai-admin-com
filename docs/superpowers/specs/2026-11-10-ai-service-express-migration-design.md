# AI 服务 HTTP 层：Next.js → Express 迁移设计

日期：2026-11-10
状态：待批准（用户已选定「方案 A（直改）+ 彻底删掉 Next」）

## 1. 意图与背景

`ai-admin-ai` 现在用 Next.js 的 **App Router Route Handlers** 提供 10 个 HTTP 端点
（REST + SSE）。但 Next 在这个仓里只干了这些事：

```
src/app/
├── layout.tsx      占位（只有 <html><body>）
├── page.tsx        占位
└── api/**/route.ts 真正干活的：9 个路由文件、10 个方法
```

**它没有渲染任何真实页面**，而 agent 内核（`src/agent/**`、`src/tools/**`、
`src/adapter/**`、`src/aadmin/**`）对 Next **零依赖**（`grep "from 'next"` = 0 处）。
⇒ Next 在这里是**一层纯负担**：为了 10 个端点引入了打包器、路由约定、
`serverExternalPackages` 的原生依赖排除、`globalThis` 单例热重载 hack，
而生产形态是「Web 服务器」，不是「agent 常驻进程」。

**目标**：把 HTTP 层换成 **Express 5**，让这个服务成为一个**直白的 Node 服务**：
`node dist/server.js` 就是它，没有框架、没有打包器。

**非目标（本轮不做）**：不引入 UI；不改 agent 内核；不改前端；不改后端；
不改 MCP 协议与 SSE 事件格式；不做多进程/水平扩展。

**反目标（做成即失败）**：
- 端点的**对外行为**有任何变化（路径、HTTP 状态码、信封 `{code,msg,data}`、
  CORS 头、SSE 帧序列）⇒ 前端与 AI 服务的其它部分会静默坏掉；
- 生产环境需要 Next 或打包器才能跑；
- 为了换框架而重写 agent 内核。

## 2. 约束

| 约束 | 说明 |
| --- | --- |
| **前端零改动** | 浏览器侧走 `/ai-api/` 代理 ⇒ 服务端必须仍挂在 `/api/agent/**`、`/api/pending`、`/api/audit` |
| **pi SDK 是 ESM-only** | `@earendil-works/pi-coding-agent` 的 `exports` 只有 `import` ⇒ **CommonJS 产物 require 不了它** ⇒ 产物必须是 ESM |
| **pi SDK 不能打包** | 带 node:fs / jiti / quickjs-wasm 等原生/动态依赖 ⇒ 只能「转译 + 依赖留在 node_modules」 |
| **agent 内核零改动** | `src/agent/**` 等不依赖框架 ⇒ 只动协议层 |
| **信封与错误语义不变** | `{code, msg, data}`；`code===0` 成功，失败是 HTTP 语义码 |
| **CORS 回具体源** | 已在 `src/http/cors.ts` 自己实现 ⇒ 不引 `cors` 包 |
| **token 透传** | 本服务不解析 token，只把 `Authorization: Bearer` 转给 AiAdmin |
| **不引新运行时依赖**（除 express 本身） | 测试用 Node 内置 `fetch`，不用 supertest |

## 3. 方案对比（已选定）

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **A（选定）** | Express 原生风格重写 10 个端点；**先补 route 层测试**再改 | 代码最直白；风险靠「先补测试」变成有网作业 |
| B | 保留 Web 标准 handler，加 Express⇄Web 适配层 | handler 一行不改、零风险；但多一层间接，且「Express 服务里写着 Web handler」与目标相反 |
| C | Express + Next 并存（Next 留给将来的 UI） | 两个进程两套运行时，复杂度反增 |

**选定 A**（用户已确认），**并且彻底删掉 Next**（用户已确认）：
不保留 Next 作为 UI 载体 —— 这个服务今天没有任何真实页面，将来要 UI 应该单独做前端页面，
而不是让 agent 守护进程里塞个 Next。

## 4. 目标结构

```
src/
├── server.ts              ★ 新：createApp()（可测）+ start()（监听 3100）
├── routes/                ★ 新：替代 src/app/api/**
│   ├── agent.ts           conversations / command / events / state / abort
│   ├── pending.ts         列表 / approve / reject
│   └── audit.ts           审计列表
├── http/                  ✎ 改：改成 Express 风格（语义不变）
│   ├── respond.ts         okEnvelope(res,…)、errorEnvelope(res,…)、preflight
│   ├── errors.ts          errorResponse(res, error)
│   ├── cors.ts            buildCorsHeaders(origin, origins)（与框架解耦）
│   ├── auth.ts            extractBearerToken(req)
│   └── sse.ts             SSE 头 + 帧拼装（逻辑不变）
├── agent/ …               ✔ 不动
├── tools/ adapter/ aadmin/ ✔ 不动
└── app/**                 ✗ 删除
next.config.ts             ✗ 删除
next-env.d.ts              ✗ 删除
```

## 5. 关键映射（Web 标准 → Express）

| 现在（Next/Web） | 改成（Express 5） |
| --- | --- |
| `request.headers.get('authorization')` | `req.get('authorization')` |
| `await request.json()` | `req.body`（`express.json()` 中间件） |
| `{ params }: { params: Promise<{id}> }` | `req.params.id` |
| `new Response(json, {status, headers})` | `res.status(code).json(body)`（CORS 头由中间件统一挂） |
| `new ReadableStream` + `controller.enqueue` | `res.write(chunk)` |
| `request.signal` 的 abort | `req.on('close', …)` |
| 每个路由各导出一个 `OPTIONS` | 一个 app 级 CORS 中间件统一处理预检（204） |
| `export const runtime = 'nodejs'` | 删除（Express 天然就是 Node） |
| `export const dynamic = 'force-dynamic'` | 删除 |

## 6. SSE（重点：唯一有状态的长连接）

```ts
res.writeHead(200, { ...SSE_HEADERS, ...corsHeaders });
res.flushHeaders?.();                       // 别让代理/内核缓冲
res.write(sseFrame('connected', { … }));    // 首帧
for (const frame of snapshot) res.write(frameToSse(frame));   // 回放
unsubscribe = agentRuntime.subscribe(cid, (f) => {
  if (f.seq > snapshotMaxSeq) res.write(frameToSse(f));       // 增量
});
const heartbeat = setInterval(() => res.write(sseComment('heartbeat')), 15_000);
req.on('close', () => { clearInterval(heartbeat); unsubscribe?.(); });
```

**保持不变的语义**：首帧 `connected` → 回放快照 → 增量帧 → 15 秒心跳注释；
断连时清理心跳与订阅（今天的 `finish()`/`cancel()` 逻辑照搬）。

## 7. 构建与运行（关键技术选择）

### 7.1 为什么产物必须是 ESM
pi SDK 是 ESM-only ⇒ CommonJS 产物 `require()` 不了它（已实测：`exports` 只有 `import`）。

### 7.2 采用：tsc + ESM + `rewriteRelativeImportExtensions`

```jsonc
// tsconfig.build.json（新增）
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "rewriteRelativeImportExtensions": true,   // 源码写 ./x.ts ⇒ 产物 ./x.js
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "node_modules", "spike"]
}
```

**代价**：所有相对 import 要加 `.ts` 后缀（**181 处**，含测试）⇒ 机械改动，脚本化处理。
**收益**：零 bundler、零 import 改写插件、类型检查与产物同源。

⚠️ 实测已验证（spike）：
- `module: nodenext` + `"type": "module"` ⇒ 产物是 **ESM**；
- `rewriteRelativeImportExtensions` ⇒ 源码 `./a.ts` 编译成 `./a.js`；
- 产物里 `import { createAgentSession } from "@earendil-works/pi-coding-agent"` **运行时正常**；
- **vitest 能解析 `.ts` 后缀的相对 import**（测试不受影响）。

### 7.3 tsconfig.json（开发/类型检查）改动
- 删 `plugins: [{name:'next'}]`、`jsx: 'preserve'`；
- `include` 去掉 `next-env.d.ts` 与 `.next/types/**/*.ts`；
- `module`/`moduleResolution` 保持 `esnext`/`bundler`（仅用于 typecheck，不 emit）。

### 7.4 package.json
- **保留** `"type": "module"`；
- 新增依赖：`express@^5.1.0`；新增开发依赖：`@types/express@^5`、`tsx@^4`（dev 热重载）；
- 脚本：

| 脚本 | 现在 | 之后 |
| --- | --- | --- |
| `dev` | `next dev -p 3100` | `tsx watch src/server.ts` |
| `build` | `next build` | `tsc -p tsconfig.build.json` |
| `start` | `next start -p 3100` | `node --env-file=.env dist/server.js` |
| `typecheck` | `tsc --noEmit` | 不变 |
| `test` | `vitest run` | 不变 |

⚠️ **`.env` 加载**：Next 会自动读 `.env`；Express 不会 ⇒ 用 Node 的 `--env-file`
（Node 20.12+ / 本机 26 支持）。为稳妥，`src/server.ts` 顶部再兜底调一次
`process.loadEnvFile?.()`（存在才调、失败不致命）⇒ dev/prod 都不依赖命令行参数。

## 8. 测试策略（先补网，再改实现）

**今天缺什么**：route handler 层**没有任何测试**（只有 `src/http/cors.test.ts`、
`errors.test.ts`）⇒ 直接重写 10 个端点属于「无网作业」。

**因此顺序是：① 先补 route 层测试（对着现有 Next 实现写，锁定行为）② 再重写实现。**

测试方式（**不引新依赖**）：
```ts
const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const res = await fetch(`${base}/api/pending`, { headers: { … } });
server.close();
```
- `createApp()` 从 `src/server.ts` 导出（**不监听**）⇒ 测试可随意起停；
- 断言点：HTTP 状态码、信封形状、CORS 头（`Access-Control-Allow-Origin` 回具体源）、
  缺 token ⇒ 401、`SSE` 首帧是 `connected` 且帧序列可解析。

**新增测试文件**：`src/routes/*.test.ts`（每个路由文件一份）。

⚠️ 实现细节提醒：
- `express.json()` 的**默认 body 上限是 100kb**，而 Next 是 1MB ⇒ 必须写
  `express.json({ limit: '1mb' })`，否则行为与现在不一致；
- 路由 handler 直接 import 了**模块级单例** `agentRuntime` ⇒ 测试要用
  `vi.mock` 掉它（照 `src/agent/runtime.test.ts` 的做法），
  否则测试会真连数据库/真调模型；
- `.gitignore`：删 `.next/`，加 `dist/`。

## 9. 风险与回滚

| 风险 | 处置 |
| --- | --- |
| 改 181 处 import 漏改 | `tsc --noEmit` 立刻暴露（类型检查阶段就红） |
| SSE 在 Express 下行为漂移 | 先写 SSE 测试（首帧/回放/心跳/断连清理）再改 |
| 忘记删 next 依赖/配置 | 收尾清单里逐条核对；`package.json` 里不应再有 `next` |
| 生产起不来 | `npm run build && npm start` 本地起一次真实冒烟（打 `/api/pending` 与一次 SSE） |
| 回滚 | 改动集中在少数提交 ⇒ `git revert` 即可；过渡期可让 Express 跑 3101、Next 跑 3100 对比 |

## 10. 实施清单（交给实现者）

1. **补 route 层测试**（对着现状写）：`src/routes/*.test.ts` —— 9 个路由文件、10 个方法；
   同时补 `src/http/cors.test.ts`（`buildCorsHeaders` 改签名后）与 `errors.test.ts`。
2. **改 `src/http/*`** 成 Express 风格（语义不变）：
   `buildCorsHeaders(origin, origins)`、`extractBearerToken(req)`、
   `okEnvelope/errorEnvelope/preflight(res, …)`、`errorResponse(res, error)`。
3. **写 `src/server.ts`**：`createApp()` + `start()`；中间件顺序
   （CORS/预检 → `express.json()` → 路由 → 404 JSON → 错误中间件）；
   优雅退出（SIGTERM/SIGINT ⇒ 停心跳、关 SSE、`server.close()`）。
4. **写 `src/routes/*`**：9 个路由文件，逐个搬 handler 逻辑。
5. **机械改 import**：所有相对 import 加 `.ts` 后缀（脚本处理，181 处）。
6. **改配置**：`tsconfig.json`、新增 `tsconfig.build.json`、`package.json`（依赖与脚本）。
7. **删 Next**：`src/app/**`、`next.config.ts`、`next-env.d.ts`、`next` 依赖。
8. **更新 README**（启动方式、端口、`.env`、与前端的代理关系）。
9. **门禁**：`tsc --noEmit` → `vitest run`（29 文件 + 新增路由测试）→ `npm run build` →
   `node --env-file=.env dist/server.js` 真实冒烟（REST + SSE）→ 前端 e2e 不受影响（路径未变）。

## 11. 我（架构侧）已做的小决定

- 产物用 **ESM + tsc**，不用 esbuild 打包（pi SDK 不能打包，且 tsc 与类型检查同源）；
- 开发热重载用 **tsx**（唯一一个新开发依赖）；
- 测试用 **Node 内置 fetch + `app.listen(0)`**，不引 supertest；
- 路由文件按领域合并成 3 个（`agent.ts` / `pending.ts` / `audit.ts`），不按端点拆 10 个文件；
- CORS 中间件**统一处理预检**，不再每个路由写 `OPTIONS`；
- 端口沿用 **3100**，`PORT` 环境变量可覆盖。

## 12. 已定的两个关键选择（不再开放讨论）

| 选择 | 结论 |
| --- | --- |
| 是否保留 Next 作为 UI 载体 | **不保留**（用户已确认「彻底删掉 Next」） |
| 是否保留 `next start` 作为临时回退开关 | **不保留** —— Next 那套已经不能独立跑，保留只会变成两套死代码；回退靠 git revert |
