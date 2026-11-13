# 前端容器化 实施计划（2026-11-13）

> **给执行的 agent：** 建议用 superpowers:executing-plans 逐条执行本计划（本计划任务少、彼此独立，原生执行更省事）。
> 步骤用 `- [ ]` 复选框跟踪。

**目标：** 产出 `ai-admin-web` 镜像（Node 构建 → nginx 托管静态产物），并把「镜像能跑起来」这件事变成可复跑的验收脚本。

**方案：** ① 镜像：`docker/web/Dockerfile`（builder `node:22-bookworm-slim` → runtime `nginx:1.27-alpine`）+ `docker/web/nginx.conf`（SPA fallback / 缓存策略 / `/healthz`）+ 仓根 `.dockerignore`。② 验收：`scripts/e2e/web-container.static.cjs`（静态断言，不需要 docker）+ `scripts/e2e/web-container.cjs`（真起容器，需要 docker）+ CI workflow。

**技术栈：** Docker 多阶段构建 · nginx · Node 22 · GitHub Actions。

**设计文档：** `docs/superpowers/specs/2026-11-13-web-container-design.md`

## 全局约束

- **不直落 main**：全部改动走分支 `feat/38-web-container` + PR。
- **构建上下文 = 仓根**：`.dockerignore` 必须在**仓根**，不是 `docker/` 下。
- **不碰前端业务代码**：`frontend/src/**`、`frontend/config/**` 一行不改；产物路径以 `frontend/package.json` 的 `build` 脚本为准。
- **不做 API 代理 / compose / 部署脚本**（#C / #C / #D 的活）。
- **不写凭据**：`.dockerignore` 必须挡住 `.env*`、`.ai/`、`auth.json`、`*.pem`。
- **验收脚本必须入库**：写在 `.scratch/` 的不算数。

## 评审重点

以下五个最可能咬人的情形，各由对应任务的步骤覆盖：

1. **构建上下文写错**（在 `docker/` 里 build）⇒ `.dockerignore` 失效、`node_modules` 进镜像 ⇒ 任务 1/3 验证。
2. **`index.html` 也被长缓存** ⇒ 发新版用户拿旧壳 ⇒ 任务 2 的静态断言 + 任务 4 的容器验收。
3. **SPA 路由刷新 404** ⇒ 用户直接白屏 ⇒ 任务 2/4 验证。
4. **`add_header` 继承坑**（location 里加了 `add_header` ⇒ 父级安全头全丢）⇒ 任务 2 用片段 `include` 规避。
5. **构建需要私有凭据**（读 `.env`/`.ai`）⇒ CI 上泄露风险 ⇒ 任务 1 的 `.dockerignore` 断言覆盖。

---

### 任务 1：构建上下文卫生（`.dockerignore`）

**涉及文件：**
- 新建：`.dockerignore`（仓根）

**产出：** 后续任务的构建上下文中只有源码，没有依赖/产物/凭据。

- [ ] **Step 1**：写 `.dockerignore`，至少覆盖：`**/node_modules`、`**/dist`、`**/dist-dev`、`**/.umi`、`**/e2e-out`、`**/coverage`、`.git`、`.github`、`**/.scratch`、`**/.env*`、`**/.ai`、`**/auth.json`、`**/*.pem`、`backend/`、`docs/`、`frontend/cloudflare-worker/`。
- [ ] **Step 2**：确认 `frontend/package.json`、`frontend/package-lock.json`、`frontend/config/`、`frontend/src/` **没有**被排除（`npm ci` 与 `max build` 需要它们）。
- [ ] **Step 3**：提交
  ```bash
  git add .dockerignore
  git commit -m "chore(docker): 加仓根 .dockerignore（构建上下文只留前端源码）"
  ```

---

### 任务 2：nginx 站点配置（`docker/web/nginx.conf` + 安全头片段）

**涉及文件：**
- 新建：`docker/web/nginx.conf`
- 新建：`docker/web/snippets/security-headers.conf`

