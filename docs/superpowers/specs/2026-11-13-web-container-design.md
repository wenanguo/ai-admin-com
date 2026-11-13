# 前端容器化设计（2026-11-13）

> **一句话**：把 `frontend/`（Umi Max 4 / React 19）做成一个**多阶段镜像** —— Node 阶段编译静态产物，
> nginx 阶段托管它 —— 产出 `ai-admin-web` 镜像，供后续 compose（#C）直接用。
>
> **关联**：issue #38 · 分支 `feat/38-web-container`

---

## 1. 目标 / 非目标

### 目标

1. `docker build -f docker/web/Dockerfile -t ai-admin-web .` 一条命令出镜像。
2. 镜像里**只有构建产物**（`frontend/dist`），没有 `node_modules`、没有源码、没有凭据。
3. 容器起来后：根路径返回前端首页 HTML；**任意前端路由刷新不 404**（SPA fallback）。
4. 缓存策略正确：带 hash 的静态资源长缓存；`index.html` 不缓存（发新版不能给用户旧壳）。
5. `/healthz` 健康检查端点（200、不含版本敏感信息）。
6. 构建**不需要任何私有凭据**：不连后端、不读 `.env`。

### 非目标（本条不做，边界写死）

- ❌ **API 代理**（`/api/`、`/ai-api/`）—— 那是 #C 的活。
- ❌ compose 编排 —— #C。
- ❌ 部署脚本 —— #D。
- ❌ 端到端部署验收脚本汇总 —— #E。
- ❌ 不改前端业务代码（产物路径以 `frontend/package.json` 的 `build` 脚本为准：`UMI_OUTPUT_PATH=dist max build`）。
- ❌ 不做 Cloudflare Worker 部署（`frontend/cloudflare-worker/` 是另一条发布路径）。

### 反目标

- 为了「多阶段」而多阶段：构建阶段里留下 `node_modules` ⇒ 镜像几百 MB ⇒ **失败**。
- `index.html` 也上长缓存 ⇒ 发新版用户拿到旧壳 ⇒ **失败**。

---

## 2. 现状（动手前先看清三件事）

| 事实 | 证据 | 对方案的影响 |
| ---- | ---- | ------------ |
| 产物是**扁平**的：hash 文件名直接躺在 `dist/` 根，**没有 `assets/` 目录** | `frontend/dist/`：`umi.<hash>.js`、`p__xxx.<hash>.async.js`、`_project__frontend_0.<hash>.css` | 验收标准写的「`/assets/*` 长缓存」在本仓**没有对应目录** ⇒ 缓存规则不能只写死 `/assets/`，要按「带扩展名的静态资源」来判，并额外保留一个显式 `/assets/` 块（为将来切目录布局预留） |
| `config.ts` 里 `exportStatic: {}` ⇒ **每条路由都预渲染了 HTML** | `frontend/dist/pm/task/index.html`、`dist/account/center/`… | `/pm/task` 这种路由**可能命中预渲染的 `pm/task/index.html`**（同一套壳，不是 404）⇒ 验收要判「200 + HTML 壳」，而不是死抠字节等于根 `index.html` |
| 8 个 locale 都在 `src/locales/` ⇒ 编译进 JS bundle | 无独立语言目录 | nginx 只需管「静态文件 vs SPA 路由」，不需要按语言目录特判 |

另：产物里有 `404.html`（umi 自带）⇒ 不需要单独配 nginx 错误页。

---

## 3. 方案对比

| 方案 | 做法 | 取舍 |
| ---- | ---- | ---- |
| **A. 多阶段镜像（本选）** | 仓根为构建上下文；`node:22` 阶段 `npm ci` + `npm run build`；`nginx:alpine` 阶段只 `COPY dist` | 镜像自洽（不依赖宿主机构建产物）、可复现、CI 一条命令就能验；代价：构建耗时长（npm ci + umi build） |
| B. 宿主机构建 → 拷进 nginx 目录挂载（AiAdmin 现有做法） | 宿主机 `npm run build`，产物挂载进 nginx 容器 | 快；但**产物与镜像版本可能对不上**，CI 不好验 ⇒ 本仓要「一条命令出镜像」，不选 |
| C. 单阶段：node 跑 `max preview` | 一个镜像跑 umi preview | 镜像大、preview 不是生产服务器（无缓存头、无 gzip）⇒ 否 |

**决定**：A。

---

## 4. 设计

### 4.1 文件布局

```
docker/
  README.md                      # 构建命令 + 镜像名（本条先占位，#E 补全）
  web/
    Dockerfile                   # 多阶段：builder(node) → runtime(nginx)
    nginx.conf                   # 整份 nginx 主配置（http/server 都在里面）
    snippets/security-headers.conf  # 安全头片段（多处 include，避免 add_header 继承坑）
.dockerignore                    # 仓根（构建上下文是仓根 ⇒ 必须放根）
```

### 4.2 Dockerfile

