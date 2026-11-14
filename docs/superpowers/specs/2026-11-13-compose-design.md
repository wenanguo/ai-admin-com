# Docker Compose 编排设计（2026-11-13）

> **一句话**：把 #38 的前端镜像与 #39 的 AI 服务镜像用 compose 串起来 —— nginx 是**唯一公网入口**，
> 三条路由（`/` 静态 + SPA fallback、`/api/` → AiAdmin 后端**不 rewrite**、`/ai-api/` → AI 服务**去前缀**），
> AI 服务只绑回环，外加一份**不含真值**的 `docker/.env.example` 与**入库的**验收脚本。
>
> **关联**：issue #40 · 分支 `feat/40-compose`

---

## 1. 目标 / 非目标

### 目标（= issue #40 的验收标准）

1. `docker compose -f docker/docker-compose.yaml up -d` 一次起来 **web + ai** 两个容器，且都 **healthy**。
2. 浏览器打根路径 ⇒ 返回**前端页面**（不是 nginx 默认页）。
3. `/api/...` ⇒ 打到 AiAdmin 后端，**路径与请求头不被改写**（AiAdmin 的 `root_path` 是 `/api/v1` ⇒ **不 rewrite**）。
4. `/ai-api/api/agent/...` ⇒ 打到 AI 服务，**前缀 `/ai-api` 被去掉**（与开发期 `frontend/config/proxy.ts` 一致）。
5. **SSE 不缓冲**（`proxy_buffering off` + 足够长的 `proxy_read_timeout`）⇒ 对话逐条到达。
6. **AI 服务只在本机可达**（端口只绑 `127.0.0.1`）⇒ 公网唯一入口是 nginx 的 80。
7. `docker/.env.example` 列出**全部**环境变量（端口、AIADMIN_*、DATABASE_URL、模型 key 占位），**不含真值**。
8. 每个服务都有：日志轮转、内存/CPU 限制、`restart: unless-stopped`；`docker compose config` 通过；README 写明启动命令与环境变量。

### 非目标（硬边界）

- ❌ 不做镜像构建（#38 / #39 已做）—— 本条只**编排**已有的镜像。
- ❌ 不做一键部署脚本（#D）、不做 TLS/443（**连挂载点都不做**）、不做数据库/Redis 编排（外部实例）。
- ❌ **不改 AiAdmin 那个仓的 compose**（它自己有一套）⇒ 只用 `AIADMIN_BASE_URL` / `AIADMIN_MCP_URL` 指向它。
- ❌ 不配 AiAdmin 侧的 MCP 白名单（`MCP_INCLUDE_TAGS` 另议）。
- ❌ 不真机部署到任何服务器（只产出**可部署**的编排 + 脚本 + 文档）。
- ❌ 不做数据库迁移（`ai_*` 表必须**已经存在**；`migrate deploy` 才行，`migrate dev/reset` 会 DROP 整个库）。

---

## 2. 现状（三条路由的口径从哪来）

| 事实 | 出处 | 对方案的影响 |
| ---- | ---- | ------------ |
| 开发期代理：`/api/` → AiAdmin（`target` 是**站点根**，**不 rewrite**，因为 baseURL 已含 `/api/v1`）；`/ai-api/` → AI 服务（`pathRewrite: {'^/ai-api': ''}`） | `frontend/config/proxy.ts` | nginx 必须**逐字复刻**这两条 ⇒ `/api/` 的 `proxy_pass` **不带 URI 部分**；`/ai-api/` 的 `proxy_pass` **带 `/`**（⇒ nginx 自动把匹配到的前缀替换成 `/`） |
| 浏览器侧 AI 地址 = `${AI_API_BASE_URL}/api/agent/...`，`AI_API_BASE_URL` 缺省 `/ai-api` | `frontend/config/config.ts` 的 `define` + `frontend/src/services/api/ai/base.ts` | 生产也是 `/ai-api/...` ⇒ **必须**保留独立前缀（否则会被 `/api/` 前缀匹配抢走） |
| AI 服务路由：`/api/agent`、`/api/pending`、`/api/audit`；SSE 在 `/api/agent/:cid/events` | `backend/ai/src/server.ts`、`backend/ai/src/routes/events.ts` | `/ai-api/` 去掉前缀后正好对上 |
| AI 服务**健康检查恒 200**（依赖挂了也 200，只在 `status` 里体现 `degraded`） | `backend/ai/src/routes/health.ts`（#39） | compose 的 healthcheck 用 `/health` ⇒ 依赖没配好也不会被判定死 ⇒ 不会雪崩 |
| AI 服务**启动时强校验环境变量**：`MINIMAX_CN_API_KEY`、`AI_MODEL`、`AIADMIN_BASE_URL`、`DATABASE_URL`、`ALLOWED_ORIGINS` 缺一即退出 | `backend/ai/src/env.ts`（zod schema） | `docker/.env` **必须**配齐 ⇒ `.env.example` 要把这几个列全；CI 里用**假值**即可启动 |
| AI 服务 `app.listen(port)` **不带 host** ⇒ 监听所有网卡 | `backend/ai/src/server.ts` | 容器内 nginx 能连上 ✓（AiAdmin 踩过的坑：绑 `localhost` ⇒ 502 但自己的 healthcheck 仍 healthy） |
| nginx 官方镜像支持 **envsubst 模板**：`/etc/nginx/templates/*.template` → `/etc/nginx/conf.d/*.conf`（启动时替换） | nginx 官方镜像 entrypoint（`20-envsubst-on-templates.sh`） | 上游地址要**可配** ⇒ 用模板 + 环境变量，而不是把地址写死在 nginx.conf 里 |

