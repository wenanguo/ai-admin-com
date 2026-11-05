# 前端 AI 工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `ai-admin-com` 里做出 **AI 工作台** —— 常驻右侧栏（对话 / 待确认 / 审计 三个页签）
+ 一个全宽页 `/ai/workspace`，接上已经在跑的 AI 服务（`D:/project/ai-admin-ai`）。

**Architecture:** 前端只做**界面与编排**：把用户的句子发给 AI 服务、把 SSE 事件流渲染成对话与命令卡片、
把待确认与审计读出来。**所有业务判定都在服务端**（哪条命令危险、能不能撤销、状态怎么算）。
前端**不做任何「这条命令危不危险」的判断** —— 那是命令层的事。

**Tech Stack:** React 19 · antd 6 · ProComponents 3 · Umi Max 4 · TypeScript · Vitest · Playwright

**Spec:** [`docs/superpowers/specs/2026-11-03-aipm-frontend-design.md`](../specs/2026-11-03-aipm-frontend-design.md)
§2 设计语言 · §3 AI 工作台（侧栏）· §4 全宽页 · §7 工程清单
（§3.5–§3.7 的契约已由 AI 服务的实现定死，见下）

**AI 服务已在跑**：`D:/project/ai-admin-ai`，`http://localhost:3100`，
已实现 `POST/GET /api/agent/conversations`、`POST /api/agent/:cid/command`、
`GET /api/agent/:cid/events`（SSE）、`GET /api/agent/:cid/state`、
`GET /api/audit`、`GET /api/pending`。**只读两个端点没有撤销与待确认的写入口**
（补偿式撤销属完整版计划；待确认的挂起/恢复同理）⇒ 前端的「撤销」与「确认执行」
按钮**要么不出现，要么禁用并说明**。

---

## Global Constraints

- **仓库**：`D:/project/ai-admin-com`，分支 `feat/pm-pages`（已合进 `main`；这个分支从 `main` 拉）。
- **前端 base URL 的前缀冲突**（必须注意）：
  - 现有代理规则是 `'/api/'` → AiAdmin（前端自己的 API base 是 `/api/v1`）。
  - AI 服务的路径也是 `/api/agent/...` ⇒ **若浏览器直接打 `/api/agent/...`，会被
    AiAdmin 的代理规则接走**（`'/api/'` 是前缀匹配，而 `/ai-api/...` **不会**）。
  - ⇒ **浏览器侧用独立前缀 `/ai-api/`**：完整 URL = `${AI_API_BASE_URL}/api/agent/...`，
    开发期 `AI_API_BASE_URL = '/ai-api'`，生产期是 AI 服务的绝对地址。
  - 开发期的代理：`'/ai-api/'` → `http://localhost:3100`，
    `pathRewrite: { '^/ai-api': '' }`（于是 `/ai-api/api/agent/x` → `http://localhost:3100/api/agent/x`）。
- **SSE 必须用 `fetch` + `ReadableStream`**，**不能用原生 `EventSource`** ——
  它带不了 `Authorization` 头。服务端也明确写了这一点。
- **token 透传**：前端把**当前用户的 AiAdmin token**（`src/auth/token.ts` 里那个）放进
  `Authorization: Bearer <token>` 发给 AI 服务；**不要**新造一套 token 存取。
- **不 mock**：AI 服务是真跑着的；e2e 里用 Playwright 的 `page.route` 拦 AI 服务
  （与现有 e2e 拦 AiAdmin 的做法一致）。
- **页面不自己弹 `message.success`/`message.error`**（请求层统一弹）。
- **只用 antd 6 的 token**，不引第二套设计语言；**不用原型里的紫→蓝渐变**（用 `Tag color="purple"`）。
- **中文注释**；提交信息用中文；subject 不得以大写拉丁词开头；**不要 push**。
- **TypeScript strict，无 `any`**。

---

### Task 1: AI 服务客户端（命令协议 · SSE · REST）

**Files:**
- Create: `src/services/api/ai/types.ts`、`client.ts`、`sse.ts`
- Test: `src/services/api/ai/client.test.ts`、`sse.test.ts`

**Interfaces:**
- Consumes: `getAccessToken`（`@/auth/token`）、`request`（`@umijs/max`）
- Produces:

