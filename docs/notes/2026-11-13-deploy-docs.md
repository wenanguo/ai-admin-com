# 部署文档 + 端到端部署验收（2026-11-13）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #42（部署文档 + 端到端部署验收脚本）· PR 见 `feat/42-deploy-docs` 分支
- **一句话**：把 `docker/README.md` 写成**换一台机器也能照着跑**的部署手册，
  并补一条**端到端部署验收脚本**（独立 compose project ⇒ 不污染开发者的本地环境）。

## 状态

**进行中**（CI 全绿后合并；合并后本条应标记「已完成」）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| （本 PR） | `docker/README.md` 重写成部署手册（9 节）+ `scripts/e2e/deploy.cjs`（端到端验收）+ `docs/process.md` §11「部署」+ compose.static.cjs 加「部署手册」断言 + CI job |

## 短设计（PM 判「中」⇒ 几段话）

**手册**（`docker/README.md`）按「换机器的人会问什么」排序：
三个部件的分工（前端静态 / AI 服务 / **AiAdmin 后端是另一个仓，只连不装**）⇒ 目录结构 ⇒
环境变量清单（每个变量**干什么 + 示例值 + 是不是凭据**）⇒ 启动步骤（含**上线前置**）⇒ 访问地址 ⇒
常见故障与排查（症状 → 原因 → 怎么办）⇒ **已知坑 6 条**（含 issue 点名的 5 条 + `/api/` 不能 rewrite）⇒ 镜像与构建 ⇒ 验收脚本 ⇒ 部署脚本。

**验收脚本**（`scripts/e2e/deploy.cjs`）与 #40 的 `compose.cjs` 的区别：
- `compose.cjs` = **验口径**（用桩证明「路径没被改写」「前缀被去掉」）；
- `deploy.cjs` = **验「一套能跑起来」**（两个容器 healthy、前端 HTML、`/api/` 通、`/ai-api/` 通、AI `/health` 200、结束清干净）。
⇒ 两者共用 `docker/docker-compose.ci.yaml` 的桩，但 `deploy.cjs` **额外**用**独立 project name** 与**独立端口**。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **独立 compose project name**（`-p ai-admin-e2e-<pid>`）+ 独立端口（18080/13100） | issue 明确要求「不污染开发者的本地环境」；compose 的 project name 决定容器/网络/卷的名字 ⇒ 换名字就等于换一套 | 验收会把开发者本地的 `ai-admin` 项目**停掉/重建** ⇒ 正在跑的服务被打断 |
| **不读 `docker/.env`，自己写临时 env 文件**（`--env-file`，全是占位） | 开发者的 `.env` 里有真值 ⇒ 验收不该碰它；CI 也不能依赖它 | 验收会用到真 key/真库 ⇒ 污染环境、CI 不稳定、密钥有机会进日志 |
| **不删镜像**（结束只 `down -v`） | 镜像可能是开发者本地在用的 ⇒ `--rmi local` 会把它删了 | 开发者下次要重新构建镜像 |
| **`/api/` 的断言分两档**（有桩 ⇒ 额外验「路径原样」；`E2E_AIADMIN_URL` 指向真后端 ⇒ 401 也算「通」） | 真后端无 token 会回 401（**通**）；桩回 200 | 只能验「有响应」，验不出「路径被 rewrite 了」 |
| **失败时打印「是哪一步失败」**（每步一个 `step()` 标记 + 失败时打日志） | issue 明确要求；只看「exit 1」没法定位 | 排查靠猜 |
| **手册把「AiAdmin 后端是另一个仓」写在最前面** | 新人最大的误解就是「怎么把 AiAdmin 也装上」 | 部署时去装 AiAdmin（另一个仓的 compose + MySQL + Redis）⇒ 越界且踩共享库的坑 |

## 怎么验

```bash
# 静态断言（不需要 docker）：含「部署手册」那节
node scripts/e2e/compose.static.cjs
# 或：npm run e2e:compose:static

# 端到端部署验收（需要 docker；没 docker ⇒ 打印 SKIP 并退出 0）
node scripts/e2e/deploy.cjs
# 或：npm run e2e:deploy
```

`deploy.cjs` 覆盖：compose config 通过 → 两个容器 healthy → `/` 是前端 HTML → `/api/` 通（桩时还验路径原样）→
`/ai-api/` 通 → AI `/health` 200 → 前端 `/healthz` 200 → 结束 `down -v` 清干净。

## 坑与提醒

- **本机没有 docker** ⇒ 端到端验收只能靠 CI（`.github/workflows/docker-compose.yml` → `deploy-e2e` job）。
- ⚠️ **`deploy.cjs` 与 `compose.cjs` 会各自构建一次镜像**（CI 上各一次）⇒ CI 时间偏长；
  将来若嫌慢，可给 `deploy-e2e` job 加 `SKIP_BUILD=1` 并复用 `compose` job 的镜像（还没做）。
- ⚠️ **手册里没有写「怎么装 AiAdmin」**（故意的）⇒ 那在另一个仓；本部署只连。
- ⚠️ **手册里的「上线前置」是硬要求**：`ai_*` 表必须已存在（`migrate deploy` 才行，`migrate dev/reset` 会 DROP 共享库）。
- 后续：M0 里程碑到此收尾（#38 前端镜像 · #39 AI 镜像 · #40 compose · #41 部署脚本 · #42 文档与验收）。