---

## 3. 方案对比

| 方案 | 做法 | 取舍 |
| ---- | ---- | ---- |
| **A. compose + nginx 模板（envsubst）（本选）** | `docker/docker-compose.yaml` 定义 web/ai 两个服务；nginx 的 **server 块**放成模板，用 `${AIADMIN_PROXY_TARGET}` / `${AI_UPSTREAM}` 在**容器启动时**替换 | 上游地址靠环境变量改，**不用重构建镜像**；compose 里一眼看清端口/网络/限制。代价：nginx 配置被拆成「主配置 + 模板」两份 |
| B. 上游地址写死在 nginx.conf | 改上游 = 改代码 + 重构建镜像 | 生产/本地切换要重建 ⇒ 不可接受 |
| C. 用 nginx `set $var` + `resolver` 运行时解析 | 配置里 `set $target "${...}"` 再 `proxy_pass $target` | nginx 对**变量**形式的 `proxy_pass` 要在**请求时**做 DNS ⇒ 必须配 `resolver` ⇒ 多一个外网依赖（8.8.8.8）且容器离线就挂 ⇒ 否 |

**决定**：A。

---

## 4. 设计

### 4.1 文件布局

```
docker/
  docker-compose.yaml          # web + ai 两个服务（编排）
  docker-compose.ci.yaml       # ★ 验收夹具：加一个 AiAdmin 桩服务（只给 CI/验收用）
  .env.example                 # 全部环境变量的占位（无真值）
  README.md                    # 启动命令 + 环境变量说明
  web/
    Dockerfile                 # #38 的镜像（要加：拷模板 + ENV 默认值）
    nginx.conf                 # 主配置（http 层）：日志/gzip/安全头 + include conf.d/*.conf
    templates/
      default.conf.template    # ★ server 块（静态 + 三条路由），启动时按环境变量替换
```

### 4.2 nginx：主配置 + 模板

**`docker/web/nginx.conf`（主配置，http 层）** —— #38 里 server 块是内联的，现在**移到模板**，
主配置只留：http 层的日志/gzip/`server_tokens off` + `include /etc/nginx/conf.d/*.conf;`。
（#38 的安全头片段仍在：模板里每个自带 `add_header` 的 location 都要 include 它 —— `add_header` 继承坑。）

**`docker/web/templates/default.conf.template`（server 块）**：

| location | 行为 |
| -------- | ---- |
| `= /healthz` | 200 `{"status":"ok"}`（**静态资源服务的健康检查**，与 AI 服务的 `/health` 是两回事） |
| `= /index.html` | `Cache-Control: no-store, no-cache, must-revalidate` |
| `^~ /assets/` | 长缓存（为将来产物切到 `assets/` 目录预留） |
| `~* \.(js\|mjs\|css\|map\|png\|jpe?g\|gif\|svg\|ico\|webp\|woff2?\|ttf\|eot)$` | 长缓存 + `try_files $uri =404`（本仓产物扁平在根 ⇒ **这条才真正生效**） |
| `/api/` | `proxy_pass ${AIADMIN_PROXY_TARGET};` —— **不带 URI 部分 ⇒ 原样透传**（不 rewrite） |
| `/ai-api/` | `proxy_pass http://${AI_UPSTREAM}/;` —— **带 `/` ⇒ nginx 把匹配到的前缀替换成 `/` ⇒ 前缀被去掉** |
| `/` | `try_files $uri /index.html;`（SPA fallback） |