```ts
// types.ts
export interface AiConversation { conversationId: string; title?: string; createdAt?: string; updatedAt?: string }
export interface AiMessage { id?: string; role: 'USER'|'ASSISTANT'|'SYSTEM'; content: string; toolCalls?: unknown }
export interface AiState { conversationId?: string; messages: AiMessage[]; isStreaming: boolean; model?: string }
export type AiEvent =
  | { type: 'connected'; conversationId: string; isStreaming: boolean }
  | { type: 'message_start'; role: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'message_end'; text?: string }
  | { type: 'tool_call'; toolName: string; args: unknown }
  | { type: 'tool_result'; toolName: string; status: 'ok'|'error'; summary?: string; details?: unknown }
  | { type: 'agent_settled' };
export interface AiAuditRow {
  id: string; command: string; actorType: 'AI'|'USER'; actorName?: string;
  args?: unknown; before?: unknown; after?: unknown;
  undoOf?: string | null; undoneAt?: string | null; adopted?: boolean | null;
  model?: string | null; tokens?: number | null; latencyMs?: number | null;
  traceId?: string | null; error?: string | null; createdAt: string;
}
export interface AiPendingRow {
  id: string; conversationId?: string | null; command: string;
  args?: unknown; preview?: unknown; status: string;
  expiresAt?: string | null; createdAt?: string;
}

// client.ts
export const AI_API_BASE_URL: string;   // process.env.AI_API_BASE_URL || '/ai-api'
export function aiUrl(path: string): string;   // `${AI_API_BASE_URL}${path}`
export async function listAiConversations(): Promise<AiConversation[]>;
export async function createAiConversation(title?: string): Promise<AiConversation>;
export async function getAiState(conversationId: string): Promise<AiState>;
export async function sendAiCommand(conversationId: string, id: string, message: string): Promise<{ id: string; success: boolean }>;
export async function listAiAudit(params?: { actor?: 'AI'|'USER'; command?: string; limit?: number }): Promise<{ total: number; items: AiAuditRow[] }>;
export async function listAiPending(status?: string): Promise<AiPendingRow[]>;

// sse.ts
export function subscribeAiEvents(conversationId: string, onEvent: (e: AiEvent) => void, onError?: (e: Error) => void): () => void;
```

- **`sendAiCommand` 的 id 必须是客户端生成的稳定 id**（例如 `cmd-${crypto.randomUUID()}`）——
  服务端按它**去重**（同一个 id 重发只跑一次）。**重试时必须复用同一个 id。**
- **`subscribeAiEvents`**：
  - 用 `fetch(aiUrl('/api/agent/:cid/events'), { headers: { Authorization: \`Bearer ${token}\` } })`
    读 `response.body` 的 `ReadableStream`；
  - 自己按 SSE 格式拆帧（`data:` 行累积到空行 = 一个事件；`event:` 行给出事件名）；
  - **重连**：断线后指数退避重连（起点 ~1s，上限 ~30s）；重连时带上 `Last-Event-ID`（若有）；
  - 返回一个**取消函数**（组件卸载时调用，abort 掉 fetch）。
  - ⚠️ 原生 `EventSource` **不可用**（带不了 `Authorization` 头）—— 服务端的 README 也这么写。

- [ ] **Step 1: 写失败的测试** —— `client.test.ts`（mock `@umijs/max` 的 request 与 `@/auth/token`）：
  - `命令带上当前用户的 token`
  - `URL 以 AI_API_BASE_URL 开头`
  - `审计与待确认解析成约定的形状`
  - `sse.test.ts`：
    - `把流里的帧解析成事件`（用一段假的 ReadableStream）
    - `断线后重连`（第一次流结束 ⇒ 第二次请求发生）
    - `取消函数会 abort`
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/services/api/ai` → Expected: FAIL
- [ ] **Step 3: 实现** —— 照上面的签名；`AI_API_BASE_URL` 从
  `process.env.AI_API_BASE_URL` 读，缺省 `/ai-api`。
  ⚠️ umi 的 `process.env.*` 只暴露 `UMI_ENV` 之类的内置变量 ⇒ 自定义变量要用
  `define` 在 `config/config.ts` 里配（读 `process.env.AI_API_BASE_URL`），或直接用
  `import.meta.env`/`process.env` 配合 umi 的 `define`。**先读 `config/config.ts` 看既有的做法。**
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 提交**

```bash
git add src/services/api/ai && git commit -F - <<'EOF'
feat(ai): AI 服务客户端

