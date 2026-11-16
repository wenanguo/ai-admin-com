# MCP 多服务器配置化（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #79 · PR（待提）
- **一句话**：把 MCP 从「**写死一个服务器**」变成「**按配置多个服务器**」
  ⇒ 智能体可以同时接多个 MCP，接新的外部系统**不用改代码**。

## 状态

**已完成**（代码已实现、单测已钉住；等提 PR + 合并）。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `backend/ai/src/agent/mcp.ts` | **删掉** `AIADMIN_MCP_SERVER_NAME` 等写死的东西 ⇒ 改成 `createMcpServersExtension(servers)`（挂 0/1/N 台）；新增 `mcpToolPrefix` / `stripMcpToolPrefix`（按**已知服务器名**剥前缀） |
| `backend/ai/src/core/config/schema.ts` | `mcpServers[]` 支持 `name` / `url` / `type`(http\|sse) / `exposure`；名字限死「小写字母/数字/连字符」 |
| `backend/ai/src/core/config/loader.ts` | `url` 里的 `${ENV_VAR}` **启动时展开**（变量没值 ⇒ 报错点名字段）；重复的服务器名 ⇒ 报错 |
| `backend/ai/src/agent/pi-session.ts` | `PiSessionOptions.mcp`（单数）⇒ `mcpServers`（复数）；测试用的假传输层按**服务器名分发** |
| `backend/ai/src/agent/runtime.ts` | `#mcpServersOf()`（按配置挂 0/1/N 台）；`channel.mcpPrefixes`（事件里认工具用） |
| `backend/ai/src/agent/session-registry.ts` | 通道多存一个 `mcpPrefixes` |
| `backend/ai/agents/README.md` | `mcpServers` 的字段表 + **Prompts 暂不支持**的说明 |
| 单测 | `mcp.test.ts`（重写，9 条）· `mcp.integration.test.ts`（+2 条：多服务器前缀、一台连不上另一台照常）· `loader.test.ts`（+6 条）· `runtime.agents.test.ts`（+4 条：0/1/N 台） |

**下一步**：下一条是 #80（技能按智能体装配）。
本条留下的口子：`skillsDirs` 已经是「按配置给目录」，但**每个智能体自己的技能布局**是下一条的事。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 服务器名限死「小写字母/数字/连字符」 | pi 把工具名里的非法字符换成 `_`（`mcp__<server>__<tool>`）⇒ 名字里有 `_` ⇒ 前缀认不准 ⇒ **写操作判不出来**（审计会漏） | 不限 ⇒ 服务器名 `my_server` ⇒ 工具名 `mcp__my_server__update_task` ⇒ 剥前缀后剩下 `server__update_task` ⇒ 认不出是写操作 |
| 剥前缀**按已知的服务器名**算（不是正则猜） | 多服务器 / 名字带连字符都不会认错；正则 `/^mcp__[^_]+__/` 在多服务器下本来就不可靠 | 用正则 ⇒ 第二台服务器的工具认不出来 ⇒ 审计漏记 |
| `url` 里的 `${ENV_VAR}` **启动时展开** | 变量没值就在启动时报错（点名字段）⇒ 不静默拿着 `${...}` 去连 | 运行时展开 ⇒ 连不上还看不出原因；启动时展开 ⇒ 变量变了要重启才生效（与「配置改完重启生效」一致） |
| `type` 支持 `http` 与 `sse`（**都走 HTTP 传输**） | pi 的 `McpHttpServerConfig` 只有 `type: "http"`；SSE 是 HTTP 传输的一种协议形态 ⇒ 一个类型值对应 pi 的同一种配置 | 做成两种 pi 配置 ⇒ 还得自己实现 sse 传输层 ⇒ 超出本条范围 |
| `exposure` 默认 `direct` | 与原来的行为一致（工具直接给模型看） | 默认 `codemode` ⇒ 模型看不到工具 ⇒ 行为变了 |
| **一台连不上 ⇒ 不拖垮整个智能体** | pi 的 MCP 扩展**本来就是**后台连接、失败只报一次 ⇒ 不拖垮是 SDK 的行为，我们只需**别自己抛** | 我们在装配阶段就 throw ⇒ 一个外部 MCP 挂了就整个智能体不能用 |
| `PiSessionOptions.mcp`（单数）⇒ `mcpServers`（复数） | 一台服务器的表达方式撑不住「N 台」 | 保留单数 + 加个数组 ⇒ 两套口径 ⇒ 迟早用错 |
| 测试用的假传输层**按服务器名分发** | pi 只给一个 `createTransport` 工厂（按 entry 分发）⇒ 多台假服务器各回各的 | 一个工厂 ⇒ 多台假服务器会串（测试测不出「哪台连不上」） |
| **不做 STDIO** | 本服务是 HTTP 服务；issue 明确不做 | —— |

## 怎么验

```bash
cd backend/ai
npm run typecheck
npm test          # 397+ 条（含多服务器与「一台连不上」）
```

人眼要看的（需要真环境）：

1. 配置里写两台 MCP ⇒ 模型能看到 `mcp__<名字>__<工具>` 两套工具；
2. 把其中一台的地址写错 ⇒ **另一台照常能用**，对话不受影响（错误看服务日志）。

## 坑与提醒

- ⚠️ **MCP 的 Prompts 做不了**（pi SDK 的 MCP 扩展只处理 tools 与 resources）
  ⇒ 「prompt 自动变成 `/<服务器名>:<prompt名>`」这条**暂不支持**（已在 `agents/README.md` 写明）。
- ⚠️ pi 的工具名规则是 `mcp__<server>__<tool>` 且**非法字符全变 `_`**
  ⇒ 服务器名不要带下划线（配置校验会拦）。
- ⚠️ 事件里认 MCP 工具靠 `channel.mcpPrefixes` ⇒ 它在**会话建起来时**才填
  ⇒ 会话还没建好的事件里没有前缀（那时也不该有 MCP 工具）。
- ⚠️ `mcpServers` 里没写 `url`、全局 `AIADMIN_MCP_URL` 也没配 ⇒ **那台不挂**
  （不是报错，也不是挂一个空地址）。
