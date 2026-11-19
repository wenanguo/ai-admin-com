# dsh 底座摸底 + 目标架构 —— 设计文档（spec）

> **状态**：待人 review（issue **#119** 的交付物）· 2026-11-19
>
> ⚠️ **本条只出文档 + 尖峰，不动生产代码**（issue 的「不做」栏）。
> 本文档通过 review 之后，才允许开始 #120（骨架换 dsh）。
>
> **尖峰证据**：`backend/ai/spike/dsh/`（可复跑的玩具任务 + 日志）
> **版本锁**：`backend/ai/spike/dsh/dsh-versions.lock.json`
> **交接文档**：`docs/notes/2026-11-19-dsh-底座摸底.md`

---

## 0. 摘要（先看这里）

| 问题 | 结论 | 依据 |
| ---- | ---- | ---- |
| dsh 能不能接？ | **能**，而且是**同构**的（子进程 + stdio JSON-RPC = 我们今天用 pi 的形状） | spike 实跑通 |
| 模型 | **成**：官方路由 `deepseek-official` + 模型 id 直通 | 源码 + spike |
| MiniMax | **成，且几乎零工作量**（dsh 自带 `dsh-llm-pi-ai` 适配器）；自己写 provider ≈ 1.5–3 人日 | 源码 |
| 工具 | **成**，但我们的 **typebox schema 要转**成 dsh 的 JSON-Schema 风格 DSL（~80 行） | spike 实挂上并被模型调用 |
| 事件 / 流式 | **契约能保住**（事件名/载荷不变 ⇒ 前端零改动），但**逐 token 实时会退化成"成批到达"** | spike 实测事件序列 |
| 审批（闸门） | **成**：dsh 的一问一答审批缝（`approval/request` ⇒ `allowed-once / rejected / cancelled`，没人应答 ⇒ fail closed） | spike 实跑通两种结果 |
| MCP | **成**（没有 `@deepseek-ai/dsh-mcp` 这个名字，但有 `dsh-mcp-client` / `-manager` / `-resources`） | spike 实挂 MCP server 并被调用 |
| 存储 | **形状不同**：dsh 是**追加式事件日志**，我们是**关系型行** ⇒ 需要决策（见 §2.7） | 源码 |
| 子代理 | **成**：`dsh-subagent` + `dsh-subagent-dsh-sdk`（每个委派任务一个独立 dsh 子进程）= 今天 `dispatch.cjs` 起 `pi-launcher.js` 的同构替代 | 源码 |

**目标架构（推荐）**：**dsh 以「子进程 + stdio JSON-RPC」的方式挂在我们的服务旁边**，
我们只新增一个**适配层**（`core/adapter/dsh/**`），其余 `core/**` 一行不改语义 ⇒ **前端零改动**。

**⚠️ 三个要人拍板的未决问题**（§9）：D1 流式退化 · D2 abort 端点没有协议对应 · D3 官方 DeepSeek 路由未实测。

---

## 1. 摸底方法（证据从哪来）

### 1.1 尖峰：真跑一遍

`backend/ai/spike/dsh/scripts/01-toy-task.mjs` 会：

1. 起一个 **dsh 运行时子进程**（`@deepseek-ai/dsh-sdk-client` ⇒ `dsh --profile sdk`，stdio JSON-RPC）；
2. 跑五个阶段：模型 → **我们自己的工具** → **MCP 工具** → **闸门（允许 / 拒绝）** → 事件序列；
3. 把结果写进 `out/spike-log.json`。

实测（2026-11-19，全绿）：

| 阶段 | 实测输出 |
| ---- | -------- |
| 模型 | `final: 2。` |
| 我们的工具 | `tool calls: toy_echo` → `TOY-ECHO:hello-dsh` |
| MCP | `tool calls: mcp__toy__toy_echo` → `MCP-TOY-ECHO:hello-mcp` |
| 闸门（允许） | `approval requests: 1 {"toolName":"toy_echo",...}` → `TOY-ECHO:MUTATE-task-42` |
| 闸门（拒绝） | `approval requests: 1` → `REJECTED:rejected` |
| 事件 | `agent/inbox/spliced → turn/start → … → assistant/message → tool/call → approval/asked → approval/decided → tool/result → step/end → turn/end` |

### 1.2 读源码

dsh 的官方仓 `deepseek-ai/deepseek-harness`（MIT · TypeScript · Cordis），
本次摸底基于 **master @ 2026-11-18（版本 0.2.2-rc.5）**，重点读了：

- `packages/sdk/client`（TS SDK · 子进程 + JSON-RPC）
- `packages/sdk/protocol`（线协议：请求/结果/通知）
- `packages/core/tools`（工具注册表 · `defineTool` · schema DSL）
- `packages/llm/*`（provider-neutral seam · DeepSeek 路由 · pi-ai 适配器）
- `packages/mcp/*`（MCP 客户端 / 管理器 / 资源）
- `packages/interaction/user-approval`（一问一答审批缝）
- `packages/session/session-persistence*`（会话持久化）
- `packages/subagent/*`（委派）

---

## 2. 八问逐条结论

### 2.1 模型：DeepSeek 模型怎么接？`AI_MODEL` 形如什么？

**结论：成。**

