# 技能 / MCP / 插件三层在 dsh 上重新落地 —— 设计文档（spec）

> **状态**：待人 review（issue **#122** 的交付物）· 2026-11-20
>
> ⚠️ **本条只重构「三层怎么挂」**（技能 / MCP / 插件）⇒ **技能正文一字不改**
>    · **业务插件逻辑不重写** · **对外契约一字不改**（前端零改动）。
>
> **上游**：[`2026-11-19-dsh-底座摸底-目标架构-design.md`](./2026-11-19-dsh-底座摸底-目标架构-design.md)
> （§2.3 工具 · §2.6 MCP · §4 三层 · §5.3 工具名归一化）·
> **施工图**：[`../plans/2026-11-19-dsh-底座摸底-目标架构.md`](../plans/2026-11-19-dsh-底座摸底-目标架构.md) §4
> · **交接文档**：[`../../notes/2026-11-20-dsh-技能-MCP-插件.md`](../../notes/2026-11-20-dsh-技能-MCP-插件.md)

---

## 0. 摘要（先看这里）

| 层 | 结论 | 依据 |
| ---- | ---- | ---- |
| **技能** | **成**：我们自己写 loader（**Agent Skills 标准格式**，不是 pi 私有）⇒ 技能资产不绑在 pi 上 | 单测 + 端到端 |
| **MCP** | **成**：走 **dsh 自带的** `@deepseek-ai/dsh-mcp-client`（标准协议）⇒ 不用自己写协议 | 端到端（真 MCP 服务器被模型调用） |
| **插件** | **成**：业务插件**零改动**；只改「挂上去」的方式 ⇒ 注册表机制（`core/plugins.ts` + 依赖注入）原样保住 | `check-core-purity.cjs` 绿 |
| **闸门** | **成**：MCP 的写操作**也要人点头**（`tools/pre-execute` ⇒ `ask` ⇒ 我们的闸门）⇒ 口径不被 MCP 绕过 | 端到端（拒绝 ⇒ 服务端一次都没被叫） |
| **工具名** | **成**：模型侧仍叫 `mcp__<server>__<tool>`（技能正文对得上）；**给人看的**名字归一化成我们的命令名 | 端到端 + 单测 |

⚠️ **本条顺手修了一个真 bug**：`PendingWaiterRegistry` 在「决定先到」时把决定**丢掉**
⇒ 批准永远等成超时（按拒绝处理）⇒ 现在会**记住**提前到的决定。

---

## 1. 三层在 dsh 上的形状

