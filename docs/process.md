# 开发流程

> 一句话：**你提 issue → 我去开发 → 提 PR**。
> 这份文档是这套流程的**唯一事实源**；`CLAUDE.md` 只留一行指路。

---

## 1. 角色

| 谁 | 干什么 |
|---|---|
| **人** | 提 issue（说清目标与验收标准）· review PR · 合并 |
| **agent** | 领 issue → 设计/计划 → 实现 → 自审 → 提 PR |

**人不需要写代码，但需要说清「做完是什么样」**（验收标准）。

---

## 2. 全流程

```
① 人提 issue
      │  模板：.github/ISSUE_TEMPLATE/agent-task.md
      ▼
② agent 领 issue
      │  a. 读 issue + 相关代码（用 CLAUDE.md 找入口）
      │  b. 判断规模（§3）⇒ 决定要不要写设计与计划
      │  c. 开分支：feat/<短号>-<关键词>
      ▼
③ 实现（小步 TDD，每个任务一个 commit）
      │  进度与决策写进 docs/notes/<日期>-<主题>.md（§4）
      ▼
④ 自审
      │  Critical / Important 必须修完并有测试；Minor 记进 notes
      ▼
⑤ 提 PR
      │  模板：.github/PULL_REQUEST_TEMPLATE.md（自动带上 Closes #xx）
      │  正文必含：做了什么 / 怎么验 / 关联的 issue / **高风险**（命中就写，没命中写「无」）
      ▼
⑥ CI：lint + tsc + 单测 + e2e（绿了才能合）
      ▼
⑦ 人 review → 合并 + 清理分支（一条命令，见 §9）
```

---

### PR 正文必含的四栏（缺一项会被打回）

| 栏 | 写什么 |
| -- | ------ |
| 做了什么 | 一两句：现在是什么行为，改完是什么行为 + `Closes #xx` |
| 怎么验 | **可复制**的命令（CI 能自动验一部分，人眼要看的写这里） |
| 影响面 | 改到哪些目录；有没有跨到 AiAdmin 那个仓 |
| **高风险** | 命中（AI 闸门口径 / 权限 / 数据模型 / 动 AiAdmin 那个仓）⇒ 写清楚是哪一项 + 影响面；**没命中就写「高风险：无」** |

⚠️ 高风险那栏**不要用复选框**（两个都勾或都不勾都说不清）⇒ 直接写一行字。

**机器会盯**：[.github/workflows/pr-body-check.yml](../.github/workflows/pr-body-check.yml) 会在 PR 上检查正文有没有
「高风险：」与「Closes #」⇒ 缺了就报出来（草稿 PR 与 bot 的 PR 跳过）。

⚠️ 目前它只是**提示**（main 还没开分支保护 ⇒ 红了也能合）⇒ 要真强制 ⇒ 给 main 加 required status check。

## 3. 规模分级（决定写多少文档）

| 规模 | 判据 | 流程 |
| ---- | ---- | ---- |
| **小** | 改文案 / 修 bug / 调样式 | issue → 分支 → 改 → PR。**不写** spec/plan |
| **中** | 加一个功能 / 改一个模块 | issue → **短设计**（几段话，写在 issue comment 或 notes 里）→ 分支 → PR |
| **大** | 架构改造 / 跨模块重构 / 动数据模型 | issue → `docs/superpowers/specs/<日期>-<主题>-design.md` + `plans/<日期>-<主题>.md` → 分支 → PR |

⚠️ **别过度**：为「加一个按钮」也写全套 spec/plan 是浪费。

---

## 4. 交接文档（`docs/notes/`）—— **让下一棒接得上**

**为什么需要**：agent 每次会话的上下文都是新的 ⇒ 「这个功能做到哪了」「为什么这么设计」
如果只活在某个会话里，就会丢。

**什么时候写**：**接手的那个会话开始时**就建（或在 issue 里贴），做一条就更新。

**放哪**：`docs/notes/<YYYY-MM-DD>-<主题>.md`，用 `docs/notes/TEMPLATE.md` 起头。

**必须包含**：

| 段 | 内容 |
|---|---|
| 目标 | 关联的 issue / PR |
| 状态 | 进行中 / 已完成 / 卡住了 |
| 已完成 | 哪些提交、做了什么（能让人一眼明白） |
| **下一步** | 具体到「改哪个文件 / 跑哪条命令」—— 不是「继续开发」这种废话 |
| **决策记录** | 每个关键决定：**定了什么 / 为什么 / 错了的代价** |
| 怎么验 | 可复制的命令 |

⚠️ **决策记录是最值钱的部分**：半年后没人记得为什么当时那么定。

