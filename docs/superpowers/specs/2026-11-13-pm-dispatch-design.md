# PM 调度机制设计（2026-11-13）

> **一句话**：用户（人）每天跟**PM agent（我）**确定要做什么；我把它落成 GitHub 上的
> **milestone + issue**；另一个**开发 agent** 从 GitHub 领 issue、开发、提 PR、测试、提交、合并。
> **我只负责沟通、拆解、排期、验收抽查，不写产品代码。**

---

## 1. 为什么要有这一层

现状（`docs/process.md`）是「人提 issue → 开发 agent 领 → PR → 人合并」。
问题在于**「人提 issue」这一步全是手动**：想到什么就手写一条 issue，写多写少、验收标准时有时无、
里程碑不明确 ⇒ 开发 agent 领活时不知道优先级、也不清楚「这批活属于哪一阶段」。

GitHub 已经有 milestone / issue / label / PR 这些现成容器，缺的是**填料的人**。
本设计引入 PM agent 来填料：把人每天说的「想做什么」翻译成**可领取、可排序、有验收标准**的 issue。

### 目标

1. 人每天只做一件事：**说需求**（可以很粗）。
2. 我负责把它变成：版本（version）× 能力块（block）的排期，落到 GitHub milestone + issue。
3. issue 必须自带：目标、**可观察的验收标准**、范围（做什么/不做什么）、上下文、依赖关系、规模分级。
4. 开发 agent 能**只靠 GitHub** 判断该领哪个 issue、怎么验完。
5. 排期意图不丢：仓库里有活的事实源 + 只增不改的决策日志。

### 非目标

1. 我**不写产品代码**、不实现功能、不修 bug。
2. 我**不代替人做技术决策**——技术方案由开发 agent 写设计/计划，人和我只管目标与验收。
3. 我**不做 CI 值班**、不自动催办 PR（只在你喊我去看时去看）。
4. 不引入新的项目管理工具/平台（不用 Jira、不用 Linear），**GitHub 就是全部**。

### 反目标（做到即失败）

- **只把需求原样贴成 issue** —— 没有验收标准、没有范围边界的 issue = 给开发 agent 添乱。
- **milestone 变成垃圾场** —— 没有明确排期的能力块就不要建 milestone。
- **PM 越权改代码** —— 我在 GitHub 上的写操作只限 milestone / issue / label / comment。
- **规划和现实脱节** —— roadmap 里的东西必须和 GitHub 上的实际状态对得上，对不上就更新 roadmap。

---

## 2. 角色与边界

| 谁 | 干什么 | 不干什么 |
|---|---|---|
| **人** | 说需求 · 拍板排期 · review 高风险 PR · 最终合并决策 | 写 issue 正文（我来写） |
| **PM agent（我）** | 沟通 · 拆需求 · 排版本/能力块 · 写 milestone + issue · 维护 `docs/pm/` · 抽查高风险 PR · 推进决策记录 | 写产品代码 · 合并 PR · 自动催办 |
| **开发 agent** | 领 issue · 读代码 · 写设计/计划 · 实现 · 自审 · 提 PR · CI · 合并 · 关 issue · 删分支 | 决定排期 · 自造需求 |

**合并与关 issue 由开发 agent 做**（PR 正文 `Closes #xx` 自动关 issue）。
我只在**高风险 PR** 上多一道确认（见 §5）。

---

## 3. 核心机制

### 3.1 排期结构：版本 × 能力块（A+B 合并）

GitHub milestone 是平的、没有嵌套 ⇒ **一条 milestone = 一个版本下的一个能力块**：

```
milestone 名： v0.9 · M1 AIPM 命令层
milestone 描述： 该块要解决什么、完成判据（来自 docs/pm/roadmap.md）
due date：      滚动 2 周，块内做不完就往后挪
```

- **版本（version）**：一条产品线一个版本号。AIPM 产品线用 `v0.9`；Ant Design Pro 基建线用 `v6.1.0`。
- **能力块（block）**：一个可独立交付的能力集合（如「AIPM 命令层」「PM 页面」「风险与洞察」）。
  块的划分**对齐代码模块**与 `docs/aipm/docs/04-command-catalog.md` 的能力域。
- **块内排序 = 优先级**；**块与块之间默认可并行**（C 方案），但有依赖的块我会写明。

