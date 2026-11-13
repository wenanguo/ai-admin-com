# docker —— 部署镜像

> **本目录**（`docker/web/`）是 issue #38 的产物：把前端（Umi 4 / React 19）做成一个
> **多阶段镜像**：Node 阶段编译静态产物 ⇒ nginx 阶段托管它。
>
> ⚠️ **本条只做「前端镜像」**：API 代理（#C）、compose 编排（#C）、部署脚本（#D）、
> 部署文档汇总（#E）都不在这里。

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
| `docker/web/nginx.conf` | nginx 主配置（**整份**替换 `/etc/nginx/nginx.conf`）：SPA fallback、缓存策略、`/healthz`、gzip、安全头 |
| `docker/web/snippets/security-headers.conf` | 安全头片段（`add_header` 继承坑 ⇒ 每个 location 都要 include） |

## 待补（后续 issue）

- **#C**：API 代理（`/api/`、`/ai-api/`）+ compose 编排 ⇒ 在 `nginx.conf` 里加 `location` + `proxy_pass`。
- **#D**：`deploy.sh` 部署脚本。
- **#E**：部署文档汇总 + 端到端部署验收脚本。

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
