# 端到端验收脚本

> 这些脚本**会真的改 AiAdmin 里的数据** ⇒ 只在测试环境跑。

| 脚本 | 干什么 |
| ---- | ------ |
| `login.cjs` | 登录取 access token（验证码答案从 Redis 读；本地开发环境才有）⇒ 写到 `.scratch/token.txt` |
| `ai-gate.cjs` | 浏览器跑一遍「AI 改任务 → 挂起等人点头 → 同意 → 任务真被改」 |
| `ai-agent-picker.cjs` | 浏览器跑一遍「工作台选智能体 → 另起一个会话 → 新会话真的用这个智能体（旧会话没被动）」 |
| `web-container.static.cjs` | **静态断言**前端镜像的配置（Dockerfile / nginx.conf / 模板 / .dockerignore）⇒ **不需要 docker** |
| `web-container.cjs` | **真起容器**验收前端镜像（构建 → `nginx -t` → 首页 → SPA fallback → 缓存头 → `/healthz`）⇒ 需要 docker |
| `compose.static.cjs` | **静态断言** compose 编排（服务/端口/网络/限制/日志 + 三条路由口径 + `.env.example`）⇒ **不需要 docker** |
| `compose.cjs` | **真起 compose** 验收（`config` → `up -d --build` → 两个容器 healthy → 三条路由 + 端口边界）⇒ 需要 docker |
| `deploy-script.cjs` | 验收 `docker/deploy.sh`（默认只检查、不改东西；有回退提示；不打印凭据）⇒ 只需 **bash** |
| `deploy.cjs` | **端到端部署验收**（起 compose ⇒ 两个容器 healthy ⇒ 前端 HTML / `/api/` 通 / `/ai-api/` 通 / AI `/health` 200 ⇒ 清干净）⇒ 需要 docker |
| `ai-container.static.cjs` | **静态断言**AI 服务镜像的配置（Dockerfile / .dockerignore / 健康检查路由 / SSE 头）⇒ **不需要 docker** |
| `ai-container.cjs` | **真起容器**验收 AI 服务镜像（构建 → 镜像里没凭据/没 devDeps → 技能就位 → `/health` 200 → 业务路由挂载）⇒ 需要 docker |
| `reuse-core-example.cjs` | **真起 compose**验收「通用内核可复用」（示例系统 + 示例自己的空库 ⇒ 智能体清单能列 → 身份自己认 → 会话建得出 → **示例命令真能调**）⇒ 需要 docker |
| `dsh-admin.static.cjs` | **静态断言**AI 管理面（issue #124）：既有 9 个端点一字未改 · 没有自造的管理面路由 · 4 个环境变量齐 · **admin 判定不许解 JWT 载荷** ⇒ **不需要 docker** |
| `dsh-admin-runtime.cjs` | **运行时验收**AI 管理面（issue #124 阶段二）：真起 dsh web + 真挂反代 ⇒ 转发成功 · **Host 保留** · cookie Path 改写 · **fail closed** · 403 · 200 ⇒ **不需要模型凭据 / 不需要 pnpm / 不连数据库** |
| `dsh-profile-refresh.cjs` | **运行时验收**dsh profile 的插件刷新（issue #158）：**改一次插件内容 ⇒ profile 里的拷贝跟着变** + 内容没变就不重装 ⇒ **不需要 pnpm / 不联网 / 不需要模型凭据** |

## 用法

```bash
# 1) 先起两个服务
cd frontend && npm run dev        # 8000
cd backend/ai && npm run dev       # 3100

# 2) 取 token
node scripts/e2e/login.cjs

# 3) 跑验收
node scripts/e2e/ai-gate.cjs
NEW_TITLE=随便一个新标题 node scripts/e2e/ai-gate.cjs   # 重复跑要换标题，否则模型说「已经是这个标题了」
```

### 智能体选择器（issue #101）

```bash
node scripts/e2e/ai-agent-picker.cjs        # 或：npm run e2e:ai-agent
AGENT_ID=qa node scripts/e2e/ai-agent-picker.cjs   # 指定挑哪个智能体（默认挑一个不是 pm 的）
```

