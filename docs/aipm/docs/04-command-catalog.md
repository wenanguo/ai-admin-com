# 04 · 命令目录（Command Catalog）

> AI 能做哪些操作、参数长什么样、哪些要人确认、怎么撤销。
> **命令 = pi tool**。工具定义直接生成模型的 JSON schema。

## 1. 工具定义模板

```ts
const tool = defineTool({
  name: "update_task",
  label: "更新任务",
  description:
    "更新任务的字段。改单个任务的常规字段用这个；批量修改请用 batch_update_tasks；" +
    "拆分一个任务用 split_task。日期用绝对日期 YYYY-MM-DD 或相对表达式（如 next-monday、+3d）。",
  parameters: Type.Object({
    task_key: Type.String({ description: "任务标识（不确定先用 search 查）" }),
    due_date: Type.Optional(Type.String({ description: "新截止日" })),
    status: Type.Optional(Type.String({ description: "目标状态" })),
    ...
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const result = await pmAdapter.updateTask(params);
    return { content: [{ type: "text", text: summarize(result) }], details: result };
  },
});
```

**写 description 的规矩**（MiniMax 的 `toolChoice` 只能是 `auto`，模型全靠描述选工具）：
1. 一句话说清**什么时候用我**。
2. 一句话说清**什么时候别用我**（指向替代命令）。
3. 参数逐个写清楚，尤其**格式与单位**。
4. 同一语义域的命令，描述里互相点名，避免模型选错。

## 2. 命令清单

标注：**确认**列见 §3；**只读**命令永不需要确认。

### 2.1 项目域

| 命令 | 参数 | 确认 |
|---|---|---|
| `list_projects` | filter{status?, owner?, tag?} | 只读 |
| `get_project` | project_key | 只读 |
| `create_project` | name, code?, description?, start_date, due_date, template_id?, owner? | 否 |
| `update_project` | project_key, name?, description?, start_date?, due_date?, tags?, status? | 状态变更：**是** |
| `get_project_overview` | project_key | 只读 |

### 2.2 里程碑域

| 命令 | 参数 | 确认 |
|---|---|---|
| `list_milestones` | project_key | 只读 |
| `get_milestone` | milestone_key | 只读 |
| `create_milestone` | project_key, name, start_date?, due_date, description?, deliverables? | 否 |
| `update_milestone` | milestone_key, name?, start_date?, due_date?, description? | 改期 > 3 天：**是** |
| `split_milestone` | milestone_key, parts:[{name, start_date?, due_date}] | **是** |
| `split_milestone_into_tasks` | milestone_key, tasks:[{title, assignee?, due_date?, estimate_hours?}] | 否 |
| `transition_milestone` | milestone_key, event(start\|complete), reason? | **是** |
| `compute_milestone_health` | milestone_key | 只读 |

> `status` **不出现在** `update_milestone` 的参数里：`AT_RISK`/`MISSED` 由规则独占写入（INV-13），`DONE` 走 `transition_milestone`。

### 2.3 任务域

| 命令 | 参数 | 确认 |
|---|---|---|
| `list_tasks` | filter{project_keys?, assignee?, statuses?, priorities?, milestone_keys?, due_before?, due_after?} | 只读 |
| `get_task` | task_key | 只读 |
| `search` | query, entity_types? | 只读 |
| `create_task` | project_key, title, milestone_key?, parent_key?, assignee?, due_date?, priority?, type?, estimate_hours?, labels? | 否 |
| `update_task` | task_key, title?, description?, status?, priority?, assignee?, due_date?, milestone_key?, estimate_hours?, actual_hours? | 按 §3 |
| `split_task` | task_key, parts:[{title, due_date?, assignee?, estimate_hours?}] | **是** |
| `batch_update_tasks` | filter{project_keys[], assignee_ids?, priorities?, statuses?, milestone_keys?, due_before?, due_after?}, set{due_date?, status?, assignee?, priority?}, reason? | **是** |
| `transition_task` | task_key, event(schedule\|start\|block\|unblock\|submit_review\|approve\|reject\|pause\|cancel\|reopen), reason? | 按 §3 |
| `delete_task` | task_key | **是** |
| `add_task_dependency` | task_key, depends_on_key, type?(FS\|SS\|FF\|SF) | 否 |
| `remove_task_dependency` | dependency_key | **是** |
| `move_task` | task_key, milestone_key | 否 |

### 2.4 风险域

