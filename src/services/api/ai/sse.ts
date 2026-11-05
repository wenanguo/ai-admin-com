/**
 * AI 服务的事件流（SSE）客户端。
 *
 * ## 为什么不用原生 `EventSource`
 *
 * 原生 `EventSource` **不能自定义请求头** ⇒ 带不了 `Authorization: Bearer <token>`，
 * 而 AI 服务的 `/api/agent/:cid/events` 必须要它（缺了就 401）。
 * 服务端的 README 与端点注释里也写了同一条。
 * ⇒ 这里用 `fetch` + `response.body`（`ReadableStream`）**自己拆 SSE 帧**。
 *
 * ## 帧格式（标准 SSE，服务端 `src/http/sse.ts`）
 *
 * ```
 * event: text_delta
 * data: {"conversationId":"...","delta":"你"}
 *
 * ```
 * - `event:` 行给出事件名，`data:` 行给出 JSON 载荷；
 * - 一帧到**空行**为止；`data:` 可以有多行（用换行拼起来）；
 * - `:` 开头的行是注释（服务端每 15 秒一次心跳）⇒ **忽略**；
 * - 不认识的字段、不认识的事件名 ⇒ **忽略**（服务端以后加事件，前端不会崩）。
 *
 * ## 断线怎么办
 *
 * 指数退避重连（起点 1 秒，上限 30 秒）。服务端**每次连接都先发一帧 `connected`**
 * ⇒ 重连后可以据此重新同步（配合 `getAiState` 的快照重建界面）。
 */
import { getAccessToken } from '@/auth/token';
import { aiUrl } from './client';
import type { AiEvent } from './types';

/** 一帧 SSE（还没映射成业务事件）。 */
export interface SseFrame {
  /** 事件名（`event:` 行；没有就是标准默认的 `message`）。 */
  event: string;
  /** 载荷（`data:` 行拼起来的原文）。 */
  data: string;
  /** 事件 id（`id:` 行；服务端目前不发）。 */
  id?: string;
}

/** 拆帧过程中的可变状态。 */
interface FrameState {
  /** 当前帧的事件名。 */
  event: string;
  /** 当前帧的 `data:` 行。 */
  data: string[];
  /** 最近一次 `id:` 行的值（跨帧保留）。 */
  id?: string;
}

/** 首次重连的等待毫秒数。 */
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1000;

/** 重连等待的上限毫秒数。 */
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

/**
 * 把一段 SSE 流拆成帧。
 *
 * @param body `fetch` 响应体（`ReadableStream`）。
 */
export async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state: FrameState = { event: '', data: [] };
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // ⚠️ `{stream: true}`：一个多字节字符可能被切在两块之间
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const frame = consumeLine(line, state);
        if (frame !== undefined) {
          yield frame;
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }
  } finally {
    // 提前退出（组件卸载）时把读取消掉，别让 pending read 悬着
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * 处理一行：空行 = 一帧结束；注释行忽略；不认识的字段忽略。
 *
 * @returns 这一行结束时凑齐的一帧（没有则 undefined）。
 */
function consumeLine(rawLine: string, state: FrameState): SseFrame | undefined {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

  // 空行 ⇒ 一帧结束
  if (line === '') {
    return flushFrame(state);
  }

  // 注释行（心跳）⇒ 忽略
  if (line.startsWith(':')) {
    return undefined;
  }

  const colonIndex = line.indexOf(':');
  const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
  let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
  // 冒号后**有一个**空格要去掉
  if (value.startsWith(' ')) {
    value = value.slice(1);
  }

  switch (field) {
    case 'event':
      state.event = value;
      break;
    case 'data':
      state.data.push(value);
      break;
    case 'id':
      state.id = value;
      break;
    default:
      // 不认识的字段 ⇒ 忽略（标准 SSE 的要求）
      break;
  }
  return undefined;
}

/** 收尾一帧（没有 `data:` 的不算一帧 —— 标准 SSE 的规则）。 */
function flushFrame(state: FrameState): SseFrame | undefined {
  if (state.data.length === 0) {
    state.event = '';
    return undefined;
  }
  const frame: SseFrame = {
    event: state.event === '' ? 'message' : state.event,
    data: state.data.join('\n'),
  };
  if (state.id !== undefined) {
    frame.id = state.id;
  }
  state.event = '';
  state.data = [];
  return frame;
}

/** 把一帧的 `data:` 解析成对象（不是合法 JSON 就当空载荷）。 */
function parsePayload(data: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 不是合法 JSON ⇒ 当空载荷
  }
  return {};
}

