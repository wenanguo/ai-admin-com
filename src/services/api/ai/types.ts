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
 * SSE 事件（服务端 `src/agent/events.ts` 的 `SSE_EVENTS`）。
 *
 * ⚠️ **服务端实际只发这 8 种**：`connected` `message_start` `text_delta`
 * `thinking_delta` `message_end` `tool_call` `tool_result` `agent_settled`。
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
  | { type: 'agent_settled' };

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
