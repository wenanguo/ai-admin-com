# AI 部分架构

> 覆盖三个仓：`ai-admin-com`（本仓库，前端）、`ai-admin-ai`（智能体服务）、`AiAdmin`（FastAPI 后端）。
> 相关设计文档：`docs/aipm/docs/01-architecture.md`、`03-api-contract.md`、`05-agent-runtime.md`。
>
> ⚠️ 本文件描述的是**当前实现**，不是规划。

---

## 0. 一句话

> **框架是 pi agent**（`@earendil-works/pi-coding-agent` 1.5.0），**模型是 MiniMax-M3.1-Flash**（`minimax-cn` provider）；
> pi 只挂载业务命令（当前仅 `create_task`），命令经适配层落到 AiAdmin 后端并留审计；
> 前端通过 `/ai-api` 的 REST + SSE 与之对话，**对智能体内部完全无感**。

---

## 1. 参与方与边界

```
┌───────────────────────────────────────┐   ① 复用 AiAdmin 的 Bearer token
│  ai-admin-com（本仓库）                 │   ② REST：快照 / 命令 / 审计 / 待确认
│  Umi Max 4 + React 19                 │   ③ SSE ：事件流（text_delta 等）
│                                       │───────────────▶┌──────────────────────────────┐
│  · AI 工作台侧栏（常驻右侧 Sider）      │                 │  ai-admin-ai（Next.js 15）     │
│  · AI 工作台全宽页 /ai/workspace      │◀────────────────│  /api/agent/*  REST + SSE     │
│  · services/api/ai/*                  │   SSE 事件流     │                              │
└───────────────────────────────────────┘                 │  src/agent/*   pi agent 运行时 │
                                                          │  src/adapter/* 适配层          │
                                                          │  src/tools/*   命令目录        │
                                                          │  src/aadmin/*  调 AiAdmin     │
                                                          └───────────┬──────────────────┘
                                                                      │ 透传 token
                                                                      ▼
                                                        ┌──────────────────────────────┐
                                                        │  AiAdmin（FastAPI，/api/v1）  │
                                                        │  权威身份 / 权限 / 业务事实源   │
                                                        └──────────────────────────────┘
```

**核心设计**：AI 服务**不自己实现认证**，它把 token 透传给 AiAdmin 校验 ⇒
**用户在 AiAdmin 的权限，就是他让 AI 做的事的权限**。这一条是整套设计的地基。

---

## 2. 智能体运行时：pi agent 怎么接进来的

### 2.1 依赖与模型

```jsonc
// ai-admin-ai/package.json
"@earendil-works/pi-coding-agent": "1.5.0"
```

```bash
# ai-admin-ai/.env
MINIMAX_CN_API_KEY=***            # pi 只靠这个环境变量鉴权
AI_MODEL=minimax-cn/MiniMax-M3.1-Flash
```

pi 的 `ModelRuntime` 解析 `provider/model` 并鉴权，凭据放在仓库内 `.ai/auth.json`。

> **不是 Claude**：Claude 只是 pi 可选的模型供应商之一，本项目实际跑的是 MiniMax。
> 框架是 pi，模型是 MiniMax，两者要分开说。

### 2.2 会话构造（`src/agent/pi-session.ts`）

三个尖峰实测踩出来的坑：

```ts
const modelRuntime = await ModelRuntime.create({ authPath: AUTH_PATH });
// ① model 必须是对象（modelRuntime.getModel(...)），不能写 "provider/model" 字符串
const model = modelRuntime.getModel(provider, modelId.slice(separator + 1));

const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(), agentDir: join(AGENT_DIR, "agent"),
  noExtensions: true, noSkills: true, noPromptTemplates: true,
  noThemes: true, noContextFiles: true,
  systemPrompt,                        // ② systemPrompt 不在 createAgentSession 的选项里
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  model, modelRuntime, resourceLoader,
  thinkingLevel: "off",
  noTools: "builtin",                  // ③ tools:[] 是白名单会连自定义工具一起关掉
  customTools: tools,
  sessionManager: SessionManager.inMemory(),
});
```

**`noTools: "builtin"` 是最重要的一个决定** —— pi 自带的 coding 工具（read / bash / edit / write）
能在服务器上乱跑，所以全部禁用，只注册业务命令。

工具的 `execute` 是**五参**：`(toolCallId, params, signal, onUpdate, ctx)`。