- 命令/会话/状态/审计/待确认的 REST 封装
- SSE 用 fetch + ReadableStream 自己拆帧(原生 EventSource 带不了 Authorization 头),
  断线指数退避重连,返回取消函数
- 命令 id 客户端生成且重试复用(服务端按它去重)
EOF
```

---

### Task 2: 侧栏容器与对话页签

**Files:**
- Create: `src/components/ai-workspace/index.tsx`、`ChatPanel.tsx`、`MessageBubble.tsx`、
  `CommandCard.tsx`、`Composer.tsx`、`useWorkspace.ts`、`useAgentStream.ts`
- Test: `src/components/ai-workspace/useAgentStream.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `subscribeAiEvents` / `sendAiCommand` / `createAiConversation` / `getAiState`
- Produces: `AiWorkspace` 组件（Task 4 把它挂进布局）

- **对话区**：用户气泡右对齐（`colorPrimary` 底白字）；助手气泡左对齐（白底 + 边框 + `Avatar`）。
- **助手气泡里**按顺序渲染：正文（`text_delta` 累积）→ 命令卡片 → 底部元信息。
- **命令卡片**：头（命令名等宽 + 状态 `Tag`）+ 体（`tool_result.summary`）+ 底（无）。
  状态取值：`tool_result.status === 'ok'` → `Tag color="success"`；`'error'` → `color="error"`；
  还没出结果（只有 `tool_call`）→ `color="processing"` + 「执行中」。
- **输入区**：单行输入 + 发送按钮；**流式中禁用输入**并显示「本轮进行中…」；
  空对话时显示 5 条快捷 chips（点击即填入输入框）：
  「@AI 建一个 SSO 登录任务」/「本周所有 P0 顺延到下周一」/「「预付款模块」还能按期完成吗？」/
  「识别「财务对账系统」的潜在风险」/「总结本周项目亮点与风险」。
- **流式状态机**（`useAgentStream`）：把 SSE 事件变成 UI 状态。
  `text_delta` 累积到当前气泡；`tool_call` 追加一张骨架卡片；`tool_result` 更新那张卡片；
  `agent_settled` 结束本轮并解禁输入；`message_start` 开一个新气泡。
  **断线重连后**用 `getAiState` **拉快照重建**（不要自己猜增量）。
- **会话**：首次打开时若无 `conversationId` ⇒ `createAiConversation()`；`conversationId` 持久化到
  `localStorage`；页面刷新后用 `getAiState` 恢复历史。

- [ ] **Step 1: 写失败的测试** —— `useAgentStream.test.ts`（喂假事件流，断言 UI 状态的变化）：
  `text_delta 累积成一个气泡` · `tool_call 追加卡片` · `tool_result 更新卡片` ·
  `agent_settled 结束本轮` · `断线后用 state 快照重建`
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/components/ai-workspace` → Expected: FAIL
- [ ] **Step 3: 实现** —— 照上面；中文注释
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 提交**

```bash
git add src/components/ai-workspace && git commit -F - <<'EOF'
feat(ai): AI 工作台侧栏的容器与对话页签

- 用户/助手气泡、命令卡片、输入区与快捷 chips
- useAgentStream 把 SSE 事件变成 UI 状态,断线用 state 快照重建
- 会话 id 持久化,刷新后恢复历史
EOF
```

---

### Task 3: 待确认与审计两个页签

**Files:**
- Create: `src/components/ai-workspace/PendingPanel.tsx`、`AuditPanel.tsx`、`PendingCard.tsx`
- Test: `src/components/ai-workspace/AuditPanel.test.tsx`

- **待确认页签**：
  - 空态：「没有待确认的操作 / 批量与破坏性操作会先在这里等你点头」。
  - 有数据时：照 spec §3.5 的卡片（命令名 + 状态标签 + 标题 + 命中清单 + 规则警告 + 三个按钮）。
  - ⚠️ **服务端目前没有「确认/取消/调整范围」的写入口**（属完整版计划）⇒
    三个按钮**要么不出现，要么禁用并 Tooltip 说明「该能力尚未开放」**。
    **不要**发一个注定 404 的请求。
  - 过期时间用 `dayjs` 的相对时间；≤ 5 分钟标红。
- **审计页签**：
  - 列表条目：圆点（`actorType==='AI'` → `colorPurple`；`'USER'` → `colorPrimary`）+ 摘要
    + 下方 `命令 · 执行人 · 相对时间`。
  - 「撤销」按钮**不出现**（服务端没有撤销端点）。
  - **脚注保留**：「审计记录 append-only：撤销是新增一条指向原记录的日志，不修改原记录。」
  - 空态：「还没有审计记录 / AI 的每次写入都会记在这里」。

- [ ] **Step 1: 写失败的测试** —— `AuditPanel.test.tsx`：
  `有数据时渲染命令与执行人` · `空态时给出说明` · `没有撤销按钮`
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx vitest run src/components/ai-workspace` → Expected: FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx vitest run` → Expected: PASS
- [ ] **Step 5: 提交**

```bash
git add src/components/ai-workspace && git commit -F - <<'EOF'
feat(ai): 待确认与审计两个页签

