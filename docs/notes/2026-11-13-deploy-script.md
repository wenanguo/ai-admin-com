# 部署脚本（2026-11-13）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #41（部署脚本 `deploy.sh`：一条命令起全套 + 失败可回退）· PR #48（已合并）
- **一句话**：把「拉代码 → 构建镜像 → 起服务 → 等健康 → 出摘要」变成**一条命令**（默认**只检查**，
  `--yes` 才动手），失败时**明确告诉人怎么回退**，且**不把凭据写进日志**。

## 状态

**已完成**（PR #48 已合并、CI 全绿）。

⚠️ **合并后的收尾**（下一棒不用重踩）：

- `scripts/agent/merge-pr.cjs` **合并成功后仍会崩**（`git pull --ff-only` 之后：它的 `tryRun`
  对 `stdout === null` 直接 `.trim()`）⇒ 合并本身成功，但后半段（切回 main / 删本地分支 /
  `fetch --prune`）没跑 ⇒ **收尾要手工做**：
  `git pull --ff-only` + `git fetch --prune` + 删本地分支。
- 合并脚本清理分支时**会把 agent 的工作区（worktree）删掉**（只剩 `node_modules` 软链）⇒
  开工前先 `ls` 一下工作区；不在就 `node scripts/agent/worktree.cjs add dev` 重建
  （重建前先把残留软链 `rm` 掉，**用 `rm` 不要用 `rm -r`**）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| （本 PR） | `docker/deploy.sh`（主逻辑）+ `docker/deploy.bat`（Windows 简化版）+ `docker/.last-deploy` 的 gitignore + 验收脚本 `scripts/e2e/deploy-script.cjs` + CI job + 文档 |

## 短设计（PM 判「中」⇒ 几段话）

**形状**：一个 bash 脚本，两种模式（默认 `check` / `--yes`），六个小函数：
`check_deps`（依赖）· `load_env`（环境变量，只查有没有值）· `do_check`（只读检查）·
`do_deploy`（真执行：pull → build → up → 等 healthy → 写状态 → 摘要）·
`wait_healthy`（轮询 `docker inspect` 的 health 状态）· `print_rollback_hint`（失败时给回退命令）。

**为什么不写成「一个巨大的 if」**：每一步都可能失败，而**每一步失败都要能给出回退路径** ⇒ 拆成函数后，
失败处理集中在 `do_deploy` 里（每个 `if ! ...; then print_rollback_hint; return 1; fi`）。

**为什么 Windows 只给简化版 .bat**：bash 的逻辑（数组、`${!var}` 间接引用、`set -euo pipefail`）在 batch 里写不出来 ⇒
与其抄一份残缺的 bash 逻辑，不如在 .bat 顶部**写清楚差别**，并推荐在 Git Bash / WSL 里用 `deploy.sh`。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **默认只检查**，`--yes` 才动手 | 与仓库里 `scripts/agent/merge-pr.cjs` 一个脾气：公共动作要显式确认 | 误敲一次就把线上换掉了 |
| **依赖检查里 node 只算警告** | 部署**不需要**宿主机装 node（构建在镜像里做）⇒ 把它当硬依赖会让没装 node 的服务器部署不了 | 目标机被迫装 node（或者部署直接被卡住） |
| **不跑 `docker compose config`**（只用 `config --services`） | `docker compose config` 会把**解析后的环境变量连值一起**打出来 ⇒ 凭据进日志 | 密钥进 CI/运维日志 ⇒ 泄密 |
| **`set -x` 禁用** | 同上（`set -x` 会把 `${DATABASE_URL}` 打进日志） | 同上 |
| **`load_env` 只检查变量「有没有值」，不打印值** | 同上；缺哪个**打印名字**即可 | 同上 |
| **状态记录 `docker/.last-deploy`**（记录 commit + 时间 + 镜像名），并 gitignore | 回退提示要用「部署前那个 commit」 | 失败时只能靠人回忆 commit ⇒ 回退容易回错 |
| **回退提示是「打印命令」而不是「自动回退」** | 自动 `git reset --hard` 会**丢改动**（部署机上的本地修改）⇒ 让人自己确认更安全 | 脚本自动回退把人的改动抹了 |
| **验收脚本只跑「检查模式」**（不跑 `--yes`） | `--yes` 会真的拉代码/构建/起服务 ⇒ 不能在 CI 的验收里跑 | CI 里误部署 |

## 怎么验

```bash
# 验收脚本（只需要 bash，不需要 docker）
node scripts/e2e/deploy-script.cjs
# 或：npm run e2e:deploy

# 手搓
bash docker/deploy.sh          # 默认只检查：报缺什么 + 列出将要做的
bash docker/deploy.sh --yes    # 真部署
```

验收脚本覆盖：默认模式**不改工作区**、**不写状态文件**、缺依赖时**明确报缺什么**、
`--help` 退出 0、未知参数退出 2、脚本里有 `set -euo pipefail` / 回退提示 / 不打印凭据、
`docker/.last-deploy` 被 gitignore、`deploy.bat` 存在。

## 坑与提醒

- **本机没有 docker** ⇒ `--yes` 的真路径只能在 CI/目标机上跑；本地只验「检查模式」。
  ⚠️ 部署脚本的「真部署」路径（pull → build → up → 等 healthy）**没有在真环境跑过** ——
  CI 里跑它等于在 CI 上部署 ⇒ 只验了检查模式 + 静态断言。**第一次在目标机上用要盯着看**。
- **`docker compose build` 的层缓存**：改一个前端文件 ⇒ 只有前端那层重建；不动前端 ⇒ 不重建 ⇒ 幂等 ✓。
- **`git pull --ff-only`**：目标机上有本地改动 ⇒ pull 失败 ⇒ 脚本报错并给回退提示（不会自动 reset）。
- **`docker/.last-deploy` 不入库**（根 `.gitignore`）⇒ 但它**在 `docker/` 目录里** ⇒
  compose 的构建上下文会带上它？—— 不会：`.dockerignore` 已排掉凭据类文件，而它只是一个小文本。
- 后续 **#42（部署文档 + 端到端部署验收）** 会复用本脚本的「检查模式」与 `docker/README.md`。
