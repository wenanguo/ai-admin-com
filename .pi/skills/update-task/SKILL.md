---
name: update-task
description: 修改已有任务（标题、优先级、状态、负责人等）。用户说「把 XX 任务改成…」「这个任务优先级调到 P0」「把它标记为完成」时用。
---

# 改任务

## ⚠️ 先分清两个工具，别用错

| 工具 | 语义 | 什么时候用 |
| ---- | ---- | ---------- |
| `mcp__aiadmin__patch_task_status` | **只改状态**（批量） | **首选** —— 更安全，不用带全量字段 |
| `mcp__aiadmin__update_task` | **全量更新（PUT）** | 改标题 / 优先级 / 负责人等其它字段 |

## 流程

1. **只改状态** ⇒ 调用 `mcp__aiadmin__patch_task_status`（`ids` 数组 + 目标状态）。
2. **改其它字段** ⇒
   - 先 `mcp__aiadmin__get_task_detail`（`id`）拿**当前完整数据**；
   - 在它的基础上改目标字段，再调用 `mcp__aiadmin__update_task` **整体提交**。
   - ⚠️ `update_task` 是**全量更新**：必须带齐
     `id` + `project_id` + `title` + `type_code` + `status_code` + `priority_code`，
     **缺任何一个都会 422** ⇒ 漏字段会把已有数据抹掉。

## 规矩

- ⚠️ 状态 / 类型 / 优先级都是**小写的字典码**（`todo` / `doing` / `done`、
  `feature` / `bug` / `ops`、`p0` ~ `p3`）。
- ⚠️ **改之前先在对话里跟用户确认**（本服务还没有「挂起等人点头」的流程
  ⇒ 宁可多问一句，也不要替用户改了已有数据）。
- 改完回报：**改了哪几个字段**（改前 → 改后），别只说「改好了」。