- **官方路由**：`@deepseek-ai/dsh-llm-deepseek-api-key` ⇒ 路由名 **`deepseek-official`**。
  - `baseURL` 默认 `https://api.deepseek.com/anthropic`（可用 `$DEEPSEEK_BASE_URL` 覆盖 ⇒ **也能指到兼容网关**）。
  - `apiKeyEnv` 默认 `DEEPSEEK_API_KEY`（**按请求解析** ⇒ 凭据不进配置文件）。
  - **模型 id 直接透传** ⇒ 新模型不用注册。
  - 无 key 时用内置清单（`deepseek-flash` / `deepseek-v4-pro`，上下文 1,048,576）。
- **我们的 `AI_MODEL` 形状**：今天是 `minimax-cn/MiniMax-M3.1-Flash`（`provider/model`）⇒
  dsh 形状不变，只是 provider 段变成**路由名**：

  ```
  AI_MODEL=deepseek-official/deepseek-v4-flash
  ```

- **实测**：spike 用 `dsh-llm-pi-ai` 适配器把 provider 路由 `spike-gw` 指向一个 OpenAI 兼容网关上的
  `deepseek-v4-flash` ⇒ 真模型真回复（见 §1.1）。
- ⚠️ **官方路由本身未实测**（我们没有官方 key）⇒ 见 §9 的 D3。

### 2.2 MiniMax：自己写一个 provider 要多少工作量？

**结论：成，而且**几乎不用写**（有现成适配器）。**

- **`@deepseek-ai/dsh-llm-pi-ai`** = dsh 官方发布的「pi-ai 支撑的多 provider 适配器」：
  把模型请求路由到 pi-ai 的 provider 目录 / OpenAI 兼容网关 / 自建服务。
  挂上它 + 写一条路由配置（≈ 10 行 YAML）就有 MiniMax：

  ```yaml
  - id: llm-pi-ai
    name: '@deepseek-ai/dsh-llm-pi-ai'
    config:
      providers:
        minimax-cn:
          apiKeyEnv: MINIMAX_CN_API_KEY   # 不写则走 pi-ai 的凭据发现
  ```

- **若坚持「一点都不碰 pi 系」**（自己写 provider）：`dsh-llm` 是 provider-neutral 的缝
  （`ctx.llm.stream()` + `StreamChunk` 协议 + `Message`/`ContentBlock` 词汇），一个 provider 适配器要做：

  | # | 要做的事 | 估计 |
  | - | -------- | ---- |
  | 1 | 请求装配（system / messages / tools / maxTokens / 思考） | 0.5 人日 |
  | 2 | 流式响应 → `StreamChunk`（text / reasoning / tool-call / usage / finish） | 0.5–1 人日 |
  | 3 | 工具调用的参数分片拼接 | 0.25 人日 |
  | 4 | 认证（apiKeyEnv / 凭据缝） | 0.25 人日 |
  | 5 | 重试 / 超时 / 错误映射（`LlmFailure`） | 0.5 人日 |
  | 6 | 模型目录（id / 上下文窗口 / 能力声明）+ 单测 | 0.5 人日 |

  ⇒ **合计 ≈ 1.5–3 人日**（MiniMax 是 OpenAI 兼容 ⇒ 可用 `@ai-sdk/openai-compatible` 或裸 fetch 起步），
  **且维护成本随 dsh 每次 API 变动而变**（RC 阶段尤其贵）。
- ⚠️ **D5**：dsh-llm-pi-ai 依赖的是 **`pi-ai`**（不是 `pi-coding-agent`）⇒
  「拔掉 pi」那条（#123）要明确：**用 pi-ai 适配器算不算「还留着 pi」**？本 spec 的建议是：
  **先用 pi-ai 适配器（省 2 人日），把它记为临时方案**；等 DeepSeek 官方路由稳定后再决定是否自写。

### 2.3 工具：我们的工具（typebox schema）怎么挂进 dsh 的 tool registry？

**结论：成，但 schema 要转一层。**

- **挂法**（实测）：写一个 **cordis 插件**，`ctx.tools.register(defineTool({...}))`：

  ```ts
  export const inject = ['tools']
  export function apply(ctx: Context) {
    ctx.tools.register(defineTool({
      name: 'toy_echo',
      description: '…',
      parameters: { text: { type: 'string', required: true, description: '…' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { echo: { type: 'string', required: true } } },
                render: (args, value) => [{ type: 'text', text: value.echo }] },
      execute: async (args, exec) => ({ echo: `TOY-ECHO:${args.text}` }),
    }))
  }
  ```

  插件要被 dsh 的 profile 认出来 ⇒ 它得是 **profile 能解析到的包**
  （我们把玩具工具 `pnpm add file:<路径>` 进了 profile；生产上则是我们自己的 npm 包）。

- **schema 的坑**：dsh 的参数 schema 是**它自己的 JSON-Schema 风格 DSL**
  （`{ type: 'string', required: true }` / `additionalProperties` / `items` / `oneOf` …），
  **不是 typebox** ⇒ 我们 `core/tools/types.ts`（typebox）**不能直接塞进去**。
  ⇒ 需要一个 **typebox → dsh schema 的转换层**（≈ 80 行 + 单测；typebox 的 `Type` 树 → dsh 的 `ValueSchemaSpec`）。