⚠️ **`${...}` 是 envsubst 的占位，不是 nginx 变量**：
- 模板里**必须**有 `ENV` 默认值（否则变量未定义时 envsubst 不替换 ⇒ nginx 启动报 `unknown "XXX" variable`）：
  `ENV AIADMIN_PROXY_TARGET=https://www.pmdict.cn`、`ENV AI_UPSTREAM=127.0.0.1:3100`。
- `AI_UPSTREAM` 默认用 `127.0.0.1:3100`（**不是** `ai:3100`）⇒ 独立跑镜像时 nginx 也能解析并启动（compose 里再覆盖成 `ai:3100`）。

⚠️ **SSE**（`/ai-api/` 那条）：`proxy_http_version 1.1` + `proxy_set_header Connection ''` +
`proxy_buffering off` + `proxy_cache off` + `proxy_read_timeout 3600s` + `proxy_send_timeout 3600s`
⇒ 逐条到达（AI 服务自己也带 `X-Accel-Buffering: no` ⇒ 双保险）。

⚠️ **上游头的传递**：`proxy_set_header Host $host` / `X-Real-IP` / `X-Forwarded-For` / `X-Forwarded-Proto`。
⚠️ **`/api/` 不 rewrite**：`proxy_pass ${AIADMIN_PROXY_TARGET};`（**没有 URI 部分**）⇒ nginx 透传原始 URI。
若写成 `proxy_pass ${AIADMIN_PROXY_TARGET}/;` ⇒ 会把 `/api/` 前缀替换成 `/` ⇒ `/api/v1/x` 变成 `/v1/x` ⇒ **404**。

### 4.3 compose（`docker/docker-compose.yaml`）

| 服务 | 镜像 | 端口 | 说明 |
| ---- | ---- | ---- | ---- |
| `web` | `ai-admin-web`（`build: ../docker/web/Dockerfile`，上下文 = 仓根） | `${WEB_PORT:-8080}:80` | nginx；**唯一公网入口**；`depends_on: ai (service_healthy)` |
| `ai` | `ai-admin-ai`（`build: ../backend/ai/Dockerfile`） | `127.0.0.1:${AI_PORT:-3100}:3100` | AI 服务；**只绑回环** ⇒ 公网只能走 nginx；compose 内网用服务名 `ai:3100` |

共用：
- 网络 `aiadmin`（bridge）—— web 与 ai 在里面互通（`ai:3100`）。
- `restart: unless-stopped`。
- 日志：`json-file` + `max-size: 10m` + `max-file: 3`。
- 资源：`mem_limit: 512m`（web）/ `1g`（ai）+ `cpus: 1.0`。
- healthcheck：web 打 `/healthz`（wget），ai 打 `/health`（node fetch）——**恒 200** ⇒ 依赖没配好不会被杀。

**AiAdmin 后端 = 外部地址**（issue 要求「决定并写明」）：compose 里用 `AIADMIN_PROXY_TARGET`
（nginx 的上游，**站点根**，如 `https://www.pmdict.cn`）与 `AIADMIN_BASE_URL`
（AI 服务自己调 AiAdmin 用的 base，**含 `/api/v1`**）—— 两个变量**名字近但含义不同**，必须在 `.env.example` 里写清楚。

### 4.4 `docker/.env.example`（无真值）

| 变量 | 默认/占位 | 谁用 | 说明 |
| ---- | --------- | ---- | ---- |
| `WEB_PORT` | `8080` | compose | 宿主机上 nginx 的端口（容器内恒 80） |
| `AI_PORT` | `3100` | compose | 宿主机上 AI 服务的端口（**只绑 127.0.0.1**） |
| `AIADMIN_PROXY_TARGET` | `https://www.pmdict.cn` | nginx | `/api/` 的上游（**站点根，不含 `/api/v1`**） |
| `AIADMIN_BASE_URL` | `https://www.pmdict.cn/api/v1` | AI 服务 | AI 服务调 AiAdmin 的 base（**含 `/api/v1`**） |
| `AIADMIN_MCP_URL` | 空 | AI 服务 | 不配就不接 MCP（AI 仍能用，只是没那些工具） |
| `DATABASE_URL` | `mysql://USER:PASSWORD@HOST:3306/aipm` | AI 服务 | `ai_*` 元数据表与业务表**同库** |
| `MINIMAX_CN_API_KEY` | 空 | AI 服务 | 模型 key（**真值只进 `docker/.env`**） |
| `AI_MODEL` | `minimax-cn/MiniMax-M3.1-Flash` | AI 服务 | 模型标识 |
| `AI_THINKING_LEVEL` | `off` | AI 服务 | 思考级别 |
| `ALLOWED_ORIGINS` | `http://localhost:8080,http://127.0.0.1:8080` | AI 服务 | 允许跨域的前端源 |

