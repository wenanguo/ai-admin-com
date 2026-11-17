# 智能体配置（`agents/`）

**一个智能体一个目录** ⇒ 提示词与技能可以与配置同目录。

```
agents/
  <agentId>/
    agent.yaml     ← 配置（**由人编辑**，没有创建/修改配置的接口）
    prompt.md      ← 可选：系统提示词文件
    skills/…       ← 可选：技能目录
```

## 仓里现成的智能体

| 目录 | 是什么 |
|------|--------|
| `pm/` | **PM 助手**（默认智能体）：写任务、建任务、管里程碑 ⇒ 等价复现原来的行为 |
| `qa/` | **通用问答**：没有工具、没有 MCP、没有技能 ⇒ 只聊天 |
| `sample/` | 格式演示（`#77` 留下的） |

⚠️ **默认智能体**由环境变量 `AI_DEFAULT_AGENT` 决定（缺省 `pm`）。

## MCP 服务器（`mcpServers`）

```yaml
mcpServers:
  # ① AiAdmin 自己的 MCP（地址不写 ⇒ 用全局默认 `AIADMIN_MCP_URL`）
  - name: aiadmin
  # ② 另一台服务器（地址写全；token 由本服务按调用方 JWT 自动带上）
  - name: docs
    url: ${DOCS_MCP_URL}
    type: http          # http（缺省）/ sse（也走 HTTP 传输）
    exposure: direct    # direct（缺省）/ deferred / codemode / hidden
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 服务器名 —— **工具名的前缀**（`mcp__<name>__<tool>`）⇒ 多服务器的工具不互相盖名。只能小写字母 / 数字 / 连字符 |
| `url` | ❌ | 地址（省略 ⇒ 用全局默认 `AIADMIN_MCP_URL`；两者都没有 ⇒ **这台不挂**）。可写 `${ENV_VAR}`（**启动时展开**） |
| `type` | ❌ | 传输类型：`http`（缺省）/ `sse`（也走 HTTP 传输）。**不支持 stdio**（本服务是 HTTP 服务） |
| `exposure` | ❌ | 暴露方式：`direct`（缺省，工具直接给模型）/ `deferred` / `codemode` / `hidden` |

⚠️ **一台连不上 ⇒ 不拖垮整个智能体**：其余服务器与对话照常（错误由 pi 报告一次）。

⚠️ **MCP 的 Prompts 暂不支持**：pi SDK 的 MCP 扩展**只处理 tools 与 resources**
⇒ 「MCP 的 prompt 自动变成 `/<服务器名>:<prompt名>` 斜杠命令」这条**做不了**
（等 SDK 支持了再做）。

## 技能（`skills`）

```yaml
skills:
  - ./skills            # 本智能体自己的技能目录（相对本配置目录）
  - ../../.pi/skills    # 也可以领用项目的技能目录
```

⚠️ **技能是按智能体的**：只有**配置里列的目录**里的技能算数
⇒ 智能体 A 看不到智能体 B 的技能（模型也拿不到）。

⚠️ pi 默认还会扫 `<cwd>/.pi/skills` 与用户家目录 `~/.agents/skills/`
⇒ 本服务**一律不加载**它们（除非你在这里列出来）⇒ 既不串味，
也不会出现「项目目录那份抢了同名、配置里那份反而没了」。

⚠️ **技能发现仍然走 pi 的 loader**（`loadSkills`）⇒ 不自己造技能扫描器。

⚠️ 技能清单接口 `GET /api/agent/skills` **按智能体**返回：
`?agentId=xxx` ⇒ 那个智能体的技能；不给 ⇒ 默认智能体。

## 会话 ↔ 智能体的绑定

`POST /api/agent/conversations` 可以带 `agentId`（不带给默认智能体）。

⚠️ **会话 id 里带着智能体 id**：`<agentId>_<uid>`
⇒ 绑定**跟着会话走**（进程重启也还在）⇒ 同一会话重建后仍是同一个智能体（不会串味）。

```json
POST /api/agent/conversations
{ "title": "起个项目", "agentId": "qa" }
```

## 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 智能体 id —— **必须与目录名一致**（小写字母 / 数字 / 连字符，最多 30 字符） |
| `name` | ✅ | 显示名 |
| `description` | ✅ | 一句话说明（清单里给界面看） |
| `model` | ❌ | 模型标识（`provider/model`）；省略 ⇒ 用全局默认 `AI_MODEL` |
| `systemPrompt` | 二选一 | 系统提示词（直接写） |
| `systemPromptFile` | 二选一 | 系统提示词文件（相对本配置目录） |
| `skills` | ❌ | 技能目录列表（相对**本配置目录**；省略 ⇒ 空 ⇒ 这个智能体**一个技能都没有**） |
| `mcpServers` | ❌ | MCP 服务器列表（**可以 0 / 1 / N 个**；省略 ⇒ 空） |
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
| `backend/ai/src/core/routes/agents.ts` | `GET /api/agents` |
