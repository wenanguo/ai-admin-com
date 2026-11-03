# 03 · API 契约（前端 ↔ 后端）

> 三种交互：**REST**（业务数据）、**命令协议**（对话）、**SSE**（流式事件）。
> 前端**永远不直连外部 API**（否则凭据泄露、权限绕过、审计断链）。

## 1. 鉴权

- 前端 → 后端：`httpOnly` cookie（session token），所有 `/api/*` 校验。
- 后端 → 外部 API：服务账号凭据放服务端环境变量，前端不可见。
- 后端 → 模块①（同进程调用，不走网络）。
- **agent 不自行声称身份**：它的一切数据访问都经后端，后端按当前 session 用户做 RBAC。

## 2. REST（业务数据）

### 2.1 业务实体
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects` | 项目列表（过滤：status / owner / tag） |
| POST | `/api/projects` | 新建（走适配层，写审计） |
| GET | `/api/projects/:key` | 项目详情 |
| PATCH | `/api/projects/:key` | 更新 |
| GET | `/api/projects/:key/milestones` | 里程碑列表 |
| GET | `/api/projects/:key/tasks` | 任务列表 |
| GET | `/api/projects/:key/risks` | 风险列表 |
| GET | `/api/projects/:key/progress` | 进度三口径 + ETA |
| GET | `/api/projects/:key/burndown` | 燃尽图数据 |
| GET | `/api/projects/:key/overview` | 概览（KPI + 风险摘要 + 里程碑摘要） |
| GET | `/api/tasks/:key` | 任务详情 |
| PATCH | `/api/tasks/:key` | 更新 |
| POST | `/api/tasks/:key/transition` | 状态迁移 `{ event, reason? }` |
| POST | `/api/tasks/batch` | 批量更新 `{ filter, set, reason? }` |
| GET | `/api/milestones/:key` / PATCH | 里程碑 |
| GET | `/api/risks/:key` / PATCH | 风险 |
| POST | `/api/risks/:key/to-task` | 风险转应对任务 |
| GET | `/api/search?q=` | 跨实体检索（指代消解） |

**写操作约定**
- 所有 PATCH/POST 都经适配层 → 写前快照 → 执行 → 写 `AuditLog`（同事务，INV-07）。
- 批量返回**逐条结果**：`{ ok: n, failed: m, results: [{ key, ok, error? }] }`。
- 需要确认的危险操作由**前端**发起确认流程（见 §5），REST 层不直接提供"绕过确认"的写入口。

### 2.2 审计与撤销
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/audit` | 审计列表（过滤：actor / command / 时间 / 是否已撤销） |
| GET | `/api/audit/:id` | 单条详情（含前后快照 diff） |
| POST | `/api/audit/:id/undo` | 补偿式撤销（返回逐条结果，冲突时拒绝） |

### 2.3 待确认（页签列表用；**执行**走 §3 的 action_response）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pending` | 待确认列表（按 user / status 过滤） |
| GET | `/api/pending/:id` | 单条详情 |
| POST | `/api/pending/:id/confirm` | **兜底通道**：当 agent 会话已不在（如重启后）时直接执行。正常路径走 §3 的 `action_response` |
| POST | `/api/pending/:id/reject` | 拒绝 |
| POST | `/api/pending/:id/adjust` | 调整范围 `{ args }` → 重新预览并生成新待确认 |

> `confirm` 是**兜底**而非主路径。主路径是 `action_response`（原地恢复工具调用，零额外 LLM 调用）。两条路径都要保证"执行 + 审计"在同一事务内，且**幂等**（同一 actionId 重复确认只执行一次）。

## 3. 命令协议（对话）

前端发**与 pi RPC 同构**的命令，统一走 `POST /api/agent/:conversationId/command`。

```ts
type ClientCommand =
  | { id: string; type: "prompt"; message: string; context?: { projectKey?: string } }
  | { id: string; type: "steer"; message: string }        // 插入当前轮次
  | { id: string; type: "abort" }
  | { id: string; type: "get_state" }
  | { id: string; type: "action_response"; actionId: string;
      decision: "confirm" | "reject" | "adjust"; args?: unknown }
  | { id: string; type: "fork"; fromEntryId?: string };
```

**响应**
```json
{ "id": "req-1", "type": "response", "command": "prompt", "success": true, "data": { "disposition": "started" } }
```
失败：`{ "success": false, "error": "..." }`。

**语义要点**
- `prompt` 成功只表示**已受理**（排队或开始），不代表模型工作完成——完成看 SSE 的 `agent_settled`。
- `steer`：在当前 assistant 轮次及其工具调用之后插入。正在流式时必须显式指定 steer 还是 follow-up，不猜。
- `action_response.confirm` **不新建执行流程**，而是唤醒被挂起的工具调用（§5）。
- `action_response.adjust`：取消当前挂起 → 重新预览 → 发起新 `action_request`（新 actionId）。
- `fork`：从某条消息开分支，原会话历史保留。

## 4. SSE 事件流

