# 开发路线图（活文档）

> **这是规划侧的事实源。** 执行侧的真相在 GitHub（milestone / issue / PR）。
> 维护者：**PM 调度 agent**。改这个文件前先读 `docs/pm/README.md`。
> ⚠️ 本文件与 GitHub 不一致时，**先对账再改**（`docs/pm/README.md` §2 的命令）。

**最后更新**：2026-11-13

> ⚠️ **due 日期以 GitHub 实际存储值为准**（GitHub 会把 `due_on` 往后/往前偏一天，
> 本文件的 due 与 milestone 列表里的值已对齐，勿手改）。

---

## 怎么读这份文档

- **版本（version）** = 一条产品线的一次交付。
- **能力块（block）** = 一个可独立交付的能力集合，划分**对齐代码模块**与
  `docs/aipm/docs/04-command-catalog.md` 的能力域。
- **GitHub 上的一条 milestone = 一个版本下的一个能力块**：`版本 · 能力块`。
- **块内顺序 = 优先级**；**块间默认可并行**，依赖在下面显式写出来。
- **状态**：`未开始` / `进行中` / `已完成` / `搁置`。

---

## 当前版本：v0.9（AIPM）

> AIPM = 对话驱动的项目管理平台（AIPM 是 AI 主操作入口，结构化视图是辅助）。
> 规格见 `docs/aipm/docs/00-master-spec.md`，原型见 `docs/aipm/prototype/`。

### M1 · AIPM 命令层　`v0.9 · M1 AIPM 命令层`（milestone #1）

- **状态**：进行中
- **due**：2026-11-26
- **范围**：后端 AI 服务（`backend/ai/`）里的**业务命令工具层**——让模型能真的操作项目/里程碑/任务/风险。
- **完成判据**：模型能通过命令完成「查项目 → 建任务 → 改任务状态 → 登记风险」，
  写操作全部留审计、改动类操作全部先问人。
- **现状**：`backend/ai/src/tools/` 目前**只有 `create_task` 一个命令**；
  `backend/ai/src/tools/index.ts` 顶部已写明「加命令的三步」（写工具 → 登记 `CommandDefinition` → 必要时进闸门）。