**接口（后续任务依赖）：**
- 产出：`docker/web/nginx.conf`（整份主配置，替换 `/etc/nginx/nginx.conf`）、`docker/web/snippets/security-headers.conf`（安全头片段，被 `include`）。
- 约定：站点根 `/usr/share/nginx/html`；健康检查路径 `/healthz`；SPA 回落文件 `/index.html`。

- [ ] **Step 1**：写 `docker/web/snippets/security-headers.conf`：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 三条 `add_header ... always`。
- [ ] **Step 2**：写 `docker/web/nginx.conf`：
  - `http` 层：`access_log /dev/stdout`、`error_log /dev/stderr`、`server_tokens off`、`sendfile on`、gzip（含 `text/css` / `application/javascript` / `image/svg+xml`）。
  - `server` 层：`listen 80`、`root /usr/share/nginx/html`、`index index.html`、`include` 安全头片段。
  - `location = /healthz`：`return 200 '{"status":"ok"}'`、`default_type application/json`、`access_log off`、`Cache-Control: no-store`。
  - `location = /index.html`：`Cache-Control: no-store, no-cache, must-revalidate`。
  - `location ^~ /assets/`：长缓存 + `try_files $uri =404`。
  - `location ~* \.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$`：长缓存 + `try_files $uri =404`。
  - `location /`：`try_files $uri /index.html`。
  - 每个自带 `add_header` 的 `location` 里都 `include` 安全头片段。
- [ ] **Step 3**：静态自查（人眼过一遍）：每个 `add_header` 所在块都 include 了安全头片段；`location /` 的 `try_files` 是 `$uri /index.html`。
- [ ] **Step 4**：提交
  ```bash
  git add docker/web/nginx.conf docker/web/snippets/security-headers.conf
  git commit -m "feat(docker): nginx 站点配置（SPA fallback + 缓存策略 + /healthz）"
  ```

---

### 任务 3：多阶段 Dockerfile + `docker/README.md`

**涉及文件：**
- 新建：`docker/web/Dockerfile`
- 新建：`docker/README.md`

**接口：**
- 消费：任务 2 的 `docker/web/nginx.conf`、`docker/web/snippets/security-headers.conf`。
- 产出：镜像名 `ai-admin-web`（本地 tag `ai-admin-web:local`），监听端口 **80**，健康检查端点 `/healthz`。

- [ ] **Step 1**：写 `docker/web/Dockerfile`：
  - `FROM node:22-bookworm-slim AS builder`；`ENV HUSKY=0 CI=true NODE_OPTIONS=--max_old_space_size=4096`。
  - `COPY frontend/package.json frontend/package-lock.json ./frontend/` → `RUN cd frontend && npm ci --ignore-scripts --no-audit --no-fund`。
  - `COPY frontend/ ./frontend/` → `RUN cd frontend && npm rebuild esbuild` → `RUN cd frontend && npm run build`。
  - `FROM nginx:1.27-alpine AS runtime`：`rm -f /etc/nginx/conf.d/default.conf`、`COPY docker/web/nginx.conf /etc/nginx/nginx.conf`、`COPY docker/web/snippets/ /etc/nginx/snippets/`、`COPY --from=builder /app/frontend/dist /usr/share/nginx/html`、`EXPOSE 80`、`HEALTHCHECK`（`wget -q -O /dev/null http://127.0.0.1/healthz || exit 1`）、`STOPSIGNAL SIGQUIT`。
- [ ] **Step 2**：写 `docker/README.md`：镜像名 `ai-admin-web`、构建命令 `docker build -f docker/web/Dockerfile -t ai-admin-web .`、运行命令、`/healthz` 说明；标明「compose / 部署脚本见 #C、#D」。
- [ ] **Step 3**：提交
  ```bash
  git add docker/web/Dockerfile docker/README.md
  git commit -m "feat(docker): 前端多阶段镜像（node 构建 → nginx 托管）"
  ```

---

### 任务 4：验收脚本（静态 + 容器）

**涉及文件：**
- 新建：`scripts/e2e/web-container.static.cjs`
- 新建：`scripts/e2e/web-container.cjs`
- 修改：`scripts/e2e/README.md`（表格加两行）
- 修改：`package.json`（加 `e2e:web` / `e2e:web:static`）