- **我们工具的三类**：
  | 我们的工具 | 现在在哪 | 在 dsh 里的落法 |
  | ---------- | -------- | -------------- |
  | AiAdmin MCP 来的 | `core/mcp/mcp.ts` | 走 **dsh-mcp-client**（§4） |
  | 本地命令（`create_task` 等） | `core/tools/index.ts` + `plugins/pm/tools/` | cordis 插件 + `defineTool`（工具名要**归一化**，见 §5.3） |
  | 技能工具 | `core/skills/skill-tools.ts` | dsh 有 `dsh-tool-skill`；我们的 `load_skill` 语义要对齐（#122） |
- ⚠️ **未实测**：`tools/pre-execute` 的 `ask` 决策（工具管线的**统一**拦截点）在**根作用域插件**里实测**没触发**。
  ⇒ 闸门先按「**工具自己问**」设计（= 我们今天的口径：命令自己判断要不要人点头），统一拦截点留待验证（§9 D4）。

### 2.4 事件与流式：我们的 SSE 契约能保住吗？

**结论：契约能保住（前端零改动）；但「逐 token 实时」会退化成「成批到达」。**

- dsh 的**持久事件词汇**（≈ 60 种）里有我们要的那几个：
  `assistant/message`（内含模型流）、`tool/call`、`tool/result`、`approval/asked`、`approval/decided`、
  `step/end`、`turn/end`、`request/header`、`session/status`。
- **增量文本在哪**：`assistant/message` 事件的 `stream` 数组里有 `text-chunks`
  （`texts: ["开始","，","我","来",…]` + `dt` 时间差）⇒ 我们可以把增量拆成多条 `text_delta`。
- **但事件本身是「step 结束」时才落**：实测一次 12.6 秒的请求里，`assistant/message` 在最后一次性到达
  ⇒ **走 stdio SDK ⇒ 前端的 `text_delta` 是成批到达，不是逐 token**。
- **逐 token 的通道 `agent/assistant-stream` 是进程内事件**（不落 durable log，SDK 协议也不转发）
  ⇒ **只有「进程内嵌入」才有真·逐 token**。
- 映射表见 §5.2；取舍见 §9 **D1**。

### 2.5 审批（闸门）：approve/reject 挂在 dsh 的哪个点上？

**结论：成，且接缝非常清楚。**

- dsh 的审批是**一问一答**的（`@deepseek-ai/dsh-user-approval`）：
  - 运行时发 **`approval/request`**（SDK 协议里是 runtime → 客户端的 **JSON-RPC 请求**）；
  - 客户端回 **`{ outcome: 'allowed-once' | 'rejected' | 'cancelled' }`**；
  - **没有回答者 ⇒ `unavailable` ⇒ fail closed**（跟我们的口径一致）；
  - `allowed-once` **只对这一次调用生效**（不是「永久放行」）。
- **客户端怎么接**（实测）：

  ```ts
  const harness = new DeepSeekHarness({ /* … */, approvalRequests: true })
  harness.client.start()
  harness.client.onRequest(async (method, params) => {
    // method === 'approval/request'
    return { outcome: 'allowed-once' }   // 或 'rejected' / 'cancelled'
  })
  ```

- **我们的闸门怎么落**（推荐）：**适配层收到 `approval/request` ⇒ 写一条 `ai_pending_action`
  ⇒ 回 `pending` SSE 事件 ⇒ 等人（复用现有 `core/gate/pending-waiters.ts`）⇒ 回 outcome**。
  ⇒ **我们自己的 pending id 就是前端批准/拒绝时用的 id**（不需要 dsh 的 approval id）。
- **审计**：`approval/asked` / `approval/decided` 是 dsh 的**持久事件** ⇒ 我们的 `ai_audit_log` 可以从它们投影
  （不必自己再记一遍；#121 处理）。
- ⚠️ 注意：`approval/request` 的载荷里**没有工具参数**（只有 `sessionId` / `toolName` / `callId?` / `reason?`）
  ⇒ 我们的 `pending` 事件要带参数 ⇒ 用 `callId` 关联 `tool/call` 事件。

### 2.6 MCP：怎么挂？（npm 上没有 `@deepseek-ai/dsh-mcp`）

**结论：成。名字不是 `dsh-mcp`，而是 `dsh-mcp-client` / `dsh-mcp-manager` / `dsh-mcp-resources`。**

- 实测：`@deepseek-ai/dsh-mcp-client` 挂一个**标准 stdio MCP server**（玩具 MCP server，一个工具）
  ⇒ 模型真的调用了 `mcp__toy__toy_echo` ⇒ 返回 `MCP-TOY-ECHO:hello-mcp`。
- 完整方案与兜底见 **§4（专章）**。

### 2.7 存储：`dsh-storage` 还是我们自己的库？和 `ai_conversation` 怎么共存？

**结论：形状不同 ⇒ 建议「两边都要，但各管各的」。**

| | dsh | 我们 |
| - | --- | --- |
| 形状 | **追加式事件日志**（`session-persistence`：每个会话一个 `.jsonl.zstd`；也有 sqlite 后端） | **关系型行**（`ai_conversation` / `ai_message` / `ai_pending_action` / `ai_audit_log`，MySQL） |
| 谁要 | 运行细节（工具轨迹、审批、压缩、流） | **产品事实**（会话列表、消息、待确认、审计） |

- **`dsh-storage` 家族**（`storage-json` / `storage-sqlite` / `storage-domain`）是给
  **非会话的应用数据**用的（工作区记录、sidecar）⇒ **不是** `ai_*` 表的替代品。
