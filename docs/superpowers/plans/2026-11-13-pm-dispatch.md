# PM 调度机制 实施计划

> **给执行的 agent：** 建议用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐条执行本计划。步骤用 `- [ ]` 复选框跟踪。

**目标：** 在 `wenanguo/ai-admin-com` 建立「人 ↔ PM agent ↔ GitHub ↔ 开发 agent」的调度层，使需求能被排成 milestone + issue，且关掉会话后可唤醒。

**方案：** 三块。① 仓库侧事实源：`docs/pm/README.md`（角色说明）+ `roadmap.md`（活的规划）+ `log.md`（只增不改的决策日志）。② 唤醒入口：pi 项目级 prompt 模板 `.pi/prompts/pm.md`（斜杠命令 `/pm`）+ `AGENTS.md` 的「PM 调度层」一节。③ GitHub 侧：label `ready`/`in-progress` + milestone（版本·能力块）+ issue（正文按 `.github/ISSUE_TEMPLATE/agent-task.md` 写满）。

**技术栈：** GitHub CLI（`gh`，API + git 走 **SSH**）、Markdown、pi prompt 模板。

**设计文档：** `docs/superpowers/specs/2026-11-13-pm-dispatch-design.md`

## 全局约束

- **不直落 main**：本计划的所有文件改动走分支 `docs/13-pm-dispatch` + PR；合并由人/开发 agent 做。
- **不写产品代码**：本计划只写 Markdown 与 GitHub 元数据。
- **issue 正文必填**：目标 / 验收标准（可观察事实）/ 范围（要做 + 不做）/ 上下文（真实文件路径）/ 依赖 / 规模。禁止「体验更好」这类主观描述。
- **只给队首打 `ready`**：每个 milestone 的第一条 issue 才有 `ready`；其余没有。
- **里程碑命名**：`版本 · 能力块`，例如 `v0.9 · M1 AIPM 命令层`；不在 GitHub 建「空壳版本 milestone」。
- **网络**：本机 git 走 **SSH**（`git@github.com`）——HTTPS 的 git 端点被重置；`http.curloptResolve` 已在仓库级配好但 HTTPS 仍不通，勿切回 HTTPS。

## 评审重点

以下五个输入/情形最可能咬人，各由对应任务的验证步骤覆盖：

1. **新会话唤醒**：不在原对话里、只在新会话打 `/pm` ⇒ 必须能读出当前排期与在途状态（任务 2、任务 5 验证）。
2. **issue 被开发 agent 领走后**：它应拿到 `ready` 之外的完整上下文（依赖、范围边界）⇒ 缺依赖标注会让它抢跑（任务 4）。
3. **issue 正文缺「不做」栏** ⇒ 开发 agent 会顺手扩大范围（任务 4）。
4. **`ready` 全量发放** ⇒ 多个 agent 抢同一依赖链 ⇒ 队列失控（任务 4 验证：每 milestone 仅一条 ready）。
5. **规划与 GitHub 脱节** ⇒ roadmap 说 A 在做、GitHub 上是 B（任务 1 + 任务 5 对账步骤）。

---

### 任务 1：建立 `docs/pm/` 事实源三件套

**涉及文件：**
- 新建：`docs/pm/README.md` —— 角色说明书：我是谁、边界在哪、每次开工的固定动作、怎么读 GitHub 状态
- 新建：`docs/pm/roadmap.md` —— 活的规划：版本 × 能力块 × 候选需求 × 依赖 × 状态
- 新建：`docs/pm/log.md` —— 只增不改的决策与对话日志

**接口：**
**依赖（上游产出）：**`docs/superpowers/specs/2026-11-13-pm-dispatch-design.md`（全部决策）
**产出（下游可依赖）：**后续任务引用的固定路径 `docs/pm/README.md`、`docs/pm/roadmap.md`、`docs/pm/log.md`；`.pi/prompts/pm.md` 的读取顺序