```
┌─ 我们的进程（Express）──────────────────────────────────────────┐
│  core/skills/skill-loader.ts   ← **我们自己的** loader（标准格式）│
│  core/skills/skills.ts         ← 提示词段（XML，一字不改）        │
│  core/skills/skill-tools.ts    ← `load_skill`（按需加载）        │
│  core/mcp/mcp.ts               ← mcpServers（语义不变）⇒ dsh 配置 │
│  core/mcp/tool-names.ts        ← **工具名归一化的唯一出处**        │
│  core/plugins.ts               ← 注册表 + 依赖注入（**不变**）      │
│  src/plugins.ts                ← 唯一 import 业务插件的地方（不变）│
│  src/plugins/pm/**             ← **业务插件（零改动）**             │
└───────────────▲───────────────────────────────────────────────┘
                │ stdio JSON-RPC（dsh 的 sdk 协议）
┌───────────────┴───────────────────────────────────────────────┐
│ dsh 运行时（子进程）                                             │
│  dsh-plugin/（我们自己的 cordis 插件）                            │
│    ① provider（OpenAI 兼容 · 不用 pi-ai）                        │
│    ② 系统提示词段（含技能段）                                     │
│    ③ 我们的命令（走命令桥回我们的进程）                            │
│    ④ **MCP 服务器**（dsh-mcp-client）+ **MCP 的闸门**             │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. 技能层

### 2.1 为什么自己写 loader

`SKILL.md` 是 **Anthropic Agent Skills 标准格式**（frontmatter + 正文）⇒ **可以**自己扫、自己解析。
⇒ 技能资产（`backend/ai/.pi/skills/**`）**不再绑在 pi 上**（拔 pi 是 #123 ⇒ 这条是它的前置）。

| 规则 | 说明 |
| ---- | ---- |
| 发现 | 目录里有 `SKILL.md` ⇒ 它**就是**一个技能（不再往里递归）；否则往子目录里找 |
| 名字 | frontmatter 的 `name`；没有 ⇒ 用**父目录名** |
| 说明 | frontmatter 的 `description`（**必填** ⇒ 没有就不算技能） |
| 隐藏 | `disable-model-invocation: true` ⇒ 不进提示词 |
| 去重 | 同名 ⇒ **先来的赢**（后来的记一条碰撞诊断） |

⚠️ **与 pi 的 loader 口径一致**（`skills.test.ts` 有一条**对照测试**：同一批目录 ⇒ 同一批技能）
⇒ 两个 runner 看到的技能一模一样 ⇒ 切 runner 不会换技能。

### 2.2 技能正文一个字不改

- loader **只读 frontmatter** ⇒ 正文原样留给 `load_skill` 工具；
- `scripts/e2e/dsh-skills-mcp-plugins.static.cjs` 断言三个 `SKILL.md` 都在、frontmatter 完整；
- ⚠️ **技能正文里写的工具名是 `mcp__aiadmin__create_task`** ⇒ **模型侧的工具名不许改**
  （改了技能正文就与模型看到的东西对不上）⇒ 归一化只发生在**给人看的地方**。

### 2.3 `load_skill`（按需加载）

工具照旧（`core/skills/skill-tools.ts`）：只读**技能目录内**的文件（`../` 一律拒绝）、
读不到返回人话而不是抛异常。⇒ **一个字没改逻辑**，只把类型从 pi 的 `Skill` 换成我们自己的 `SkillEntry`。

---

## 3. MCP 层

### 3.1 用 dsh 自带的客户端（不自己写协议）

`@deepseek-ai/dsh-mcp-client`（0.2.2-rc.5，与其它 dsh 包同一条发布线）：

- 标准 MCP 协议（官方 `@modelcontextprotocol/client` 2.2.0）；
- 每个实例连**一台**服务器 ⇒ 工具注册成 `mcp__<serverName>__<toolName>`；
- 我们的插件**程序化调用**它的 `apply(ctx, config)`（**不写 YAML** ⇒ 服务器清单是**运行时算的**
  ⇒ per-用户 token 天然成立 ⇒ spec §4.2 的多用户待解点 D6 不再卡在这一层）。

### 3.2 配置形状（`agent.yaml` 的 `mcpServers` 语义不变）

| 我们的配置 | dsh 的形状 |
| ---------- | ---------- |
| `name` | `serverName`（工具名前缀） |
| `url` | `url`（streamable-http） |
| `type: http \| sse` | `transport: streamable-http`（dsh 只有这一种 HTTP 传输） |
| `exposure: direct` | （无对应 ⇒ 直接给模型看） |
| `exposure: deferred \| codemode` | （无对应 ⇒ 同 direct） |
| `exposure: hidden` | **不挂这台**（模型看不到） |
| 调用方的 token | `headers: { Authorization: "Bearer …" }` |

⚠️ **token 只活在子进程的环境变量里**（`DSH_AI_MCP_SERVERS` = base64 的 JSON）⇒ **不落盘、不进日志**。

### 3.3 工具名归一化（spec §5.3）

| 地方 | 名字 |
| ---- | ---- |
| **模型侧**（工具声明、技能正文） | `mcp__aiadmin__create_task`（**不变**） |
| **界面**（`tool_call` / `tool_result`） | `create_task`（**归一化**） |
| **待确认**（`ai_pending_action.command`） | `create_task`（**归一化**） |
| **审计**（`ai_audit_log.command`） | `create_task`（**归一化**） |

⚠️ **规则只有一处**（`core/mcp/tool-names.ts`）⇒ 四个地方永远一致。
⚠️ **只有 dsh 路径归一化**（pi 路径保持原样 ⇒ 不改现有产品的显示 ⇒ #123 拔 pi 时自然统一）。

### 3.4 MCP 的写操作也要人点头（**口径不被绕过**）

⚠️ **这是本条最容易漏的一条**：MCP 的工具是 **dsh 直接注册**的 ⇒ 不走命令桥 ⇒ 闸门看不见它
⇒ 「修改已有数据要点头」的口径会被**绕过**。

⇒ 办法：dsh 的工具管线有**统一拦截点**（`tools/pre-execute`）⇒ 我们的插件对
「MCP 的写工具」（`update_` / `patch_`）返回 **`ask`** ⇒ dsh 走**审批缝**
（`approval/request`）⇒ **我们的进程**处理（挂待确认 ⇒ 等真人点头 ⇒ 回放行/拒绝）。

⇒ **实测**：拒绝 ⇒ MCP 服务器**一次都没被叫**；批准 ⇒ 真的执行了（端到端脚本里）。

⚠️ spec §9 的 **D4**（「`ask` 在根作用域插件里没触发」）**不适用于我们**：
我们的插件在 **profile 的补丁层**（= agent 作用域）⇒ 实测**触发正常**。

---

## 4. 插件层：**业务插件零改动**

### 4.1 机制原样保住

| 规矩 | 怎么保证 |
| ---- | -------- |
| 内核不 import 插件 | `scripts/check-core-purity.cjs`（第一档）绿 |
| 入口侧是唯一注册处 | `src/plugins.ts`（静态验收脚本断言） |
| 注册表 + 依赖注入 | `core/plugins.ts` 的 `PluginRegistry`（**一个字没改**） |
| 换业务系统不用改内核 | `scripts/check-core-reuse.cjs` 绿 |

### 4.2 迁移清单（**哪个文件改什么**）

**业务插件（`backend/ai/src/plugins/pm/**`）⇒ 一个字没改**（`git diff` 为空）：

| 文件 | 动作 | 说明 |
| ---- | ---- | ---- |
| `src/plugins/pm/index.ts` | **不变** | 命令目录 / 身份 / 上下文 / 探针 / `mcpDefaultUrl` 照旧 |
| `src/plugins/pm/tools/create-task.ts` | **不变** | 命令本体（要库、要 token）⇒ 仍在**我们的进程**里跑 |
| `src/plugins/pm/context/pm-context.ts` | **不变** | 讨论上下文 + 写规则 ⇒ 闸门照旧收窄字段 |
| `src/plugins/pm/adapter/**`、`env.ts`、`health.ts` | **不变** | AiAdmin 适配层（与 dsh 无关） |

**「挂上去」的那一侧（改这些）**：

| 文件 | 动作 | 说明 |
| ---- | ---- | ---- |
| `core/plugins.ts` | **不变** | 注册表 + 依赖注入（原样） |
| `src/plugins.ts` | **不变** | 唯一 import 业务插件的地方（原样） |
| `core/session/runtime.ts` | **改** | ① 插件的命令 ⇒ 工具目录 ⇒ dsh 的工具（#120 已有）；② 插件的 `mcpDefaultUrl` ⇒ **MCP 配置**（本条新增） |
| `core/mcp/mcp.ts` | **改** | mcpServers（配置形状不变）⇒ **dsh 的客户端配置** |
| `core/mcp/tool-names.ts` | **加** | 工具名归一化的唯一出处 |
| `core/adapter/dsh/runner.ts` | **改** | 把 MCP 配置塞进子进程的环境变量（**凭据不落盘**） |
| `core/adapter/dsh/tools.ts` | **改** | 工具目录里的工具名也走同一套归一化规则 |
| `dsh-plugin/src/tools.js` | **不变** | 我们的命令 ⇒ dsh 的工具 ⇒ 命令桥（#120 已有） |
| `dsh-plugin/src/mcp.js` | **加** | ① 挂 MCP 服务器（dsh-mcp-client）② **MCP 的闸门** |
| `dsh-plugin/src/index.js` | **改** | 把上面两件事挂上（`apply` 改成 async） |

⇒ **一句话**：业务插件只提供「能力」（命令 / 上下文 / 探针 / 默认 MCP 地址），
**怎么挂**由内核 + dsh 侧插件决定 ⇒ 换业务系统只改 `src/plugins.ts`。

---

## 5. 边界与不变量（复查用）

| 不变量 | 怎么保证 |
| ------ | -------- |
| **技能正文一字不改** | 静态验收脚本 + `git diff`（`.pi/skills/**` 为空） |
| **模型侧的工具名不变** | 归一化只发生在 SSE / 待确认 / 审计三处 |
| **dsh 的类型不外泄** | `scripts/check-dsh-boundary.cjs`（三档）绿（新增 MCP / 工具管线的类型名） |
| **内核不碰业务** | `scripts/check-core-purity.cjs` 绿 |
| **对外契约一字不改** | `core/routes/contract.ts` **没动**（`git diff` 为空）⇒ 前端零改动 |
| **闸门口径不变** | 「新增放行、修改要点头」⇒ 我们的命令与 **MCP 的工具**都问 |
| **数据模型只加不改** | 本条**没动**数据模型 |

---

## 6. 已知缺口（留给 #123 / #124）

| # | 缺口 | 影响 | 留给 |
| - | ---- | ---- | ---- |
| 1 | **pi 路径的工具名还没归一化**（界面仍显示 `mcp__aiadmin__x`） | 两个 runner 的显示名不同 | #123（拔 pi ⇒ 自然统一） |
| 2 | `exposure: deferred / codemode` 在 dsh 形状里**没有对应** | 只能「直接给模型看」 | #124（管理面） |
| 3 | MCP 的**多用户隔离**仍是「一个会话一个 dsh 进程」 | 会话多了 ⇒ 进程多 | #124（`dsh-mcp-manager`） |
| 4 | e2e 的 MCP 服务器走 **stdio**（生产走 streamable-http） | 传输层没在 e2e 里覆盖（同一个客户端） | — |
| 5 | 官方 DeepSeek 路由（D3）仍未实测 | 与本条无关 | #120 的后续 |