```
GET /api/agent/:conversationId/events      （text/event-stream）
```

**首帧**
```json
{ "type": "connected", "conversationId": "...", "isStreaming": false, "pendingActionIds": ["act_1"] }
```
`pendingActionIds` 用于**重连后恢复待确认卡片**。

**事件类型**

| 事件 | 载荷 | 前端渲染 |
|---|---|---|
| `connected` | conversationId, isStreaming, pendingActionIds | 建立连接 / 恢复待确认 |
| `message_start` | message | 对话气泡开始 |
| `text_delta` | delta | 文本增量 |
| `message_end` | message | 气泡完成 |
| `thinking_delta` | delta | "AI 正在思考"（可折叠） |
| `tool_call` | toolName, args 摘要 | 命令卡片（骨架态） |
| `tool_result` | toolName, status, 影响范围, auditId | 命令卡片（完成态 + 撤销按钮） |
| `action_request` | actionId, command, preview, expiresAt | **待确认卡片** |
| `action_resolved` | actionId, decision, result | 卡片消失或标记已执行 |
| `state_dirty` | 受影响的实体类型 | 提示主内容区刷新 |
| `agent_settled` | — | 本轮完全结束 |
| `heartbeat` | — | 保活 |

**背压与丢帧**
- 每连接 backlog 上限 16MB；超限时丢弃**可重建的增量帧**（`text_delta` / `thinking_delta`），保留结构性事件（`tool_call` / `tool_result` / `action_request` / `action_resolved` / `state_dirty`）。
- 客户端丢帧后用 `GET /api/agent/:conversationId/state` 拉快照重建——**快照是最终真相**。

**状态快照**
```
GET /api/agent/:conversationId/state
→ { conversation, messages[], pendingActions[], isStreaming, model, thinkingLevel }
```

## 5. 待确认时序

```
用户: "把本周所有 P0 任务的截止日顺延到下周一"
  │
  ├─ agent 调 tool batch_update_tasks
  │    └─ execute() 内：
  │         1. preview(args) → 命中清单 + 旧值 + 规则警告
  │         2. 写 PendingAction(status=PENDING, expires_at=+30min)
  │         3. 发 extension_ui_request → await promise（挂起）
  │    ← SSE: { type:"tool_call", toolName:"batch_update_tasks" }
  │    ← SSE: { type:"action_request", actionId, preview, expiresAt }
  │
用户点【确认】
  │
  ├─ POST /api/agent/:cid/command  { type:"action_response", actionId, decision:"confirm" }
  │    └─ 后端 resolve promise → 工具原地恢复
  │         → 适配层执行（写前快照 → 执行 → 写 AuditLog）
  │         → 工具返回结果 → agent 本轮自然收尾："已把 3 个任务顺延到 3-16"
  │    ← SSE: { type:"tool_result", status:"ok", auditId }
  │    ← SSE: { type:"action_resolved", actionId, decision:"confirm" }
  │    ← SSE: { type:"state_dirty", entities:["task"] }
  │    ← SSE: { type:"agent_settled" }
```

**超时**：30 分钟（`expires_at`）→ 惰性判定 + 每日清理任务 → `EXPIRED`；用户此时确认 → 提示"预览已过期，请让 AI 重新生成"。

**断线**：挂起态在服务端；重连后 `connected` 帧带 `pendingActionIds`，前端恢复卡片。

## 6. 埋点字段

写操作产生 `AuditLog`，其中可用于指标统计的字段：

| 字段 | 用途 |
|---|---|
| `actor_type` | `AI` / `USER` —— 分流统计 |
| `command` | 命令维度 |
| `adopted` | 用户是否采纳 AI 建议（确认=是；拒绝=否；确认后撤销=单独统计） |
| `undone_at` | 回滚率 |
| `model` / `tokens` / `latency_ms` | 成本与性能 |
| `trace_id` | 贯穿一次对话的链路 |

## 7. 错误约定

| 错误码 | HTTP | 含义 | 前端行为 |
|---|---|---|---|
| `VALIDATION` | 400 | 参数不合法 | 显示字段级错误 |
| `NOT_FOUND` | 404 | 实体不存在（可能已被外部删除） | 提示并刷新视图 |
| `CONFLICT` | 409 | 外部系统状态冲突（如里程碑已完成） | 提示冲突原因，建议刷新 |
| `RATE_LIMIT` | 429 | 外部 API 限速 | 提示稍后重试，**不重试写操作** |
| `AUTH_EXPIRED` | 401 | 外部凭据失效 | 提示联系管理员；**不重试** |
| `AI_UNAVAILABLE` | 503 | 模型不可用 | 提示"AI 暂不可用，请手动操作"；**手动路径不受影响** |
| `LLM_UNAVAILABLE` | 503 | 模型未发起工具调用 | 纠正重试 1 次，仍失败则放弃该轮 |

> **写操作不自动重试**（除非带 `Idempotency-Key` 且适配层确认幂等）。读操作可重试一次。