---

## 5. 分支与提交

| 约定 | 说明 |
| ---- | ---- |
| 分支名 | `feat/<短号>-<关键词>`、`fix/<短号>-<关键词>`；一次 issue 一个分支 |
| 提交信息 | conventional commits（`feat(ai):` / `fix(frontend):` / `docs(ai):` / `chore:` / `refactor:`）—— commitlint 会拦 |
| 提交粒度 | 一个任务一个提交；别把「重构 + 新功能」混在一起 |
| 落点 | **不再直落 main** ⇒ 一律走分支 + PR |
| 合并 | squash 或 merge 由人定；合并后删分支 |

---

## 6. 验收脚本（`scripts/e2e/`）

**为什么入库**：写在 `.scratch/` 里的脚本会被 gitignore ⇒ 不能复跑、不能进 CI、同事看不到。

| 脚本 | 干什么 |
| ---- | ------ |
| `scripts/e2e/login.cjs` | 登录取 token（验证码从 Redis 读；只用于本地验收） |
| `scripts/e2e/ai-gate.cjs` | 浏览器端到端：登录 → AI 工作台 → 让它改任务 → 等确认 → 点同意 → 核对任务真被改 |

⚠️ 这些脚本会**真的改数据**（AiAdmin 里的任务）⇒ 只在测试环境跑。

---

## 7. 什么该进仓、什么不该

| 进仓 | 不进仓 |
| ---- | ---- |
| 交接文档（`docs/notes/`）· 设计/计划（`docs/superpowers/`）· 验收脚本（`scripts/e2e/`）· 技能（`.pi/skills/`） | 凭据（`.env` / `.ai/auth.json`）· 临时探针（`.scratch/`）· 构建产物 |

---

## 8. agent 的硬规矩（摘自 `CLAUDE.md`）

1. **不直落 main** ⇒ 一律分支 + PR。
2. **先读 `docs/notes/`** ⇒ 上一棒做过什么、为什么这么做。
3. **改动要有测试**；端到端行为要有验收脚本。
4. **技能是提示词** ⇒ `.pi/skills/**` 进模型上下文 ⇒ 走评审，别写凭据。
5. **破坏性操作要人点头** ⇒ 写操作类工具必须走闸门。
6. **ai-admin（FastAPI）是独立仓** ⇒ 改它要单独提 PR 到那个仓。

---

## 9. 合并与清理分支（一条命令）

仓库的 `delete_branch_on_merge = false` ⇒ **合并后分支不会自动删** ⇒ 忘了删就堆积死分支。

```bash
# ① 只检查（默认，什么都不改）
node scripts/agent/merge-pr.cjs 8

# ② 检查通过就合并 + 删分支（本地与远端都删）
node scripts/agent/merge-pr.cjs 8 --yes

# ③ 换合并方式（默认 squash：一个 PR 一个提交）
node scripts/agent/merge-pr.cjs 8 --yes --strategy merge
```

脚本做的四件事：

| # | 动作 |
| - | ---- |
| 1 | **检查**：PR 状态 · 是否草稿 · 是否可合并 · CI 有无失败/未完成 · 有无「要求修改」的 review |
| 2 | 检查不通过 ⇒ **打印问题并退出**，什么都不动 |
| 3 | 通过且带 `--yes` ⇒ 合并（`gh pr merge --delete-branch`） |
| 4 | 本地清理：切回 main → `pull --ff-only` → 删本地分支 |

⚠️ **合并是公共动作** ⇒ 脚本默认**只检查** ⇒ 真合并必须显式 `--yes`。
⚠️ 合并方式默认 `squash`（main 上一个提交对应一个 PR/issue）；想保留 PR 内的细粒度提交用 `--strategy merge`。

### ⚠️ 合并脚本的三个坑（都踩过了）

| 坑 | 现象 | 处理 |
|---|---|---|
| **`gh pr merge --delete-branch` 会删本地分支** | 脚本若在**要删的那个分支**上 ⇒ **它会把自己删掉**（合并仍成功，只是脚本没了） | 脚本先把自己 copy 到临时目录再跑；**长期住 main** |
| **网络中断** | `gh pr merge` 内部要 fetch ⇒ 断网直接失败 | 失败后**远端没变化** ⇒ 网络恢复后重跑同一条命令即可 |
| **`stderr` 可能是 null** | 错误处理里 `.trim()` 崩掉，把真正的错误盖住 | 取 stderr 前先判空 |

⇒ **合并脚本要常驻 main**（它是流程的一部分，不是某个功能的附属）。

---

## 10. PM 调度层（多角色协作）