### 2.3 会话通道（`src/agent/session-registry.ts`）

一个 `conversationId` = 一个通道，挂着四样东西：

| 东西 | 说明 |
| ---- | ---- |
| SSE 订阅者集合 | 每个连上来的客户端一个 |
| 回放窗口 | `FrameBuffer`（内存，16 MB 上限） |
| 调用方 token | **只在内存**，绝不落盘、绝不进日志 |
| pi 会话 | **懒创建**：第一次有命令时才建 |

通道数上限 64（超了关最久没用的），空闲 TTL 30 分钟。

### 2.4 回放窗口（`src/agent/frame-buffer.ts`）

- 字节上限默认 **16 MB**；超限时**优先丢「可重建」的帧**（`text_delta` —— 文本增量可以从快照重建），
  **保留结构帧**（`tool_call` / `tool_result` / `agent_settled` —— 这些是「发生了什么」的事实，丢了就真丢了）
- 每帧带 `seq`（缓冲内单调递增）⇒ 连接时「先取回放快照，再接增量」，用序号去重 ⇒ **既不重复也不漏**

### 2.5 模型上下文怎么来的（⚠️ SDK 的关键机制）

pi 的 SDK 文档说：

> **SessionManager is authoritative for finalized model context.**
> Restore external history by constructing the session with a manager containing those entries.
> Assigning `session.agent.state.messages` **does not** replace persisted context.

本服务的对话历史存在自己的 `ai_message` 表，而 pi 会话是**内存态、懒创建**的
（进程重启就没了；通道空闲 30 分钟也会被回收）⇒

⇒ 建 pi 会话时，把 `ai_message` 里的历史**还原成 pi 的 entries**，
交给 `SessionManager.inMemory(cwd, { id }, entries)`。

- 不还原的话：**前端看得见历史，模型看不见**（用户会觉得「AI 明明看得到，却像第一次见我」）；
- ⚠️ **当前这一句要排除在历史之外** —— 它随后由 `session.prompt(message)` 加进
  pi 的消息列表，两边都放 ⇒ 模型看到同一句话两遍；
- `session.agent.state.messages = ...` 那条路**不生效**（SDK 文档明说）。

### 2.6 排队语义（SDK 原生）

| 场景 | 本服务的做法 |
| ---- | ------------ |
| 没有轮次在跑 | `session.prompt(message, { expandPromptTemplates: false })` |
| 有轮次在跑 + 普通 `prompt` | `session.followUp(message)`（排队，**不打断**） |
| 有轮次在跑 + `prompt-steer` | `session.steer(message)`（**打断**：插到当前助手轮次及其工具调用之后） |
| 用户点「停止」 | `session.abort()`（随后 pi 自己发 `agent_settled`） |

⚠️ `prompt` / `followUp` / `steer` 三个类型都**不展开提示词模板**
（用户打的「/xxx」不是命令）；`steer` / `followUp` 是 SDK 原生的，
它们**会**展开 ⇒ 用户的话被当成扩展命令时会抛错 ⇒ 运行时兵底回普通排队。

---

## 3. 全链路：一次「用户说话 → 助手回复」

```
 用户            前端 ai-admin-com              ai-admin-ai                    AiAdmin
  │                    │                             │                             │
  │ 打字                │                             │                             │
  ├───────────────────▶│ Composer.onSend            │                             │
  │                    │ workspace.send(text)        │                             │
  │                    │  ① createAiCommandId()      │                             │
  │                    │  ② appendUserMessage()      │  ← 乐观上屏（不等服务端）      │
  │                    │  ③ POST /api/agent/:cid/    │                             │
  │                    │     command {id,type,msg}   │                             │
  │                    ├────────────────────────────▶│ submitCommand()             │
  │                    │                             │  ④ 按 id 去重（同 id 不重跑）   │
  │                    │                             │  ⑤ session.prompt(text) ─────▶│
  │                    │                             │      pi agent 调模型         │
  │                    │                             │      (MiniMax-M3.1-Flash)     │
  │                    │                             │                             │
  │                    │◀── SSE: connected ───────────┤ （连上即回放历史）            │
  │                    │◀── SSE: message_start ──────┤                             │
  │                    │◀── SSE: text_delta  × N ────┤  ← 逐字增量                   │
  │                    │◀── SSE: message_end ─────────┤  ← 本轮完整正文 + error?      │
  │                    │◀── SSE: agent_settled ───────┤  ← 本轮结束，输入解禁         │
  │                    │                             │                             │
  │                    │  ⑥ 拆帧 → toAiEvent()        │                             │
  │                    │  ⑦ applyAiEvent() → state    │                             │
  │                    │  ⑧ ChatPanel → MessageBubble │                             │
```