- **建议**（#121 落地）：
  1. **产品事实源仍在我们自己的表**（前端要的就是这个形状）⇒ `ai_conversation` / `ai_message` 继续存在；
  2. dsh 的会话日志当**执行痕迹**（落在 `dshHome` 下，或实现一个 MySQL 持久化后端）；
  3. 会话 id 映射：`ai_conversation.dsh_session_id`（新增列）↔ dsh session id。
- ⚠️ `@deepseek-ai/dsh-session-persistence-sqlite` **没有 0.2.2-rc.5**（还在 0.0.1-rc.1 线）⇒ 本轮只走 JSONL。

### 2.8 子代理：能替代 `dispatch.cjs` 现在 spawn 的 `pi-launcher.js` 吗？

**结论：成，而且形状几乎一样。**

- dsh 的委派：`@deepseek-ai/dsh-subagent`（委派缝）+ 三种后端：
  | 后端 | 形状 |
  | ---- | ---- |
  | `dsh-subagent-spawn-in-process` | 子代理在**同一进程**里跑（有自己的持久会话） |
  | `dsh-subagent-fork-in-process` | 同上 + 分叉 |
  | **`dsh-subagent-dsh-sdk`** | **每个委派任务起一个独立的 dsh 子进程**（自己的 profile / 会话 / 模型路由 / 工具；中间消息留在子进程里，父只拿到最终答复） |
- **我们的 `dispatch.cjs` 今天做的事**（起一个 `pi-launcher.js` 子进程跑一个任务、拿结果）
  ⇒ **`dsh-subagent-dsh-sdk` 是同构替代**。
- SDK 侧还有 `subagent.started` / `subagent.finished` 通知 ⇒ PM 派活可以改成
  「父会话里调 subagent 工具」（更贴近 dsh 的用法），也可以继续「我们自己编排进程」（改动更小）。
- ⇒ 建议：**#123（拔 pi + 派活脱离 pi）**里先把派活改成 dsh 子代理，**保留我们自己的编排外壳**
  （审计、状态回写仍在我们这边）。

---

## 3. 目标架构

### 3.1 dsh 在我们进程里的位置：**子进程 + stdio JSON-RPC**（推荐）

```
┌─ frontend（零改动） ──────────────────────────────────────────────┐
│   HTTP + SSE：9 个端点，事件名/载荷一字不动（见 §5）              │
└───────────────▲──────────────────────────────────────────────────┘
                │ /api/agent/*  /api/pending  /api/audit
┌───────────────┴──────────────────────────────────────────────────┐
│ backend/ai（Express）                                            │
│                                                                  │
│  core/routes/**   ← 对外契约（留）                                │
│  core/gate/**     ← 闸门：pending 表 + 等人（留）+ dsh 审批接线（改）│
│  core/audit/**    ← 审计（留）                                    │
│  core/store/**    ← ai_* 表（留）                                │
│  core/skills/**   ← 提示词拼装（留）/ 技能目录（改）               │
│  core/tools/**    ← 命令定义（留）/ typebox→dsh schema（改）       │
│  core/plugins.ts  ← 插件契约（留）                                │
│                                                                  │
│  ★ core/adapter/dsh/**   ← 唯一允许出现 dsh 的地方               │
│      client.ts    （stdio JSON-RPC 客户端 / 进程生命周期）         │
│      protocol.ts  （线协议常量：我们自己写的 TS 类型）             │
│      events.ts    （dsh 事件 → 我们的 SSE 事件）                  │
│      approvals.ts （approval/request → 我们的闸门）               │
│      tools.ts     （工具注册 + 工具名归一化）                     │
│      mcp.ts       （MCP server 配置生成）                        │
│                                                                  │
└───────────────▲──────────────────────────────────────────────────┘
                │ stdio：换行分隔的 JSON-RPC（dsh 的 sdk 协议）
┌───────────────┴──────────────────────────────────────────────────┐
│ dsh 运行时（子进程）                                              │
│   profile = 我们的 profile（cordis.patch.yml：LLM 路由 / 工具 /  │
│   MCP / 审批 / 技能）                                            │
│   一个进程承载多个会话（conversationId ↔ dsh sessionId）          │
└──────────────────────────────────────────────────────────────────┘
```

**为什么选子进程**（而不是进程内嵌入）：

| 维度 | 子进程 + JSON-RPC ✅ | 进程内嵌入（dsh-base 装进我们的进程） |
| ---- | -------------------- | ------------------------------------ |
| 类型外泄 | **零**（只认协议字符串） | 高（cordis + dsh 的 TS 类型进我们的进程） |
| 故障隔离 | **dsh 崩了不影响我们的服务**（RC 阶段很关键） | 无隔离 |
| 升级影响面 | 换子进程即可 | 升级 dsh = 升级我们的运行时 |
| 逐 token 流式 | ✗（成批） | ✓ |
| 调试 | 进程边界清楚（stderr 独立） | 混在一个进程里 |
| 部署 | 容器里多一个可执行文件 | 多一堆 npm 依赖 |

⇒ **推荐子进程**；若人认为「逐 token」不可接受（§9 **D1**），再评估进程内嵌入
（那时 dsh 的类型外泄要用 §7 的边界设计硬压住）。

### 3.2 生命周期

1. **启动**：AI 服务起来 ⇒ 适配层 **lazy** spawn 一个 dsh 进程（`dsh --profile <我们的 profile>`），
   做 `initialize` 握手（带 provider / model / cwd / `approvalRequests: true`）。
