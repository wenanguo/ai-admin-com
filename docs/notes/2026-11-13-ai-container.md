# AI 服务容器化 + 健康检查（2026-11-13）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue #39 · PR #45（已合并）
- **一句话**：把 `backend/ai/` 做成可独立运行的镜像（多阶段 Dockerfile），并**新增**
  `GET /health`（**恒 200**、带逐依赖自检结果）。

## 状态

已完成（PR #45 已合并、CI 全绿）—— 实现要点见下。

⚠️ **收尾时踩的坑（工具链的，不是本条的）**：

- `scripts/agent/merge-pr.cjs` **合并成功后仍会崩**（`git pull --ff-only` 之后：
  它的 `tryRun` 对 `stdout === null` 直接 `.trim()` ⇒ `TypeError`）⇒ 合并本身成功，
  但脚本后半段（切回 main / 删本地分支 / `fetch --prune`）没跑 ⇒ **要手工收尾**。
  （上一棒在 #38 就踩过同一个坑，**还没修** ⇒ 该给 PM 单独开单。）
- 这次还发现：**合并脚本清理分支时会把「工作区」（worktree）里的文件删掉**
  ⇒ `gh pr merge --delete-branch` 把 agent 的工作区（`D:/project/ai-admin-com-worktrees/dev`）
  删得只剩两个 `node_modules` 软链 ⇒ **下一棒开工前先确认工作区还在**，
  不在就 `node scripts/agent/worktree.cjs add dev` 重建（它会重接 node_modules）。
  ⚠️ 重建前先把残留的软链 `rm` 掉（**用 `rm` 不要用 `rm -r`** ⇒ 别把主 checkout 的
  `node_modules` 删了）。

## 短设计（规模：中 ⇒ 几段话，不写 spec）

1. **镜像**：`backend/ai/Dockerfile`，**构建上下文 = 仓根**（与前端镜像同构 ⇒ 共用仓根
   `.dockerignore`）。两阶段：builder（node 22 ⇒ `npm ci` ⇒ `tsc` ⇒ `prisma generate`）
   ⇒ runtime（`npm ci --omit=dev` ⇒ 只拷 `dist/` + 生成的 prisma 客户端 + `/app/.pi`）。
2. **健康检查**：新路由 `backend/ai/src/routes/health.ts`，挂在**根路径 `/health`**（不跟业务
   路由混在一起），**不要 token**，**恒回 200**；依赖状态写在 `checks` 里，
   `status` 汇总成 `ok` / `degraded`。
3. **自检三条**：数据库只做 **TCP 连通性**（不跑 SQL、不碰 prisma 引擎）、AiAdmin 发一个普通
   HTTP GET（连得上就算 up）、模型只看 key 在不在（**不调模型 API**）。
   探针并行、每个 2 秒超时、结果缓存 5 秒。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `feat(ai)` | `backend/ai/Dockerfile`（多阶段）+ 仓根 `.dockerignore` 放行 `backend/ai` |
| `feat(ai)` | `GET /health`（`src/routes/health.ts` + `health-probes.ts` + 挂到 `server.ts`） |
| `test(ai)` | `src/routes/health.test.ts`（12 条：口径 / 探针 / 缓存 / 地址解析） |
| `test(e2e)` | `scripts/e2e/ai-container.static.cjs`（静态断言）+ `ai-container.cjs`（真起容器） |
| `ci` | `.github/workflows/docker-ai.yml`（static + image 两个 job） |
| `docs(ai)` | `backend/ai/README.md`「容器」那节 + `docker/README.md` + `scripts/e2e/README.md` |

**下一步（具体到文件与命令）**：无（本条已收尾）。后续相关：

- **#C（编排）**：compose 里给 AI 服务加 healthcheck（镜像里已有 `HEALTHCHECK`），
  并在 nginx 侧加 `proxy_buffering off;`（SSE 不缓冲）。