### 命令调用的支线（tool call）

```
pi: tool_execution_start
   └─▶ SSE: tool_call {toolName, args}
         └─▶ src/tools/create-task.ts     参数校验 / 拼装
               └─▶ src/adapter/datasource.ts  鉴权透传 / 字段映射 / 错误归一 / 分页语义 / 幂等
                     └─▶ src/aadmin/client.ts    POST 到 AiAdmin（事实源）
                     └─▶ src/audit.ts            写前快照 + 一条 ai_audit_log
                           └─▶ SSE: tool_result {status, summary, details}
                                 └─▶ 前端 CommandCard 由「执行中」变「已执行 / 失败」
```

**每次写都要留审计**（`ai_audit_log` 含 `before` / `after` 字段级差异、`undoOf`、`model`、`tokens`、`latencyMs`）。

---

## 4. 事件映射全表

### 4.1 pi 原生事件 → SSE 事件

pi 的事件序列（尖峰实测）：

```
agent_start → turn_start → message_start → message_update* → message_end
            → tool_execution_start → tool_execution_end → …
            → turn_end → agent_end → agent_settled
```

`src/agent/event-mapper.ts` 收敛成 7 种（`src/agent/events.ts`）：

| pi 事件 | SSE 事件 | 载荷 | 说明 |
| ------- | -------- | ---- | ---- |
| — | `connected` | `{conversationId, isStreaming}` | 连接建立的第一帧 |
| `message_start` | `message_start` | `{role:"assistant"}` | **推迟到第一条文本增量才发** |
| `message_update` | `text_delta` | `{delta}` | 文本增量 |
| `message_update` | `thinking_delta` | `{delta}` | 思考增量（**只在思考级别不为 `off` 时才有**） |
| `message_end` | `message_end` | `{text, error?}` | `text` 是**完整正文**，`error` 仅失败时有 |
| `tool_execution_start` | `tool_call` | `{toolName, args}` | |
| `tool_execution_end` | `tool_result` | `{toolName, status, summary, details}` | |
| `agent_settled` | `agent_settled` | `{}` | 一轮结束 |
| — | `:heartbeat`（注释行） | — | 每 15 秒一次，防代理判空闲超时 |

两条收敛规则：

1. `message_update` 只留 `text_delta`（思考增量不给前端）
2. **`message_start` 推迟到第一条文本增量** —— 模型第一轮常常只带工具调用、没有正文，
   那时发 `message_start`+`message_end`（正文为空）会让前端多出一个空气泡；
   整轮都没有正文 ⇒ **一个气泡都不开**

`agent_start` / `turn_*` / `agent_end` 不外发（对前端没意义）。

### 4.2 SSE 事件 → 前端状态 → UI

| SSE 事件 | `useAgentStream` 的动作 | 界面表现 |
| -------- | ----------------------- | -------- |
| `connected` | 打开**回放窗口**，拉快照 | 「AI 服务不可用」标签消失 |
| `message_start` | 新建一个助手气泡，`activeId` 指向它 | 出现一个空的助手气泡占位 |
| `text_delta` | 累积进 `activeId` 气泡的 `text` | 气泡里的字逐字出现 |
| `thinking_delta` | 累积进 `thinking`（**不进气泡**） | 输入区上方一行「思考中…」 || `message_end` | 收尾：正文空则用 `text` 补；`serverText` 另存一份；`error` 标失败 | 气泡正文定格；失败轮次带错误提示 |
| `tool_call` | 往该轮的 `commands` 里追加一张 `running` 卡片 | 命令卡片「执行中」 |
| `tool_result` | 回填到**最后一张同名且 running** 的卡片；找不到就补一张已完成的 | 命令卡片「已执行 / 失败」 |
| `agent_settled` | `activeId` 清空、`streaming=false` | 输入框解禁 |

