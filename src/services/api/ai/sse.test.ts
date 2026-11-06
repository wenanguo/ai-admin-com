/**
 * SSE 客户端的测试 —— **不碰网络**。
 *
 * `fetch` 被替换掉，喂的是**假的 ReadableStream**：
 * 这样「拆帧 / 忽略未知事件 / 断线重连 / 取消」都能在浏览器里跑，不需要真的服务。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_API_BASE_URL } from './base';
import { subscribeAiEvents, toAiEvent } from './sse';
import type { AiEvent } from './types';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

vi.mock('@/auth/token', () => ({
  getAccessToken: vi.fn(() => 'token-abc'),
  // ⚠️ `@/auth/session` 会 import 这几个（这里只 import 不会报错，
  //    但缺了的话真调起来会炸）⇒ 补齐。
  clearAuth: vi.fn(),
  getRefreshToken: vi.fn(() => 'refresh-abc'),
  isRememberMe: vi.fn(() => true),
  setTokens: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(async () => 'token-new'),
}));

vi.mock('@/auth/session', () => ({
  refreshSession: mocks.refreshSession,
}));

/** 造一帧标准 SSE（服务端 `src/http/sse.ts` 的 `frameToSse`）。 */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 造一段假的 SSE 流（读完就结束）。 */
function streamOf(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/** 造一段永不结束的流（模拟「连上了但不说话」）。 */
function openStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start() {
      // 什么都不做 ⇒ 流不结束
    },
  });
}

/** 假的 fetch：返回给定的响应体。 */
function stubFetch(bodies: ReadableStream<Uint8Array>[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = bodies.shift();
    return {
      ok: true,
      status: 200,
      body: body ?? openStream(),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls };
}

describe('AI 事件流订阅', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('把流里的帧解析成事件', async () => {
    const { calls } = stubFetch([
      streamOf(
        frame('connected', { conversationId: 'c1', isStreaming: false }) +
          frame('message_start', { conversationId: 'c1', role: 'assistant' }) +
          frame('text_delta', { conversationId: 'c1', delta: '你好' }),
      ),
    ]);
    const events: AiEvent[] = [];

    const cancel = subscribeAiEvents('c1', (event) => events.push(event));

    await vi.waitFor(() => expect(events).toHaveLength(3));
    expect(events).toEqual([
      { type: 'connected', conversationId: 'c1', isStreaming: false },
      { type: 'message_start', role: 'assistant' },
      { type: 'text_delta', delta: '你好' },
    ]);
    expect(calls[0]?.url).toBe(`${AI_API_BASE_URL}/api/agent/c1/events`);
    cancel();
  });

  it('请求带上当前用户的 token', async () => {
    const { calls } = stubFetch([openStream()]);

    const cancel = subscribeAiEvents('c1', () => undefined);

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-abc');
    cancel();
  });

  it('不认识的事件名被忽略', async () => {
    stubFetch([
      streamOf(
        frame('unknown_event', { conversationId: 'c1', thought: '想一下' }) +
          frame('agent_settled', { conversationId: 'c1' }),
      ),
    ]);
    const events: AiEvent[] = [];

    const cancel = subscribeAiEvents('c1', (event) => events.push(event));

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({ type: 'agent_settled' });
    cancel();
  });

  it('thinking_delta 被映射成思考事件', async () => {
    // ⚠️ 思考级别默认 `off` ⇒ 服务端平时不发这个事件；
    //    开了思考才会来 ⇒ 前端要认它（否则界面看上去就是卡住）。
    stubFetch([
      streamOf(
        frame('thinking_delta', { conversationId: 'c1', delta: '先想想…' }) +
          frame('agent_settled', { conversationId: 'c1' }),
      ),
    ]);
    const events: AiEvent[] = [];

    const cancel = subscribeAiEvents('c1', (event) => events.push(event));

    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[0]).toEqual({ type: 'thinking_delta', delta: '先想想…' });
    expect(events[1]).toEqual({ type: 'agent_settled' });
    cancel();
  });

  it('注释行（心跳）被忽略', async () => {
    stubFetch([
      streamOf(
        ': heartbeat\n\n' +
          frame('text_delta', { conversationId: 'c1', delta: 'x' }),
      ),
    ]);
    const events: AiEvent[] = [];

    const cancel = subscribeAiEvents('c1', (event) => events.push(event));

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({ type: 'text_delta', delta: 'x' });
    cancel();
  });

  it('message_end 保留失败原因(error)', () => {
    // 服务端 `src/agent/events.ts` 的 MessageEndPayload 带 error ——
    // 前端要靠它分辨「这一轮失败了」和「这一轮正常结束」
    const event = toAiEvent({
      event: 'message_end',
      data: JSON.stringify({
        conversationId: 'c1',
        text: '',
        error: '模型调用失败',
      }),
    });

    expect(event).toEqual({
      type: 'message_end',
      text: '',
      error: '模型调用失败',
    });
  });

  it('message_end 正常结束时没有 error', () => {
    const event = toAiEvent({
      event: 'message_end',
      data: JSON.stringify({ conversationId: 'c1', text: '好的' }),
    });

    expect(event).toEqual({ type: 'message_end', text: '好的' });
  });

  it('断线后重连', async () => {
    const { mock } = stubFetch([
      streamOf(frame('agent_settled', { conversationId: 'c1' })),
      openStream(),
    ]);

    const cancel = subscribeAiEvents('c1', () => undefined, undefined, {
      initialRetryDelayMs: 5,
      maxRetryDelayMs: 20,
    });

    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    cancel();
  });

  it('取消函数会 abort', async () => {
    const { calls } = stubFetch([openStream()]);

    const cancel = subscribeAiEvents('c1', () => undefined, undefined, {
      initialRetryDelayMs: 5,
    });

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const signal = calls[0]?.init?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    cancel();

    expect(signal.aborted).toBe(true);
  });

  it('401（token 过期）先静默刷新,再重连', async () => {
    // ⚠️ token 过期时事件流会一直 401 ⇒ 对话静默死掉（规格 §3.10）。
    //    ⇒ 收到 401 要先走 AiAdmin 的静默刷新流程，再重连。
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return {
          ok: false,
          status: 401,
          body: null,
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        body: openStream(),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', mock);

    const errors: Error[] = [];
    const cancel = subscribeAiEvents(
      'c1',
      () => undefined,
      (error) => errors.push(error),
      { initialRetryDelayMs: 5, maxRetryDelayMs: 20 },
    );

    // 刷新被调了
    await vi.waitFor(() => expect(mocks.refreshSession).toHaveBeenCalled());
    // 然后重连了（第二次请求）
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    // 失败被报出来了（界面据此显示「AI 服务不可用」）
    expect(errors.length).toBeGreaterThanOrEqual(1);
    cancel();
  });
});
