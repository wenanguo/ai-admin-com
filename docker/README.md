# docker —— 部署手册（前端 + AI 服务）

> **一句话**：这份文档的目标是 —— **换一台机器，也能照着它把整套跑起来**。
>
> 本目录管两件事：
> 1. **两个镜像**：`ai-admin-web`（前端静态站，nginx 托管）与 `ai-admin-ai`（AI 服务，Node 容器）；
> 2. **把它们串起来**：`docker-compose.yaml` + `deploy.sh` + 本文档。
>
> ⚠️ **AiAdmin 后端（FastAPI）在另一个仓**（`wenanguo/AiAdmin`）⇒ 本部署**只连、不装**。

---

## 1. 三个东西的分工（先分清）

| 部件 | 在哪 | 本部署管不管 | 说明 |
| ---- | ---- | ------------ | ---- |
| **前端静态站** | `docker/web/` ⇒ 镜像 `ai-admin-web` | ✅ **管**（构建 + nginx 托管） | Umi 4 构建出的 `frontend/dist`，纯静态 |
| **AI 服务** | `backend/ai/` ⇒ 镜像 `ai-admin-ai` | ✅ **管**（构建 + 编排） | Express 5 + pi SDK + Prisma；提供 `/api/agent`、`/api/pending`、`/api/audit`、`/health` |
| **AiAdmin 后端** | **另一个仓**（`D:/project/AiAdmin`） | ❌ **只连不装** | 业务事实源（用户、权限、任务…）+ MCP。本部署用 `AIADMIN_BASE_URL` / `AIADMIN_PROXY_TARGET` 指向它 |
| **MySQL** | 外部实例（和 AiAdmin 同库 `aipm`） | ❌ **不管** | 本部署只给 `DATABASE_URL` |

**流量长什么样**（公网唯一入口是 nginx 的 80）：

```
浏览器 ──► nginx（ai-admin-web，:80）
            ├── /            → 前端静态（dist）+ SPA fallback
            ├── /api/...     → AiAdmin 后端（**不 rewrite**，路径原样透传）
            └── /ai-api/...  → AI 服务（**去掉 /ai-api 前缀**）
```

---

## 2. 目录结构

```
仓库根/
├─ .dockerignore                 # 构建上下文卫生（排除 node_modules / 产物 / 凭据）
├─ frontend/                     # 前端源码（Umi Max 4 / React 19）
├─ backend/ai/                   # AI 服务源码（Express 5 + pi SDK + Prisma）
│  ├─ Dockerfile                 #   AI 服务的多阶段镜像
│  ├─ .pi/skills/                #   技能（提示词）—— cwd 相对，镜像里放在 /app/.pi
│  └─ .env.example               #   AI 服务自己的环境变量清单
└─ docker/                       # ★ 本目录：部署相关
   ├─ README.md                  #   ← 你正在看的这份（部署手册）
   ├─ .env.example               #   ★ 环境变量清单（**只有占位**；真值进 .env）
   ├─ .env                       #   真值文件（**不入库**，已被 .gitignore 覆盖）
   ├─ .last-deploy               #   上次成功部署的 commit（**不入库**；回退提示用）
   ├─ docker-compose.yaml        #   ★ 编排：web + ai 两个服务
   ├─ docker-compose.ci.yaml     #   验收夹具（只在 CI 用：多起一个 AiAdmin 桩）
   ├─ deploy.sh                  #   部署脚本（默认只检查；--yes 才动手）
   ├─ deploy.bat                 #   Windows 版（简化版）
   └─ web/
      ├─ Dockerfile              #   前端的多阶段镜像
      ├─ nginx.conf              #   nginx 主配置（http 层）
      ├─ templates/
      │  └─ default.conf.template#   nginx 站点（server 块）—— 启动时按环境变量替换
      └─ snippets/
         └─ security-headers.conf#   安全头片段
```

---

## 3. 环境变量清单

> 真值放 **`docker/.env`**（复制 `.env.example` 改）⇒ **不入库**（仓根 `.gitignore` 的 `**/.env` 覆盖它）。
> 下面这张表是**占位 + 说明**，**没有任何真值**。