⚠️ `docker/.env` 已被仓根 `.gitignore` 的 `**/.env` 覆盖 ⇒ **不入库** ✓（验收脚本会断言这一点）。
⚠️ `.env.example` 里**不许**出现真值（key / 口令）⇒ 静态脚本断言「没有看起来像真 key 的字符串」。

### 4.5 验收脚本（入库）

- **`scripts/e2e/compose.static.cjs`**（不需要 docker）：断言 compose 的服务/端口/网络/限制/日志/healthcheck、
  模板里的三条路由与 SSE 指令、`.env.example` 的变量齐全且无真值、`docker/.env` 被 gitignore。
- **`scripts/e2e/compose.cjs`**（需要 docker）：
  1. `docker compose -f docker/docker-compose.yaml config` ⇒ 校验通过；
  2. `docker compose ... up -d --build`（叠 `docker-compose.ci.yaml` 起一个 **AiAdmin 桩**）⇒ 两个容器都 healthy；
  3. `GET /` ⇒ 前端 HTML；`GET /healthz` ⇒ 200；
  4. `GET /api/v1/ping` ⇒ 桩服务回显的路径**仍是 `/api/v1/ping`**（证明**没 rewrite**）；
  5. `GET /ai-api/health` ⇒ AI 服务的健康 JSON（证明**前缀被去掉**）；`GET /ai-api/api/agent/x/events` ⇒ 不是 404/502；
  6. `docker compose port ai 3100` ⇒ `127.0.0.1:3100`（**只绑回环**）；
  7. `docker compose down -v` 清理。

### 4.6 CI

新增 `.github/workflows/docker-compose.yml`：PR 触发 ⇒ 跑 `scripts/e2e/compose.cjs`（runner 自带 docker ⇒ 真跑）。
⚠️ 本机没有 docker ⇒ 本地只能跑静态脚本；容器验收看 CI。

---

## 5. 风险与已知取舍

| 风险 | 处置 |
| ---- | ---- |
| 本机没有 docker ⇒ 没法本地验 compose | 静态脚本本地跑 + CI 真跑（与 #38/#39 同一套路） |
| envsubst 模板：变量未定义 ⇒ nginx 启动报错 | 镜像里 `ENV` 给默认值（`AIADMIN_PROXY_TARGET` / `AI_UPSTREAM`）⇒ 独立跑也能起 |
| `/api/` 写成 `proxy_pass .../` ⇒ 路径被吃掉 ⇒ 404 | 设计里明确「不带 URI 部分」；验收脚本用**回显桩**断言路径原样到达 |
| AI 服务启动强校验环境变量 ⇒ 缺一个就退出 | `.env.example` 列全；CI 用假值启动；README 写明「缺 `MINIMAX_CN_API_KEY` / `DATABASE_URL` ⇒ 容器起不来」 |
| `ai_*` 表不存在 ⇒ 运行时报错 | **本块不做迁移** ⇒ 文档写明：上线前确认那 5 张表已存在（只允许 `migrate deploy`） |
| compose 的 `build:` 段会让 `up -d` 触发构建 | 文档写明：`--build` 才构建；镜像已存在时直接 `up -d` 复用 |
| 桩服务只在验收夹具里 | `docker/docker-compose.ci.yaml` 明确标注「仅验收用」⇒ 生产不用它 |

## 6. 本条之后谁接

- **#D**：`deploy.sh`（一条命令起全套 + 失败可回退）—— 复用 `docker/docker-compose.yaml` + `docker/.env`。
- **#E**：部署文档 + 端到端部署验收脚本 —— 复用 `docker/README.md` 与 `scripts/e2e/compose.cjs`。
