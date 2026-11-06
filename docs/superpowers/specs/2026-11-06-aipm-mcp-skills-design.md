# 设计：AI 能力扩展改造 —— 从「开发者写命令」到「MCP 工具 + Skills 配方」

> 日期：2026-11-06
> 涉及仓库：`ai-admin-ai`（主要）、`AiAdmin`（后端前置）、`ai-admin-com`（前端，只读展示 + 可选的确认入口）
> 状态：待批准

---

## 1. 意图与为什么

**现状**：AI 服务只有一条命令 `create_task`，而且它写在 TypeScript 里。加一条命令要碰
**8 个文件、4 层翻译**：

```
后端字段名 → wire 类型 → 统一模型 → 统一 key → 命令参数 → 提示词
(aadmin/types)(adapter/model)(adapter/keys)(tools/*)(agent/prompt)
     ↘ 枚举归一(adapter/enums) ↙   ↘ 审计 + 闸门 + 写前快照（每条命令重写一遍）↙
```

⇒ **只有开发者能扩展 AI 的能力**，业务同学想加一条查询/写操作，必须提开发需求。

**要达到的状态**：业务同学写一个 markdown 文件，AI 就会用；后续还能自己继续改。

**为什么不是「再加一层抽象」**：任何自创的声明格式（yaml/md 配置）都不是 pi 的官方扩展点，
pi 升级后会失配，且我们无法从上游获得修复。

**为什么是 MCP + Skills**：

- **MCP** 是 pi 的官方工具来源扩展点（`createMcpExtension()`），工具来自外部服务器，
  pi 不管它们怎么实现 ⇒ **后端怎么演进，AI 侧不用改代码**；
