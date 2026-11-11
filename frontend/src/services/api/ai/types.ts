/**
 * AI 服务（`D:/project/ai-admin-ai`）的**数据形状**。
 *
 * ⚠️ 每个字段都是**照着服务端的实现抄的**，改之前先对一眼：
 * - 会话 / 命令 / 事件：`src/agent/runtime.ts`、`src/agent/events.ts`、`src/agent/store.ts`
 * - 审计行：`src/audit-query.ts` 的 `AuditItem`
 * - 待确认行：`src/pending-query.ts` 的 `PendingItem`
 *
 * 前端**不做任何业务判定**（哪条命令危不危险、能不能撤销、状态怎么算）——
 * 那些是命令层与服务端的事。
 */

/**
 * AI 服务的响应信封（与 AiAdmin 同一套 `{code, msg, data}`，成功 `code === 0`）。
 *
 * ⚠️ 与 AiAdmin 的 `ApiResponse` 差在 `status_code` / `success` 两个字段上 ——
 * AI 服务只回 `{code, msg, data}`（服务端 `src/http/respond.ts` 的 `okEnvelope`）。
 */
export interface AiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

/** 一个会话（服务端 `src/agent/store.ts` 的 `ConversationRecord`）。 */
export interface AiConversation {
  conversationId: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 一条消息（角色与 `ai_message.role` 的枚举一致）。 */
export interface AiMessage {
  id?: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  /** 序号（服务端按它排序）。 */
  seq?: number;
  createdAt?: string;
}

/**
 * 会话快照（`GET /api/agent/:cid/state`）。
 *
 * ⚠️ **快照才是真相**：SSE 是增量的，断线/刷新/晚连都会丢帧 ⇒
 * 客户端随时可以用它重建界面。
 */
export interface AiState {
  conversationId?: string;
  messages: AiMessage[];
  isStreaming: boolean;
  model?: string;
}

/**
 * **讨论上下文**：当前正在跟 AI 聊的那条任务。
 *
 * ⚠️ **跨仓契约**（与服务端 `src/agent/context.ts` 一一对应）：
 * 前端把「用户点的那一行」原样发过去 ⇒ 服务端不自己查库
 * （查详情要 `…:detail` 权限，只有列表权限的角色会 403）。
 *
 * - `task` 是**回填基线**：后端 `update_task` 是**整对象 PUT**
 *   （缺 `project_id/title/type_code/status_code/priority_code` 就 422）
 *   ⇒ 基线必须带齐，服务端只在它之上改**允许改的那三个字段**。
 * - `labels` 是「线上码 → 中文」：服务端渲染成「in_progress（进行中）」
 *   ⇒ 模型照抄线上码就不会写出不存在的状态（线上码里**没有** `doing`）。
 */
export interface AiTaskContext {
  /**
   * 上下文是**任务**还是**项目**。
   *
   * ⚠️ 两种的差别很大：
   *    - `task` ⇒ 回填只能改**这一条**任务（服务端会把写参数收窄到它）；
   *    - `project` ⇒ 谈的是**整个项目**（可以列它的任务、改它的某条任务，
   *      但改哪条任务由模型决定，且只能改那三个可写字段）。
   */
  kind: 'task' | 'project';
  /** 任务对象（后端 update 的载荷形状）。`kind==='task'` 时必有。 */
  task?: Record<string, unknown> & { id: number };
  /** 字典中文名（线上码 → 中文）：状态/优先级/类型。 */
  labels?: Record<string, string>;
  /** 人名（负责人/报告人）。 */
  names?: { assignee?: string; reporter?: string };
  /** 所属项目。 */
  project?: { id: number; name: string };
  /** 所属里程碑。 */
  milestone?: { id: number; name: string };
  /** 项目上下文时的项目编码（给人看的）。 */
  projectCode?: string;
}

/**
 * SSE 事件（服务端 `src/agent/events.ts` 的 `SSE_EVENTS`）。
 *
 * ⚠️ **服务端实际只发这 8 种**：`connected` `message_start` `text_delta`
 * `thinking_delta` `message_end` `tool_call` `tool_result` `agent_settled` `pending`。
 * 设计里的 `action_request` / `state_dirty` / `auth_expired` / `heartbeat`
 * **还没实现** ⇒ 不写进这个联合类型。
 * 解析器遇到不认识的事件名会**忽略**它（服务端以后加事件，前端不会崩）。
 */
export type AiEvent =
  | { type: 'connected'; conversationId: string; isStreaming: boolean }
  | { type: 'message_start'; role: string }
  | { type: 'text_delta'; delta: string }
  /**
   * 思考增量（模型的「心里话」）。
   *
   * ⚠️ **默认收不到**：服务端的思考级别默认 `off` ⇒ 压根不产生这个事件。
   *    开了思考才会来 ⇒ 前端要能显示「思考中…」，否则界面看上去就是卡住了。
   */
  | { type: 'thinking_delta'; delta: string }
  /**
   * 一条助手消息结束。
   *
   * ⚠️ `error` **失败时才有**（服务端 `src/agent/events.ts` 的 MessageEndPayload）：
   * 前端要靠它分辨「这一轮失败了」与「这一轮正常结束」——
   * 丢掉了这个字段,界面就没办法把失败的那一轮标出来。
   */
  | { type: 'message_end'; text?: string; error?: string }
  | { type: 'tool_call'; toolName: string; args: unknown }
  | {
      type: 'tool_result';
      toolName: string;
      status: 'ok' | 'error';
      summary?: string;
      details?: unknown;
    }
  | { type: 'agent_settled' }
  /**
   * **挂起中**：模型想改已有数据，等人点头。
   *
   * ⚠️ 服务端在 `tool_call` hook 里同步挂起 ⇒ 这一轮在等 ⇒
   *    界面上要显示「等待你确认」（不然看起来像卡死）。
   */
  | {
      type: 'pending';
      id: string;
      command: string;
      args: Record<string, unknown>;
    }
  /**
   * **写回成功**：AI 真的改了某条任务。
   *
   * ⚠️ 服务端只在「写操作成功」时发 ⇒ 前端拿它把左边的列表/看板/甘特
   *    刷新一遍，并把那一行高亮（否则用户不知道写回落到哪了）。
   */
  | {
      type: 'entity_updated';
      entityType: 'task';
      entityId: number;
      fields: string[];
    };

/** 一条审计（服务端 `src/audit-query.ts` 的 `AuditItem`）。 */
export interface AiAuditRow {
  id: string;
  command: string;
  actorType: 'AI' | 'USER';
  actorName?: string;
  /** 参数（服务端读侧已脱敏）。 */
  args?: unknown;
  /** 写前快照。 */
  before?: unknown;
  /** 写后快照。 */
  after?: unknown;
  /** 撤销时指向的原审计行 id。 */
  undoOf?: string | null;
  undoneAt?: string | null;
  adopted?: boolean | null;
  model?: string | null;
  tokens?: number | null;
  latencyMs?: number | null;
  traceId?: string | null;
  error?: string | null;
  createdAt: string;
}

/** 一条待确认（服务端 `src/pending-query.ts` 的 `PendingItem`）。 */
export interface AiPendingRow {
  id: string;
  conversationId?: string | null;
  command: string;
  /** 参数（服务端读侧已脱敏）。 */
  args?: unknown;
  /** 预览摘要（给人看的，原样透出）。 */
  preview?: unknown;
  status: string;
  expiresAt?: string | null;
  createdAt?: string;
}