- **#E（部署文档）**：把「凭据挂载 `/app/.ai`」写进部署清单。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **`/health` 恒回 200**（依赖挂了也 200） | 探针回非 200 ⇒ 编排系统把**还活着的容器**杀掉重启（雪崩） | 服务抖动 ⇒ 容器连环重启 |
| **健康检查不要 token、挂在根路径** | 编排系统没有用户 token；混进 `/api/agent` 会和业务路由混淆 | 探针 401 ⇒ 容器永远「不健康」 |
| **数据库只探 TCP，不跑 SQL** | 探针不该有副作用，也不该依赖 prisma 引擎/驱动（`mysql2` 是 devDependency） | 探针在生产里堆积连接 / 拖慢响应 |
| **`skipped` 不算 degraded** | 没配某个依赖不是故障 | 每次都「degraded」⇒ 看不出真故障 |
| **基础镜像用 `node:22-bookworm-slim`，不用 alpine** | prisma 查询引擎在 musl 上要另配 openssl、还要挑对引擎变体 | 容器一起来就报引擎找不到 |
| **`npm ci --omit=dev --ignore-scripts`（runtime）** | `prisma` CLI 是 devDependency ⇒ 运行时生成不了客户端 ⇒ 必须从 builder 拷 `.prisma`；`--ignore-scripts` 免得 `@prisma/client` 的 postinstall 在没有 schema 的容器里失败 | 镜像里没有 prisma 客户端 ⇒ 服务一起来就炸 |
| **启动命令 `node dist/main.js`（不用 `--env-file=.env`）** | 容器里没有 `.env` ⇒ `--env-file` 缺文件会**直接退出**；`src/load-env.ts` 本来就是「有就读、没有就用环境变量」 | 容器一起来就退出，日志只有一行 `ENOENT` |
| **`prisma generate` 排在 `tsc` 之前** | `@prisma/client` 的类型是从 `.prisma/client` re-export 的 ⇒ 客户端没生成时 tsc 编译不过 | 镜像构建直接失败（CI 第一版就踩了） |
| **运行时显式删掉 `prisma` CLI / `typescript`** | 它们是 `@prisma/client` 的 **peerOptional** 依赖 ⇒ npm 会装上 ⇒ `--omit=dev` 拦不住（`npm prune --omit=dev` 也不行） | 镜像里多出开发工具（还带 50MB 查询引擎）⇒ 违反「镜像里没有 devDependencies」 |
| **仓根 `.dockerignore` 放行 `backend/ai`** | AI 镜像要从这里取 `package.json` / `src` / `prisma` / `.pi` ⇒ 整目录排掉 ⇒ 构建直接失败 | 镜像构建失败（`backend/` 被排掉） |
| **技能拷到 `/app/.pi`（WORKDIR=/app）** | 技能是 **cwd 相对**（`join(process.cwd(), ".pi", "skills")`）⇒ 相对位置必须一致 | `load_skill` 读不到技能 ⇒ AI 少一半能力，且**不报错** |

## 怎么验

```bash
# 单元测试（12 条）
cd backend/ai && npx vitest run src/routes/health.test.ts

# 静态断言（不需要 docker，任何机器都能跑）
node scripts/e2e/ai-container.static.cjs

# 真起容器（需要 docker；没 docker ⇒ 打印 SKIP 并退出 0）
node scripts/e2e/ai-container.cjs
```

## 坑与提醒

- ⚠️ **镜像里的 prisma 客户端要先 generate 再 tsc**：`@prisma/client` 的类型是从
  `.prisma/client` re-export 的 ⇒ 客户端没生成时 `tsc` 报
  `Module '"@prisma/client"' has no exported member 'PrismaClient'`。
- ⚠️ **`--omit=dev` 拦不住 peerOptional**：`@prisma/client` 把 `prisma`（CLI）与 `typescript`
  声明成 peerOptional ⇒ npm 会把它们装上（`npm prune --omit=dev` 也不行）⇒ 镜像里会多出
  CLI（还带 50MB 的查询引擎）与 typescript ⇒ **运行时阶段要显式 `rm -rf`**。
  （两条都是 CI 的 container job 真跑出来的，本机没有 docker。）
- ⚠️ **本机没有 docker** ⇒ 镜像**没有在本地真构建过**；构建正确性靠 CI
  （`.github/workflows/docker-ai.yml` 的 image job，GitHub runner 自带 docker）。
  第一次在本地跑容器验收前，先 `docker build` 一次。
- ⚠️ **`.dockerignore` 是共用的**：改它 ⇒ 前端镜像的构建上下文也变（前端 Dockerfile 只
  `COPY` 特定目录 ⇒ 镜像内容不变，只是上下文变大）。
- ⚠️ **`prisma generate` 要联网**（下载查询引擎）⇒ 构建机没网会失败。
- ⚠️ **凭据挂载点是 `/app/.ai`**（pi 的 `AGENT_DIR = join(process.cwd(), ".ai")` ⇒ 固定
  在 WORKDIR 下）⇒ 部署时要挂对位置，否则 pi 找不到凭据。