- **构建上下文 = 仓根**（验收命令 `docker build -f docker/web/Dockerfile -t ai-admin-web .`）⇒ `.dockerignore` 放仓根。
- **builder**：`node:22-bookworm-slim`（**不用 alpine**：`@utoo/pack`（utoopack 内核）、`esbuild` 等预编译二进制是 glibc 版，musl 跑不起来）。
  - 依赖层缓存：先 `COPY frontend/package.json frontend/package-lock.json frontend/.npmrc` → `npm ci --ignore-scripts` → 再 `COPY frontend/` → 源码改动不重装依赖。
  - ⚠️ **必须带 `frontend/.npmrc`**（`legacy-peer-deps=true`）：本仓的 lock 是按 legacy-peer-deps 生成的；少了它 ⇒ `npm ci` 报 lock 不同步（EUSAGE）。
  - ⚠️ **钉 `npm@10.9.9`**（= 仓库 CI 用的版本）：`node:22` 自带 npm 11 ⇒ lock 同步检查更严 ⇒ 同样会 EUSAGE。
  - `--ignore-scripts` 会跳过 `esbuild` 的安装脚本（它负责把二进制就位）⇒ 紧跟一条 `npm rebuild esbuild` 补回来。
  - ⚠️ **仓根的 `package.json` + `package-lock.json` 也要拷进构建目录**：utoopack（`@utoo/pack` 的 `findRootDir`）靠 **lock 文件链**找项目根 ⇒ 本地根 = 仓根；镜像里少了根 lock ⇒ 根退化成 `frontend/` ⇒ `Welcome.tsx` 里 `import '../../../docs/cheatsheet.*.md'` 变成「跳根」⇒ 解析失败。
  - ⚠️ **要拷 `docs/cheatsheet.en-US.md` / `docs/cheatsheet.zh-CN.md`**：它们是 `frontend/src/pages/Welcome.tsx` 的构建输入（utoopack 的 `*.md` loader）。
  - 构建：`npm run build`（= `cross-env UMI_OUTPUT_PATH=dist max build`）⇒ 产物在 `frontend/dist`。
  - `ENV HUSKY=0`（不装 git hooks）、`NODE_OPTIONS=--max_old_space_size=4096`（照抄 CI 的构建参数）。
  - `ARG COMMIT_HASH` ⇒ 可选注入构建版本（`config.ts` 认这个变量；不给也不报错）。
- **runtime**：`nginx:1.27-alpine`
  - `COPY --from=builder /app/frontend/dist /usr/share/nginx/html`
  - `COPY docker/web/nginx.conf /etc/nginx/nginx.conf`（替换默认主配置 ⇒ 日志到 stdout、gzip、安全头都能配）
  - 删掉镜像自带的 `conf.d/default.conf`（用不到，留着容易误以为生效）
  - `EXPOSE 80`、`HEALTHCHECK`（`wget -q -O /dev/null http://127.0.0.1/healthz`）、`STOPSIGNAL SIGQUIT`

### 4.3 nginx 规则（`docker/web/nginx.conf`）

| 位置 | 规则 | 为什么 |
| ---- | ---- | ---- |
| `http` | `access_log /dev/stdout`、`error_log /dev/stderr`、`server_tokens off`、gzip（`text/css`、`application/javascript`、`image/svg+xml`…）、`sendfile on` | 日志进容器日志；不泄露 nginx 版本；压缩 |
| `server` | `root /usr/share/nginx/html`、`index index.html` | 站点根 |
| `location = /healthz` | `return 200 '{"status":"ok"}'`、`default_type application/json`、`access_log off` | 健康检查；**只回固定串，不带版本号** |
| `location = /index.html` | `add_header Cache-Control "no-store, no-cache, must-revalidate" always` | **壳不缓存** ⇒ 发新版立刻生效 |
| `location ^~ /assets/` | `add_header Cache-Control "public, max-age=31536000, immutable" always`、`try_files $uri =404` | 验收标准点名 `/assets/*`；本仓当前产物扁平 ⇒ 这块是为「将来产物切到 `assets/` 目录」预留 |
| `location ~* \.(js\|mjs\|css\|map\|png\|jpe?g\|gif\|svg\|ico\|webp\|woff2?\|ttf\|eot)$` | 同上长缓存 + `try_files $uri =404` | **本仓真正生效的那条**：产物扁平在根，hash 文件名带扩展名 |
| `location /` | `try_files $uri /index.html` | **SPA fallback**：任意前端路由刷新 ⇒ 根 `index.html`（不 404） |

**为什么 `try_files $uri /index.html`（不带 `$uri/`）**：
带 `$uri/` 时 `/pm/task`（无尾斜杠）仍会落到 `pm/task/index.html`（umi `exportStatic` 预渲染的那份）。
不带 `$uri/` ⇒ `/pm/task` 精确回落到**根 `index.html`**，与验收标准字面一致；带尾斜杠的 `/pm/task/` 仍由目录索引命中预渲染页（同一套壳）。

**`add_header` 继承坑**：`add_header` 一旦在 `location` 里出现，**父级的 `add_header` 全部失效**（nginx 语义）。
⇒ 安全头写成片段 `snippets/security-headers.conf`，在 `server` 与每个自带 `add_header` 的 `location` 里各 `include` 一次。