2. **会话**：`POST /api/agent/conversations` ⇒ 在 dsh 里开一个 session ⇒ 把 dsh sessionId 记进
   `ai_conversation`（#121 加列）。
3. **命令**：`POST /api/agent/conv-1/command` ⇒ `session/prompt` ⇒ 订阅 `session.event` 通知 ⇒
   映射成我们的 SSE 事件。
4. **审批**：`approval/request` ⇒ 写 `ai_pending_action` ⇒ `pending` 事件 ⇒ 等人 ⇒ 回 outcome。
5. **挂掉**：dsh 进程退出 ⇒ 适配层重启它 + 用 JSONL 日志恢复会话（`session/resume`）。
6. **关停**：`shutdown` 协议 + stdin EOF → SIGTERM → SIGKILL 的阶梯（sdk-client 自带）。

### 3.3 我们的 profile（cordis.patch.yml）

我们要自己维护一份 profile 补丁（YAML），里面是：

- LLM 路由（`deepseek-official` 或 `dsh-llm-pi-ai` 的 MiniMax 路由）；
- 我们的 cordis 插件（工具、闸门接线、MCP 配置、技能）；
- MCP server 条目（`AIADMIN_MCP_URL` ⇒ streamable-http + `Authorization: Bearer`）。

⇒ **这份 YAML 是「我们的」配置**（进我们的仓，走 git 评审）⇒ 符合「技能提示词走 git 评审」的规矩。

---

## 4. 【专章】MCP 怎么挂 —— 方案与兜底

> 这是整块**最大的未知数**（issue 原话），所以单列一节。

### 4.1 事实（已核实）

- npm 上**没有** `@deepseek-ai/dsh-mcp` 这个包；
- **有**这三个（都在 0.2.2-rc.5 上发布）：
  | 包 | 干什么 |
  | -- | ------ |
  | `@deepseek-ai/dsh-mcp-client` | 连**一个** MCP server，把它的工具暴露成原生工具 |
  | `@deepseek-ai/dsh-mcp-manager` | 管**一群** client（运行时增删改、状态、重启、探测） |
  | `@deepseek-ai/dsh-mcp-resources` | 跨连接的 resource 发现 / 读取 |
- **实测**（spike 阶段 3）：挂一个玩具 stdio MCP server ⇒ 模型调用 `mcp__toy__toy_echo` ⇒ 成功返回。
- dsh 用的是**官方 MCP SDK**（`@modelcontextprotocol/client` 2.2.0）⇒ 标准协议，不是私有协议。

### 4.2 方案 A（**推荐**）：用 `dsh-mcp-client` 挂 AiAdmin 那个 MCP

**AiAdmin 的 MCP 是标准 MCP（`AIADMIN_MCP_URL`，带用户 JWT）⇒ 直接挂。**

```yaml
# 我们的 profile 补丁
- id: mcp-aiadmin
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: aiadmin
    transport: streamable-http
    url: !!js process.env.AIADMIN_MCP_URL
    headers:
      Authorization: !!js '`Bearer ${process.env.AIADMIN_USER_TOKEN}`'
    toolCallTimeoutMs: 60000
    reconnect: { enabled: true }
```

- **工具名**：dsh 会把工具限定成 **`mcp__<serverName>__<toolName>`**（`mcp__aiadmin__create_task`）
  ⇒ 与 Claude Code / Codex 同款命名。
- **要做的适配**：把 `mcp__aiadmin__create_task` **归一化回**我们对外的命令名 `create_task`
  （前端 `CommandCard` 会显示工具名 ⇒ 不归一化就是**产品可见的变化**，见 §5.3）。
- **鉴权**：dsh 的 `headers` 支持 `!!js` 表达式 ⇒ 每个用户一个 token ⇒ **适配层按会话拼 profile**（或用凭据缝 `${credential:REF}`）。
- **多用户**：一个 dsh 进程承载多个会话 ⇒ **MCP 的 Authorization 是 per-用户** ⇒
  ⇒ **要么每个用户一个 dsh 进程**，要么**每个用户一组 MCP client 条目**（`mcp-manager` 就是干这个的）。
  ⇒ 这是方案 A 最大的**待解点**（§9 D6）。

### 4.3 方案 B（兜底）：自己写 MCP 客户端

**触发条件**（任一成立就切 B）：

1. `dsh-mcp-client` 的配置**表达不了**我们的鉴权/多租户需求（例如 per-用户 header + 连接数爆炸）；
2. dsh 的 MCP 客户端在 RC 升级中**反复破坏兼容**；
3. 我们需要**复用今天已经跑通的** `core/mcp/mcp.ts`（pi-mcp 客户端）而不是重写一遍。

**做法**：把**已有的** MCP 客户端（`core/mcp/mcp.ts` 用的 `@earendil-works/pi-mcp`）换成
**标准 MCP 客户端**（`@modelcontextprotocol/client` 2.2.0，与 dsh 用的是同一套），
在**我们的进程里**维护连接，把工具**注册进 dsh 的 tool registry**（cordis 插件里
`ctx.tools.register(defineTool(...))` ⇒ 委托给我们自己的 MCP 客户端执行）。

- **代价**：我们要自己写「工具 → MCP 调用」的桥（≈ 1 人日），但**协议层是标准库**（不是自研）。
- **好处**：完全掌控鉴权、多租户、超时、审计；**不依赖 dsh 的 MCP 包**（少一处升级风险）。

