---
name: update-task
description: 修改已有任务（标题、优先级、状态、负责人等）。用户说「把 XX 任务改成…」「这个任务优先级调到 P0」「把它标记为完成」时用。
---

# 改任务

## ⚠️ 先分清三个工具，别用错

| 工具 | 语义 | 什么时候用 |
| ---- | ---- | ---------- |
| `mcp__aiadmin__get_task_detail` | 按 id 读**当前完整数据** | 改之前**先读** |
| `mcp__aiadmin__update_task` | **全量更新（PUT）** | **一切修改**（状态、标题、优先级、负责人、工时、描述……） |
| `mcp__aiadmin__patch_task_status` | **批量改「是否可用」(0/1)** | ⚠️ **改不了任务状态** ⇒ 改状态**不要**用它 |

> ⚠️ `patch_task_status` 名字像「改状态」，**实际改的是「是否可用」**（`status` 是 0/1 的整数）
> ⇒ 拿它改任务状态 ⇒ 状态没变，还顺手动了可用状态。
> ⇒ **改状态一律用 `update_task`**（把 `status_code` 带上）。

## 参数（`mcp__aiadmin__get_task_detail`）

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | integer | ✅ | 任务 id |

## 参数（`mcp__aiadmin__update_task`）

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | integer | ✅ | 任务 id |
| `project_id` | integer | ✅ | 所属项目 id（**数字**，不是项目编码） |
| `title` | string | ✅ | 任务标题 |
| `type_code` | string | ✅ | 类型（字典码，**小写**） |
| `status_code` | string | ✅ | 状态（字典码，**小写**） |
| `priority_code` | string | ✅ | 优先级（字典码，**大写 P**） |
| `description` | string | — | 任务描述（Markdown） |
| `assignee_id` | integer | — | 负责人 id |
| `milestone_id` | integer | — | 所属里程碑 id |
| `parent_id` | integer | — | 父任务 id |
| `estimate_hours` | number | — | 预估工时（**单位：小时**） |
| `actual_hours` | number | — | 实际工时（**单位：小时**） |
| `start_date` | string | — | 计划开始日期（`YYYY-MM-DD`） |
| `due_date` | string | — | 计划截止日期（`YYYY-MM-DD`） |

## 流程

1. 先 `mcp__aiadmin__get_task_detail`（`id`）拿**当前完整数据**；
2. 在它的基础上改目标字段，再调用 `mcp__aiadmin__update_task` **整体提交**；
3. ⚠️ `update_task` 是**全量更新**：**必填六项一个都不能少**
   （`id` + `project_id` + `title` + `type_code` + `status_code` + `priority_code`），
   **缺任何一个都会 422** ⇒ 漏字段会把已有数据抹掉。

## 规矩

- ⚠️ 状态 / 类型 / 优先级的线上码**以上下文里给的为准**（上下文里是「线上码（中文）」两样）：
  - 状态：`backlog` / `todo` / `in_progress` / `blocked` / `review` / `done` / `cancelled`
    （⚠️ **没有 `doing`**）；
  - 优先级：`P0` / `P1` / `P2`（**大写 P**）；
  - 类型：`feature` / `bug` / `ops`。
- ⚠️ **没填的字段不要传 `null`** —— 不传就行（后端会保持原值）。
- ⚠️ 改数据要**等人点头**：本服务有「待确认」闸门（`update_` / `patch_` 开头的工具会被挂起）
  ⇒ 把要改的值填对，等用户在「待确认」里点头。
- 改完回报：**改了哪几个字段**（改前 → 改后），别只说「改好了」。