> `serverText` 单独存一份的原因：服务端的帧缓冲 16 MB 上限会淘汰 `text_delta`
> ⇒ 累积出来的 `text` 可能是**残缺**的 ⇒ 用 `message_end` 的完整正文对账才能认出「这是同一轮」。

### 4.3 三个只读端点 → 两个页签

| 端点 | 载荷 | 前端 | 界面 |
| ---- | ---- | ---- | ---- |
| `GET /api/pending` | `AiPendingRow[]` | `useAiLists({pending})` | 待确认页签（`PendingPanel`） |
| `GET /api/audit` | `{total, items: AiAuditRow[]}` | `useAiLists({audit})` | 审计页签（`AuditPanel`，AI 行带紫色小圆点） |

**服务端目前没有确认/撤销的写入口** ⇒ 这两个页签纯只读。
**服务端也没有任何命令会进待确认**（唯一的 `create_task` 是非破坏性的）⇒ 待确认列表现在是空的。

---

## 5. 快照 vs 回放：竞态与「回放窗口」

服务端连上后会**立刻**把整段历史（回放）写进同一个 SSE 响应：

```
write(connected) → for (const frame of snapshot) write(...)
```

而前端收到 `connected` 就去拉快照 ⇒ **两者赛跑**。
快照可能落在回放的中间 ⇒ 「快照落地」≠「回放结束」⇒ 回放的**尾巴**还会再来
⇒ **历史被渲染两遍（而且是永久的）**。

解法是 `useAgentStream.ts` 里的 `ReplayWindow`：

| 机制 | 作用 |
| ---- | ---- |
| `snapshotReady` | 快照没到**不能**关窗口（关了就没有真相了） |
| `completedTurns >= expectedTurns` | 回放收完了 ⇒ 整段回放都到了 ⇒ **立刻关窗**，不等静默期 |
| `REPLAY_SETTLE_MS = 1000` | 静默期兜底（回放对不齐时，例如服务端重启后缓冲空了） |
| `REPLAY_MAX_WINDOW_MS = 4000` | 硬兜底：快照请求卡住 ⇒ 否则实时帧被无限攒着，用户看到「我发了话，助手不回」 |
| `partitionTurns()` | 关窗时把积压分成「快照已有的」与「快照之后才发生的」—— 后者**必须上屏**，不能吞 |
| `mergeCommandSources()` | 快照里**没有**工具调用历史 ⇒ 命令卡片要合并回去，否则用户以为命令没执行 |

配套：`client.ts` 的 `SNAPSHOT_TIMEOUT_MS = 3000` 必须**短于** 4 s
⇒ 让快照请求先失败 ⇒ 走「快照读不到 ⇒ 回放的积压顶上」那条路。

---

## 6. 传输层细节

### 6.1 为什么用 `/ai-api` 独立前缀

AI 服务的路径也是 `/api/agent/...`，而 dev 代理的 `'/api/'` 规则归 AiAdmin
⇒ 浏览器直接打 `/api/agent/...` 会被 AiAdmin 接走。

| 层 | 位置 | 内容 |
| -- | ---- | ---- |
| 前缀常量 | `src/services/api/ai/base.ts` | `AI_API_BASE_URL`（构建期 `define` 注入，缺省 `/ai-api`） |
| 开发代理 | `config/proxy.ts` | `'/ai-api/'` → `http://localhost:3100`，`pathRewrite` 去掉前缀 |
| 客户端 | `src/services/api/ai/client.ts` | `baseURL: ''`（**必须**，否则拼成 `/api/v1/ai-api/...`） |

`base.ts` 单独拆成**零依赖叶子模块**，是因为 `src/requestErrorConfig.ts` 要用它判断
「这条请求是不是 AI 的」（AI 命令每次都带 `msg`，弹 success 提示就是噪音）——
若从 `client.ts` import 会把 umi 运行时拖进请求配置，形成循环依赖温床。

### 6.2 为什么手写 SSE 客户端

原生 `EventSource` **不能自定义请求头** ⇒ 带不了 `Authorization` ⇒ 401。
所以 `src/services/api/ai/sse.ts` 用 `fetch` + `response.body`（ReadableStream）自己拆帧：

- 标准 SSE 帧解析（`event:` / `data:` / `id:` / `:` 注释心跳）
- **未知事件名 → 忽略**（服务端以后加事件前端不会崩）
- 指数退避重连 1 s → 2 s → 4 s … 上限 30 s
- **401 → 先 `refreshSession()` 静默刷新 token 再重连**（不做这件事，对话会静默死掉）
- 每次连接服务端都先发 `connected` ⇒ 用它触发重新同步