### 4.4 方案 C（最土的兜底）：把 MCP 变成「普通 HTTP 工具」

如果前两条都不通：把 AiAdmin 的能力**以普通工具**暴露给 dsh（我们的 cordis 插件里直接
`fetch` AiAdmin 的 REST 接口）⇒ 绕开 MCP 协议。

- **代价**：AiAdmin 那边的 MCP 工具就**用不上了**（得在 AiAdmin 仓另开 REST 口子 ⇒ 跨仓 ⇒ 要人拍板）。
- **只在 A、B 都不成立时用**。

### 4.5 建议的推进顺序

| 步骤 | 做什么 | 落在哪 |
| ---- | ------ | ------ |
| 1 | 用 `dsh-mcp-client` 挂**玩具** MCP（已做，spike 阶段 3 ✅） | #119 |
| 2 | 用 `dsh-mcp-client` 挂**真的** AiAdmin MCP（单用户、Bearer） | #122 |
| 3 | 决定**多用户**怎么隔离（per-用户进程 vs per-用户 client 条目） | #122（+ 人拍板） |
| 4 | 若 2/3 卡住 ⇒ 切方案 B（自写客户端 + 桥） | #122 |
| 5 | 兜底 C 不用准备，除非 A/B 都死 | — |

---

## 5. 对外契约不变的承诺（前端零改动）

### 5.1 承诺

- **9 个 HTTP 端点**（`core/routes/contract.ts` 那张表）：路径、方法、状态码、信封、**文案一字不动**。
- **SSE 事件名与载荷**（`core/session/events.ts` 的 10 种）：**一字不动**。
- 前端**不改一行代码**。

### 5.2 dsh 事件 → 我们的 SSE 事件（映射表）

| dsh 事件 | 我们的 SSE 事件 | 备注 |
| -------- | --------------- | ---- |
| （连接建立） | `connected` | 我们自己发 |
| `assistant/message`（`stream` 里的 `text-chunks`） | `text_delta`（多条） | 首条文本前先发 `message_start` |
| `assistant/message`（reasoning 增量） | `thinking_delta` | 默认不开（与今天一致） |
| `assistant/message`（收尾） | `message_end`（带全文） | 没有正文就不开气泡（与今天一致） |
| `tool/call` | `tool_call` `{ toolName, args }` | dsh 的 `arguments` 是 **JSON 字符串** ⇒ 要 `JSON.parse` |
| `tool/result` | `tool_result` `{ toolName, status, summary }` | `isError` ⇒ `status: 'error'` |
| `approval/asked` | `pending` `{ id, command, args }` | `id` 用**我们自己的** pending id；`args` 靠 `callId` 关联 `tool/call` |
| `turn/end` / `session.status`（idle） | `agent_settled` | |
| （闸门确认后我们自己写回成功） | `entity_updated` | 我们自己的事件，不变 |
| `step/*`、`request/*`、`system/message`、`user/message`、`session/title` | —— | 内部用，不外发 |

> ⚠️ **成批 vs 逐 token**：`text_delta` 的**到达时机**会变（step 末成批），**事件名与载荷不变** ⇒ 前端零改动。

### 5.3 工具名归一化（必须做）

前端 `CommandCard` 直接显示 `toolName` ⇒ dsh 的 `mcp__aiadmin__create_task` 会**显示在界面上**。

⇒ 适配层维护一张 **dsh 工具名 → 我们的命令名** 的映射（`mcp__aiadmin__create_task` ⇒ `create_task`），
映射表来自**我们的 MCP 工具清单**（不是猜的）⇒ 界面、审计表、`ai_pending_action.command` 都不变。

### 5.4 闸门口径不变

「**新增放行、修改要点头**」的口径留在**我们的命令定义**里（`core/tools/types.ts` 的
`isDestructiveCommand` 之类），dsh 的审批缝只是**执行点** ⇒ 口径不变、可测。

---

## 6. 逐文件「留 / 改 / 删」清单（覆盖 `backend/ai/src/core/**` 全部）

> 图例：**留** = 语义不动 · **改** = 换实现但对外形状不变 · **删** = 随 pi 一起走 · **加** = 新增