| 变量 | 谁用 | 干什么 | 示例/占位 | 是凭据吗 |
| ---- | ---- | ------ | --------- | -------- |
| `WEB_PORT` | compose | 宿主机上 nginx 的端口（容器内恒 80） | `8080` | 否 |
| `AI_PORT` | compose | 宿主机上 AI 服务的端口（**只绑 `127.0.0.1`**） | `3100` | 否 |
| `AIADMIN_PROXY_TARGET` | **nginx** | `/api/` 转到哪。⚠️ 必须是**站点根**（**不含 `/api/v1`**） | `https://www.pmdict.cn` | 否（但别写内网细节到公网文档） |
| `AIADMIN_BASE_URL` | **AI 服务** | AI 服务自己调 AiAdmin 的 base。⚠️ **含 `/api/v1`** | `https://www.pmdict.cn/api/v1` | 否 |
| `AIADMIN_MCP_URL` | **AI 服务** | AiAdmin 的 MCP（**工具的来源**）。不配 ⇒ 不接 MCP（AI 仍能用，只是没那些工具） | 空 | 否 |
| `DATABASE_URL` | **AI 服务** | AiAdmin 的 MySQL（`ai_*` 元数据表与业务表**同一个库** `aipm`） | `mysql://USER:PASSWORD@HOST:3306/aipm` | ✅ **是**（口令） |
| `MINIMAX_CN_API_KEY` | **AI 服务** | 模型 key（minimax-cn；也可用 `MINIMAX_API_KEY`） | 空 | ✅ **是**（密钥） |
| `AI_MODEL` | **AI 服务** | 模型标识 | `minimax-cn/MiniMax-M3.1-Flash` | 否 |
| `AI_THINKING_LEVEL` | **AI 服务** | 思考级别（`off`/`low`/…）。⚠️ 思考会**让用户等更久** ⇒ 默认 `off` | `off` | 否 |
| `ALLOWED_ORIGINS` | **AI 服务** | 允许跨域的前端源（逗号分隔，回具体的源，**不用 `*`**） | `http://localhost:8080,http://127.0.0.1:8080` | 否 |

⚠️ **两个名字很像的变量**（最容易搞混）：
`AIADMIN_PROXY_TARGET` = **nginx 的上游**（站点根）；`AIADMIN_BASE_URL` = **AI 服务出站用的 base**（含 `/api/v1`）。

### 凭据从哪来 / 放哪

| 凭据 | 哪来 | 放哪 | ⚠️ 注意 |
| ---- | ---- | ---- | ---- |
| 模型 key（`MINIMAX_CN_API_KEY`） | minimax 开放平台 | `docker/.env` | **不入库**；也**不进镜像**（构建阶段不读 `.env`） |
| 数据库口令（`DATABASE_URL` 里） | AiAdmin 那边的 MySQL | `docker/.env` | 同上；AiAdmin 自己的 compose 里也有同一份 |
| AiAdmin 的登录 token | 用户登录 AiAdmin 时拿 | 浏览器（前端带 `Authorization` 头） | 不落盘 |

⚠️ **`.ai/auth.json`**（pi SDK 的本地凭据，**不在本仓**）⇒ **不进镜像**（`.dockerignore` 排掉 `.ai/`）。
AI 服务镜像里**只有** `/app/.pi/skills`（技能提示词），**没有**任何密钥。

---

## 4. 启动步骤

### 4.1 前置

- **Docker Engine / Docker Desktop**（含 `docker compose` 插件）✅
- **git** ✅
- **node ≥ 22**：⚠️ **部署本身不需要**（构建在镜像里做）；但要在本机跑验收脚本（`scripts/e2e/**`）就需要。

```bash
docker compose version     # 有输出 ⇒ compose 插件在
```

### 4.2 准备配置

```bash
cp docker/.env.example docker/.env
$EDITOR docker/.env        # 至少填：DATABASE_URL、MINIMAX_CN_API_KEY
```

### 4.3 ⚠️ 上线前置（**最容易被跳过、后果最严重**）

**那 5 张 `ai_*` 表必须已经存在于 `aipm` 库**（`ai_conversation`、`ai_message`、`ai_pending`、`ai_audit`…）。

- `ai_*` 与业务表在**同一个库** ⇒ **`migrate dev` / `migrate reset` 会把整个共享库 DROP** ⇒ **只允许 `migrate deploy`**。
- 本部署**不做迁移**（也不做备份）⇒ **上线前人工确认表已存在**：
  ```sql
  -- 在 AiAdmin 的 MySQL 上跑
  SHOW TABLES LIKE 'ai_%';
  ```
  没看到表 ⇒ **先在 AiAdmin 那个仓做一次 `migrate deploy`**，再上线本部署。

### 4.4 起服务