### 6.3 端点清单

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/agent/conversations` | 列会话（最近更新在前） |
| POST | `/api/agent/conversations` | 新建会话 |
| GET | `/api/agent/:cid/state` | 会话快照（消息 / isStreaming / model），**3 s 超时** |
| POST | `/api/agent/:cid/command` | 提交命令（`type` = `prompt` / `prompt-followup` / `prompt-steer`），**按 id 去重** |
| POST | `/api/agent/:cid/abort` | **中止**当前那一轮（`session.abort()`）；⚠️ 中止**不是回滚** |
| GET | `/api/agent/:cid/events` | SSE 事件流（`connected` → 回放 → 增量） |
| GET | `/api/audit` | 审计流水（`actor` / `command` / `limit` 过滤） |
| GET | `/api/pending` | 待确认列表（`status` 过滤） |

---

## 7. 前端分层

```
src/services/api/ai/          ← 传输层（端点的一一映射）
├── base.ts      前缀常量 + aiUrl()（零依赖叶子）
├── client.ts    REST 客户端（umi request，baseURL:''，skipErrorHandler）
├── sse.ts       SSE 客户端（手写帧解析 + 指数退避重连）
└── types.ts     数据形状（照服务端实现逐字段抄）

src/components/ai-workspace/  ← 状态层与展示层
├── useAgentStream.ts   ★ 流式状态机：SSE 事件 → 界面状态
├── useWorkspace.ts     ★ 会话生命周期 + 发命令 + 重试（id 复用）
├── useAiLists.ts       待确认/审计两个只读列表（按需读）
├── storage.ts          localStorage 持久化（折叠态 / 页签 / 会话 id）
├── paths.ts            路由常量（/ai/workspace，三处引用）
├── palette.ts          颜色常量（AI 身份色 #722ED1）
├── index.tsx           侧栏容器（对话 / 待确认 / 审计 三页签）
├── ChatPanel.tsx  MessageBubble.tsx  Composer.tsx  CommandCard.tsx
├── PendingCard.tsx  PendingPanel.tsx  AuditPanel.tsx
└── AiWorkspaceShell.tsx  ★ 应用外壳：右侧常驻 Sider

src/pages/ai/workspace/    ← 全宽页
├── index.tsx          宽版对话 + 三视图 + 意图卡片墙
├── WideChat.tsx       宽版聊天
├── RuleSplit.tsx      规则与 AI 的分工
├── IntentGallery.tsx  10 类意图
└── intents.ts         意图清单
```

### 界面结构

```
┌─────────────────────────────────────────────────────────────┐
│ ProLayout（左侧菜单）        │  AI 工作台 Sider（400px）       │
│                             │  ┌───────────────────────────┐  │
│  主内容区（自己滚）           │  │ [全宽] AI 工作台 [收起]     │  │
│                             │  ├───────────────────────────┤  │
│  /ai/workspace 全宽页         │  │ 对话 │ 待确认 │ 审计         │  │
│  → 侧栏让开                  │  │  气泡 / 命令卡片            │  │
│                             │  │ （消息区列内滚，输入固定）    │  │
└─────────────────────────────────────────────────────────────┘
```

- `AiWorkspaceShell` 挂在 `rootContainer`（`src/app.tsx`）⇒ 侧栏是**框架的右边**，与 ProLayout 的左菜单对称，不是贴在内容上的浮板
- `⌘B / Ctrl+B` 折叠，状态存 localStorage；输入框里不劫持快捷键（那里 `Ctrl+B` 是加粗）
- 窄屏（< 1200 px）antd `Sider.breakpoint` 自动收成 40 px 竖条（响应式行为**不写** localStorage）
- 全宽页上**不挂侧栏** ⇒ 避免两个 `useWorkspace` 各建一个会话、互相覆盖存储
- 会话通过 `localStorage['aipm.workspace']` 保持两边同一个

---

## 8. 可用性设计：AI 挂了，系统不瘫

贯穿全套代码的一条主线：

| 措施 | 位置 | 原因 |
| ---- | ---- | ---- |
| `skipErrorHandler: true` | `client.ts` | 侧栏常驻每个页面 ⇒ 全局错误提示会在每个页面重复出现 |
| 错误显示在面板里 | `index.tsx` / `connectionError` | 同上 |
| 待确认/审计**按需读** | `useAiLists({pending, audit})` | 用户没点那个页签就别发请求 |
| `aiUnavailable` 判定 | `useWorkspace.ts` | 不能用 `!connected`（首次连接瞬间也是 false ⇒ 每个页面开都闪一下「不可用」） |
| 读失败不许崩 | `useAiLists.ts` | 失败只落到一个错误提示里 |
| 没有数据源就不画 | 全宽页 | 服务端无配额端点 ⇒ **不画配额条**；无依赖图 ⇒ ETA 只写 burndown |
| 前端不做业务判定 | 全部 | 命令危不危险、能不能撤销、状态怎么算 ⇒ 都是命令层与服务端的事 |

---

## 8.5 真实后端验收结果（2026-11-07）

后端 `module_mcp` 已上线（`https://www.pmdict.cn/api/v1/mcp`，tag 白名单=任务模块），
本仓与真后端跑通了完整链路：

