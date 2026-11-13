# 前端容器化（2026-11-13）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #38（前端容器化）· PR 见 `feat/38-web-container` 分支
- **一句话**：把 `frontend/` 做成多阶段镜像 `ai-admin-web`（node 构建 → nginx 托管 `frontend/dist`），
  并把「镜像能跑起来」变成**入库的**验收脚本 + CI。

## 状态

**已完成**（CI 全绿后合并；合并后本条应标记「已完成」）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `f08b5a1` | 设计文档 + 实施计划（PM 判「大规模」⇒ spec + plan） |
| `b5ff697` | `.dockerignore` + `docker/web/Dockerfile` + `docker/web/nginx.conf` + 安全头片段 + `docker/README.md` |
| `129ac88` | 验收脚本（静态断言 + 起容器）+ CI workflow + `scripts/e2e/README.md` + 根 `package.json` 脚本 |
| `08b133d` → 后续若干次 | 修 CI 里暴露的构建问题（`.npmrc` / npm 版本 / 根 lock / docs 构建输入 / 验收脚本自身的两处误判） |

**下一步（具体到文件与命令）**：

```
# 后续 issue（不是本条的活）：
#   #C compose 编排：docker/docker-compose.yml + nginx 加 /api/、/ai-api/ 的 proxy_pass
#      ⇒ 在 docker/web/nginx.conf 的 server 块里加 location + proxy_pass（骨架已就位）
#   #D 部署脚本 scripts/deploy/deploy.sh
#   #E 部署文档 + 端到端部署验收脚本（docker/README.md 现在只有镜像与构建命令，待补）
```

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **构建上下文 = 仓根**，`.dockerignore` 放仓根 | 验收命令是 `docker build -f docker/web/Dockerfile -t ai-admin-web .` ⇒ 上下文就是仓根；`.dockerignore` 放 `docker/` 下**不生效** | `node_modules`（2.5GB，含 Windows 二进制）进上下文 ⇒ 构建慢到不可接受 |
| **依赖层要拷 `frontend/.npmrc`**（内容：`legacy-peer-deps=true`） | 本仓的 `frontend/package-lock.json` 是**按 legacy-peer-deps 生成的**；少了这个 .npmrc ⇒ npm 按「自动装 peer」算出的树与 lock 不同 ⇒ `npm ci` 直接 EUSAGE | 镜像构建第一步就挂：`npm ci can only install packages when your package.json and package-lock.json ... are in sync` |
| **钉 `npm@10.9.9`**（= 仓库 CI 用的版本） | `node:22` 现在默认带 **npm 11** ⇒ 它的 lock 同步检查比 npm 10 严 ⇒ 本仓的 lock 被判不同步 ⇒ `npm ci` EUSAGE | 同上（换个错误信息而已）。钉住后镜像与 CI 装出**同一棵树**（2183 个包） |
| **仓根的 `package.json` + `package-lock.json` 也要拷进构建目录** | utoopack 找「项目根」的规则（`@utoo/pack` 的 `findRootDir`）：从 cwd 往上找**最近的 lock 文件**，再往上找**还有 lock 文件的目录** ⇒ 本地根 = 仓根（frontend/ 与 仓根都有 lock）⇒ `frontend/src/pages/Welcome.tsx` 里 `import '../../../docs/cheatsheet.en-US.md'` 在根之内 | 镜像里根退化成 `frontend/` ⇒ 那个 import 变成「跳出根目录」⇒ utoopack 报 `Module not found: Can't resolve '../../../docs/cheatsheet.en-US.md'`（**踩了 4 次才定位**） |
| **要拷 `docs/cheatsheet.en-US.md` / `docs/cheatsheet.zh-CN.md`** | 它们是 `frontend/src/pages/Welcome.tsx` 的**构建输入**（utoopack 的 `*.md` loader）；而 `.dockerignore` 里原本排掉了 `docs/` | 同上（文件不在镜像里 ⇒ 解析不到） |
| builder 用 `node:22-bookworm-slim`，**不用 alpine** | `@utoo/pack`（utoopack 的 Rust 内核）、`esbuild` 的预编译二进制是 **glibc** 版；alpine=musl ⇒ 跑不起来 | 镜像构建在最后一步炸（而且只在 Linux 上炸，本机还验不出来） |
| `npm ci --ignore-scripts` + `npm rebuild esbuild` | 依赖层要能缓存（先只 COPY `package.json`/`package-lock.json`）；此时**源码还没拷进来**，root 包的 `prepare`（husky + max setup）会失败 ⇒ 跳过脚本；`--ignore-scripts` 顺带跳过 esbuild 的安装脚本 ⇒ 单独 rebuild 补回来 | 不跳过 ⇒ 依赖层缓存失效（每次改源码都重装依赖）；不 rebuild ⇒ esbuild 二进制没就位 |
| **nginx 整份替换 `/etc/nginx/nginx.conf`**（而不是塞进 `conf.d/default.conf`） | 要控制日志到 stdout、gzip、安全头、`server_tokens off` ⇒ 这些都得在主配置里写 | 只能用默认站点配置的一半能力，日志进不了 `docker logs` |
| `try_files $uri /index.html`（**刻意不带 `$uri/`**） | 验收标准写「任意前端路由刷新返回 index.html」；带 `$uri/` 时 `/pm/task` 会命中 umi `exportStatic` 预渲染的 `pm/task/index.html`（同一套壳，但字面不是根 index.html）⇒ 不带尾斜杠的路由精确回落到**根 index.html** | 验收方按字面核对时对不上（其实两种都是 200 的壳） |
| 长缓存靠「**带扩展名的正则 location**」，另留一个显式 `/assets/` 块 | 本仓 umi 4 产物是**扁平**的（`umi.<hash>.js` 直接躺在 `dist/` 根，**没有 `assets/` 目录**）⇒ 只写 `/assets/` 会一条都命中不了；带 hash 的文件名天然带扩展名 ⇒ 正则才真正生效 | 「`/assets/*` 长缓存」验收项看着实现了，实际**完全没生效**（静态资源全走 SPA fallback ⇒ 每次全量重下） |
| 安全头做成**片段** `snippets/security-headers.conf`，每个自带 `add_header` 的 location 都 `include` | nginx 语义：location 里一旦出现 `add_header`，**父级的 add_header 全部失效**（不是合并）⇒ 只在 server 写一遍，那些 location 的响应就没有安全头 | 静态资源响应裸奔（缺 `X-Content-Type-Options` 等） |
| `/healthz` 返回固定 `{"status":"ok"}` | 验收要求「返回 200 且**不含版本敏感信息**」⇒ 不能带版本号/提交号 | 健康检查变成信息泄露 |
| 镜像名 `ai-admin-web`、端口 **80**、`/healthz` 路径 | #C（compose）要直接用 ⇒ 先定死，省得 compose 再改 | compose 里镜像名对不上 ⇒ 改两处 |

