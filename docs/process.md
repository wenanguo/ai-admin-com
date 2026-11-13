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
      │  正文必含：做了什么 / 怎么验 / 关联的 issue
      ▼
⑥ CI：lint + tsc + 单测 + e2e（绿了才能合）
      ▼
⑦ 人 review → 合并 + 清理分支（一条命令，见 §9）
```

---

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