| 检查 | 结果 |
| ---- | ---- |
| `initialize` | ✅ `serverInfo: {"name":"AiAdmin PM API"}` |
| `tools/list` | ✅ 5 个工具（见下） |
| 真实 HTTP 上的 JWT 透传 | ✅ `Authorization: Bearer <调用方 token>` |
| 真实调用 `list_tasks` | ✅ 返回真实数据（total 90） |
| 走本服务的完整对话 | ✅ 模型先 `load_skill(list-tasks)` → 再 `mcp__aiadmin__list_tasks` → 回答 |
| **真的建出任务** | ✅ 用户说「在项目 6 建一个任务…」→ 模型调 `create_task` → 后端 `创建任务成功` → 落库核对 `id=117` |

**建任务那次，模型自己传的参数**（没人告诉它）：

```json
{"project_id": 6, "title": "【AI 验收】冒烟测试",
 "type_code": "feature", "status_code": "todo", "priority_code": "p2"}
```

⇒ 小写字典码 ✓ · 数字 `project_id` ✓ · 必填五项齐全 ✓ · **没多传**后端自动填的字段 ✓

⚠️ **发现的两个后端问题**（2026-11-07）：

| 问题 | 现象 | 修法 |
| ---- | ---- | ---- |
| `created_via_code` 没自动填充 | 工具描述说「不传时后端自动填充」，实际落库是 `null` ⇒ **AI 建的任务丢了来源标记** | 后端自动填充时填 `nl_chat` |
| `patch_task_status` 的 schema 与描述矛盾 | 描述说「`status_code` 取字典值（todo/doing/done）」，schema 却是 **`status: integer`** ⇒ 按描述传字符串大概率 422 | 后端把两边对齐（工具描述是模型唯一的使用依据） |

**真实工具清单**（工具名 = `mcp__aiadmin__` + 后端 operation_id）：

| 工具 | 语义 | 备注 |
| ---- | ---- | ---- |
| `list_tasks` | 分页查询 | 过滤：`project_id` / `status_code` / `priority_code` / `title` / `assignee_id` |
| `get_task_detail` | 按 `id` 查详情 | |
| `create_task` | 新建 | 必填 `project_id` / `title` / `type_code` / `status_code` / `priority_code`；`reporter_id` / `sort_order` / `created_via_code` **不用传**（后端自动填） |
| `update_task` | 改任务 | ⚠️ **PUT 全量更新**：缺任一必填字段就 422 ⇒ 先 `get_task_detail` 再整体提交 |
| `patch_task_status` | 只改状态（批量） | 首选；⚠️ 描述说字典码、schema 却是 `integer`（**待后端对齐**） |

⚠️ **码是小写字典码**（`feature` / `todo` / `p0`），不是 `FEATURE` / `TODO` / `P0`。
⚠️ 工具输出**会被截断**（一次 20 条任务就有 990 行）⇒ 技能里要建议小 `page_size`。

---

## 9. 已知边界与未实现