| 文件 | 动作 | 说明 |
| ---- | ---- | ---- |
| `core/app.ts` | **改** | 装配：起适配层（dsh 进程）+ 注入到 runtime |
| `core/app.test.ts` | **改** | 换假适配层 |
| `core/index.ts` | **留**（导出签名要微调） | 公开入口（12 个导出）不许变；内部实现换 |
| `core/index.test.ts` | **改** | 「不许 import pi」的断言改成「不许 import dsh（除适配层）」 |
| `core/plugins.ts` | **留** | 插件契约（业务插件挂载点）不变 |
| `core/errors.ts` | **留** | |
| `core/purity.test.ts` | **改** | 加一条：**dsh 只能出现在 `core/adapter/dsh/**`** |
| `core/audit/**` | **留** | 审计形状不变（dsh 的 `approval/*` 事件投影进来，见 #121） |
| `core/config/**` | **留** | 智能体配置（YAML）不变 |
| `core/context/anchor.ts` | **留** | 讨论上下文锚点是我们自己的 |
| `core/env/**` | **留** | |
| `core/gate/gate.ts` | **改** | pi 的 `ExtensionAPI` ⇒ 改成**审批缝接线**（收到 `approval/request` ⇒ 写 pending ⇒ 等人 ⇒ 回 outcome） |
| `core/gate/pending-*.ts` | **留** | 待确认表 + 等人机制（复用） |
| `core/gate/*.test.ts` | **改** | 换成适配层的假审批源 |
| `core/http/**` | **留** | |
| `core/mcp/mcp.ts` | **改** | pi-mcp 客户端 ⇒ **生成 dsh-mcp-client 的配置**（§4.2） |
| `core/mcp/mcp.fake.ts` | **改** | 同上（假 MCP） |
| `core/mcp/*.test.ts` | **改** | |
| `core/routes/**` | **留** | **对外契约（9 端点 + SSE）一个字不动** |
| `core/session/pi-session.ts` | **删** | pi 专有 ⇒ 换成 `core/adapter/dsh/session.ts` |
| `core/session/session-entries.ts` | **删** | pi 的 entry 转换（dsh 有自己的事件词汇） |
| `core/session/event-mapper.ts` | **改** | pi 事件 → SSE ⇒ **dsh 事件 → SSE**（§5.2） |
| `core/session/events.ts` | **留** | **SSE 事件名与载荷不变** |
| `core/session/frame-buffer.ts` | **留** | 回放窗口（我们自己的） |
| `core/session/identity.ts` | **留** | |
| `core/session/runtime.ts` | **改** | 运行时门面：命令 → `session/prompt`；快照 → dsh 状态 |
| `core/session/session-registry.ts` | **改** | 会话注册表（conversationId ↔ dsh sessionId） |
| `core/session/startup-lock.ts` | **留** | |
| `core/session/*.test.ts` | **改** | |
| `core/skills/skills.ts` | **留** | **提示词拼装是我们自己的**（`renderSkillsSection` / `buildSystemPrompt`） |
| `core/skills/skill-catalog.ts` | **改** | pi 的 `loadSkills` ⇒ **我们自己的 loader**（`backend/ai/.pi/skills/**` 是标准 SKILL.md，不丢） |
| `core/skills/skill-tools.ts` | **改** | pi 的 `Skill` 类型 ⇒ dsh 形状 / 或并入 `dsh-tool-skill`（#122） |
| `core/skills/*.test.ts` | **改** | |
| `core/store/**` | **留** | `ai_*` 表（#121 再谈 dsh 形状的共存） |
| `core/tools/index.ts` | **留** | `buildCommandTools` / `isDestructiveCommand` 是我们的 |
| `core/tools/types.ts` | **改** | typebox ⇒ **加一层 typebox → dsh schema 转换**（§2.3） |
| `core/types/api.ts` | **留** | |
| `core/agent-capabilities.test.ts` | **改** | |
| **加** `core/adapter/dsh/client.ts` | **加** | dsh 进程生命周期 + JSON-RPC 客户端 |
| **加** `core/adapter/dsh/protocol.ts` | **加** | 线协议常量 + **我们自己写的** TS 类型（不 import dsh 的类型） |
| **加** `core/adapter/dsh/events.ts` | **加** | dsh 事件 → SSE 事件 |
| **加** `core/adapter/dsh/approvals.ts` | **加** | 审批缝 ⇄ 我们的闸门 |
| **加** `core/adapter/dsh/tools.ts` | **加** | 工具注册 + 工具名归一化 |
| **加** `core/adapter/dsh/mcp.ts` | **加** | MCP 配置生成 |
| **加** `scripts/check-dsh-boundary.cjs` | **加** | 可执行断言：**dsh 只许出现在适配层** |

**不在本清单里**（本条不做）：`src/plugins/pm/**`（业务插件）、`src/server.ts`（薄入口）、前端、AiAdmin 仓。

---

## 7. 类型不外泄的边界设计

**目标**：dsh 是 RC ⇒ 它的 API 会变 ⇒ **dsh 的任何类型/名字都不许出现在我们的业务代码里**。

三层防线：

1. **目录边界**：dsh 相关的东西**只在** `backend/ai/src/core/adapter/dsh/**`。
   ⇒ 加一条**可执行检查**（仿 `scripts/check-core-purity.cjs`）：

   ```bash
   grep -rn "@deepseek-ai/\|dsh-" backend/ai/src \
     | grep -v "^backend/ai/src/core/adapter/dsh/" \
     | grep -v "dsh-"   # 说明文字里的 dh 字样不算
   ```

   （实现细节见 `scripts/check-dsh-boundary.cjs`，与 `check-core-purity.cjs` 同一个套路。）

2. **类型边界**：适配层**不 import dsh 的 TS 类型**（连 `@deepseek-ai/dsh-sdk-client` 的类型也不 import）
   ⇒ 我们**自己**写线协议的类型（JSON 形状）⇒ **dsh 升级不会引起我们的编译错误**，
   只会在适配层里显式看到差异。

   > 若决定用官方 `@deepseek-ai/dsh-sdk-client`：它就住在适配层里，**其余模块不许 import 它**；
   > 我们对外导出的是**自己的**接口（`DshClient` / `DshSession` / `DshEvent`）。

3. **形状边界**：跨层只传 **JSON**（事件、工具参数、审批请求）⇒ 与 dsh 的内部模型解耦。

**升级影响面 = 适配层目录**（≈ 5 个文件）—— 这是本架构最核心的保险。

---

## 8. 版本锁与升级策略