⚠️ 需要前端（8000）+ AI 服务（3100）都跑着 + 有 token（`.scratch/token.txt`）。
它**不改任何业务数据**（只是建会话 ⇒ 会话列表里会多一条）。

## 前端镜像验收（issue #38）

```bash
# 静态断言（不需要 docker，任何机器都能跑）
node scripts/e2e/web-container.static.cjs
# 或
npm run e2e:web:static

# 真起容器（需要 docker；没 docker ⇒ 打印 SKIP 并退出 0）
node scripts/e2e/web-container.cjs
# 或
npm run e2e:web
```

CI（`.github/workflows/docker-web.yml`）在 PR 上跑这两条 —— runner 自带 docker ⇒ 容器验收是真跑的。

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `IMAGE` | `ai-admin-web:local` | 容器验收用的镜像名 |
| `PORT` | `18080` | 容器验收占用的宿主机端口 |
| `SKIP_BUILD` | — | `=1` 时跳过构建（用已有镜像） |

## AI 服务镜像验收（issue #39）

```bash
# 静态断言（不需要 docker，任何机器都能跑）
node scripts/e2e/ai-container.static.cjs
# 或
npm run e2e:ai:static

# 真起容器（需要 docker；没 docker ⇒ 打印 SKIP 并退出 0）
node scripts/e2e/ai-container.cjs
# 或
npm run e2e:ai
```

CI（`.github/workflows/docker-ai.yml`）在 PR 上跑这两条。

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `IMAGE` | `ai-admin-ai:local` | 容器验收用的镜像名 |
| `PORT` | `13100` | 容器验收占用的宿主机端口 |
| `SKIP_BUILD` | — | `=1` 时跳过构建（用已有镜像） |

> ⚠️ 容器里**没有真凭据**：验收用假的 `MINIMAX_CN_API_KEY` 与**黑洞地址**的
> `AIADMIN_BASE_URL` / `DATABASE_URL` ⇒ 顺便验了「依赖不可用时 `/health` 仍是 200」。

## compose 编排验收（issue #40）

```bash
# 静态断言（不需要 docker，任何机器都能跑）
node scripts/e2e/compose.static.cjs
# 或
npm run e2e:compose:static

# 真起 compose（需要 docker；没 docker ⇒ 打印 SKIP 并退出 0）
node scripts/e2e/compose.cjs
# 或
npm run e2e:compose
```

⚠️ 脚本**不读 `docker/.env`**：它自己写一份**假值** env 文件传给 compose（`--env-file`）⇒ 不会碰到真值。

CI（`.github/workflows/docker-compose.yml`）在 PR 上跑这两条 —— runner 自带 docker ⇒ 容器验收是真跑的。

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `WEB_PORT` / `AI_PORT` | `8080` / `3100` | 验收占用的宿主机端口 |
| `SKIP_BUILD` | — | `=1` 时跳过构建（用已有镜像） |

## 部署脚本验收（issue #41）

```bash
node scripts/e2e/deploy-script.cjs     # 或：npm run e2e:deploy-script
```

⚠️ 只需要 **bash**（Windows 用 Git Bash / WSL；CI 是 ubuntu）⇒ **不需要 docker**。
它会真的跑一次 `bash docker/deploy.sh`（**默认只检查模式**）并断言：**工作区没变**、**没写状态文件**、
缺依赖时**明确报缺什么**、`--help`/未知参数的退出码对。

## 内核复用验收（issue #116）

```bash
# 静态断言（不需要 docker，任何机器都能跑）
node scripts/check-core-reuse.cjs
# 或
npm run check:reuse-core

# 真起 compose（需要 docker；没 docker ⇒ 打印 SKIP 并退出 0）
node scripts/e2e/reuse-core-example.cjs
# 或
npm run e2e:reuse-core
```

它起的是 [`backend/ai/examples/reading-notes/`](../../backend/ai/examples/reading-notes/)
（**读书笔记示例**：自己的插件 + 自己的智能体 YAML + 自己的空库，**不依赖 AiAdmin**）。

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `MINIMAX_CN_API_KEY` | — | 模型 key（**可省** ⇒ 少了就只验到「装配成功」这一步） |
| `NOTES_PORT` | `13200` | 宿主机端口 |
| `SKIP_BUILD` | — | `=1` 时跳过构建（用已有镜像） |

