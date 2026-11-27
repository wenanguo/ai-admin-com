---
name: list-tasks
description: 列出任务。用户问「这个项目还有哪些任务」「哪些任务没做完」「P0 有多少」「谁在负责 XX」时用。
---

# 列任务

工具：`mcp__aiadmin__list_tasks`

## 参数（`mcp__aiadmin__list_tasks`）

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `page_no` | integer | — | 页码（从 1 开始，默认 1） |
| `page_size` | integer | — | 每页条数（**上限 100**，默认 10） |
| `project_id` | integer | — | 所属项目 id（**数字**，不是项目编码） |
| `title` | string | — | 标题关键词（模糊匹配） |
| `type_code` | string | — | 类型（字典码，**小写**） |
| `status_code` | string | — | 状态（字典码，**小写**） |
| `priority_code` | string | — | 优先级（字典码，**大写 P**） |
| `assignee_id` | integer | — | 负责人 id |
| `milestone_id` | integer | — | 所属里程碑 id |
| `parent_id` | integer | — | 父任务 id |
| `estimate_hours` | number | — | 预估工时（**单位：小时**） |
| `start_date` | string | — | 计划开始日期（`YYYY-MM-DD`） |
| `due_date` | string | — | 计划截止日期（`YYYY-MM-DD`） |

## 流程

1. **确认项目**
   - 用户给的是**项目编码**（`PRJ-2026-Q3-001`）⇒ 这个工具要 **数字 `project_id`**。
   - ⚠️ **MCP 里没有「列项目」工具** ⇒ 你自己换不了编码 ⇒
     - 讨论上下文里有项目（形如「项目：<名字>（id=<数字>）」）⇒ 就用那个 id；
     - 否则**问用户**是哪个项目 / 要哪个 id，**不要瞎猜**。
   - 用户没给项目 ⇒ **先问**，不要瞎猜。

2. **列任务**：调用 `mcp__aiadmin__list_tasks`，常用参数见上面的参数表：
   - ⚠️ 状态 / 类型是**小写字典码**（`todo` / `in_progress` / `feature`），
     优先级是**大写 P**（`P0`）—— ⚠️ 不是 `doing`，也不是小写的 `p0`。
   - ⚠️ **输出会被截断**（一次 20 条任务就有近千行）⇒ `page_size` 给小一点（默认 10）。

3. **回报给用户**
   - 按状态分组列出（标题 + 状态 + 优先级），并说明一共多少条。
   - ⚠️ 超过一页时要说明「只列了最新的一批」。
   - 一条都没有时，先确认是不是项目 id 或过滤条件给错了，再问用户。