## 怎么验

```bash
# ① 静态断言（**不需要 docker**，任何机器都能跑）
node scripts/e2e/web-container.static.cjs
# 或
npm run e2e:web:static

# ② 真起容器（需要 docker；本机没 docker ⇒ 打印 SKIP 并退出 0）
node scripts/e2e/web-container.cjs
# 或
npm run e2e:web

# ③ CI（GitHub runner 自带 docker ⇒ ② 在 CI 上是真跑的）
#    .github/workflows/docker-web.yml：static job + image job
```

`②` 覆盖的验收点：构建成功、`nginx -t` 通过、镜像里没有 `node_modules`、`/` 返回首页 HTML、
`/pm/task` 刷新不 404、静态资源 `max-age=31536000`、`/index.html` `no-store`、`/healthz` 200 且无版本信息。

## 坑与提醒

- **本机（Windows + git-bash）没有 docker** ⇒ 本地跑不了 `docker build` / `nginx -t`；
  容器验收靠 **CI**（新增的 `docker-web.yml`）。改完 nginx 配置**必须看 CI 的 image job**。
- **本条在 CI 上迭代了 5 轮才把镜像构建跑通**（每轮 ~2 分钟）。教训：
  「本机没有 docker ⇒ 只能靠 CI 验」时，**先把最可能踩的坑写进 Dockerfile 注释**，
  并在验收脚本里打印**失败输出**（一开始只打 stderr 尾部，把真正的错误原因截没了，定位慢了 3 轮）。
- **utoopack 在 Windows 上解不开 junction**：worktree 里 `frontend/node_modules` 是指向主 checkout 的
  junction ⇒ `npx max build` 报 `Symlink frontend/node_modules could not be resolved`。
  **这不是本条的问题**（Docker 里 `node_modules` 是真目录），
  但会让人以为「前端构建坏了」⇒ 别在 worktree 里用 umi 构建来判断镜像能不能构建。
- `npm ci --ignore-scripts` 只跳过**生命周期脚本**；optionalDependencies（如 `@utoo/pack-linux-x64-gnu`、
  `@esbuild/linux-x64`）照常安装 ⇒ 原生二进制不会缺。
- `max build` 自己会生成 `src/.umi`（`@umijs/preset-umi` 的 build 命令里 apply 了 `onGenerateFiles`）
  ⇒ 镜像里**不需要**额外跑 `max setup`。
- 验收脚本里断言「镜像里没有 node_modules」用的是 `find / -maxdepth 4 -type d -name node_modules`；
  ⚠️ 产物里**文件名**含 `node_modules__xxx.css`（打包器把模块路径拼进了文件名）⇒ 别用字符串包含来判断。
