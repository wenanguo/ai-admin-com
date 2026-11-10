---
name: create-task
description: 在 AiAdmin 的项目下新建一条任务。用户说「建个任务」「加一条 XX 任务」「记一下要做的事」时用。
---

# 建任务

工具：`mcp__aiadmin__create_task`（后端任务模块的创建接口）

1. **先确认项目**
   - 用户通常给的是**项目编码**（形如 `PRJ-2026-Q3-001`）。
   - ⚠️ 任务接口要的是 **project_id（数字）**，不是编码 ⇒ 先用项目列表接口把编码换成 id。
   - 换不到 ⇒ **问用户**要编码，**绝不**自己编一个 id。

2. **建任务**：调用 `mcp__aiadmin__create_task`，**必填五项**：
   - `project_id`（数字 id）
   - `title`（一句话，动宾结构，不超过 60 字）
   - `type_code`：`feature` / `bug` / `ops` / `research` / `spike`
   - `status_code`：`todo` / `in_progress` / `done` / `backlog` / `review` / `blocked`
     （新建一般给 `todo`；⚠️ **没有 `doing`**）
   - `priority_code`：`P0` / `P1` / `P2` / `P3`（**大写 P**）
   - 可选：`description`（Markdown）、`assignee_id`、`milestone_id`、`parent_id`、
     `estimate_hours`、`start_date` / `due_date`
   - ⚠️ **一定要传** `created_via_code="nl_chat"`（=「自然语言对话建的」）
     —— 这是「来源标记」字段，不传后端会当成人工建的（manual），前端就看不出
     这条任务是 AI 建的。
   - ⚠️ `reporter_id` / `sort_order` **不用传**（后端自动填）
   - ⚠️ 这些码是**字典里的线上码**：类型与状态是小写（`feature` / `todo` / `in_progress`），
     优先级是**大写 P**（`P0` / `P1`）—— ⚠️ 不是 `FEATURE` / `TODO`，
     也不是小写的 `p0` / `doing`

3. **回报给用户**：任务标题、所属项目、状态、任务 id。
   - 工具失败时把失败原因讲清楚（项目不存在、参数不对、权限不足），并说明下一步怎么办。