> §1–§9 讲的是「**一条 issue 从提出到合并**」的流水线。
> §10 讲的是它**前面那一段**：谁来把人的想法变成合格的 issue。

### 10.1 三个角色

```bash
人（说需求）→ PM 调度 agent → GitHub（milestone + issue）→ 开发 agent → PR → 人合并
```

| 角色 | 干什么 | 不干什么 |
| ---- | ------ | -------- |
| **人** | 说需求 · 拍板排期 · review 高风险 PR · 合并 | 手写 issue 正文 |
| **PM 调度 agent** | 沟通 · 拆需求 · 排版本/能力块 · 写 milestone + issue · 维护 `docs/pm/` · 抽查高风险 PR | ❌ 写产品代码 ❌ 合并 PR |
| **开发 agent** | 领 issue · 读代码 · 设计/计划 · 实现 · 自审 · 提 PR · 测试 · 合并 · 关 issue · 删分支 | 决定排期 · 自造需求 |

**角色判定**：说「排期 / 里程碑 / 今天做什么 / 建 issue」⇒ PM 模式；
说「领 #xx 去做」⇒ 开发模式。PM 是**可选角色**，开发 agent 的默认行为不变。

### 10.2 PM 的产物落在哪

| 东西 | 位置 | 性质 |
| ---- | ---- | ---- |
| 排期（版本 × 能力块） | GitHub **milestone**（命名 `版本 · 能力块`） | 执行侧真相 |
| 待办 | GitHub **issue**（正文按 `.github/ISSUE_TEMPLATE/agent-task.md` 写满） | 执行侧真相 |
| 可领取标记 | label `ready`（队首）/ `in-progress`（在途）/ `agent-task`（给 agent 的活） | 队列控制 |
| 规划与理由 | `docs/pm/roadmap.md`（活）/ `docs/pm/log.md`（只增不改） | 规划侧真相 |
| 角色说明 | `docs/pm/README.md` | 流程 |
| 唤醒入口 | `.pi/prompts/pm.md`（斜杠命令 `/pm`） | 入口 |

### 10.3 与 §2 流水线的关系

PM **只替换 §2 的第 ① 步「人提 issue」**：
原来是人手写，现在由 PM 拆解并写满（目标 / 可观察的验收标准 / 范围「要做+不做」/ 上下文真实路径 / 依赖 / 规模）。
②～⑦（领 issue → 实现 → 自审 → PR → CI → 合并）**完全不变**，仍由开发 agent 走。

**依赖规则**：块内按依赖排序（只给队首打 `ready`），块与块之间可并行。

### 10.4 收尾分工

- **合并 + 关 issue + 删分支**：开发 agent（PR 正文写 `Closes #xx`）。
- **PM 抽查**：AI 闸门 / 权限 / 数据模型 / 动 AiAdmin（FastAPI）那个仓 —— 这四类 PR PM 要亲自看内容。
- **合并脚本**：`node scripts/agent/merge-pr.cjs <PR号> --yes`（见 §9），**常驻 main**。

### ⚠️ 合并脚本的第四个坑：`gh` 收尾报错 ≠ 合并失败

实测（2026-11-13，PR #18）：`gh pr merge --squash --delete-branch` 在**删分支收尾**时抛自己的内部错误
（`Cannot read properties of null (reading 'trim')`），但**合并早已成功**。

⇒ 脚本现在：**报错后核对 PR 的真实状态**（`gh pr view --json state`）⇒ 已 `MERGED` 就继续走清理流程。

另外两条一起改了：

| 坑 | 处理 |
|---|---|
| **squash 合并后 `git branch -d` 会说「分支未合并」** | 改用 `-D`（squash 产生的是新提交，原分支提交不在 main 历史里） |
| **脚本可能躺在要删的分支上** | 合并**前**先切回 base（脚本常驻 main ⇒ 活着） |

---

### ⚠️ 合并脚本的第六个坑：`statusCheckRollup` 含**历史**的失败

实测（2026-11-13）：`gh pr view --json statusCheckRollup` 会把**历史**的 check run 也列进来
（同名 check 会出现多次）⇒ 一次失败就把 PR **永久卡住**。

⇒ 场景：我故意让 `body-check` 失败一次做负向测试 ⇒ 修好、重跑绿了 ⇒ rollup 里那个 failure 还在
⇒ 脚本永远说「有 CI 失败」⇒ **合不了**（GitHub 自己的合并按钮只看最新那次，没这个问题）。

⇒ 现在脚本改走 **check-runs API**，按**检查名**分组取**最新一次**；
⚠️ 顺带注意：check-runs 的 `conclusion` 是**小写**（`success`），rollup 是大写（`SUCCESS`）
⇒ 比较要大小写不敏感。

