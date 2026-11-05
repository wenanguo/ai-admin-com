/**
 * AI 服务客户端的测试 —— **不碰网络**。
 *
 * `@umijs/max` 的 `request` 与 `@/auth/token` 的 `getAccessToken` 都被替换掉：
 * 前者让我们能断言「发了什么请求」，后者让我们能断言「带了谁的 token」。
 */
import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_API_BASE_URL,
  aiUrl,
  createAiCommandId,
  createAiConversation,
  getAiState,
  listAiAudit,
  listAiConversations,
  listAiPending,
  sendAiCommand,
} from './client';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

vi.mock('@/auth/token', () => ({
  getAccessToken: vi.fn(() => 'token-abc'),
}));

/** 一次请求的记录（只列用得到的字段）。 */
interface RecordedRequest {
  method?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
}

/** 造一个成功信封（服务端 `src/http/respond.ts` 的 `okEnvelope`）。 */
function envelope<T>(data: T) {
  return { code: 0, msg: '成功', data };
}

/**
 * 取第 n 次请求的 [url, options]。
 *
 * ⚠️ `request` 是重载函数，`vi.mocked` 只保留了最后一个重载 ⇒ 这里补一次转换。
 */
function calls(): [string, RecordedRequest][] {
  return vi.mocked(request).mock.calls as unknown as [
    string,
    RecordedRequest,
  ][];
}

/** 取第 n 次请求的 [url, options]。 */
function callOf(index: number): [string, RecordedRequest] {
  const call = calls()[index];
  expect(call, `第 ${index + 1} 次请求没有发生`).toBeDefined();
  return call;
}

describe('AI 服务客户端', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(request).mockResolvedValue(envelope(null));
  });

  it('URL 以 AI_API_BASE_URL 开头', async () => {
    vi.mocked(request).mockResolvedValue(envelope([]));

    await listAiConversations();

    // ⚠️ 缺省就是 '/ai-api'（不能退回 AiAdmin 的 '/api/'）
    expect(AI_API_BASE_URL).toBe('/ai-api');
    const [url, options] = callOf(0);
    expect(url).toBe(`${AI_API_BASE_URL}/api/agent/conversations`);
    expect(url.startsWith(AI_API_BASE_URL)).toBe(true);
    // ⚠️ 共享实例的 baseURL 是 AiAdmin 的 '/api/v1' ⇒ 必须置空，
    // 否则 AI 服务的路径会被拼成 '/api/v1/ai-api/...'（打到错误的代理规则上）。
    expect(options.baseURL).toBe('');
  });

  it('命令带上当前用户的 token', async () => {
    vi.mocked(request).mockResolvedValue(
      envelope({ id: 'cmd-1', type: 'response', success: true }),
    );

    await sendAiCommand('c1', '建一个任务');

    const [, options] = callOf(0);
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer token-abc',
    });
  });

  it('命令 id 由客户端生成', async () => {
    vi.mocked(request).mockResolvedValue(
      envelope({ id: 'x', type: 'response', success: true }),
    );

    const ack = await sendAiCommand('c1', '建一个任务');

    expect(ack.id).toMatch(/^cmd-/);
    const [, options] = callOf(0);
    expect(options.data).toMatchObject({ id: ack.id, type: 'prompt' });
  });

  it('重试时复用同一个命令 id', async () => {
    vi.mocked(request).mockResolvedValue(
      envelope({ id: 'x', type: 'response', success: true }),
    );

    const first = await sendAiCommand('c1', '建一个任务');
    const second = await sendAiCommand('c1', '建一个任务', { id: first.id });

    expect(second.id).toBe(first.id);
    const sentIds = calls().map(
      ([, options]) => (options.data as { id: string }).id,
    );
    expect(sentIds).toEqual([first.id, first.id]);
  });

  it('生成的命令 id 形如 cmd-<uuid>', () => {
    expect(createAiCommandId()).toMatch(
      /^cmd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('审计与待确认解析成约定的形状', async () => {
    vi.mocked(request).mockResolvedValue(
      envelope({
        total: 1,
        items: [
          {
            id: 'a1',
            command: 'create_task',
            actorType: 'AI',
            actorName: '张三',
            args: { title: '侧栏冒烟' },
            before: null,
            after: { id: 7 },
            undoOf: null,
            undoneAt: null,
            adopted: null,
            model: 'pi',
            tokens: 12,
            latencyMs: 30,
            traceId: 'trace-1',
            error: null,
            createdAt: '2026-11-04T00:00:00.000Z',
          },
        ],
      }),
    );

    const page = await listAiAudit({
      actor: 'AI',
      command: 'create_task',
      limit: 10,
    });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 'a1',
      command: 'create_task',
      actorType: 'AI',
      createdAt: '2026-11-04T00:00:00.000Z',
    });
    const [url, options] = callOf(0);
    expect(url).toBe(`${AI_API_BASE_URL}/api/audit`);
    expect(options.params).toMatchObject({
      actor: 'AI',
      command: 'create_task',
      limit: 10,
    });
  });

  it('待确认列表解析成约定的形状', async () => {
    vi.mocked(request).mockResolvedValue(
      envelope([
        {
          id: 'p1',
          conversationId: 'c1',
          command: 'batch_update',
          args: { ids: [1, 2] },
          preview: { title: '批量顺延' },
          status: 'PENDING',
          expiresAt: '2026-11-04T01:00:00.000Z',
          createdAt: '2026-11-04T00:30:00.000Z',
        },
      ]),
    );

    const items = await listAiPending();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'p1',
      command: 'batch_update',
      status: 'PENDING',
    });
    const [url] = callOf(0);
    expect(url).toBe(`${AI_API_BASE_URL}/api/pending`);
  });

  it('会话列表与新建会话', async () => {
    vi.mocked(request).mockResolvedValue(
      envelope([
        {
          conversationId: 'c1',
          title: '侧栏冒烟',
          updatedAt: '2026-11-04T00:00:00.000Z',
        },
      ]),
    );

    const conversations = await listAiConversations();

    expect(conversations).toHaveLength(1);
    expect(conversations[0].conversationId).toBe('c1');

    vi.mocked(request).mockResolvedValue(
      envelope({
        conversationId: 'c2',
        title: '新对话',
        createdAt: '2026-11-04T01:00:00.000Z',
      }),
    );
    const created = await createAiConversation('新对话');
    expect(created.conversationId).toBe('c2');
    const [, options] = callOf(1);
    expect(options.data).toMatchObject({ title: '新对话' });
  });

  it('取会话快照', async () => {
    vi.mocked(request).mockResolvedValue(
      envelope({
        conversationId: 'c1',
        messages: [
          {
            id: 'm1',
            role: 'USER',
            content: '建个任务',
            seq: 1,
            createdAt: '2026-11-04T00:00:00.000Z',
          },
        ],
        isStreaming: false,
        model: 'pi',
      }),
    );

    const state = await getAiState('c1');

    expect(state.conversationId).toBe('c1');
    expect(state.messages[0].role).toBe('USER');
    expect(state.isStreaming).toBe(false);
    const [url] = callOf(0);
    expect(url).toBe(`${AI_API_BASE_URL}/api/agent/c1/state`);
  });

  it('aiUrl 拼在 AI_API_BASE_URL 后面', () => {
    expect(aiUrl('/api/agent/c1/events')).toBe(
      `${AI_API_BASE_URL}/api/agent/c1/events`,
    );
  });
});