### 3.2 issue 领取策略：可领标记 + 依赖标注

- label `agent-task` = 这是给 agent 的活（已有）。
- label `ready` = **现在可以领**。我维护它：只有排到队首的 issue 才有 `ready`；
  开发 agent 领走（打 `in-progress`）后我把它去掉；完成、下一条补上。
- **依赖标注**：issue 正文写明「依赖 #xx 合并后才能动手」。
  这解决了「自由领取会抢跑」的问题，同时保留块间并行。

> 为什么不全用 A（严格串行）：整条流水线变串行会拖慢合并节奏；
> 为什么不全用 B（自由挑）：AIPM 内部有明确依赖（命令层先于风险与预测）。
> C 兼顾两者。

### 3.3 issue 正文必须包含

直接复用现有模板 `.github/ISSUE_TEMPLATE/agent-task.md`，**必填项不得空**：

| 段 | 要求 |
|---|---|
| 目标 | 一句话说清「做完是什么样」 |
| **验收标准** | **可观察的事实**，逐条 `- [ ]`；禁止「体验更好」这类主观描述 |
| 范围 | **要做 / 不做**两栏都写；不做的那栏是防范围蔓延的关键 |
| 上下文 | 相关文件、页面、接口、文档链接（我会去仓库里查实，不写「相关代码」这种废话） |
| 依赖 | 依赖的 issue 号（或「无」） |
| 约束 | 模板自带的 4 条硬规矩默认勾上 |
| 规模 | 小 / 中 / 大 —— 决定开发 agent 写多少文档（`docs/process.md` §3） |

### 3.4 事实源：仓库里的两个文件

| 文件 | 性质 | 内容 |
|---|---|---|
| `docs/pm/roadmap.md` | **活的规划**（可改） | 版本 × 能力块 × 候选需求 × 依赖图 × 每个块的状态；GitHub milestone 的说明文字也写在这里 |
| `docs/pm/log.md` | **只增不改** | 决策记录（定了什么/为什么/错了的代价）+ 每日对话纪要 |

**为什么必须有仓库版本**：聊天会丢上下文，GitHub 界面不承载「为什么这么排」。
与 `docs/notes/` 同一逻辑：**交接文档让下一棒接得上**。

### 3.5 我的日常循环（你每天只需要说需求）

```
你说需求
  ↓
我判断：这是新能力？已有 issue 的补充？还是 bug？
  ↓
属于哪个版本 / 能力块？依赖谁？规模多大？
  ↓
写/改 roadmap.md → 建/改 GitHub milestone → 建 issue（正文写满）
  ↓
标记队首 issue 为 ready（其余不发 ready）
  ↓
把「今天要做什么、为什么这么排」讲给你听，等你点头
```

**我主动提案**（不等你逐条点）：每次对话我扫一遍
`docs/roadmap/v6.1.0-release-plan.md`、`docs/aipm/docs/04-command-catalog.md`、
`docs/notes/` 里未完成项，产出**候选清单**（3~5 条，每条一句话 + 为什么是现在）给你挑。

---

## 4. 方案对比（怎么建）

| 方案 | 事实源 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A. GitHub 即事实源 | GitHub | 零维护 | 规划意图只活在界面和对话里 | ✗ |
| **B. 仓库规划文件 + 我手动同步** | 仓库文件 | 人可读、可评审、进 git；现在只有 ~10 个 issue，手工成本低 | 我要写 gh 命令 | **✓ 采用** |
| C. B + 幂等同步脚本 | 仓库文件 | 省手工 | 脚本本身要维护、要测 | 后手：issue 上到二三十个再补 |

**我不用脚本建 issue**（决定）：`gh` CLI 直接调，模板现成，量小；
C 方案留作 `scripts/pm/sync.mjs` 的后手。

---

## 5. 完成与验收（谁说了算）

流程：开发 agent 提 PR → CI 绿 → 合并 → `Closes #xx` 关 issue → 删分支。

**高风险改动我抽查**（我要看 PR 内容再确认关闭），判定为高风险的四种：

1. **AI 闸门口径**（`backend/ai/src/agent/gate.ts` 一带：新增放行 / 修改要点头）—— 错了会静默改数据。
2. **权限**（`frontend/src/access.ts`、`getInitialState`、JWT 处理）—— 错了会越权。
3. **数据模型**（Prisma schema、迁移脚本）—— 错了难回滚。
4. **动了 AiAdmin（FastAPI）那个仓** —— 跨仓改动必须在两边都对得上。

