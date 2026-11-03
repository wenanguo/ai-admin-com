# 02 · 领域模型与业务规则

> 有哪些实体、状态怎么流转、指标怎么算。**数字全部由确定性规则算出，LLM 不参与计算。**

## 1. 本地存储（AI 侧元数据）

业务事实源在外部 API，本地只保存 AI 运行时必需的元数据。

```
User            id, name, email(unique), password_hash, role(MEMBER|ADMIN),
                is_admin(bool), external_id?, created_at
Session         id, user_id, token_hash(unique), expires_at, created_at

Conversation    id, project_ref, channel(WEB|FEISHU), created_at
Message         id, conversation_id, role(USER|ASSISTANT|SYSTEM), content,
                tool_calls(jsonb), created_at
                role: USER | ASSISTANT | SYSTEM

PendingAction   id, conversation_id?, user_id, command, args(jsonb),
                preview(jsonb), status, expires_at, resolved_at?, resolved_by?,
                adjusted_from?, created_at
                status: PENDING | CONFIRMED | REJECTED | EXPIRED | EXECUTED

AuditLog        id, workspace_id, actor_type(USER|AI), actor_id, command,
                args(jsonb), before_snapshot(jsonb), after_snapshot(jsonb),
                undo_of?, undone_at?, adopted?(bool), model?, tokens?,
                latency_ms?, trace_id?, error?, created_at
                actor_type: USER | AI

EntityRef       id, workspace_id, entity_type, external_id, local_alias?,
                project_ref?, title_cache?, last_synced_at, created_at
                entity_type: PROJECT | MILESTONE | TASK | RISK

SyncCache       id, entity_type, external_id, payload(jsonb), etag?, fetched_at
ProgressSnapshot id, project_ref, snapshot_date, total_tasks, done_tasks,
                total_estimate, remaining_estimate, milestone_done_count, created_at
DerivedState    id, entity_ref, kind(MILESTONE_HEALTH|ETA|RISK_SUGGESTION),
                payload(jsonb), computed_at
```

> `PendingAction` 与 `AuditLog` 是**两张表**：前者是"待人决定"，后者是"已发生"。确认执行时由前者生成后者，用 `undo_of` 关联。

## 2. 统一领域模型

外部 API 的字段名与状态枚举各异，适配层把它们归一到下面这套。**上层（agent 的 tool 定义、前端视图）只认这套。**

```
Project    key, code, name, description, owner, status, priority,
           start_date, due_date, tags[], extra{}
           status: PLANNING | ACTIVE | ON_HOLD | COMPLETED | CANCELLED | ARCHIVED

Milestone  key, project_key, name, description, start_date, due_date,
           actual_start_date?, actual_end_date?, status, deliverables[], sort_order
           status: UPCOMING | IN_PROGRESS | DONE | AT_RISK | MISSED

Task       key, project_key, milestone_key?, parent_key?, title, description,
           type, status, priority, estimate_hours?, actual_hours?, assignee?,
           reporter, reviewers[], labels[], start_date?, due_date?,
           actual_start_date?, actual_end_date?, sort_order, source
           status: BACKLOG | TODO | IN_PROGRESS | REVIEW | DONE | BLOCKED | CANCELLED
           priority: P0 | P1 | P2 | P3
           type: FEATURE | BUG | TASK | CHORE
           source: MANUAL | AI | IMPORT

Risk       key, project_key, title, description, category, probability(1-5),
           impact(1-5), score, level, status, owner, mitigation_plan?,
           contingency_plan?, due_date?, trigger_date?, milestone_key?
           category: SCHEDULE | SCOPE | QUALITY | RESOURCE | COMPLIANCE
           status: IDENTIFIED | ANALYZING | MITIGATING | REALIZED | CLOSED
           level: SEVERE | HIGH | MEDIUM | LOW
```

**归一规则**
- 外部枚举 → 统一枚举的映射表写在适配层配置里（可配，如 `statusMap.task`）。
- 外部缺失字段用默认值或从 labels 推断，**不猜测**——缺失即缺省。
- 统一模型里**多出来的字段**（`at_risk` 这类规则派生态）在本地计算，**不回写外部**。

## 3. 派生状态存哪

| 派生数据 | 存哪 | 何时算 |
|---|---|---|
| 里程碑健康度与依据 | `DerivedState(MILESTONE_HEALTH)` | 任务变更后 + 每日 cron |
| ETA 预测（P50/P90/confidence） | `DerivedState(ETA)` | 每日 cron + 手动触发 |
| 燃尽图快照 | `ProgressSnapshot` | 每日 24:00 |
| 风险候选建议 | `DerivedState(RISK_SUGGESTION)` | 每日 cron + 状态变更增量检查 |

> **只读不回写外部**：避免污染外部数据源，也避免外部拒绝写入。UI 用"领域模型 = 外部状态 + 本地派生覆盖"的合成视图。

