# AI 能力扩展：MCP 工具 + Skills 配方（2026-11-06 ~ 2026-11-10）

> 这份是「把 AI 的能力扩展成本从『开发者写代码』降到『写一个 markdown』」那次改造的交接与决策记录。
> 设计文档：`docs/superpowers/specs/2026-11-06-aipm-mcp-skills-design.md`（在 `backend/ai/docs/`）

## 目标

- 让**业务同学**能自己给 AI 加能力（写 markdown），不用找开发者。
- 后端加接口 ⇒ AI 侧**一行代码都不用改**。
- 改已有数据 ⇒ 必须**人点头**。

## 状态

已完成（Skills 层 → MCP 接入 → 待确认闭环，三段都真实验收过）

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `8e1a999` | 技能提示词段（自己渲染，措辞指向 `load_skill`） |
| `ce914ca` | `load_skill` 工具（按名字读，目录内白名单） |
| `7e649e3` | pi 会话接上技能（发现 SKILL.md + 注入提示词 + 工具） |
| `dbfceb3` | AiAdmin 的 MCP 服务器配置与注册扩展 |
| `7e649e3`+ | pi 会话挂上 MCP 扩展（每会话带自己的 token） |
| `8afd965` | 假 MCP 传输层 —— 证明模型能看到并调用 MCP 工具 |
| `aa57ac3` | token 轮换时重建会话（MCP 不复用旧 token） |
| `f0c51bb`/`ce52856`/`dc0db0f`/`49284f8` | 闸门（修改类工具在 `tool_call` hook 里等批准）+ approve/reject 端点 |
| `3f00b67` | 前端：pending 事件 + 同意/拒绝按钮 + 「等待你确认」提示 |

## 决策记录（★）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **只用 pi 官方扩展点**（MCP / Skills / customTools），**不造 yaml/DSL** | yaml 那套是自创的 ⇒ pi 升级就失配，且我们拿不到上游修复 | 升级即返工 |
| **工具来源 = 后端 MCP**，不由我们写命令 | AiAdmin 已有 `module_mcp`（路由表→tool）⇒ 后端加接口，AI 侧零改动 | 扩展成本回弹到「开发者写代码」 |
| **口径住在技能（markdown）里，不住在代码里** | 业务同学要能改口径（字典码、必填字段、坑） | 每次改口径都要发版 |
| **模型上下文只认 `SessionManager`** | SDK 明说：改 `session.agent.state.messages` **不**替换持久化上下文 | 模型失忆 |
| **历史要还原成 entries** 交给 `SessionManager.inMemory(cwd, {id}, entries)` | 让进程重启/通道回收后模型还记得聊过什么 | 前端看得见历史、模型看不见（用户觉得 AI 装失忆） |
| **当前这句要从历史里排除** | 它随后由 `prompt()` 加进 pi 消息列表 ⇒ 两边都放，模型看两遍 | 模型看到同一句话两遍 |
| **`extensionFactories` 挂 `DefaultResourceLoader`**，不是 `createAgentSession` | 给错位置**被静默忽略** ⇒ 扩展根本不加载 ⇒ 一个 MCP 工具都不出现（排查了很久） | 工具全无，且没有任何报错 |
| **建完会话必须 `bindExtensions({mode:"print"})`** | 只有它会发 `session_start` ⇒ MCP 服务器这时才连 | 同上（连接不建） |
| **闸门用 `tool_call` hook 同步挂起**（在 hook 里 await 批准） | hook 是 async 且被 await ⇒ 批准后 **pi 照常执行原调用** ⇒ 那一轮不打断，也不用往会话里注入系统消息 | 要额外实现「注回会话」（三种候选机制都要验），且污染对话 |
| **`tool.execute()` 会绕过流水线** ⇒ hook 不触发 | 测闸门必须走 `session.agent.beforeToolCall(...)` | 以为闸门失效了 |
| **技能来源限定在项目目录** | pi 会连用户家目录的 `~/.agents/skills/` 一起扫（实测扫进 27 个无关技能） | 用户家目录的技能进系统提示词，可能被诱导读用户文件 |
| **思考级别默认 `off`** | 开了思考模型先想再写 ⇒ 用户等更久；前端还没接「思考中」的完整展示 | 体验变差 |
| **`created_via_code` 要显式传 `nl_chat`** | 后端「自动填充」填的是 `manual` ⇒ AI 建的任务丢了来源标记 | 前端看不出哪条是 AI 建的 |

## 怎么验

```bash
# 单元 + 集成（不调模型）
cd backend/ai && npx vitest run

# 真后端：起 AI 服务 + 前端，跑浏览器端到端
node scripts/e2e/login.cjs                       # 取 token
node scripts/e2e/ai-gate.cjs                     # 改任务 → 等确认 → 同意 → 核对
```

## 坑与提醒

- **MCP 工具输出会被截断**（一次 20 条任务就有 990 行）⇒ 技能里要建议更小的 `page_size`。
- **`patch_task_status` 的 schema 与描述矛盾**（描述说字典码、schema 是 `integer`）⇒ **后端待修**（工具描述是模型唯一的使用依据）。
- **AiAdmin 的 MCP 白名单默认只有「任务模块」** ⇒ 里程碑/项目/风险的接口要用得先开 `MCP_INCLUDE_TAGS`。