其余（样式、文案、小 bug、纯前端交互）**不逐条看**，CI 绿 + 合并即完成。

**我随时可查的进度信号**（你喊我就去看）：
`gh pr list`（谁在做什么、CI 状态）· `gh issue list`（哪些 ready、哪些在途）·
`gh api .../milestones`（各块完成度）。

---

## 6. 约束

1. **不直落 main** —— 我建的每个 issue 都带「走分支 + PR」约束。
2. **我不碰凭据** —— 不写 `.env`、`.ai/auth.json`。
3. **技术决策归开发 agent** —— 我不指定实现方式，只说清目标与验收。
4. **AiAdmin 是另一个仓** —— 涉及它的需求要在 issue 里写明「在那边单独提 PR」。
5. **规模不过度** —— 「加一个按钮」不写长设计、不拆成三个 issue。

---

## 7. 留给实现的部分（由我执行，不需要人）

1. 建 `docs/pm/roadmap.md` + `docs/pm/log.md`（含模板与首版规划）。
2. 用 `gh` 建首批 milestone（AIPM `v0.9` 三个能力块 + 基建 `v6.1.0` 一块）。
3. 把 roadmap 里的候选需求落成首批 issue（按模板写满），只给队首打 `ready`。
4. 在 `docs/process.md` 加一节「PM 调度层」，说明这个角色与流程的衔接（人 → 我 → GitHub → 开发 agent）。
5. 建 `.pi/prompts/pm.md`（斜杠命令 `/pm`）+ `docs/pm/README.md`（角色说明书），
   在 `AGENTS.md` 加一节「PM 调度层」——让**新会话能自己醒来**（见 §10）。

## 8. 初始能力块划分（**提案，等你拍板**）

| Milestone | 覆盖 | 来源 |
|---|---|---|
| `v0.9 · M1 AIPM 命令层` | 命令定义 / 确认判定 / 撤销 / 审计（后端 ai） | `docs/aipm/docs/04-command-catalog.md` §2 |
| `v0.9 · M2 项目·里程碑·任务视图` | PM 页面：项目 / 里程碑 / 任务 三视图 | `docs/aipm/prototype/*.html` + 已有页面 |
| `v0.9 · M3 风险与洞察` | 风险登记 / 升级 / 进度预测 / 周报 | `docs/aipm/docs/04` §2.5 |
| `v6.1.0 · L1 清理与修 bug` | Pro 升级：legacy class、typings、6 个已知 bug | `docs/roadmap/v6.1.0-release-plan.md` Layer 1 |

**依赖**：M1 → M2（前端要能消费命令结果）→ M3（风险依赖里程碑数据）。
M1 与 L1 无依赖 ⇒ 可并行。

---

## 10. 唤醒与接力（关掉对话后怎么找回我）

> 目标：**关掉会话不丢角色**。最坏情况下，从 GitHub + 仓库文件能完整重建上下文，**不依赖对话记忆**。

### 10.1 四级唤醒（从省事到兜底）

| 级 | 你怎么唤醒 | 前提 |
|---|---|---|
| ① | 在 pi 里打 **`/pm`** | 项目级 prompt 模板 `.pi/prompts/pm.md`（仓库里，跟着 git 走） |
| ② | 说「**读 docs/pm/README.md，接手 PM 角色**」 | README 里写着角色定义、该读哪几个文件、第一步做什么 |
| ③ | 直接说需求（「今天要做 X」） | `AGENTS.md` 里有「PM 调度层」一节 ⇒ 我会自动认出该进角色 |
| ④ | 什么都不说 | 我从 GitHub 现状（milestone / issue / PR）+ `docs/pm/` 重建计划，出一份「当前状态 + 候选清单」给你 |

### 10.2 `/pm` 模板要做的事

`.pi/prompts/pm.md` 展开后 ≈ 一段短指令：

```
你现在是本仓的 PM 调度角色（只排期、不写产品代码）。
按顺序读：docs/pm/README.md → docs/pm/roadmap.md → docs/pm/log.md（末尾 20 行）
然后用 gh 查当前状态：milestone 列表、open issue（label ready / in-progress）、open PR 及 CI。
输出：① 当前排期与在途状态 ② 今天建议做的 3~5 条候选（每条一句话 + 为什么是现在）
等我拍板后再建/改 milestone 与 issue。
```