## 10. agent 工作区隔离（worktree）

### 为什么

**一个 agent 一个工作区**，别共用同一个 checkout。

实测教训（2026-11-13）：开发 agent 与 PM 调度 agent 共用 `D:/project/ai-admin-com`
⇒ 对方把我的工作区切到了 main；它的设计文档差点被我 `git add -A` 带进我的提交；
后来仓库内的 `.worktrees/` 目录**被另一个 agent 整个删掉**（只���下分支）。

⇒ 规矩：**每个 agent 一个独立工作区**（`git worktree`），目录彼此独立 ⇒ 切分支互不影响。

### 怎么用

```bash
# 建一个工作区（开发 agent 用 dev，PM 用 pm）
node scripts/agent/worktree.cjs add dev
node scripts/agent/worktree.cjs add pm

# 看有哪些工作区
node scripts/agent/worktree.cjs list

# 删一个（合并完、活干完）
node scripts/agent/worktree.cjs remove pm
```

脚本会顺手做掉两件**每次新建都要做**的事：

| 事 | 为什么 |
| -- | ---- |
| 把主 checkout 的 `node_modules` 用 **junction** 接过来 | 两个子项目共 2.5GB ⇒ 每个工作区重装太慢。⚠️ 改依赖时要在**主 checkout** 装，或删掉 junction 重装 |
| 跑一次 `max setup` 生成 `frontend/src/.umi` | `.umi` 被 gitignore ⇒ 新工作区没有它 ⇒ `tsc` 会报 `@umijs/max` 类型缺失 |

### 目录放哪

**仓库外**：`D:/project/ai-admin-com-worktrees/<名字>`（可用 `AI_WORKTREE_ROOT` 覆盖）。

⚠️ 最初放在仓库内的 `.worktrees/` ⇒ **被另一个 agent 删掉了** ⇒ 放外面更安全。

### ⚠️ 两个防呆（都实测踩过）

| 坑 | 脚本现在怎么挡 |
| ---- | ------------ |
| **另一个 agent 照文档跑 remove，想删别人的工作区** | remove 前自查：有未提交改动 / 有**未合并**的提交 ⇒ 拒绝删并列出原因 |
| **在自己的工作区里跑 remove** | cwd 就在该目录 ⇒ Windows 删不掉（还会把 worktree 元数据搞坏）⇒ 拒绝并提示先 cd 出去 |

⚠️ 目录名**带角色前缀**（`agent-dev` / `agent-pm`）⇒ 两个 agent 不会选到同一个名字。

### 干活时的规矩

- 干活前**先看自己在哪个工作区**：`git worktree list`
- 一个工作区 = 一个 agent；工作区之间**不共享未提交改动**
- ⚠️ `git add -A` 只在自己的工作区里用（别把别人的文件带进自己的提交）
- 合并走 `scripts/agent/merge-pr.cjs`（在**主 checkout** 里跑，脚本常驻 main）

### ⚠️ 第五个坑：`gh --delete-branch` 会连**本地**分支一起删

实测：脚本先删远端分支、再删本地分支 ⇒ 但 `gh pr merge --delete-branch` **已经把本地分支删了**
⇒ 再删一次报「branch not found」⇒ 脚本在那里抛错 ⇒ **后面的 `pull` 没跑到**（本地 main 落后远端）。

⇒ 现在：删本地分支时**容忍「已不存在」**，并在最后补一次 `git fetch --prune`
（否则 `git branch -a` 里还挂着 `origin/xxx`，看着像分支还在）。

---

## 11. 部署（`docker/`）

**部署手册在 [`docker/README.md`](../docker/README.md)** —— 换一台机器照着它就能把整套跑起来。

| 想干什么 | 用什么 |
| -------- | ------ |
| 只想知道「要配哪些变量 / 出错了怎么办」 | 读 [`docker/README.md`](../docker/README.md) |
| 想真的部署 | `bash docker/deploy.sh --yes`（默认是**只检查**模式） |
| 想验「这套真能跑起来」 | `node scripts/e2e/deploy.cjs`（独立 compose project ⇒ 不碰本地环境） |

⚠️ 三条硬规矩：

1. **真值只进 `docker/.env`**（不入库）⇒ 模型 key / 数据库口令不进镜像、不进日志。
2. **AI 服务端口只绑 `127.0.0.1`** ⇒ 公网唯一入口是 nginx 的 80。
3. **数据库迁移不在部署范围** ⇒ `ai_*` 那几张表必须**已经存在**（只允许 `migrate deploy`）。