- **Skills** 是 pi 的官方指令扩展点，且实现了
  [Agent Skills 规范](https://agentskills.io/specification)（跨工具通用、可被别的
  Agent 宿主复用）⇒ **业务同学写的就是它**；
- 两者组合起来正好是「用 skill 组合调用 MCP 接口完成任务创建」——本设计最初的目标。

---

## 2. 目标 / 非目标 / 反目标

### 目标

1. **业务同学能新增能力**：写 `skills/<name>/SKILL.md`（markdown + frontmatter），
   零代码、零 TypeScript、零 YAML 语法。
2. **工具来源零维护**：AiAdmin 的接口自动成为模型的工具（后端加接口 ⇒ AI 自动会用）。
3. **升级不炸**：只用 pi 的官方扩展点（MCP / Skills / customTools / extensions），
   不用任何自创的运行时机制。
4. **安全性不退让**：模型碰不到 `.env`、数据库口令、源码；写操作仍然有闸门与审计。
5. **事件流不变**：前端那套 SSE / 回放窗口 / 快照机制一行不改。

### 非目标

- 不做「自然语言自动生成命令」（生成 skill 草案）——**以后**再说，见 §8。
- 不做多租户 / 多 AI 服务的隔离。
- 不改 AiAdmin 的业务逻辑。
- 不追求「一条 skill 覆盖所有场景」——skill 是配方，不是程序。

### 反目标（做成这些就算失败）

- ❌ 让模型能读任意文件（为了读 SKILL.md 而放开 pi 的 `read` 工具）。
- ❌ 把 61 个 MCP 工具全塞进模型的工具声明（选错工具的概率会爆炸）。
- ❌ 用自创的 yaml/DSL 描述命令（pi 升级即失配）。
- ❌ 为了「统一口径」再写一层完整的 adapter（那正是我们要拆掉的东西）。

---

## 3. 约束（已核实的事实）

| 事实 | 出处 |
| ---- | ---- |
| pi 的 MCP 扩展点：`createMcpExtension()`，工具名 `mcp__<server>__<tool>` | `dist/extensions/mcp/index.d.ts` |
| MCP 服务器可由 `pi.registerMcpServer(name, config)` **在运行时注册**（同名再注册会替换） | `dist/core/extensions/types.d.ts:1411` |
| HTTP MCP 支持 `url` + `headers`（静态字符串，支持 `${ENV}` / `!cmd`） | `dist/core/mcp-servers.d.ts:100` |
| MCP 工具的暴露方式：`exposure` = `codemode`(默认) / `deferred` / `direct` / `hidden`，`toolExposure` 可按工具覆盖 | `dist/extensions/mcp/index.d.ts` |
| Skills 走 Agent Skills 规范：`SKILL.md` + frontmatter（`name`/`description` 必填） | `docs/skills.md` |
| ⚠️ **pi 只在模型声明了 `read` 或 `bash` 工具时，才把 skills 段写进系统提示** | `dist/core/system-prompt.js:102` |
| ⚠️ 我们当前 `noTools: "builtin"` ⇒ **没有 `read`/`bash` ⇒ skills 段不会出现** | `src/agent/pi-session.ts` |
| pi 的 `tool_call` 事件可以 `block` 工具执行（⇒「先问人」闸门） | `dist/core/extensions/types.d.ts:1108` |
| 项目级 skills 目录：`.pi/skills/`；也有 `.agents/skills/`（Agent Skills 标准位置） | `docs/configuration.md:35` |
| AiAdmin 后端**已有** `module_mcp`：路由表 → MCP tool，带 tag/method/路径白名单，JWT 透传 | `AiAdmin/backend/app/plugin/module_mcp/server.py`（**未提交的工作区改动**） |
| 线上 AiAdmin 的 `GET /api/v1/openapi.json` 有 334 条路径，其中 61 条是 `pm_*` | 实测 |
| 线上 AiAdmin 的 `/api/v1/mcp` **当前 404**（MCP 模块还没部署） | 实测 |

**因此本设计有一个硬前置依赖：后端的 MCP 服务要先合并部署。**（§7）

---

## 4. 考虑过的方案

| 方案 | 做法 | 为什么不选 / 为什么选 |
| ---- | ---- | ---- |
| **A. yaml 声明式命令** | 一个 yaml 描述命令，通用执行器负责调用/审计/闸门 | ❌ 自创格式，pi 升级失配；且「参数解析」（编码→id、枚举→线上码）仍要代码 |
| **B. 声明式 + OpenAPI 自动取接口** | yaml 里只写字段映射，路径从 OpenAPI 取 | ❌ 仍是自创格式 |
| **C. MCP 工具 + Skills 配方** | 工具来自后端 MCP；skill 是 markdown 配方 | ✅ **选中**：两个都是 pi 官方扩展点；扩展成本降到「写 markdown」 |
| **D. 自然语言生成 skill** | 用户描述诉求，LLM 生成 skill 草案 | ⏳ 以后做（§8），现在没有可信的校验手段 |

**用户已确认**：选 (C)（对应上一轮讨论里的「a」：口径层全部交给后端 + skill，
AI 服务侧不再维护 adapter）。

---

## 5. 架构

```
┌───────────────────────────────────────────────────────────────────┐
│ AiAdmin（FastAPI）                                                  │
│   module_mcp：路由表 → MCP tool                                     │
│     · MCP_INCLUDE_TAGS（默认「任务模块」→ 要扩）                    │
│     · MCP_INCLUDE_METHODS=get,post,put,patch（不含 delete）          │
│     · MCP_EXCLUDE_PATH_SUFFIXES=/export,/import,/download/template  │
│     · headers=["authorization"] ⇒ 调用方的 JWT 原样透传              │
│     · ⚠️ 审计与写前快照要在这里补（见 §6.6）                        │
└───────────────▲───────────────────────────────────────────────────┘
                │ MCP streamable HTTP（POST /api/v1/mcp）
                │ Authorization: Bearer <当前用户JWT>（每次会话/每次刷新）
┌───────────────┴───────────────────────────────────────────────────┐
│ ai-admin-ai（pi agent，Next.js）                                     │
│                                                                      │
│  .pi/skills/<name>/SKILL.md   ← ★ 业务同学写的就是这里（markdown）     │
│                                                                      │
│  src/agent/                                                          │
│    pi-session.ts     建 pi 会话：挂 MCP 扩展 + 自建 skill 注入         │
│    skills.ts         扫描 .pi/skills、解析 frontmatter、拼提示词段      │
│    skill-reader.ts   ★ 受限的技能文件读取工具（只许读 skills 目录）    │
│    mcp.ts            ★ 注册/刷新 AiAdmin MCP 服务器（带当前用户 token） │
│    gate.ts           ★ pi tool_call hook：破坏性操作「先问人」         │
│    runtime.ts        会话/命令/事件流（现有逻辑基本不动）              │
│                                                                      │
│  src/tools/*.ts   逃生舱：复杂写操作（create_task 先留）             │
└───────────────────────────────────────────────────────────────────┘
```

---

## 6. 怎么做（已定部分）

### 6.1 工具来源：AiAdmin 的 MCP

- AI 服务用 SDK 的 `createMcpExtension()`（`DefaultResourceLoader` 的 `extensionFactories`）。
- **不写 `.pi/mcp.json`**：我们的 token 每个用户不同、且会轮换 ⇒ 静态文件表达不了
  ⇒ 用 `pi.registerMcpServer()` 在**建会话时**注册。
  - ⚠️ `registerMcpServer` 是 **extension API** ⇒ 要通过一个
    **inline extension**（`extensionFactories` 里传一个闭包工厂）在 `session_start` 时注册；
    工厂闭包捕获当次会话的 token ⇒ 每个 pi 会话带**自己的**用户 token。
- 服务器配置：

  ```ts
  pi.registerMcpServer('aiadmin', {
    type: 'http',
    url: AIADMIN_MCP_URL,               // 新增环境变量，缺省 `${AIADMIN_BASE_URL}/mcp`
    headers: { Authorization: `Bearer ${token}` },
    exposure: 'direct',                  // 第一版（见下方决定）
  });
  ```

- **工具暴露方式（我的决定 + 切换条件）**：第一版用 `exposure: "direct"` ——
  后端的 tag 白名单先只开「任务模块」（工具数个位数）⇒ 直接进模型工具声明最好用。
  **切换条件**：工具数超过 ~15 个时改成 `"deferred"` + `createToolSearchExtension()`
  （模型用 `searchTools` 按需找），避免选错工具。
- **token 轮换**：调用方每次命令带来的 token 都可能变 ⇒ 每次 `submitCommand` 时
  若 token 与建会话时不同 ⇒ **重建该会话的 pi 会话**（连带重建 MCP 连接）。
  （先验证 `registerMcpServer` 同名替换是否会重建连接；不重建就用重建会话这条退路。）

### 6.2 JWT 透传的边界

- MCP 工具调用**带着用户的 JWT** ⇒ 后端 `AuthPermission` 的权限码校验原样生效
  ⇒ **用户在 AiAdmin 的权限 = AI 能替他做的范围**（与现有设计一致）。
- ⚠️ 后端的 MCP 路由白名单里有 `post,put,patch` ⇒ **AI 能改数据**。
  ⇒ 「哪些工具是破坏性的」必须在**我们这侧**再拦一道（§6.5）。

### 6.3 Skills：格式、位置、加载

**位置**：`ai-admin-ai/.pi/skills/<name>/SKILL.md`（pi 官方项目级位置；
也可以用 `.agents/skills/` 以兼容别的 Agent 宿主）。

**格式**（Agent Skills 规范，pi 原生支持）：

```markdown
---
name: create-task
description: 在 AiAdmin 里建任务。用户说「建个任务」「加一条 XX 任务」时用。
---

# 建任务

1. 先用 `mcp__aiadmin__list_projects` 按 code 找项目 …
2. 再用 `mcp__aiadmin__create_task` 建任务 …
3. 告诉用户任务 key（`task:321`）与标题。
```

**加载：用 pi 官方的扫描器，提示词我们自己拼。**

理由（§3）：pi 只在模型有 `read`/`bash` 时才注入 skills 段，而我们需要的是
「模型能读到 skill 文件但读不到别的文件」。

做法：

1. `src/agent/skills.ts`：用 **pi 官方的 `loadSkillsFromDir({ dir, source })`** 扫描
   `.pi/skills/`，拿到 `Skill[]`（含 `name` / `description` / `filePath` / `baseDir` /
   `disableModelInvocation`）与 `diagnostics`。
   - ⚠️ **不自己写 frontmatter 解析**：官方 loader 已经有格式校验与诊断
     （缺 `description` 的不加载、命名冲突保留第一个并告警…）⇒ 自己写只会漂移。
2. 拼进我们自己的 `systemPrompt`（`PM_AGENT_PROMPT` 后面加一段）。

   格式照 Agent Skills 规范的 XML（与 pi 的 `formatSkillsForPrompt` 一致），
   但**措辞自己写**（官方那个只会说「用 read/bash 工具加载」，而我们没有那两个工具）：

   ```xml
   <available_skills>
     <skill><name>create-task</name><description>…</description><location>…</location></skill>
   </available_skills>
   Use the load_skill tool to load a skill's file when the task matches its description.
   ```

   ⇒ **不调用** `formatSkillsForPrompt`：它的 `fileReadTool` 参数只会产出
   「用 read 工具 / 用 bash / 笼统的一句」三种措辞，没有「用 load_skill」这一档。
3. 注册自定义工具 `load_skill(name)`：读 `.pi/skills/<name>/SKILL.md` 全文返回。
   - **路径白名单**：解析后的绝对路径必须落在 skills 根目录内，否则拒绝
     （防 `../` 穿越）。
   - 大小上限（比如 64 KB）。
   - 这是 pi 官方 customTools 形态，不失配。

**为什么不用 pi 的 `.pi/SYSTEM.md` / `APPEND_SYSTEM.md`**：那是**静态**的，
技能增删要改文件 + 重启；我们希望「加一个目录 ⇒ 重启后自动出现在提示里」。

**「改完就生效」**：pi 有 `/reload`（TUI 内）。我们是服务端 ⇒ 提供一个
`POST /api/agent/skills/reload`（或重启进程）——**第一版先做「重启生效」**，
第二版做热加载（重新扫描 + 重建 pi 会话）。

### 6.4 技能的「可组合」

skill 是**指令**，不是程序。模型读到 skill 后按其中的步骤**依次调用 MCP 工具**
（例如：先 `list_projects` 拿项目 id → 再 `create_task` 建任务）。
这正是 pi 的原生模型（skill = 教模型怎么组合工具）。

⇒ 「复合命令」（先查后写）**不需要新机制**，skill 里写步骤即可。

### 6.5 破坏性操作「先问人」：**新增放行，修改要人点头**（用户已定）

**口径**（2026-11-06 用户定）：

| 操作 | 处理 |
| ---- | ---- |
| **新增**（create / 建任务） | 直接执行，不问 |
| **修改**（update / 改状态 / 改字段） | **拦下来，等人点头** |

⚠️ 后端 MCP 的 method 白名单是 `get,post,put,patch`（**不含 delete**）⇒
删除不会变成工具 ⇒ 第一版要拦的只有「改已有数据」这一类。

**机制**（pi 官方 hook）：

1. `pi.on("tool_call", handler)` —— 命中「修改类工具」⇒
   - 把 `(conversationId, toolName, args, userId)` 写进 **`ai_pending_action`**
     （表已经在了：`command` = 工具名、`args` = 工具参数、`preview` = 给人看的摘要、
     `status=PENDING`、`expiresAt`）；
   - 返回 `{block: true, reason: '这个操作需要人工确认'}` ⇒ pi 不执行它。
2. 通过 SSE 推一个 `pending` 事件 ⇒ 前端现有的「待确认」页签就能看到
   （`GET /api/pending` 已经能读）。
3. 用户点「同意」⇒ 新增端点 `POST /api/agent/pending/:id/approve`（与 `/reject`）⇒
   AI 服务用**当前用户的 token** 执行那个工具 ⇒ 把结果**注回会话** ⇒ 模型继续。
4. 「谁批准的」记在 `ai_pending_action.resolvedBy`（审计）。

⚠️ **「注回会话」的机制需要验证**（§9）：
- 候选 A：执行后用 `session.prompt('[系统] 用户已批准并执行了…')` 把结果当一轮新输入
  ⇒ 模型能接着说，但会把系统消息当用户输入；
- 候选 B：用 pi 的 `followUp()` / `steer()` 插进当前轮；
- 候选 C：`session.agent.state.messages` 追加一条（**文档说赋值不替换持久化上下文，
  追加是否有效需验**）。
⇒ 实现时先验 A，最差也能用 A（能用就行，模型能理解）。

⚠️ **前端还缺「同意/拒绝」入口**（现在 `GET /api/pending` 是只读的）⇒
这是阶段 3 的一部分（前端 + 后端端点）。

### 6.6 审计与写前快照：归后端

- MCP 工具调用**不进我们的 adapter** ⇒ 我们的 `audit.ts` / 写前快照**对 MCP 工具无效**。
- ⇒ **后端 MCP 层必须补**：tool 调用时写 `ai_audit_log`（含 before/after）。
  （后端已经有 `ai_audit_log` 表的 schema，在 AiAdmin 仓还是 ai-admin-ai 仓要确认。）
- **过渡期**：现有 `create_task`（代码工具）继续走我们的审计 ⇒ 两条路并存，
  审计记录会标明来源（`args.source = 'tool' | 'mcp'`）。
- ⚠️ 这是**本设计对后端的硬要求**，在 §7 的风险里。

### 6.7 事件流 / SSE：一行不改

SSE 的 8 种事件、快照、回放窗口、`agent_settled` 都不动。
⚠️ **一个要注意的点**：pi 的 MCP 工具调用会产生 `tool_call` / `tool_result` 事件
⇒ 我们现有的 `event-mapper.ts` 会把它们映射成 SSE 的 `tool_call` / `tool_result`
⇒ **前端不用改就能看到 MCP 工具的执行卡片** ✓（要核对 payload 形状是否对得上）。

### 6.8 现有代码的退休路线

| 现在 | 之后 | 时机 |
| ---- | ---- | ---- |
| `src/adapter/*`（enums/model/keys/datasource/capabilities） | **退休** | 后端 MCP 覆盖对应能力之后 |
| `src/tools/create-task.ts` | 先留（逃生舱），后迁成 skill | 后端 `create_task` MCP 工具可用 + 审计到位之后 |
| `src/audit.ts` | 只服务代码工具；MCP 工具的审计在后端 | 随代码工具退休 |
| `src/agent/prompt.ts` | 追加 skills 段；能力清单改为「MCP 工具 + skills」 | 第一阶段 |

---

## 7. 风险与前置依赖

| # | 风险 / 依赖 | 影响 | 应对 |
| - | ----------- | ---- | ---- |
| 1 | **后端 MCP 未部署**（线上 `/api/v1/mcp` 404） | **整条路径不可用** | ⚠️ **用户负责部署**（2026-11-06 确认）⇒ 阶段 1 之前必须有；**不阻塞**阶段 2（skill 部分可用现有代码工具当底座先跑通） |
| 2 | 后端 MCP 默认只暴露「任务模块」 | 里程碑/项目/风险没有工具 | 扩 `MCP_INCLUDE_TAGS`（配置项，不用改代码） |
| 3 | 61 个工具全 `direct` ⇒ 模型选错 | 体验差、误调用 | 用 `"exposure": "deferred"` + `createToolSearchExtension()`；或按 tag 拆多个 server |
| 4 | 后端 MCP 未做审计 | AI 的写操作没有审计 | 后端补（§6.6）；过渡期保留代码工具 |
| 5 | pi `registerMcpServer` 同名替换后连接是否重建 | token 轮换时可能用旧 token | 先验证；退路是 token 变了就重建 pi 会话 |
| 6 | `load_skill` 是我们自己写的工具 | 路径穿越风险 | 绝对路径白名单 + 大小上限 |
| 7 | skill 写错 ⇒ 模型照做 | 业务风险 | skill 走 git 评审；前端可显示「当前可用技能」清单 |

---

## 8. 阶段与验收

### 阶段 0（后端，**用户负责**，2026-11-06 确认）
- 合并部署 `module_mcp`；**tag 白名单 = 任务模块**（用户定）；
  补 tool 调用的审计。
- **验收**：`GET /api/v1/mcp` 能列出任务模块的工具；带用户 JWT 调用 `create_task` 工具成功。

### 阶段 1（AI 服务：接上 MCP）
- `pi-session.ts` 挂 MCP 扩展；`mcp.ts` 注册 AiAdmin server（带 token）。
- **验收**：模型能看到并调用 `mcp__aiadmin__*` 工具；SSE 里出现工具执行卡片；
  用户 JWT 生效（用受限账号调用被拒）。

### 阶段 2（AI 服务：接上 Skills）
- `skills.ts` 用 `loadSkillsFromDir` 扫描 + 注入提示词段；
  `skill-reader.ts` 受限的 `load_skill` 工具；
  **我们代写 3 个样板 skill**（用户定）：
  `create-task`（新增）/ `list-tasks`（读）/ `list-projects`（读）。
- **验收**：**不改任何 TS 代码**，只加一个 `.pi/skills/xxx/SKILL.md`，
  模型就能用它完成对应的事。

### 阶段 3（AI 服务 + 前端：待确认闭环）
- `tool_call` hook：修改类工具 ⇒ 挂起 + `ai_pending_action` + SSE `pending` 事件；
  `POST /api/agent/pending/:id/approve|reject`；前端「待确认」页签加同意/拒绝按钮；
  再加一个 `update-task` 样板 skill 来验证。
- **验收**：模型要改任务 ⇒ 界面出现待确认 ⇒ 用户点同意 ⇒ 工具真的执行 ⇒ 模型接着说。

### 阶段 4（可选：退休）
- 退休 `src/adapter/*` 与代码工具（`create_task`），把审计完全交给后端。

### 终局验收（这条最重要）

> **一个不写 TypeScript 的业务同学，在 `.pi/skills/` 下加一个 markdown 文件，
> 重启服务，AI 就会用这个新能力；pi 升级不需要我们改任何代码。**

---

## 9. 我的决定与待确认

### 我已经替你定的（可反悔，但有理由）

| 决定 | 理由 |
| ---- | ---- |
| 用 pi 官方的 `loadSkillsFromDir` 扫描技能目录，不自己写 frontmatter 解析 | 官方 loader 已有校验与诊断；自己写会漂移 |
| 提示词段自己拼，不用 `formatSkillsForPrompt` | 它的措辞只有 read/bash 两档，我们用的是 `load_skill` |
| MCP 用 `registerMcpServer` 运行时注册，不写 `.pi/mcp.json` | 静态文件表达不了「每个用户不同的 token」 |
| 新增环境变量 `AIADMIN_MCP_URL`（缺省 `${AIADMIN_BASE_URL}/mcp`） | 本地后端端口与线上不同，要能单独配 |
| 第一版 `exposure: "direct"`，工具数 > 15 就切 `"deferred"` + tool_search | tag 白名单只开任务模块（工具数个位数）⇒ direct 最好用 |
| skill 生效方式第一版是「重启」 | 热加载需要重建所有 pi 会话，收益低；后面再说 |
| **修改类工具一律挂起等人点头**（用户定） | 已写进 §6.5；「新增」不拦 |
| **MCP tag 白名单 = 任务模块**（用户定） | 先小范围验证整条链路 |
| **第一批 3 个样板 skill 由我们代写**（用户定） | 当业务同学的模板 |

### 需要你回答的（已答完，2026-11-06）

1. ~~后端 MCP 谁在做、何时能部署？~~ → **用户自己部署，完成后通知**。
2. ~~MCP 的 tag 白名单开多大？~~ → **任务模块**。
3. ~~哪些操作要「先问人」？~~ → **新增放行，修改要点头**。
4. ~~第一批参考 skill 谁写？~~ → **我们写 3 个样板**。

### 还需要验证的三件事（实现阶段的头半天）

1. `registerMcpServer` 同名再注册后，**连接**是否重建（决定 token 轮换的实现方式）；
2. inline extension（`extensionFactories` 里的闭包工厂）在 `session_start` 注册
   MCP server 后，**每个 pi 会话能带不同的 token**；
3. 「挂起 → 批准 → 执行 → 注回会话」的**注回方式**（§6.5 的候选 A/B/C）。

- 精确的 SDK 用法与文件落点见 §6；实现时以 `node_modules/@earendil-works/pi-coding-agent/dist`
  的类型声明为准（本文引用的行号会漂移）。
- 要先做的三个验证（各 30 分钟内可完成）：
  1. `registerMcpServer` 同名再注册后，**连接**是否重建（决定 token 轮换的实现方式）；
  2. `createMcpExtension()` + `exposure: "deferred"` 下，模型能否通过 `tool_search` 找到工具；
  3. 用 inline extension（`extensionFactories` 里的闭包工厂）在 `session_start` 注册
     MCP server，确认每个 pi 会话能带**不同的** token。
- 未决但可先按默认推进：skill 热加载（第一版重启生效）、前端技能清单的接口形状。
- 明确不做：自然语言生成 skill、命令 DSL、多 AI 服务。