### 10.3 为什么关掉对话不会丢

| 东西存在哪 | 内容 |
|---|---|
| GitHub milestone/issue | 排期、状态、依赖、验收标准 —— **执行侧的真相** |
| `docs/pm/roadmap.md` | 版本×能力块×候选需求×依赖图 —— **规划侧的真相** |
| `docs/pm/log.md` | 为什么这么排（决策记录） —— **理由** |
| `docs/pm/README.md` | 角色定义 + 每次开工的固定动作 —— **流程** |

⇒ 对话只是**入口**，不是**载体**。换个人（或换我）来，只要读这几个文件就能接着干。

### 10.4 与开发 agent 的隔离

- `AGENTS.md` 里的「PM 调度层」要写明：**这是可选角色**，默认角色不变；
  开发 agent 领 issue 时不会误进 PM 角色。
- `/pm` 只在你想让我当 PM 时用；开发 agent 那个会话不用它。
- 判定：**你说「排期 / 里程碑 / issue / 今天做什么」⇒ PM 模式**；
  说「领 #12 去做」⇒ 开发模式。

---

## 附录 A · 执行用的具体做法（gh CLI）

```bash
# ① 建 label（一次性）
gh label create ready       --color 0E8A16 --description "可领取：排在队首，开发 agent 可直接领"
gh label create in-progress --color FBCA04 --description "开发 agent 已领走"

# ② 建 milestone（版本 · 能力块）
gh api -X POST repos/:owner/:repo/milestones \
  -f title="v0.9 · M1 AIPM 命令层" \
  -f description="<来自 roadmap.md 该块的描述与完成判据>" \
  -f due_on="2026-11-27T00:00:00Z"

# ③ 建 issue（正文按模板写满；标签 agent-task + 依赖标签）
gh issue create --title "[agent] <一句话目标>" \
  --body-file .scratch/issue-body.md \
  --label "agent-task" --milestone "v0.9 · M1 AIPM 命令层"

# ④ 只给队首打 ready
gh issue edit <号> --add-label ready
```

**注意**：GitHub 的 milestone 没有「嵌套」概念，`v0.9` 这一层只能体现在**标题前缀**与
**roadmap.md 的分组**上；不额外建「空壳版本 milestone」，避免出现永远 0% 的假看板。

## 附录 B · `docs/pm/roadmap.md` 骨架

```markdown
# 开发路线图（活文档）

## 当前版本：v0.9（AIPM）

### M1 · AIPM 命令层        状态：进行中   due：2026-11-27
- [ ] #12 <issue 标题>（ready · 依赖：无）
- [ ] #13 <issue 标题>（依赖 #12）
**完成判据**：<一句话>

### M2 · 项目·里程碑·任务视图  状态：未开始
**完成判据**：<一句话>

## 基建线：v6.1.0（Ant Design Pro 升级）
### L1 · 清理与修 bug   状态：未开始
```

## 附录 C · `docs/pm/log.md` 骨架（只增不改）

```markdown
# PM 决策与对话日志（只增不改）

## 2026-11-13 · 建立 PM 调度机制
- **定了什么**：milestone = 版本·能力块；issue 领取用 ready 标签；块间并行、块内按依赖排序。
- **为什么**：GitHub milestone 平的，嵌套不了；AIPM 有明确依赖（命令层→风险），纯自由领会抢跑。
- **错了的代价**：块划分切错 ⇒ issue 挂错 milestone，重排成本 = 改 issue 的 milestone（低）。
```

---

## 9. 未决 / 下一步

| # | 问题 | 谁定 | 默认 |
|---|---|---|---|
| 1 | 第一个版本叫 `v0.9` 还是别的？ | 人 | `v0.9`（我的判断，改名很便宜） |
| 2 | 初始能力块划分（§8）是否照用？ | 人 | 照用，先建 4 个 milestone |
| 3 | 首个 issue 的选题 | 人 + 我 | 我提候选，你拍板 |
| 4 | `ready` / `in-progress` 两个 label 命名 | 我 | `ready`、`in-progress`（需新建） |
