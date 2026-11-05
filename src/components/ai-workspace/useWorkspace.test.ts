/**
 * AI 工作台**会话**的测试 —— 不碰网络。
 *
 * 钉死四件事：
 * 1. 没有存过的会话 ⇒ 新建一个，并记住它（刷新后还在）
 * 2. 存过的会话 ⇒ 直接复用，不新建
 * 3. 服务端已经没有这个会话 ⇒ 换一个（不能一直对着死会话发消息）
 * 4. **命令 id 由组件自己生成**：重试必须复用同一个 id
 *    （服务端按 id 去重，换一个 id 就会把命令真的再执行一遍）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import { WORKSPACE_STORAGE_KEY } from './storage';
import { useWorkspace } from './useWorkspace';

const mocks = vi.hoisted(() => ({
  createAiConversation: vi.fn(),
  getAiState: vi.fn(),
  sendAiCommand: vi.fn(),
  createAiCommandId: vi.fn(),
  subscribeAiEvents: vi.fn(() => () => undefined),
}));

vi.mock('@/services/api/ai/client', () => ({
  AI_API_BASE_URL: '/ai-api',
  aiUrl: (path: string) => `/ai-api${path}`,
  createAiCommandId: mocks.createAiCommandId,
  sendAiCommand: mocks.sendAiCommand,
  createAiConversation: mocks.createAiConversation,
  getAiState: mocks.getAiState,
  listAiAudit: vi.fn(),
  listAiPending: vi.fn(),
  listAiConversations: vi.fn(),
}));

vi.mock('@/services/api/ai/sse', () => ({
  subscribeAiEvents: mocks.subscribeAiEvents,
  readSseFrames: vi.fn(),
  toAiEvent: vi.fn(),
}));

/** 服务端的会话快照。 */
const SNAPSHOT = {
  conversationId: 'c-old',
  messages: [],
  isStreaming: false,
};

describe('AI 工作台的会话', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.createAiCommandId.mockReturnValue('cmd-1');
    mocks.sendAiCommand.mockResolvedValue({ id: 'cmd-1', success: true });
    mocks.getAiState.mockResolvedValue(SNAPSHOT);
    mocks.createAiConversation.mockResolvedValue({
      conversationId: 'c-new',
      title: '新对话',
    });
  });

  it('没有存过的会话会新建一个并记住', async () => {
    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });
    expect(mocks.createAiConversation).toHaveBeenCalledTimes(1);
    // 记住了 ⇒ 刷新页面不用再新建
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toContain('c-new');
  });

  it('存过的会话直接复用', async () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ conversationId: 'c-old' }),
    );

    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-old');
    });
    expect(mocks.createAiConversation).not.toHaveBeenCalled();
  });

  it('服务端已经没有这个会话时换一个', async () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ conversationId: 'c-gone' }),
    );
    mocks.getAiState.mockRejectedValue(new Error('404'));

    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });
    expect(mocks.createAiConversation).toHaveBeenCalledTimes(1);
  });

  it('发送时组件自己生成命令 id', async () => {
    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    await result.current.send('本周所有 P0 顺延到下周一');

    // id 由组件生成并原样传给客户端 —— 不是客户端每次现造一个
    expect(mocks.sendAiCommand).toHaveBeenCalledWith(
      'c-new',
      '本周所有 P0 顺延到下周一',
      { id: 'cmd-1' },
    );
    // 用户的话立刻上屏（乐观渲染）
    await vi.waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0].role).toBe('user');
  });

  it('刷新后把历史拉回来', async () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ conversationId: 'c-old' }),
    );
    mocks.getAiState.mockResolvedValue({
      conversationId: 'c-old',
      messages: [
        { id: 'm1', role: 'USER', content: '建个任务', seq: 1 },
        { id: 'm2', role: 'ASSISTANT', content: '好的', seq: 2 },
      ],
      isStreaming: false,
    });

    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });
    expect(result.current.messages[0].text).toBe('建个任务');
    expect(result.current.messages[1].role).toBe('assistant');
  });

  it('会话还没建好时发送会先等它', async () => {
    // 会话是异步建出来的 ⇒ 用户完全可能在建好之前就点了发送
    let resolveConversation: (value: unknown) => void = () => undefined;
    mocks.createAiConversation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConversation = resolve;
        }),
    );

    const { result } = await renderHook(() => useWorkspace());

    const pending = result.current.send('建个任务');
    expect(mocks.sendAiCommand).not.toHaveBeenCalled();

    resolveConversation({ conversationId: 'c-new' });
    await pending;

    // 等到了会话 ⇒ 命令真的发出去了
    expect(mocks.sendAiCommand).toHaveBeenCalledWith('c-new', '建个任务', {
      id: 'cmd-1',
    });
  });

  it('重试复用同一个命令 id', async () => {
    // ⚠️ **护甲**：第二次调用 `createAiCommandId` 给一个**不同的**值。
    // 若 `retry` 将来被改成重新生成 id，它拿到的就是 `cmd-2`，
    // 服务端会把这个命令**真的再执行一遍**（服务端按 id 去重）⇒ 下面的断言会挂。
    mocks.createAiCommandId
      .mockReturnValueOnce('cmd-1')
      .mockReturnValueOnce('cmd-2');
    mocks.sendAiCommand.mockRejectedValueOnce(new Error('网络断了'));

    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    await result.current.send('建个任务');
    await vi.waitFor(() => {
      expect(result.current.sendError).toBeTruthy();
    });

    await result.current.retry();

    // 两次用的是**同一个** id：服务端按 id 去重，不会把命令跑两遍
    expect(mocks.sendAiCommand).toHaveBeenCalledTimes(2);
    expect(mocks.sendAiCommand.mock.calls[0]?.[2]).toEqual({ id: 'cmd-1' });
    expect(mocks.sendAiCommand.mock.calls[1]?.[2]).toEqual({ id: 'cmd-1' });
    // 重试**没有**重新生成 id（生成出来的会是 cmd-2）
    expect(mocks.createAiCommandId).toHaveBeenCalledTimes(1);
  });
});