| 命令 | 参数 | 确认 |
|---|---|---|
| `list_risks` | filter{project_keys?, levels?, statuses?, categories?} | 只读 |
| `register_risk` | project_key, title, description?, category, probability(1-5), impact(1-5), owner?, milestone_key?, mitigation_plan?, due_date? | 否 |
| `update_risk` | risk_key, title?, description?, category?, probability?, impact?, owner?, mitigation_plan?, contingency_plan?, due_date?, milestone_key? | 升降级：**是** |
| `transition_risk` | risk_key, event(analyze\|start_mitigation\|close), reason? | **是** |
| `convert_risk_to_task` | risk_key, title?, assignee?, due_date?, estimate_hours? | 否 |
| `suggest_risks` | project_key | 只读 |

### 2.5 进度与洞察域

| 命令 | 参数 | 确认 |
|---|---|---|
| `get_progress` | project_key | 只读 |
| `predict_milestone_slip` | milestone_key | 只读 |
| `predict_project_eta` | project_key | 只读 |
| `generate_weekly_report` | project_key, date_range? | 只读 |

### 2.6 评论域

| 命令 | 参数 | 确认 |
|---|---|---|
| `add_comment` | target_type, target_key, content, mentions? | 否 |
| `list_comments` | target_type, target_key | 只读 |

## 3. 确认判定

判定在**两处**，缺一不可：

1. **静态标注**：tool 的 `annotations.destructiveHint`——"这类命令天生危险"（删除、拆分、批量、风险关闭）。
2. **动态判定**：适配层的 `requiresConfirmation(command, args)`——看具体参数（改期多少天、是否跨项目、影响多少条）。

| 情形 | 需确认 | 理由 |
|---|---|---|
| 只读命令 | 否 | |
| 新建实体 | 否 | 可补偿撤销 |
| 改 title/description/priority/assignee/估时/milestone 归属 | 否 | 常规 |
| `status` → `CANCELLED` | **是** | 等价删除 |
| `status` → 其他值 | 否 | |
| 改 due_date，变化 **> 3 天** | **是** | 3 天 = 是否影响本周交付的分界 |
| 改 due_date，变化 ≤ 3 天 | 否 | |
| 任何 `batch_*` | **是** | 影响面不明确 |
| 删除 / 软删除 | **是** | |
| 拆分（`split_*`） | **是** | 产生多个新实体 |
| 改 risk.probability/impact（**含降级**） | **是** | INV-12 |
| risk → CLOSED | **是** | |
| 里程碑 → DONE | **是** | 且需任务全部完成 |
| 跨项目写操作 | **是** | 超出当前上下文 |

阈值常量：`DESTRUCTIVE_DATE_THRESHOLD_DAYS = 3`（可配）。

## 4. 确认流程与预览

见 03 §5 时序图。要点：

- **预览是快照**：生成待确认时固定命中清单（实体键 + 旧值）。执行的是这份快照里的实体，**不重新跑 filter**——否则用户看到的预览和实际改动会不一致。
- **预览里的警告由规则算**，不是模型编的。例如"顺延后仍无法解锁关键路径"来自关键路径分析。
- 调整范围 = 取消当前挂起 → 改参数 → 重新预览 → 新 actionId，旧记录置 EXPIRED 并留审计。

## 5. 撤销矩阵

| 命令 | 补偿动作 |
|---|---|
| `update_*` | 用写前快照的旧值 PATCH 回去 |
| `create_*` | DELETE；外部不支持则本地标记"逻辑删除" |
| `delete_task` | 用快照重建（ID 会变 → 更新 `EntityRef`） |
| `split_task` | 删除新任务 + 恢复原任务 |
| `split_milestone` | 删除子里程碑 + 恢复父里程碑 |
| `split_milestone_into_tasks` | 删除生成的任务 |
| `convert_risk_to_task` | 删除任务 + 恢复风险 status |
| `batch_update_tasks` | 逐条按旧值恢复（单次调用） |
| `add_task_dependency` | 删除依赖行 |
| `remove_task_dependency` | 重建依赖行 |
| `transition_*` | 恢复到迁移前的 from 状态 |

**三条硬约束**（01 §4.5）：逐条独立 + 部分失败显式报告；补偿前冲突检测；补偿本身写审计。

## 6. 命令实现约束

1. `execute()` 内**只调适配层**，不碰数据库。
2. 危险命令在 `execute()` 内**第一件事**是求值预览并挂起等待确认，**不要先执行再问**。
3. 只读命令返回的 `details` 要**结构化**（不是自然语言），便于模型继续推理。
4. 结果 `content` 是给模型看的简短摘要；`details` 是给程序看的完整数据。**大结果要截断并告诉模型去哪看完整数据**（pi 的约定）。
5. 抛异常 = 工具失败（模型会看到错误并重试或改参数）；返回 `isError: true` = 有数据但带错误（脚本仍能拿 `structuredContent`）。
6. 工具描述与 `parameters` 里**不要出现外部 API 的字段名**——一律用统一领域模型的名字（02 §2）。
