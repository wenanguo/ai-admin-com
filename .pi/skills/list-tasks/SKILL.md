---
name: list-tasks
description: 列出任务。用户问「这个项目还有哪些任务」「哪些任务没做完」「P0 有多少」「谁在负责 XX」时用。
---

# 列任务

工具：`mcp__aiadmin__list_tasks`

1. **确认项目**
   - 用户给的是**项目编码** ⇒ 先用项目列表接口把它换成 **project_id（数字）**。
   - 用户没给项目 ⇒ **先问**是哪个项目，不要瞎猜。

2. **列任务**：调用 `mcp__aiadmin__list_tasks`，常用参数：
   - `project_id`（数字 id）
   - `status_code`（`todo` / `in_progress` / `done` / `backlog` / `review` / `blocked` …）
   - `priority_code`（`P0` ~ `P3`，**大写 P**）
   - `type_code`（`feature` / `bug` / `ops` …）
   - `title`（标题关键词，模糊匹配）
   - `assignee_id`（负责人 id）
   - `page_no` / `page_size`（**单页上限 100**）
   - ⚠️ 状态 / 类型是小写字典码（`todo` / `in_progress` / `feature`），
     优先级是**大写 P**（`P0`）—— ⚠️ 不是 `doing`，也不是小写的 `p0`

3. **回报给用户**
   - 按状态分组列出（标题 + 状态 + 优先级），并说明一共多少条。
   - ⚠️ 超过一页时要说明「只列了最新的一批」。
   - 一条都没有时，先确认是不是项目 id 或过滤条件给错了，再问用户。