- [ ] **步骤 1：写 `docs/pm/README.md`**

  必须含 5 段，每段都有具体命令（不许写「用 gh 查一下」这种废话）：
  1. **角色**：只排期不写码；GitHub 上的写操作仅限 milestone/issue/label/comment。
  2. **每次开工的固定动作**（有序）：
     ```bash
     git -C <repo> fetch origin && git -C <repo> log --oneline -1 origin/main
     gh api repos/:owner/:repo/milestones --jq '.[] | "\(.number) \(.title) open=\(.open_issues)/\(.closed_issues)"'
     gh issue list --state open --label ready
     gh issue list --state open --label in-progress
     gh pr list --state open
     ```
  3. **判定模式**：说「排期/里程碑/今天做什么/issue」⇒ PM 模式；说「领 #12 去做」⇒ 开发模式（不切角色）。
  4. **写 issue 的硬要求**（8 条，来自设计文档 §3.3）。
  5. **收尾**：合并与关 issue 由开发 agent 做；高风险四类（闸门/权限/数据模型/动 AiAdmin 那个仓）我要抽查 PR 内容。

- [ ] **步骤 2：写 `docs/pm/roadmap.md`**

  结构固定为（附录 B 的骨架），并填入首版内容：
  - `## 当前版本：v0.9（AIPM）` 下的 M1 / M2 / M3 三块，每块含：**状态**、**due**、**完成判据**（一句话）、**issue 列表**（占位 `#<号> <标题>（ready/依赖 #x）`）、**候选需求**（未落 issue 的）。
  - `## 基建线：v6.1.0（Ant Design Pro 升级）` 下的 L1 块。
  - ⚠️ **必须写明一条事实**：`docs/roadmap/v6.1.0-release-plan.md` 里的 `ant-legacy-form-item` 清理与 `typings.d.ts` 清理**在本仓已完成**（`grep` 无命中）⇒ L1 的候选需求需按本仓实际重新核对，**不得照抄上游 Pro 的 issue 编号**（#11772 等是上游 Ant Design Pro 的 issue，不是本仓的）。

- [ ] **步骤 3：写 `docs/pm/log.md`**

  追加式，首条记录本次的 5 个决定（milestone 结构 / 领取策略 / 事实源 / 验收口径 / 建 issue 方式），每个含「定了什么 / 为什么 / 错了的代价」。

- [ ] **步骤 4：验证**

  Run: `ls docs/pm/ && grep -c "为什么" docs/pm/log.md && grep -n "ant-legacy-form-item" docs/pm/roadmap.md`
  Expected: 三个文件都在；`log.md` 至少 5 处「为什么」；`roadmap.md` 命中那条「本仓已完成」的说明。

- [ ] **步骤 5：提交**

  ```bash
  git add docs/pm/
  git commit -m "docs(pm): 建立 PM 调度层的事实源三件套"
  ```

---

### 任务 2：唤醒入口（`/pm` + 角色说明接入 AGENTS.md）

**涉及文件：**
- 新建：`.pi/prompts/pm.md` —— pi 项目级 prompt 模板，斜杠命令 `/pm`
- 修改：`AGENTS.md` —— 追加「PM 调度层」一节（在 `## AI Skills` 一节之前）
- 修改：`docs/process.md` —— 追加 §10「PM 调度层：多角色协作」，说明「人 → PM → GitHub → 开发 agent」的链路与角色分工

**接口：**
**依赖（上游产出）：**任务 1 的三个文件路径
**产出（下游可依赖）：**`/pm` 命令；`AGENTS.md` 与 `docs/process.md` 中的 PM 章节

- [ ] **步骤 1：写 `.pi/prompts/pm.md`**

  文件头必须是 YAML frontmatter（pi 的格式）：
  ```markdown
  ---
  description: 以 PM 调度角色接手：读排期、报状态、给候选，等拍板
  ---
  ```
  正文 = 设计文档 §10.2 那段指令的完整版，末尾加一句「先只输出状态与候选，等我拍板后再建/改 milestone 与 issue」。

- [ ] **步骤 2：在 `AGENTS.md` 追加「PM 调度层」一节**

  内容要求：
  - 说明这是**可选角色**，默认开发 agent 的行为不变。
  - 角色判定句：「排期/里程碑/今天做什么/issue」⇒ PM 模式；「领 #xx 去做」⇒ 开发模式。
  - 指向 `docs/pm/README.md`。
  - 明确 PM **不写产品代码**。

- [ ] **步骤 3：在 `docs/process.md` 追加 §10**

  内容要求：把现有 §2 的流程图扩成两段（人 → **PM** → GitHub → 开发 agent），并说明与 §1 角色表的分工；同时说明「PM 层的文件在 `docs/pm/`，issue 正文要求见 `.github/ISSUE_TEMPLATE/agent-task.md`」。

