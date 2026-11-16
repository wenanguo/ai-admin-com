# 智能体配置（`agents/`）

**一个智能体一个目录** ⇒ 提示词与技能可以与配置同目录。

```
agents/
  <agentId>/
    agent.yaml     ← 配置（**由人编辑**，没有创建/修改配置的接口）
    prompt.md      ← 可选：系统提示词文件
    skills/…       ← 可选：技能目录
```

## 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 智能体 id —— **必须与目录名一致** |
| `name` | ✅ | 显示名 |
| `description` | ✅ | 一句话说明（清单里给界面看） |
| `model` | ❌ | 模型标识（`provider/model`）；省略 ⇒ 用全局默认 `AI_MODEL` |
| `systemPrompt` | 二选一 | 系统提示词（直接写） |
| `systemPromptFile` | 二选一 | 系统提示词文件（相对本配置目录） |
| `skills` | ❌ | 技能目录列表（相对本配置目录；省略 ⇒ 空） |
| `mcpServers` | ❌ | MCP 服务器列表（`{ name, url? }`；省略 ⇒ 空） |
| `tools` | ❌ | 工具白名单（工具名；省略 ⇒ 空） |

⚠️ **未知字段会报错**（拼错字段名不会被悄悄丢掉）。
⚠️ `systemPrompt` 与 `systemPromptFile` **二选一**（两个都写 ⇒ 报错）。

## 口径：非法配置**启动即报错**

缺字段 / 类型错 / 引用的目录或文件不存在 / `id` 与目录名不一致
⇒ 服务**起不来**，报错里点名**是哪个字段**（例：`字段 skills[0]：目录不存在（…）`）。

⇒ 改完配置**重启 AI 服务**生效（清单端点 `GET /api/agents` 读的是真文件）。

## 相关代码

| 位置 | 干什么 |
|------|--------|
| `backend/ai/src/core/config/schema.ts` | 字段形状校验（纯结构） |
| `backend/ai/src/core/config/loader.ts` | 读目录 + 读 YAML + 校验路径是否存在 |
| `backend/ai/src/core/config/catalog.ts` | 配置 ⇒ 清单项（能力摘要） |
| `backend/ai/src/routes/agents.ts` | `GET /api/agents` |