- **依赖**：无（本块是 M2/M3 的前置）。
- **候选需求**（→ issue 列表）：

  | # | 需求 | 规模 | 依赖 | issue |
  | - | ---- | ---- | ---- | ----- |
  | 1 | 项目域**只读**命令：`list_projects` / `get_project` / `get_project_overview` | 小 | 无 | [#10](https://github.com/wenanguo/ai-admin-com/issues/10) ★ready |
  | 2 | 任务域**只读**命令：`list_tasks` / `get_task` / `search` | 小 | 无 | [#11](https://github.com/wenanguo/ai-admin-com/issues/11) ★ready |
  | 3 | 项目与里程碑**写**命令走闸门：`create_*` / `update_*` / `transition_milestone` / `split_milestone` | 中 | #10 | #12 |
  | 4 | 风险域命令：`register_risk` / `update_risk` / `transition_risk` / `convert_risk_to_task` | 中 | #12 | #13 |
  | 5 | 洞察域命令：`get_progress` / `predict_milestone_slip` / `predict_project_eta` / `generate_weekly_report` | 中 | #13 | #14 |
  | 6 | 撤销与审计闭环：每条写命令可查、可撤销 | 中 | #12 | #15 |
  | 11 | **任务域写命令**走闸门：`update_task` / `transition_task` / `split_task` / `delete_task` / `batch_update_tasks` | 中 | #11 #12 | #22 |

### M2 · 项目·里程碑·任务视图　`v0.9 · M2 项目·里程碑·任务视图`（milestone #2）

- **状态**：进行中
- **due**：2026-12-03
- **范围**：前端 PM 页面（`frontend/src/pages/module_pm/`）+ AI 工作台里的 PM 操作闭环。
- **完成判据**：四个 PM 页面都展示**真实接口数据**（非占位/假数据），
  且能在 AI 工作台里发命令 → 视图回填刷新。
- **现状**：路由壳已在（`module_pm/{project,milestone,task,risk}/index.tsx`），
  服务层已在（`frontend/src/services/api/pm/`）；任务页走 `TaskWorkspace` 组件。
- **依赖**：M1（命令层）。
- **在途**：issue #9（任务页三视图高度统一）—— **已完成**（PR #18 已合并，2026-11-13）。
- **候选需求**：

  | # | 需求 | 规模 | 依赖 | issue |
  | - | ---- | ---- | ---- | ----- |
  | 7 | AI 工作台发 PM 命令后回填视图 | 中 | #11 | #16 |
  | 8 | 里程碑页与风险页接真实接口数据 | 中 | 无 | #17 |

### M3 · 风险与洞察　`v0.9 · M3 风险与洞察`（milestone #3）

- **状态**：未开始
- **due**：2026-12-10
- **范围**：风险登记/升级、延期预测、风险预警、周报，并可**一键转成待执行命令**。
- **完成判据**：风险与进度数字由**确定性规则**算出（LLM 只负责措辞），
  预警项能直接生成待确认命令。
- **依赖**：M1（命令层）→ M2（里程碑/项目数据）。
- **候选需求**：

  | # | 需求 | 规模 | 依赖 | issue |
  | - | ---- | ---- | ---- | ----- |
  | 9 | 风险预警到待执行命令（一键转） | 中 | #13 | #19 |

---

## 基建线：v6.1.0（Ant Design Pro 升级）

### L1 · 清理与修 bug　`v6.1.0 · L1 清理与修 bug`（milestone #4）

- **状态**：未开始
- **due**：2026-12-10
- **范围**：本仓相对上游 Ant Design Pro 的**技术债清理**。
- **完成判据**：给出一份「本仓实际待修清单」并逐条修完。
- ⚠️ **不要照抄 `docs/roadmap/v6.1.0-release-plan.md`**：
  - 该文档里的 `ant-legacy-form-item` 清理与 `typings.d.ts`（`slash2` / `omit.js`）清理
    **在本仓已完成**（`grep` 无命中）⇒ 清单必须按**本仓实际**重新核对。
  - 它引用的 issue 号（#11772 等）是**上游 Ant Design Pro 的 issue，不是本仓的** ⇒ 不可直接引用。
- **候选需求**：

  | # | 需求 | 规模 | 依赖 | issue |
  | - | ---- | ---- | ---- | ----- |
  | 10 | 核对 v6.1.0 升级项在本仓的现状，产出待修清单（调研型，不改代码） | 小 | 无 | [#20](https://github.com/wenanguo/ai-admin-com/issues/20) ★ready |
  | 12 | PR 模板补「高风险」栏（`/dev.md` 要求但模板没有） | 小 | 无 | [#24](https://github.com/wenanguo/ai-admin-com/issues/24)（在途：PR #25） |

---

## 排期约定

- **一个 issue = 一个分支 = 一个 PR**（`docs/process.md` §5）。
- **只给队首打 `ready`**（每个 milestone 的第一条）⇒ 块内串行、块间并行。
  当前队首：**#10**（M1）、**#20**（L1）。
- **依赖链**：M1 → M2 → M3；M1 与 L1 无依赖，可同时开工。
- **滚动 due**：每两周一个块，做不完就往后挪，不作废已建 issue。

## 变更记录

| 日期 | 变更 |
| ---- | ---- |
| 2026-11-13 | 首版：v0.9 三个能力块 + 基建线 L1；首批 10 条候选需求 |
| 2026-11-13 | 首批 10 条 issue 已建（#10–#17、#19、#20），依赖编号回写；#9（任务页高度）归入 M2；队首 #10 / #20 已打 `ready` |
| 2026-11-13 | 补 M1 缺口 #22（任务域写命令）；#9 完成（PR #18 已合）；#24（PR 模板高风险栏，开发 agent 自提）归入 L1；PM 调度层 PR #21 已合入 main |