## 4. 状态机

原则：用**迁移表**而非状态图，便于 review、单测与校验。

### 4.1 Project

| from | event | guard | to | side-effect |
|---|---|---|---|---|
| (new) | create | code 唯一；owner 有效 | `PLANNING` | 写审计 |
| `PLANNING` | activate | `start_date ≤ today` | `ACTIVE` | 启动进度计算 |
| `ACTIVE` | put_on_hold | reason 必填 | `ON_HOLD` | 暂停预测任务 |
| `ON_HOLD` | resume | — | `ACTIVE` | 重启预测任务 |
| `ACTIVE` | complete | 所有里程碑 DONE/CANCELLED；无 IN_PROGRESS 任务 | `COMPLETED` | 归档评估 |
| `ACTIVE` | cancel | reason 必填 | `CANCELLED` | 归档 |
| `COMPLETED` | archive | — | `ARCHIVED` | 冻结历史 |

### 4.2 Milestone

| from | event | guard | to | side-effect |
|---|---|---|---|---|
| (new) | create | `[start_date, due_date] ⊆ project 区间` | `UPCOMING` | — |
| `UPCOMING` | start | `start_date ≤ today` | `IN_PROGRESS` | 写审计 |
| `IN_PROGRESS` | complete | 关联任务全 DONE/CANCELLED | `DONE` | 触发进度重算 |
| `IN_PROGRESS` | **规则判定** | §5.1 | `AT_RISK` | 通知 PM + 生成风险建议 |
| `AT_RISK` | **规则判定** | 逾期 > 14 天 | `MISSED` | 升级到风险登记册 |
| `AT_RISK` | complete | 任务全完成 | `DONE` | 同上 |

> **规则独占写回权**：`AT_RISK` / `MISSED` **只能**由规则引擎写入，人和 AI 都不能手工设这两个状态；反过来，人也不能手工把 `AT_RISK` 改成 `DONE`——必须走 `complete_milestone` 并通过任务校验。冲突时**规则优先**。

### 4.3 Task

| from | event | guard | to | side-effect |
|---|---|---|---|---|
| (new) | create | 项目未归档/取消 | `BACKLOG` | — |
| `BACKLOG` | schedule | `due_date ≥ today` | `TODO` | — |
| `TODO` | start | assignee ≠ null | `IN_PROGRESS` | 写 `actual_start_date` |
| `TODO`/`BACKLOG`/`IN_PROGRESS` | block | reason 必填 | `BLOCKED` | 写 `blocked_since`，启动阻塞统计 |
| `BLOCKED` | unblock | reason 必填 | `IN_PROGRESS` | 累加阻塞时长 |
| `IN_PROGRESS` | submit_review | reviewer ∅? | `REVIEW` | 通知 reviewer |
| `REVIEW` | approve | — | `DONE` | 写 `actual_end_date`、`actual_hours` |
| `REVIEW` | reject | comment 必填 | `IN_PROGRESS` | — |
| `IN_PROGRESS` | pause | — | `TODO` | 保留 `actual_start_date` |
| any | cancel | reason 必填 | `CANCELLED` | 写审计；**退出 ETA 预测** |
| any | reopen | PM/owner | `TODO` | 清 `actual_end_date` |

**依赖不变量**：`type ∈ {FS(默认), SS, FF, SF}`；FS = 前置 done 才可 IN_PROGRESS；SS = 前置 in_progress 即可；**不允许跨项目依赖**；**不允许成环**（创建/更新时 DFS 检测）。

### 4.4 Risk

| from | event | guard | to | side-effect |
|---|---|---|---|---|
| (new) | create / ai_suggest | probability, impact ∈ 1..5 | `IDENTIFIED` | 自动算 `score = p × i` |
| `IDENTIFIED` | analyze | PM 复核 | `ANALYZING` | 写 `mitigation_plan` |
| `ANALYZING` | start_mitigation | mitigation_plan 非空 + due_date | `MITIGATING` | 进风险仪表盘 |
| `MITIGATING` | close | 关闭原因必填 | `CLOSED` | 冻结为历史 |
| `MITIGATING`/`ANALYZING` | **score_up** | p 或 i 提升 | `REALIZED` | 升级为"已发生问题"，触发 PMO |
| any | force_close | PMO | `CLOSED` | — |

### 4.5 全局不变量