- [ ] **步骤 4：验证**

  Run: `head -4 .pi/prompts/pm.md && grep -n "PM 调度层" AGENTS.md docs/process.md`
  Expected: frontmatter 的 `---` 与 `description:` 在前两行；两个文件都命中「PM 调度层」。

- [ ] **步骤 5：提交**

  ```bash
  git add .pi/prompts/pm.md AGENTS.md docs/process.md
  git commit -m "docs(pm): 加 /pm 唤醒命令与角色说明"
  ```

---

### 任务 3：GitHub 基础设施（label + milestone）

**涉及文件：** 无文件改动（GitHub 元数据）。

**接口：**
**依赖（上游产出）：**设计文档 §8 的 4 个能力块与命名规则
**产出（下游可依赖）：**label `ready`、`in-progress`；4 个 milestone 及其编号（写回 `docs/pm/roadmap.md`）

- [ ] **步骤 1：建两个 label**

  ```bash
  gh label create ready --color 0E8A16 --description "可领取：排在队首，开发 agent 可直接领"
  gh label create in-progress --color FBCA04 --description "开发 agent 已领走"
  ```
  Expected: 两条 `gh label list` 里都有（已存在时用 `gh label edit` 改描述，不重复建）。

- [ ] **步骤 2：建 4 个 milestone**

  ```bash
  gh api -X POST repos/:owner/:repo/milestones -f title="v0.9 · M1 AIPM 命令层" -f description="<roadmap.md 里该块的描述与完成判据>" -f due_on="2026-11-27T00:00:00Z"
  gh api -X POST repos/:owner/:repo/milestones -f title="v0.9 · M2 项目·里程碑·任务视图" -f description="..." -f due_on="2026-12-04T00:00:00Z"
  gh api -X POST repos/:owner/:repo/milestones -f title="v0.9 · M3 风险与洞察" -f description="..." -f due_on="2026-12-11T00:00:00Z"
  gh api -X POST repos/:owner/:repo/milestones -f title="v6.1.0 · L1 清理与修 bug" -f description="..." -f due_on="2026-12-11T00:00:00Z"
  ```
  Expected: `gh api repos/:owner/:repo/milestones` 返回 4 条，标题与上表逐字一致。

- [ ] **步骤 3：把 milestone 编号与 due 写回 `docs/pm/roadmap.md`**，并追加 `docs/pm/log.md` 一条（记「建了哪 4 个 milestone、各自 due、编号」）。

- [ ] **步骤 4：验证**

  Run: `gh api repos/:owner/:repo/milestones --jq '.[] | "\(.number)\t\(.title)\t\(.due_on)"'`
  Expected: 4 行，编号 1..4。

---

### 任务 4：首批 issue（正文写满 + 依赖标注 + 只放行队首）

**涉及文件：** 无文件改动（GitHub 元数据）；正文草稿写在 `.scratch/`（gitignore，不入库）。

**接口：**
**依赖（上游产出）：**任务 3 的 milestone 标题；`docs/aipm/docs/04-command-catalog.md` §2 的命令清单；`backend/ai/src/tools/index.ts` 里「加命令的三步」
**产出（下游可依赖）：**10 个 issue（编号回写 `docs/pm/roadmap.md`），其中 2 个带 `ready`

- [ ] **步骤 1：写好 10 条 issue 的正文草稿**（每条一个 `.scratch/issue-N.md`）

  清单（★ = 带 `ready`）：

  | # | milestone | 标题 | 规模 | 依赖 |
  |---|---|---|---|---|
  | 1 | M1 | ★ 项目域只读命令（list_projects / get_project / get_project_overview） | 小 | 无 |
  | 2 | M1 | 任务域只读命令（list_tasks / get_task / search） | 小 | 无 |
  | 3 | M1 | 项目与里程碑写命令走闸门确认（create/update/transition） | 中 | #1 |
  | 4 | M1 | 风险域命令（register/update/transition/convert） | 中 | #3 |
  | 5 | M1 | 洞察域命令（get_progress / predict_* / generate_weekly_report） | 中 | #4 |
  | 6 | M1 | 命令撤销与审计闭环（写操作可查可撤销） | 中 | #3 |
  | 7 | M2 | AI 工作台发 PM 命令后回填视图 | 中 | #2 |
  | 8 | M2 | 里程碑页与风险页接真实接口数据 | 中 | 无 |
  | 9 | M3 | 风险预警到待执行命令（一键转） | 中 | #4 |
  | 10 | L1 | ★ 核对 v6.1.0 升级项在本仓的现状，产出待修清单 | 小 | 无 |

  每条正文**必须**含：目标 / 验收标准（≥3 条可观察事实）/ 范围（要做 + 不做）/ 上下文（真实路径）/ 依赖 / 约束勾选 / 规模。
  上下文里引用的路径必须真实存在，例如 `backend/ai/src/tools/`、`backend/ai/src/agent/gate.ts`、`frontend/src/services/api/pm/`、`docs/aipm/docs/04-command-catalog.md`。

