---
name: create-task
description: 在 AiAdmin 的项目下新建一条任务。用户说「建个任务」「加一条 XX 任务」「记一下要做的事」时用。
---

# 建任务

工具：`mcp__aiadmin__create_task`（AiAdmin 后端 MCP 的建任务工具）

## 参数（`mcp__aiadmin__create_task`）

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `project_id` | integer | ✅ | 所属项目 id（**数字**，不是项目编码） |
| `title` | string | ✅ | 任务标题：一句话、动宾结构、不超过 60 字 |
| `type_code` | string | ✅ | 类型（字典码，**小写**） |
| `status_code` | string | ✅ | 状态（字典码，**小写**） |
| `priority_code` | string | ✅ | 优先级（字典码，**大写 P**） |
| `description` | string | — | 任务描述（Markdown） |
| `milestone_id` | integer | — | 所属里程碑 id |
| `parent_id` | integer | — | 父任务 id（**不许跨项目**） |
| `assignee_id` | integer | — | 负责人 id |
| `estimate_hours` | number | — | 预估工时（**单位：小时**，可小数） |
| `start_date` | string | — | 计划开始日期（`YYYY-MM-DD`） |
| `due_date` | string | — | 计划截止日期（`YYYY-MM-DD`） |
| `created_via_code` | string | — | 创建方式（字典码） |

## 流程

1. **先确认项目（`project_id` 是数字 id）**
   - 任务接口只认**数字项目 id**（`project_id`），**不认**项目编码（`PRJ-2026-Q3-001`）。
   - ⚠️ **MCP 里没有「列项目」工具** ⇒ 你自己换不了编码 ⇒ 只有两条路：
     - **讨论上下文里有项目**（形如「【当前讨论的项目】#6 某某项目」或「- 所属项目：#6 某某项目」）
       ⇒ 就用那个 `#6` 里的**数字**；
     - 否则**问用户**要项目 id。
   - ⚠️ **绝不自己编一个 id**（编了 ⇒ 任务建到别人的项目里，而且看不出来）。
   - ⚠️ 用户只给了项目**编码**时：告诉他「这个接口要数字 id」，请他给 id 或先选项目；
     **不要**把编码硬塞进 `project_id`（⇒ 422）。

2. **建任务**：调用 `mcp__aiadmin__create_task`，**必填五项**（见上面的参数表）：
   - `type_code`：`feature` / `bug` / `ops` / `research` / `spike`
   - `status_code`：`backlog` / `todo` / `in_progress` / `blocked` / `review` / `done` / `cancelled`
     （⚠️ **没有 `doing`**）
   - `priority_code`：`P0` / `P1` / `P2` / `P3`（**大写 P**）
   - ⚠️ 类型与状态是**小写字典码**，优先级是**大写 P**
     ⇒ 不是 `FEATURE` / `TODO`，也不是小写的 `p0`。
   - ⚠️ **`created_via_code` 一定要传 `"nl_chat"`**（=「自然语言对话建的」）
     —— 这是「来源标记」字段，不传后端会当成人工建的，前端就看不出这条任务是 AI 建的。
   - ⚠️ `reporter_id` / `sort_order` **不用传**（后端自动填）。

3. **回报给用户**：任务标题、所属项目、状态、任务 id。
   - 工具失败时把失败原因讲清楚（项目不存在、参数不对、权限不足），并说明下一步怎么办。