```bash
# 方式一（推荐）：部署脚本 —— 默认只检查，确认后再动手
bash docker/deploy.sh          # 只检查：报缺什么 + 列出将要做的
bash docker/deploy.sh --yes    # 真执行：拉代码 → 构建 → 起 → 等 healthy → 出摘要

# 方式二：手敲 compose
docker compose -f docker/docker-compose.yaml up -d --build
docker compose -f docker/docker-compose.yaml ps
docker compose -f docker/docker-compose.yaml logs --tail 100 web ai
```

### 4.5 访问地址

| 地址 | 是谁 | 说明 |
| ---- | ---- | ---- |
| `http://<服务器 IP>:8080/` | 前端 | 容器内 80 ⇒ 宿主机 `${WEB_PORT}`（默认 8080） |
| `http://<服务器 IP>:8080/healthz` | 前端健康检查 | 固定 `{"status":"ok"}`（**不含版本信息**） |
| `http://127.0.0.1:3100/health` | **AI 服务**（只在本机） | ⚠️ 只绑回环 ⇒ **外网访问不到**；`status` 是 `ok` / `degraded` |
| `http://<服务器 IP>:8080/ai-api/health` | AI 服务（经 nginx） | 浏览器侧能访问的 AI 健康检查 |

⚠️ **AI 服务只绑 `127.0.0.1`** ⇒ 公网唯一入口是 nginx ⇒ 鉴权/限流/日志都走 nginx。

---

## 5. 常见故障与排查

| 症状 | 大概率原因 | 怎么办 |
| ---- | ---------- | ------ |
| `ai` 容器**起不来**（一直 restart） | 环境变量缺失：AI 服务启动时强校验 `DATABASE_URL` / `MINIMAX_CN_API_KEY` / `AIADMIN_BASE_URL` / `ALLOWED_ORIGINS` | `docker compose logs ai` 看报错（它会点名缺哪个）⇒ 补进 `docker/.env` |
| `ai` 容器 healthy 但 `status: degraded` | 依赖不通（MySQL / AiAdmin / MCP） | 看 `/health` 的 `checks` 字段，逐个看哪个 `down` ⇒ 依赖挂了**不会**把容器判死 |
| nginx **502**（`/api/` 或 `/ai-api/`） | 上游地址错 / 上游容器没监听 `0.0.0.0` | `docker compose logs web` 看 nginx 错误；`docker compose exec web wget -qO- http://ai:3100/health` 试连通 |
| `/ai-api/...` **404** | 前缀口径不对（没去前缀 / 去错前缀） | 浏览器请求应是 `/ai-api/api/agent/...` ⇒ nginx 去前缀后 `/api/agent/...`；见 §6 坑 4 |
| 浏览器打开是 **nginx 默认页** | 镜像里没有产物（构建没跑成功） | `docker compose exec web ls /usr/share/nginx/html | head` ⇒ 空 ⇒ 重新 `up -d --build` |
| 前端刷新路由**白屏/404** | SPA fallback 没生效 | `curl -I http://127.0.0.1:8080/pm/task` ⇒ 应 200 + `text/html` |
| 发了新版但**用户还是旧页面** | `index.html` 被缓存 | `curl -I .../index.html` ⇒ 应有 `Cache-Control: no-store, no-cache, must-revalidate` |
| **对话要等很久才一次性蹦出来** | SSE 被 nginx 缓冲 | 见 §6 坑 2（`proxy_buffering off`） |
| AI 服务**找不到技能** | 技能路径是 **cwd 相对** | 见 §6 坑 3（`WORKDIR=/app` ⇒ 技能在 `/app/.pi/skills`） |
| 部署中途失败，**不知道怎么办** | —— | `bash docker/deploy.sh --yes` 失败时会打印**回退命令**（`git reset --hard <上一个 commit>` + `docker compose up -d --build`） |

---

## 6. 已知坑（都是真踩过的）

1. **容器必须监听 `0.0.0.0`**，不能是 `localhost`
   ⇒ 否则 nginx 连不上（**502**），而**容器自己的 healthcheck 走 localhost 仍显示 healthy** ⇒ 极具迷惑性。
   本仓 AI 服务用 `app.listen(port)`（不带 host）⇒ 监听所有网卡 ✓。

2. **AI 的 SSE 必须关 `proxy_buffering`**
   ⇒ 否则 nginx 会攒着一起发 ⇒ 用户看到「对话憋很久才一次性蹦出来」。
   本仓 nginx 模板里有 `proxy_buffering off` + `proxy_read_timeout 3600s`；
   AI 服务自己也发 `X-Accel-Buffering: no`（双保险）。