| ID | 不变量 | 强制位置 |
|---|---|---|
| INV-01 | 任务依赖不形成环 | DAO create/update 前 DFS |
| INV-02 | 子任务 `parent_key` 不跨项目，层级 ≤ 3 | DAO 校验 |
| INV-03 | 里程碑 `[start_date, due_date] ⊆ project 区间` | DAO 校验 |
| INV-04 | 评论 `target_type ∈ {task,milestone,project,risk,meeting}` | schema Literal |
| INV-05 | 项目 `code` 唯一且不可修改 | DAO + 状态机 |
| INV-06 | 删除项目前关联任务/里程碑必须 ARCHIVED | Service 编排 |
| INV-07 | **写库必须与 AuditLog 写入在同一事务内** | Service 装饰器 |
| INV-08 | `Risk.score = probability × impact`，冗余但必须一致 | Service 校验 + 触发器 |
| INV-09 | 估时/实际工时 ≥ 0，精度 0.5h | schema |
| INV-10 | 任务依赖不允许跨项目 | DAO |
| INV-11 | **所有写操作（人或 AI）必须经过适配层**，不得直写数据库 | 架构测试 + review |
| INV-12 | **风险降级需人工确认**（防止 AI 自行淡化风险） | `requiresConfirmation` |
| INV-13 | **里程碑 AT_RISK/MISSED 只由规则写入** | 规则引擎独占写路径 |
| INV-14 | 撤销不得静默覆盖他人后续修改 | 冲突检测（01 §4.5） |
| INV-15 | **写前必须读旧值**（外部通路下的撤销前提） | 适配层装饰器 |

## 5. 计算规则（确定性）

### 5.1 里程碑健康度

```
progress       = done 任务数 / 任务总数
days_left      = due_date - today
velocity       = 近 14 天完成任务数 / 14          ← 用 actual_end_date
required_rate  = 剩余任务数 / max(days_left, 1)
blocked_days   = max(now - 阻塞起始) over BLOCKED tasks

AT_RISK 若 (progress < 0.5 且 days_left < 14)
       或 (velocity < required_rate × 0.8)
       或 (存在 blocked_days > 3 的任务)
       或 (逾期 3 天内的 grace 期)
MISSED 若 due_date < today 且 progress < 1
```

结果写 `DerivedState(MILESTONE_HEALTH)`，含 `reason`（人类可读依据，如"存在阻塞 5 天的任务：真实会话脱敏数据导出"）。

### 5.2 进度三口径

| 指标 | 公式 |
|---|---|
| 任务完成率 | `done 任务数 / 总任务数`（分母为非 CANCELLED 且未删除的活跃任务） |
| 估时完成率 | `Σ done 任务 actual_hours / Σ done 任务 estimate_hours`（分母 0 → 项目均值兜底） |
| 里程碑达成率 | `done 里程碑数 / 按截止日排期应 done 里程碑数` |
| 项目健康度 | 红灯 = 任一里程碑 AT_RISK/MISSED，或延期率 > 30% |

### 5.3 风险等级矩阵（score = p × i，p/i 各 1..5）

| score | 等级 | 颜色 | 自动动作 |
|---|---|---|---|
| ≥ 16 | SEVERE 严重 | 🔴 | 推送 PMO + 进入每周复盘 |
| 9–15 | HIGH 高 | 🟠 | 推送 PM |
| 4–8 | MEDIUM 中 | 🟡 | 仪表盘提示 |
| < 4 | LOW 低 | 🟢 | 仅登记 |

**"升级到高"的语义**：改 `probability`/`impact` 使 score 落入目标区间，**不直接写 `level`**（level 是冗余计算列）。降级同样要人确认（INV-12）。

### 5.4 风险 5 类自动识别

| 类别 | 规则 |
|---|---|
| 延期 | 任一里程碑 AT_RISK 或预测延期概率 ≥ 70% |
| 阻塞 | 存在任务 BLOCKED 时长 > 历史均值 1.5× |
| 过载 | 任一 assignee 当前 WIP > 其历史 P75 |
| 流失 | assignee 7 天内未更新其名下任何任务 |
| 范围蔓延 | 新增需求估时 > 原计划估时 + 20% |

输出为**候选风险**（不直接落库），经人采纳才 `register_risk`（`source=AI`）。

### 5.5 ETA 预测

```
method = burndown 外推 + CPM 关键路径
输出   = { predicted_end_date, p50, p90, confidence, explanation }
降级   = 无 CPM 时仅 burndown（无 P50/P90）；历史不足 → "数据不足，无法预测"
```

**`explanation` 由 LLM 润色，数字由规则算。**

### 5.6 相对日期解析

"本周所有 P0 任务顺延到下周一"——**不让模型算日期**。

- 日期参数接受 `DateRef`：`"2026-03-16" | "next-monday" | "this-week" | "+3d" | "today"`。
- 后端统一解析：`this-week` = 本周一 00:00 ~ 本周日 23:59（**周起点周一，时区 Asia/Shanghai**）；`next-monday` = 下一个周一 00:00。
- 上下文注入"今天是 X（Asia/Shanghai）"供模型参考，但**落库的一定是后端解析出的绝对日期**。
- 区间端点**闭区间**（含两端）。