### 4.4 缓存策略小结

| 请求 | Cache-Control |
| ---- | ------------- |
| `/index.html`、SPA 回落 | `no-store, no-cache, must-revalidate` |
| 带 hash 的 `*.js` / `*.css` / 字体 / 图片 | `public, max-age=31536000, immutable` |
| `/healthz` | `no-store` |

### 4.5 `.dockerignore`（仓根）

排除：`**/node_modules`、`**/dist`、`**/dist-dev`、`**/.umi`、`**/e2e-out`、`**/coverage`、`.git`、`.github`、
`**/.scratch`、`**/.env*`、`**/.ai`、`**/auth.json`、`**/*.pem`、`backend/`、`frontend/cloudflare-worker/`。
⇒ 镜像构建阶段拿不到源码依赖目录，也拿不到任何凭据。

⚠️ **`docs/` 不能排掉**：`frontend/src/pages/Welcome.tsx` import 了 `docs/cheatsheet.*.md` ⇒ 排掉它 ⇒ 构建报 “Can't resolve”。

---

## 5. 验收标准 → 实现 → 验证 映射

| #38 的验收标准 | 实现位置 | 验证方式 |
| -------------- | -------- | -------- |
| `docker build -f docker/web/Dockerfile -t ai-admin-web .` 成功，镜像里没有 node_modules | `.dockerignore` + 多阶段 | `scripts/e2e/web-container.cjs`（构建 + `find / -type d -name node_modules` 为空） |
| 根路径返回前端首页 HTML | `location /` + `try_files` | 同上：`GET /` ⇒ 200 + `text/html` + 含 `<div id="root">` |
| SPA fallback：`/pm/task` 刷新仍返回 HTML，不 404 | `try_files $uri /index.html` | 同上：`GET /pm/task` ⇒ 200 + 含 `<div id="root">` |
| `/assets/*` 长缓存、`index.html` 不缓存 | `location ^~ /assets/` + 扩展名正则 + `location = /index.html` | 同上：抽一个 hash 资源请求 ⇒ `Cache-Control` 含 `max-age=31536000`；`/index.html` ⇒ 含 `no-store` |
| 容器内 `nginx -t` 通过 | `docker/web/nginx.conf` | 同上：`docker run --rm ai-admin-web nginx -t` |
| `/healthz` 返回 200、不含版本敏感信息 | `location = /healthz` | 同上：`GET /healthz` ⇒ 200 + JSON + 正文里没有版本号字段 |
| 构建不需要私有凭据 | `.dockerignore` 排除 `.env`/`.ai`/`auth.json`；构建阶段不连后端 | 静态检查脚本断言 `.dockerignore` 覆盖了这些模式；构建日志里无凭据 |
| `docker/README.md` 写明构建命令与镜像名 | `docker/README.md` | 静态检查脚本断言含 `docker build` 与 `ai-admin-web` |

**验证脚本的分工**（没有 docker 也能跑的那部分）：

- `scripts/e2e/web-container.static.cjs` —— **纯静态断言**（读 `Dockerfile` / `nginx.conf` / `.dockerignore` / `docker/README.md`）：
  不需要 docker，CI 必跑 ⇒ 配置写错了当场红。
- `scripts/e2e/web-container.cjs` —— **真起容器**（构建 → `nginx -t` → 起容器 → curl 各项 → 查镜像里没有 node_modules）：
  需要 docker；本机没 docker 时打印 `SKIP` 并退出 0；GitHub Actions runner 有 docker ⇒ CI 上真跑。

CI：新增 `.github/workflows/docker-web.yml`（PR 触发）⇒ 「静态检查」+「构建镜像并跑容器验收」两个 job。

---

## 6. 风险与已知取舍

| 风险 | 处置 |
| ---- | ---- |
| 本机没有 docker ⇒ 没法本地跑 `docker build` | 验收靠 CI（GitHub runner 有 docker）+ 静态检查脚本；本地用 `npm run e2e:web:static` |
| `npm ci --ignore-scripts` 跳过 `esbuild` 安装脚本 | 紧跟 `npm rebuild esbuild`；CI 里真构建 ⇒ 出错立刻可见 |
| 依赖层缓存 = 源码一改就重装依赖（若放弃 `--ignore-scripts`） | 本设计保留 `--ignore-scripts` + `rebuild esbuild` 的组合 ⇒ 依赖层可缓存 |
| `exportStatic` 预渲染页 vs 根 `index.html` | 两者都是同一套壳；`try_files` 顺序已按「字面回根 index.html」定 |
| 后续 #C 要加 `/api/`、`/ai-api/` 代理 | nginx 配置是**站点级骨架**，加 `location` 即可，不必重写结构；本条**故意不加**代理块 |

## 7. 本条之后谁接

- **#C（compose）**：拿 `ai-admin-web` 镜像 + nginx 路由 ⇒ 本条的镜像名与监听端口（80）已定。
- **#D（部署脚本）**、**#E（部署文档 + 验收汇总）**：`docker/README.md` 与 `scripts/e2e/web-container.cjs` 是它们的落点。