- 待确认卡片与空态;确认/取消/调整范围三个按钮因服务端尚无写入口而禁用并说明
- 审计条目、相对时间与 append-only 脚注;不显示撤销(服务端未实现)
EOF
```

---

### Task 4: 挂进布局 + 开发期代理

**Files:**
- Modify: `src/app.tsx`（`layout` 的 `childrenRender`）
- Modify: `config/config.ts`（`define` 里加 `AI_API_BASE_URL`）与 `config/proxy.ts`（加 `/ai-api/`）
- Create: `src/components/ai-workspace/styles.ts`（若需要）
- Test: `e2e/ai-workspace.spec.ts`

- **布局**：`childrenRender` 里返回 `<Layout>`，右侧挂 `AiWorkspace`：
  - 用 antd `Layout.Sider`（**不是 Drawer** —— AIPM 00 §3.3 明确否决了抽屉），
    `width={400}`、`collapsible`、`collapsedWidth={40}`；
  - 折叠时收成 40px 的竖条（图标 + 竖排「AI 工作台」），**主内容跟着收窄**；
  - `⌘B` / `Ctrl+B` 切换折叠；状态存 `localStorage`。
- **开发期代理**：`config/proxy.ts` 加
  ```ts
  '/ai-api/': { target: 'http://localhost:3100', changeOrigin: true, pathRewrite: { '^/ai-api': '' } },
  ```
  （三个 env 段 dev/test/pre 都要加。）
  ⚠️ **不要**改现有的 `'/api/'` 规则 —— 那是 AiAdmin 的。
- **`AI_API_BASE_URL`**：在 `config/config.ts` 的 `define` 里注入
  `'process.env.AI_API_BASE_URL': JSON.stringify(process.env.AI_API_BASE_URL || '/ai-api')`，
  前端读 `process.env.AI_API_BASE_URL`。
  开发时它在 `.env.local` 里设成 `/ai-api`（走代理）；生产时是 AI 服务的绝对地址。

- [ ] **Step 1: 写失败的 e2e** —— `e2e/ai-workspace.spec.ts`：
  - `侧边栏出现 AI 工作台`（Playwright 拦 AI 服务的接口）
  - `⌘B 能折叠与展开`（断言宽度/可见性变化）
  - `输入一句话能出现助手回复`（拦 SSE 路由，返回几帧固定事件）
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx playwright test e2e/ai-workspace.spec.ts` → Expected: FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx playwright test e2e/ai-workspace.spec.ts` → Expected: PASS
- [ ] **Step 5: 全量门禁** —— Run: `npm run lint && npm test && npm run build && npx playwright test --workers=3`
- [ ] **Step 6: 提交**

```bash
git add src/app.tsx config e2e/ai-workspace.spec.ts && git commit -F - <<'EOF'
feat(ai): AI 工作台挂进布局与开发期代理

- childrenRender 里用 antd Layout.Sider 挂常驻右栏(不是抽屉),
  折叠成 40px 竖条且主内容跟着收窄,⌘B 切换并持久化