**接口：**
- 消费：任务 1/2/3 的全部产物。
- 产出：两条可复跑命令 —— `node scripts/e2e/web-container.static.cjs`（无 docker 依赖）、`node scripts/e2e/web-container.cjs`（需要 docker，缺 docker 时 SKIP 退出 0）。

- [ ] **Step 1**：写 `scripts/e2e/web-container.static.cjs`（纯 node，无依赖）：
  断言 `.dockerignore` 覆盖 `node_modules`/`dist`/`.env`/`.ai`/`auth.json`/`*.pem`；断言 `Dockerfile` 含两个 `FROM`、`nginx` 运行时、`HEALTHCHECK`、`COPY --from=builder`；断言 `nginx.conf` 含 `try_files $uri /index.html`、`location = /healthz`、`max-age=31536000`、`no-store`、`include` 安全头片段；断言 `docker/README.md` 含 `docker build` 与 `ai-admin-web`。失败 ⇒ 打印缺哪一条并 `exit 1`。
- [ ] **Step 2**：跑它 ⇒ 期望全绿（此时文件刚写好，若红说明断言与实现不一致 ⇒ 改实现，不要改断言迁就）。
- [ ] **Step 3**：写 `scripts/e2e/web-container.cjs`：
  1. `docker build -f docker/web/Dockerfile -t ai-admin-web:local .`；
  2. `docker run --rm ai-admin-web:local nginx -t`（配置校验）；
  3. `docker run -d --name ai-admin-web-e2e -p 18080:80 ai-admin-web:local`，轮询 `/healthz` 直到 200；
  4. `GET /` ⇒ 200 + `text/html` + 正文含 `<div id="root">`；
  5. `GET /pm/task` ⇒ 200 + 正文含 `<div id="root">`（SPA fallback）；
  6. 从 `/` 的 HTML 里抽一个 `/*.js`（或 `/*.css`）资源 ⇒ 断言 `Cache-Control` 含 `max-age=31536000`；
  7. `GET /index.html` ⇒ 断言 `Cache-Control` 含 `no-store`；
  8. `GET /healthz` ⇒ 200 + JSON + 正文不含版本号样式字段；
  9. `docker run --rm --entrypoint sh ai-admin-web:local -c "find / -maxdepth 4 -type d -name node_modules"` ⇒ 输出为空；
  10. `finally` 里 `docker rm -f ai-admin-web-e2e`。
  没有 docker ⇒ 打印 `SKIP（本机没有 docker）` 并 `exit 0`。
- [ ] **Step 4**：改 `package.json` 加脚本：`"e2e:web": "node scripts/e2e/web-container.cjs"`、`"e2e:web:static": "node scripts/e2e/web-container.static.cjs"`；更新 `scripts/e2e/README.md` 表格与用法。
- [ ] **Step 5**：提交
  ```bash
  git add scripts/e2e/web-container.static.cjs scripts/e2e/web-container.cjs scripts/e2e/README.md package.json
  git commit -m "test(e2e): 前端镜像验收脚本（静态断言 + 起容器跑 curl）"
  ```

---

### 任务 5：CI 接线 + 交接文档

**涉及文件：**
- 新建：`.github/workflows/docker-web.yml`
- 新建：`docs/notes/2026-11-13-web-container.md`

- [ ] **Step 1**：写 workflow：PR 触发；job `static`（node 22，跑 `node scripts/e2e/web-container.static.cjs`）；job `image`（ubuntu-latest，跑 `node scripts/e2e/web-container.cjs` —— runner 自带 docker）。
- [ ] **Step 2**：写 `docs/notes/2026-11-13-web-container.md`（模板见 `docs/notes/TEMPLATE.md`）：目标 / 状态 / 已完成表 / 决策记录 / 怎么验 / 坑。
- [ ] **Step 3**：提交
  ```bash
  git add .github/workflows/docker-web.yml docs/notes/2026-11-13-web-container.md
  git commit -m "ci(docker): 前端镜像 CI（静态检查 + 构建并跑容器验收）"
  ```
- [ ] **Step 4**：提 PR（正文含「做了什么 / 怎么验 / `Closes #38`」+ 高风险标注），CI 全绿后合并。