### 8.1 锁什么

**锁 `0.2.2-rc.5` 全家桶**（`backend/ai/spike/dsh/dsh-versions.lock.json`，**精确版本，无 `^` / `~`**）。

**为什么不是 issue 里写的 `0.0.1-rc.1` / `dsh-agent 0.1.0-rc.6`**：

- 那两个是 npm 的 **`latest` dist-tag**，但它们来自**两条不同的发布线**
  （`dsh-agent` 在 0.1.0-rc.x 线，其余包在 0.0.1-rc.x 线）⇒ **一起装直接失败**（实测）：

  ```
  npm error Could not resolve dependency:
  npm error peer @deepseek-ai/dsh-invariants@"^0.1.0-rc.6" from @deepseek-ai/dsh-agent@0.1.0-rc.6
  npm error peer @deepseek-ai/dsh-llm@"^0.0.1-rc.1" from @deepseek-ai/dsh-sdk-client@0.0.1-rc.1
  ```

  ⇒ **npm 的 `latest` 在 dsh 上是坏的** ⇒ 任何 `npm i @deepseek-ai/dsh-*` 都要**显式写版本**。
- `0.2.2-rc.5` = 官方仓 master（2026-11-18）的发布，peer 图自洽 ⇒ **实测装得上、跑得通**（spike 全绿）。

### 8.2 已知缺口

- `@deepseek-ai/dsh-session-persistence-sqlite` **没有** 0.2.2-rc.5（还在 0.0.1-rc.1 线）⇒ 本轮只走 JSONL。
- `@deepseek-ai/dsh-invariants` 最高只有 0.2.0-rc.2（peer 带进来的，不单独锁）。

### 8.3 升级策略

1. **升级 = 单独一条 issue**（不夹带在别的 issue 里 ⇒「顺手升」是 RC 阶段最贵的习惯）。
2. 流程：
   1. 改 `dsh-versions.lock.json`（全部包**同一个**发布线，一起动）；
   2. `pnpm install` ⇒ 看 peer 冲突（冲突 = 这条线不自洽 ⇒ 换线）；
   3. **重跑 spike**（`node backend/ai/spike/dsh/scripts/01-toy-task.mjs`）⇒ 五个阶段必须全绿；
   4. **回看本 spec 的八问**（§2）⇒ 有没有结论变了（尤其：事件名、审批载荷、MCP 配置形状）；
   5. 更新本 spec 的 §2 / §8；
   6. 才动生产代码。
3. **生产代码里的 dsh 依赖**：`backend/ai/package.json` **不依赖** `@deepseek-ai/*`
   （dsh 是**子进程** ⇒ 只需要「怎么启动它」）⇒ 升级只影响部署镜像里的 dsh 版本。

---

## 9. 未决问题（要人拍板）

| # | 问题 | 选项 | 建议 |
| - | ---- | ---- | ---- |
| **D1** | **流式**：走子进程 ⇒ `text_delta` 成批到达（契约不变，但体感从逐字变成成批） | A 子进程（推荐）· B 进程内嵌入（保逐 token，但类型外泄风险大） | **A**；若前端反馈必须逐字，再评估 B |
| **D2** | **abort 端点**：`POST /api/agent/conv-1/abort` 在 SDK 协议里**没有对应**（协议只有 initialize/prompt/query/resume/wait/working-directory/shutdown） | A 杀并重建该会话的 dsh 进程（粗糙）· B 进程内嵌入（可直接 AbortController）· C 给 dsh 提 issue 要 `session/cancel` | **A 先兜住**（用户体验上「中止」= 停掉这轮），C 并行提 |
| **D3** | **官方 DeepSeek 路由未实测**（我们没有官方 key） | A 拿一把 key 实测 · B 只用兼容网关 | **A**（#120 开工前） |
| **D4** | **工具统一拦截点**：`tools/pre-execute` 的 `ask` 决策在根作用域插件里实测没触发 | A 工具自己问（= 今天口径）· B 找到正确的作用域挂法 | **A 先做**（不阻塞），B 在 #120 里再试 |
| **D5** | `dsh-llm-pi-ai` 算不算「还留着 pi」 | A 算（#123 要一并拔）· B 不算（只依赖 pi-ai，不是 pi-coding-agent） | **B**（省 2 人日），但要在 #123 里写清楚 |
| **D6** | **MCP 多用户**：per-用户 dsh 进程 vs per-用户 MCP client 条目 | A per-用户进程 · B per-用户 client 条目（`mcp-manager`） | **B**（进程复用），A 作为兜底 |

---

## 10. 下一步（issue 映射）

| issue | 内容 | 依赖本 spec 的哪些结论 |
| ----- | ---- | ---------------------- |
| **#120** | AI 服务骨架换成 dsh（对外契约不变） | §3 架构 · §5 契约 · §6 清单 · §7 边界 · §8 版本锁 |
| **#121** | 存储与审计迁到 dsh 形状 | §2.7 |
| **#122** | 技能 / MCP / 插件三层重新落地 | §2.3 · §2.6 · §4 |
| **#123** | 拔掉 pi 依赖 + PM 派活脱离 pi | §2.2（D5）· §2.8 |
| **#124** | AI 管理面（智能体市场 / 技能管理 / MCP 管理） | §4.2（`mcp-manager`）· §2.3 |

**本条（#119）到此为止**：只出文档 + 尖峰，**不动生产代码**。