- 开发期代理加 /ai-api/ → AI 服务(pathRewrite 去掉前缀),不动 AiAdmin 的 /api/ 规则
- AI_API_BASE_URL 通过 config 的 define 注入
EOF
```

---

### Task 5: 全宽页 `/ai/workspace`

**Files:**
- Create: `src/pages/ai/workspace/index.tsx`
- Modify: `config/routes.ts`
- Test: `e2e/ai-workspace-page.spec.ts`

- **页面结构**（照 spec §4）：
  - 头部：标题「AI 工作台」+ 副标题「命令层受控写入 · 实时引用」+ 右侧「历史对话」「新对话」按钮；
  - **工作台视图**（三个页签：待确认 / 审计 / 规则与 AI 的分工）—— 复用侧栏的两个面板；
  - **规则与 AI 的分工**双栏：左栏 `colorSuccess` 底（规则引擎：健康度 / 进度三口径 / 风险矩阵 /
    5 类风险识别 / ETA / 相对日期解析），右栏 `colorPurple` 底（LLM：意图抽取 / 结论措辞 /
    下一步建议 / 纪要摘要）；
    底部 `Alert type="warning"`：「边界：LLM 不能写库、不能定权限、不能自己决定要不要人确认。
    破坏性操作一律先进待确认队列；所有写操作留审计且可撤销。」
    ⚠️ **左栏的 ETA 那条要按实情写**：后端没有依赖图接口，CPM 关键路径不可用 ⇒
    ETA 实际只有 burndown，**不要写 P50/P90**。
  - **10 类意图卡片**（照原型）：进度查询 / Owner 查询 / 风险查询 / 负载查询 / 依赖查询 /
    历史相似 / 总结查询 / SLA 查询 / 文档查询 / 建议查询 —— **点击即把示例问句填进输入框**
    （不是直接发送）。
  - **模型与配额**：⚠️ 服务端**没有**模型列表与配额端点 ⇒ **只显示当前模型**
    （来自 `getAiState` 的 `model`），**不画配额进度条**（没有数据源就不画假数字）。
- **路由**：`/ai/workspace` 注册进 `config/routes.ts`。
- **入口**：从侧栏头部加一个「展开」链接跳到这个全宽页。

- [ ] **Step 1: 写失败的 e2e** —— `e2e/ai-workspace-page.spec.ts`：
  `页面能打开` · `规则与 AI 的分工两栏都在` · `意图卡片点击后输入框被填上` · `不画配额条`
- [ ] **Step 2: 跑测试确认失败** —— Run: `npx playwright test e2e/ai-workspace-page.spec.ts`
  Expected: FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑测试确认通过** —— Run: `npx playwright test e2e/ai-workspace-page.spec.ts` → Expected: PASS
- [ ] **Step 5: 全量门禁** —— Run: `npm run lint && npm test && npm run build && npx playwright test --workers=3`
- [ ] **Step 6: 提交**

```bash
git add src/pages/ai config/routes.ts e2e/ai-workspace-page.spec.ts && git commit -F - <<'EOF'
feat(ai): AI 工作台全宽页

- 头部、待确认/审计/规则分工三视图、10 类意图卡片(点击填入输入框)
- 只显示当前模型,不画没有数据源的配额条
- 规则栏的 ETA 按实情写(后端无依赖图,只有 burndown,没有 P50/P90)
EOF
```

---

## 完成判据

- [ ] `npm run lint` 干净 · `npm test` 全绿 · `npm run build` 成功 · `npx playwright test --workers=3` 全绿
- [ ] **手工验证**（对着**真跑着的** AI 服务）：
  1. 起 AI 服务（`cd D:/project/ai-admin-ai && NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev`）
  2. 起前端 `npm run dev`
  3. 登录 AiAdmin，在任意页面按 `⌘B` ⇒ 右侧出现 AI 工作台
  4. 输入「在项目 PRJ-2026-Q3-001 下建一个任务，标题叫「侧栏冒烟」，优先级 P1」
     ⇒ **看到流式回复 + 一张命令卡片**，且**任务真的出现在任务列表页**
  5. 切到「审计」页签 ⇒ **看到刚才那一条**（actorType=AI, command=create_task）
  6. 切到「待确认」页签 ⇒ 空态（「没有待确认的操作」）—— 因为本切片唯一的命令是非破坏性的
  7. 把刚才建的任务删掉（别留在共享生产库里）
- [ ] 报告里贴出**真实的**请求与响应（token 脱敏）

## 切片之外（完整版计划里的后续任务）

- **撤销**：`POST /api/audit/:id/undo`（补偿式）—— AI 服务的完整版 Task 4
- **待确认的挂起/恢复**：`pi.on("tool_call")` 返回 `{block:true, reason}` —— 完整版 Task 7
  ⇒ 在那之前，前端的「确认执行 / 取消 / 调整范围」是**禁用**的
- **AI 侧的其余命令**（查询项目、建里程碑、改风险…）与**规则引擎**的洞察输出
- **引用回跳**：AI 结论里的实体 id → 跳到对应页面（审计行的 `after` 里已有）
