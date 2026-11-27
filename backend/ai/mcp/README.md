# MCP 工具清单**快照**

> 这个目录放**入库的快照** —— AiAdmin 的 MCP 服务器（`https://www.pmdict.cn/api/v1/mcp`）
> **暴露了哪些工具、每个工具的参数 schema 是什么**。
>
> **它不是**运行时配置 ⇒ 服务启动时**不读**它 ⇒ 只给**守卫**用。

## 为什么要有它

技能正文（`backend/ai/.pi/skills/<名字>/SKILL.md`）是**提示词** ⇒ 它进模型上下文 ⇒
里面写的是 **MCP 工具的真实参数名**（`project_id` / `type_code` / `status_code` ……）。

⇒ 后端改了工具（改名 / 改参数 / 改必填）⇒ 技能就**悄悄失配** ⇒ 没人知道 ⇒
模型拿着旧参数名去调 ⇒ **422**。

⇒ 所以把工具清单**快照进仓** ⇒ 再用**离线守卫**比对「技能 ⇄ 快照」
（[`scripts/e2e/mcp-tools-snapshot.static.cjs`](../../../scripts/e2e/mcp-tools-snapshot.static.cjs)）
⇒ 漂移在 CI 里就红。

## 文件

| 文件 | 是什么 |
| ---- | ------ |
| `aiadmin-tools.snapshot.json` | **AiAdmin PM API** 的工具清单快照（名字 + 描述 + 参数 schema） |

## 怎么更新（**人工跑、要联网**）

```bash
# 在仓根跑（默认抓生产 AiAdmin；只读 tools/list ⇒ 不改任何数据）
node scripts/mcp/snapshot-aiadmin-tools.cjs

# 抓完立刻跑守卫 ⇒ 它会告诉你哪些技能要跟着改
node scripts/e2e/mcp-tools-snapshot.static.cjs
```

⚠️ **抓完一定要跑守卫**：快照更新了而技能没改 ⇒ 守卫会红 ⇒ 那正是要修的地方。
⚠️ 抓快照**需要联网**（CI 里没有 AiAdmin）⇒ **守卫不联网**（它只比对本仓的两个文件）。

## 快照里有什么

```jsonc
{
  "server": "aiadmin",              // 服务器名（工具名前缀 mcp__aiadmin__）
  "source": "https://…/api/v1/mcp", // 来源
  "capturedAt": "2026-11-27",       // 抓取日期（人工刷新时才变）
  "protocolVersion": "2025-06-18",  // MCP 协议版本
  "serverInfo": "AiAdmin PM API",   // 服务器自报的名字
  "tools": [
    {
      "name": "create_task",        // 工具名（**裸名**；模型侧是 mcp__aiadmin__create_task）
      "description": "…",           // 后端写的工具描述（模型靠它决定用不用）
      "inputSchema": { … }          // JSON Schema（参数名 / 类型 / 必填）
    }
  ]
}
```

## ⚠️ 已知的后端矛盾（快照如实记录，别改快照去迁就它）

`patch_task_status` 的**描述**说「`status_code` 取字典值（如 todo/doing/done）」，
**但它的 schema 是 `status`：整数 0/1**（=「是否可用」）⇒ 两处自相矛盾。

⇒ **以 schema 为准**（参数校验看 schema）⇒ 技能正文按 schema 写
（见 `backend/ai/.pi/skills/patch-task-status/SKILL.md`）。
⇒ 要后端改的话，在 **AiAdmin 那个仓**单独提 PR（**不改本仓**）。
