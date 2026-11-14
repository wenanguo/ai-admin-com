# docker —— 部署镜像与编排

> **本目录**（`docker/web/`）是 issue #38 的产物：把前端（Umi 4 / React 19）做成一个
> **多阶段镜像**：Node 阶段编译静态产物 ⇒ nginx 阶段托管它。
>
> issue #40 又加了 **compose 编排**（`docker/docker-compose.yaml`）与 **API 代理**。
>
> ⚠️ **还没做的**：部署脚本（#D）、完整部署文档（#E）、TLS/443。

## 镜像

| 镜像名 | 说明 | 端口 | 健康检查 |
| ------ | ---- | ---- | -------- |
| `ai-admin-web` | 前端静态站点（nginx + `frontend/dist`） | `80` | `GET /healthz` ⇒ 200 `{"status":"ok"}` |

## 构建

⚠️ **构建上下文是仓根**（`.dockerignore` 在仓根）：

```bash
# 在仓根执行
docker build -f docker/web/Dockerfile -t ai-admin-web .
```

镜像里**只有构建产物**（`frontend/dist`）：没有 `node_modules`、没有源码、没有任何凭据。
构建阶段**不连后端、不读 `.env`** ⇒ 不需要私有凭据。

可选：注入构建版本（进 `frontend/config/config.ts` 的 `COMMIT_HASH`）：

```bash
docker build -f docker/web/Dockerfile \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  -t ai-admin-web .
```

## 运行

```bash
docker run -d --name ai-admin-web -p 8080:80 ai-admin-web

# 看一眼
curl -s http://127.0.0.1:8080/healthz      # => {"status":"ok"}
curl -sI http://127.0.0.1:8080/index.html  # => Cache-Control: no-store, no-cache, must-revalidate

# 停掉
docker rm -f ai-admin-web
```

## 验一下

```bash
node scripts/e2e/web-container.static.cjs   # 静态断言（不需要 docker）
node scripts/e2e/web-container.cjs          # 真起容器验收（需要 docker；没 docker ⇒ SKIP）
```

CI（`.github/workflows/docker-web.yml`）会在 PR 上跑这两条。

## 目录

| 路径 | 干什么 |
| ---- | ------ |
| `docker/web/Dockerfile` | 多阶段构建（builder=node:22-bookworm-slim，runtime=nginx:1.27-alpine） |
| `docker/web/nginx.conf` | nginx **主配置**（**整份**替换 `/etc/nginx/nginx.conf`）：日志到 stdout、gzip、安全头、`include conf.d/*.conf` |
| `docker/web/templates/default.conf.template` | nginx **站点（server 块）**：静态 + 三条路由（`/`、`/api/`、`/ai-api/`）⇒ 容器启动时按**环境变量**替换（envsubst） |
| `docker/web/snippets/security-headers.conf` | 安全头片段（`add_header` 继承坑 ⇒ 每个 location 都要 include） |
| `docker/docker-compose.yaml` | **编排**：web + ai 两个服务（issue #40） |
| `docker/docker-compose.ci.yaml` | ★ **验收夹具**（只在 CI/验收用）：多起一个 AiAdmin 桩 |
| `docker/.env.example` | 环境变量清单（**只放占位**，真值进 `docker/.env`，不入库） |

## 待补（后续 issue）

- **#D**：`deploy.sh` 部署脚本。
- **#E**：部署文档汇总 + 端到端部署验收脚本。

---

# compose 编排（issue #40）

## 起一套

```bash
# 1) 先把占位清单复制成真值文件（docker/.env 不入库）
cp docker/.env.example docker/.env
$EDITOR docker/.env          # 至少填：DATABASE_URL、MINIMAX_CN_API_KEY

# 2) 起（首次会构建两个镜像 ⇒ 要几分钟）
docker compose -f docker/docker-compose.yaml up -d --build

# 3) 看一眼
curl -s  http://127.0.0.1:8080/healthz          # => {"status":"ok"}
curl -sI http://127.0.0.1:8080/api/v1/currentUser | head -1   # => 打到 AiAdmin（路径没被改写）
curl -s  http://127.0.0.1:8080/ai-api/health    # => AI 服务的健康 JSON（前缀 /ai-api 被去掉）

# 4) 停掉（连卷一起清）
docker compose -f docker/docker-compose.yaml down -v
```

⚠️ **首次启动前必须确认**：AiAdmin 库里那 5 张 `ai_*` 表**已经存在**
（`ai_*` 与业务表**同库** ⇒ 只允许 `migrate deploy`，`migrate dev/reset` 会 DROP 整个库）。

## 两个服务 / 三条路由