/** 读一个字符串字段（没有就当空串）。 */
function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/** 读一个可选的字符串字段（没有就是 undefined）。 */
function readOptionalString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * 把一帧映射成业务事件。
 *
 * @returns 认识的事件；**不认识的事件名 ⇒ undefined（忽略）**。
 */
export function toAiEvent(frame: SseFrame): AiEvent | undefined {
  const payload = parsePayload(frame.data);
  switch (frame.event) {
    case 'connected':
      return {
        type: 'connected',
        conversationId: readString(payload, 'conversationId'),
        isStreaming: payload.isStreaming === true,
      };
    case 'message_start':
      return { type: 'message_start', role: readString(payload, 'role') };
    case 'text_delta':
      return { type: 'text_delta', delta: readString(payload, 'delta') };
    case 'message_end':
      return { type: 'message_end', text: readOptionalString(payload, 'text') };
    case 'tool_call':
      return {
        type: 'tool_call',
        toolName: readString(payload, 'toolName'),
        args: payload.args,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        toolName: readString(payload, 'toolName'),
        status: payload.status === 'error' ? 'error' : 'ok',
        summary: readOptionalString(payload, 'summary'),
        details: payload.details,
      };
    case 'agent_settled':
      return { type: 'agent_settled' };
    default:
      // ⚠️ 服务端以后加新事件时，前端不会崩（这一帧被丢掉）
      return undefined;
  }
}

/** 订阅选项（缺省用生产值；测试用它把退避调小）。 */
export interface SubscribeAiEventsOptions {
  /** 首次重连的等待毫秒数（缺省 1000）。 */
  initialRetryDelayMs?: number;
  /** 重连等待的上限毫秒数（缺省 30000）。 */
  maxRetryDelayMs?: number;
}

/**
 * 订阅某个会话的事件流。
 *
 * @param conversationId 会话 id。
 * @param onEvent 事件回调。
 * @param onError 出错回调（每次失败都会叫一次；重连本身不算错误）。
 * @returns **取消函数**（组件卸载时调用 ⇒ abort 掉正在跑的 fetch）。
 */
export function subscribeAiEvents(
  conversationId: string,
  onEvent: (event: AiEvent) => void,
  onError?: (error: Error) => void,
  options?: SubscribeAiEventsOptions,
): () => void {
  const initialDelay =
    options?.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;
  const maxDelay = options?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;

  const controller = new AbortController();
  let closed = false;
  /** 已经连续失败了几次（连上就归零）。 */
  let failures = 0;
  /** 最近一次收到的事件 id（重连时带上 `Last-Event-ID`）。 */
  let lastEventId: string | undefined;

  const run = async (): Promise<void> => {
    while (!closed) {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${getAccessToken()}`,
          Accept: 'text/event-stream',
        };
        if (lastEventId !== undefined) {
          headers['Last-Event-ID'] = lastEventId;
        }

        const response = await fetch(
          aiUrl(`/api/agent/${conversationId}/events`),
          { headers, signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`AI 事件流请求失败（HTTP ${response.status}）`);
        }
        const body = response.body;
        if (body === null) {
          throw new Error('AI 事件流没有响应体');
        }
        // 连上了 ⇒ 退避归零
        failures = 0;

        for await (const frame of readSseFrames(body)) {
          if (closed) {
            return;
          }
          if (frame.id !== undefined) {
            lastEventId = frame.id;
          }
          const event = toAiEvent(frame);
          if (event === undefined) {
            // 不认识的事件 ⇒ 忽略
            continue;
          }
          if (event.type === 'connected') {
            // 服务端每次连接都先发 connected ⇒ 可以据此重新同步
            failures = 0;
          }
          onEvent(event);
        }
      } catch (error) {
        if (closed) {
          return;
        }
        onError?.(toError(error));
      }

      if (closed) {
        return;
      }
      // 指数退避：1s → 2s → 4s …… 上限 30s
      const delay = Math.min(maxDelay, initialDelay * 2 ** failures);
      failures += 1;
      await sleep(delay, controller.signal);
    }
  };

  void run();

  return () => {
    closed = true;
    controller.abort();
  };
}

/** 未知错误转成 `Error`。 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** 睡一会儿（被 abort 时立刻醒）。 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve();
    };
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