## 端到端部署验收（issue #42）

```bash
node scripts/e2e/deploy.cjs            # 或：npm run e2e:deploy
```

⚠️ 需要 **docker**（没 docker ⇒ 打印 SKIP 并退出 0）。
它会**用独立的 compose project name**（`ai-admin-e2e-<pid>`）+ 临时 env 文件（全是占位）
起一套 ⇒ 验「两个容器 healthy / `/` 是前端 HTML / `/api/` 通 / `/ai-api/` 通 / AI `/health` 200」
⇒ 结束 `down -v` 清干净 ⇒ **不碰开发者的本地环境与真凭据**。

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `WEB_PORT` / `AI_PORT` | `18080` / `13100` | 验收占用的端口（不抢 8080/3100） |
| `E2E_AIADMIN_URL` | 用夹具里的桩 | 指向**真实** AiAdmin 后端时用（那时的 `/api/` 会回 401，也算「通」） |
| `SKIP_BUILD` | — | `=1` 时跳过构建（用已有镜像） |

## AI 管理面验收（issue #124）

```bash
# 静态断言（不需要 docker，任何机器都能跑）
node scripts/e2e/dsh-admin.static.cjs
# 或
npm run e2e:dsh-admin:static
```

它钉四件事：① **既有 9 个端点一字未改**（`core/routes/contract.ts` 逐条比对基线）；
② **没有自造的管理面路由**（dsh-admin 适配层里不许注册路由；核心里不许出现
`mcp-servers` / `plugin-market` 这类 CRUD ⇒ 防「重复造轮子又长回来」）；
③ **4 个环境变量**（`DSH_ADMIN_ENABLED` / `DSH_ADMIN_PORT` / `DSH_ADMIN_HOME` /
`DSH_ADMIN_TRUSTED_HOST`）都有实现与文档；
④ ⚠️ **admin 判定不许解 JWT 载荷**（载荷没验签 ⇒ 伪造 `{"access":"admin"}` 就能
拿到 dsh 的完整管理 UI ⇒ **权限提升**）⇒ 反代里不许有解载荷的代码、不许有兜底判定、
没注入判定器就得**拒绝**（fail closed）、且入口侧**真的**把判定器注进去了。

⚠️ 它**管不了**「dsh 的 UI 在 iframe 里长什么样」⇒ 那一条**只能人工验**
（见 PR #147 的正文）。

## dsh profile 插件刷新验收（issue #158）

```bash
node scripts/e2e/dsh-profile-refresh.cjs        # 或：npm run e2e:dsh:profile-refresh
```

⚠️ **不需要模型凭据、不连数据库、不联网**（用「假 pnpm」⇒ 不装真依赖）。
它钉住这条**很容易退回去**的行为：**改一次插件内容 ⇒ profile 里的拷贝跟着变**
（旧判据是「依赖路径一样就跳过」⇒ 拷进去的永远是旧的 ⇒ 派活直接报 `NO_ADAPTER`）。

机器上有 pnpm 时，它还会**顺手用真 pnpm** 再验一遍
（证明「pnpm 会把 `file:` 目录重新打包」⇒ 重装拿到的就是新内容）。

## 环境变量

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `FRONTEND_URL` | `http://localhost:8000` | 前端地址 |
| `TASK_ID` | `117` | 用来改的那个任务 id |
| `NEW_TITLE` | 自动生成 | 改成的标题 |
| `USER_TOKEN` / `TOKEN_FILE` | `.scratch/token.txt` | token 来源 |
| `AIADMIN_BASE_URL` | `https://www.pmdict.cn/api/v1` | AiAdmin 后端 |
| `REDIS_HOST` / `REDIS_PASSWORD` … | 见脚本 | 只用于读验证码答案 |

## 为什么它们在仓里

写在 `.scratch/` 里的脚本会被 gitignore ⇒ 不能复跑、不能进 CI、同事看不到。
⇒ 这两个是**验收的证据**，要能重跑。