| 服务 | 镜像 | 宿主端口 | 说明 |
| ---- | ---- | -------- | ---- |
| `web` | `ai-admin-web` | `${WEB_PORT:-8080}:80` | nginx ⇒ **公网唯一入口** |
| `ai` | `ai-admin-ai` | `127.0.0.1:${AI_PORT:-3100}:3100` | AI 服务 ⇒ **只绑回环**，外网直连不到 |

| 路由 | 转到 | 口径 |
| ---- | ---- | ---- |
| `/` | 前端静态 | SPA fallback ⇒ 任意路由刷新不 404 |
| `/api/` | AiAdmin 后端（`AIADMIN_PROXY_TARGET`） | **不 rewrite**（AiAdmin 的 root_path 是 `/api/v1`，而 baseURL 已含它） |
| `/ai-api/` | AI 服务（compose 内网 `ai:3100`） | **去掉 `/ai-api` 前缀**（与开发期 `frontend/config/proxy.ts` 一致） |

⚠️ **两个名字很像的变量**：
`AIADMIN_PROXY_TARGET` = nginx 的上游（**站点根，不含 `/api/v1`**）；
`AIADMIN_BASE_URL` = AI 服务自己调 AiAdmin 用的 base（**含 `/api/v1`**）。

⚠️ **AiAdmin 后端不在本编排内**（外部实例）⇒ 用上面两个变量指向它。

## 环境变量

全部列在 [`docker/.env.example`](.env.example)（**只放占位**）。最要紧的几个：

| 变量 | 谁用 | 不配会怎样 |
| ---- | ---- | -------- |
| `DATABASE_URL` | AI 服务 | **容器起不来**（启动时强校验） |
| `MINIMAX_CN_API_KEY` | AI 服务 | **容器起不来**（同上） |
| `AIADMIN_BASE_URL` | AI 服务 | **容器起不来**（同上） |
| `ALLOWED_ORIGINS` | AI 服务 | **容器起不来**（同上） |
| `AIADMIN_PROXY_TARGET` | nginx | 用默认的线上 AiAdmin |
| `WEB_PORT` / `AI_PORT` | compose | 默认 8080 / 3100 |

## 验一下

```bash
node scripts/e2e/compose.static.cjs   # 静态断言（不需要 docker）
node scripts/e2e/compose.cjs          # 真起 compose 验收（需要 docker；没 docker ⇒ SKIP）
```

CI（`.github/workflows/docker-compose.yml`）会在 PR 上跑这两条（runner 自带 docker ⇒ 真跑）。

---

# 部署脚本（issue #41）

## 一条命令

```bash
bash docker/deploy.sh          # **默认只检查**（不改任何东西）
bash docker/deploy.sh --check  # 同上（显式写法）
bash docker/deploy.sh --yes    # 真执行
```

`--yes` 会做：**拉最新代码 → 构建镜像（层缓存，没变化不重建）→ `compose up -d` → 等两个容器 healthy → 写状态记录 + 打印摘要**。

- **幂等**：再跑一次不报错，也不重建没变化的东西。
- **失败可回退**：任何一步失败都会打印**怎么回退**（`git reset --hard <上一个 commit>` + `docker compose up -d --build`）。
- **不把凭据写进日志**：只打印环境变量的**名字**，不打印值。
- **状态记录**：`docker/.last-deploy`（记录上次成功部署的 commit ⇒ 回退提示用；**已 gitignore**）。

Windows（只有 Docker Desktop 的机器）：用 `docker\deploy.bat`（功能是 bash 版的简化版；**推荐在 Git Bash / WSL 里用 `deploy.sh`**）。

⚠️ 部署**不需要**宿主机装 node（构建在镜像里做）；但本机跑 `scripts/e2e/**` 的验收脚本需要 node ≥ 22。

## AI 服务镜像（issue #39）

⚠️ **AI 服务的镜像不在本目录**：它是 `backend/ai/Dockerfile`（多阶段：node 22 ⇒ tsc ⇒
生产依赖 + 技能 + prisma 客户端），细节见 `backend/ai/README.md` 的「容器」那节。

```bash
# 同样在**仓根**执行（构建上下文 = 仓根）
docker build -f backend/ai/Dockerfile -t ai-admin-ai .
```

| 镜像名 | 说明 | 端口 | 健康检查 |
| ------ | ---- | ---- | -------- |
| `ai-admin-ai` | AI 编排服务（Express 5 + pi SDK + Prisma） | `3100` | `GET /health` ⇒ **恒 200**（含 `status` / `checks`） |

验收：`node scripts/e2e/ai-container.static.cjs`（不需要 docker）/ `node scripts/e2e/ai-container.cjs`（要 docker）。