| 项 | 状态 |
| -- | ---- |
| `action_request` / `state_dirty` / `auth_expired` / `heartbeat` 事件 | 设计里有，**服务端未实现** ⇒ 前端联合类型里没有，遇到会忽略 |
| 待确认的**写入口**（确认 / 撤销） | 服务端没有 ⇒ 前端只读 |
| 模型列表 / 配额端点 | 没有 ⇒ 只显示当前模型，不画配额条 |
| 命令类型 | 服务端当前只有 `create_task` 一条（设计里最终约 40 条） |
| `Last-Event-ID` 断点续传 | 服务端帧不带对外序号 ⇒ 实际从未生效（代码里留着接口） |
| pi 的 `thinking` 输出 | **可选**：思考级别由 `AI_THINKING_LEVEL` 控制（默认 `off` ⇒ 压根不产生）；开了则以 `thinking_delta` 外发，前端显示「思考中…」 |
| 「待确认」的**写入口**（确认/撤销） | 服务端没有 ⇒ 前端只读 |
| 凭证失效的 HTTP 状态 | 必须是 **401**（前端据此刷新 token）；⚠️ 服务端曾因跨 chunk 的 `instanceof` 失效而误返 500，已修 |

---

## 10. 排障速查

| 症状 | 原因 | 去看哪 |
| ---- | ---- | ---- |
| 页面上闪「AI 服务不可用」 | 首连瞬间 `connected=false` 被误判 | `useWorkspace.ts` 的 `everConnected` |
| 一直「我发了话，助手不回」 | 快照卡住 ⇒ 回放窗口一直开着 ⇒ 实时帧被攒着 | `useAgentStream.ts` 的 `REPLAY_MAX_WINDOW_MS` |
| 历史被渲染两遍 | 回放尾巴漏到窗口外 | `REPLAY_SETTLE_MS` / `tryCloseReplayWindow` |
| 重试把命令真跑了一遍 | 重试时换了新的命令 id | `useWorkspace.ts` 的 `lastCommandRef` |
| 事件流一直 401 | token 过期，没走静默刷新 | `sse.ts` 的 `refreshSession()` |
| 命令卡片重建后消失 | 快照里没有工具调用历史 | `mergeCommandSources()` |
| 请求打到 `/api/v1/ai-api/...` | `baseURL` 没置空 | `client.ts` 的 `aiRequest()` |
| 待确认列表永远是空的 | 服务端当前无破坏性命令 ⇒ 无待确认项 | `src/tools/index.ts` 的 `destructive` |
| AI 服务返 500「服务内部错误：凭证已失效」 | 跨 chunk 的 `instanceof` 失效（应为 401） | 服务端 `src/http/errors.ts` 的结构化判定 |

---

## 11. 相关文件索引

| 关注点 | 文件 |
| ------ | ---- |
| pi 会话构造 | `ai-admin-ai/src/agent/pi-session.ts` |
| **历史 → pi entries（上下文还原）** | `ai-admin-ai/src/agent/session-entries.ts` |
| 命令执行 / 去重 / 状态读取 | `ai-admin-ai/src/agent/runtime.ts` |
| 事件收敛 | `ai-admin-ai/src/agent/event-mapper.ts` |
| 事件定义（7 种） | `ai-admin-ai/src/agent/events.ts` |
| 回放窗口（16 MB） | `ai-admin-ai/src/agent/frame-buffer.ts` |
| 会话通道 / token / pi 会话生命周期 | `ai-admin-ai/src/agent/session-registry.ts` |
| 消息落库 | `ai-admin-ai/src/agent/store.ts` |
| SSE 帧写出 / 心跳 | `ai-admin-ai/src/http/sse.ts` |
| 事件流端点（回放 + 增量 + 去重） | `ai-admin-ai/src/app/api/agent/[conversationId]/events/route.ts` |
| 命令目录 | `ai-admin-ai/src/tools/index.ts` |
| 适配层（鉴权 / 映射 / 错误归一 / 幂等） | `ai-admin-ai/src/adapter/datasource.ts` |
| 审计写入 | `ai-admin-ai/src/audit.ts` |
| 前端 REST 客户端 | `ai-admin-com/src/services/api/ai/client.ts` |
| 前端 SSE 客户端 | `ai-admin-com/src/services/api/ai/sse.ts` |
| 前端流式状态机 | `ai-admin-com/src/components/ai-workspace/useAgentStream.ts` |
| 前端会话管理 | `ai-admin-com/src/components/ai-workspace/useWorkspace.ts` |
| 前端应用外壳 | `ai-admin-com/src/components/ai-workspace/AiWorkspaceShell.tsx` |