3. **AI 服务的技能路径是 **cwd 相对****
   ⇒ `load_skill` / `/api/agent/skills` 按 `join(process.cwd(), ".pi", "skills")` 找
   ⇒ 换 `WORKDIR` 就找不到技能 ⇒ 镜像里 `WORKDIR=/app` 且技能必须在 `/app/.pi/skills` ✓。

4. **`/ai-api/` 前缀不能省**
   ⇒ AI 服务的路径也是 `/api/agent/...`，而 nginx 的 location 是**前缀匹配**
   ⇒ 浏览器若直接打 `/api/agent/...`，会被 `/api/`（归 AiAdmin）抢走 ⇒ 404。
   ⇒ 浏览器侧固定用 `/ai-api/`（`frontend/config/config.ts` 的 `AI_API_BASE_URL` 注入），
     nginx 去掉前缀再转给 AI 服务（与开发期 `frontend/config/proxy.ts` 逐字一致）。

5. **`ENVIRONMENT` 要显式钉死 `prod`**
   ⇒ 否则可能读到 `.env.dev`（验证码被关掉）—— 这是 AiAdmin 那边的教训。
   本仓 AI 服务没有这个变量，但**同理**：本部署**不挂任何 `.env` 进容器**，
   全部走 compose 的 `environment:` ⇒ 不会有「读到 dev 配置」的机会。

6. **（额外交代）`/api/` 不能 rewrite**
   ⇒ AiAdmin 的 `root_path` 是 `/api/v1`，而前端 baseURL **已经含** `/api/v1`
   ⇒ nginx 的 `proxy_pass` **必须不带 URI 部分**（带了会把 `/api/` 前缀吃掉 ⇒ 404）。

---

## 7. 镜像与构建

| 镜像 | 构建命令（**仓根**执行） | 内容 |
| ---- | ----------------------- | ---- |
| `ai-admin-web` | `docker build -f docker/web/Dockerfile -t ai-admin-web .` | 只有 `frontend/dist`（无 `node_modules`、无源码、无凭据） |
| `ai-admin-ai` | `docker build -f backend/ai/Dockerfile -t ai-admin-ai .` | 只有生产依赖 + `dist/` + 生成的 prisma 客户端 + `/app/.pi`（技能） |

⚠️ **构建上下文 = 仓根**（`.dockerignore` 在仓根）⇒ 两条命令都在**仓根**跑。
⚠️ 构建阶段**不连后端、不读 `.env`、不带任何凭据** ⇒ 构建机上不需要私有信息。

---

## 8. 验收脚本（都能复跑）

```bash
node scripts/e2e/compose.static.cjs    # 静态断言（不需要 docker）
node scripts/e2e/compose.cjs           # 真起 compose 验三条路由（需要 docker）
node scripts/e2e/deploy.cjs            # 端到端部署验收（需要 docker；独立 project name，不污染本地）
node scripts/e2e/deploy-script.cjs     # 部署脚本本身的行为验收（只需要 bash）
node scripts/e2e/web-container.static.cjs
node scripts/e2e/web-container.cjs
```

CI 里会跑这些（`.github/workflows/docker-compose.yml`、`.github/workflows/docker-web.yml`）。

---

## 9. 部署脚本（一条命令）

```bash
bash docker/deploy.sh          # **默认只检查**（不改任何东西）
bash docker/deploy.sh --check  # 同上（显式写法）
bash docker/deploy.sh --yes    # 真执行
```

`--yes` 会做：**拉最新代码 → 构建镜像（层缓存，没变化不重建）→ `compose up -d` → 等两个容器 healthy → 写 `docker/.last-deploy` + 打印摘要**。

- **幂等**：再跑一次不报错，也不重建没变化的东西。
- **失败可回退**：任何一步失败都会打印**怎么回退**（`git reset --hard <上一个 commit>` + `docker compose up -d --build`）。
- **不把凭据写进日志**：只打印环境变量的**名字**，不打印值。
- **状态记录**：`docker/.last-deploy`（记录上次成功部署的 commit ⇒ 回退提示用；**已 gitignore**）。

Windows（只有 Docker Desktop 的机器）：用 `docker\deploy.bat`（bash 版的简化版；**推荐在 Git Bash / WSL 里用 `deploy.sh`**）。