- [ ] **步骤 2：建 issue**

  ```bash
  gh issue create --title "[agent] <标题>" --body-file .scratch/issue-N.md --label "agent-task" --milestone "v0.9 · M1 AIPM 命令层"
  ```
  Expected: 每条返回 issue URL；`gh issue list --label agent-task` 数量 +10。

- [ ] **步骤 3：只给 #1 和 #10 打 `ready`**（各 milestone 的队首）

  ```bash
  gh issue edit <1号> --add-label ready
  gh issue edit <10号> --add-label ready
  ```
  Expected: `gh issue list --label ready` 恰好 2 条。

- [ ] **步骤 4：把在途的 issue #9 归入 M2**

  ```bash
  gh issue edit 9 --milestone "v0.9 · M2 项目·里程碑·任务视图"
  ```
  Expected: #9 的 milestone 字段为 M2。（#9 已有分支 `feat/9-task-view-height` 在开发中，不加 `ready`。）

- [ ] **步骤 5：验证队列形状**

  Run:
  ```bash
  gh issue list --state open --label ready --json number,title,milestone
  gh issue list --state open --label agent-task --json number,milestone --jq '.[] | "\(.number) \(.milestone.title)"'
  ```
  Expected: ready 恰好 2 条，分属 M1 与 L1；其余 open issue 无 `ready`。

- [ ] **步骤 6：把 issue 编号回写 `docs/pm/roadmap.md`**（每块列出 `#号 标题（ready）`），并在 `docs/pm/log.md` 追加一条（记「首批 10 条 issue 的分块与放行策略」）。

---

### 任务 5：对账 + 提 PR

**涉及文件：**
- 修改：`docs/pm/roadmap.md`（任务 3/4 的回写）

**接口：**
**依赖（上游产出）：**任务 1–4 的产出
**产出（下游可依赖）：**一个待合并的 PR

- [ ] **步骤 1：对账（roadmap ↔ GitHub）**

  Run:
  ```bash
  gh api repos/:owner/:repo/milestones --jq '.[] | "\(.title): open=\(.open_issues)"'
  grep -n "#" docs/pm/roadmap.md | head -20
  ```
  Expected: roadmap 里列出的 issue 编号在 GitHub 上都存在，且 milestone 一致；无「roadmap 里有、GitHub 上没有」的条目。

- [ ] **步骤 2：提交回写**

  ```bash
  git add docs/pm/roadmap.md docs/pm/log.md
  git commit -m "docs(pm): 回写首批 milestone 与 issue 编号"
  ```

- [ ] **步骤 3：推分支并开 PR**

  ```bash
  git push -u origin docs/13-pm-dispatch
  gh pr create --title "docs(pm): 建立 PM 调度层" --body "新增 docs/pm/ 三件套、/pm 唤醒命令、AGENTS.md 与 docs/process.md 的 PM 章节。GitHub 侧已建 4 个 milestone 与首批 10 条 issue。"
  ```
  Expected: PR URL 输出。注意：仓库 `delete_branch_on_merge=false` ⇒ 合并后需手工删分支。

- [ ] **步骤 4：验证 PR 状态**

  Run: `gh pr list --state open --json number,title,headRefName --jq '.[] | "\(.number) \((.headRefName)) \(.title)"'`
  Expected: 有一条 `docs/13-pm-dispatch` 的 PR，CI 状态待跑完（若 CI 红了先修）。

- [ ] **步骤 5：交付说明**

  向人报告：① 建了哪些 milestone / issue（附编号）② 哪个是队首（可领）③ `/pm` 怎么用 ④ PR 号 ⑤ 待人拍板的点（版本名 v0.9、初始四块划分）。
