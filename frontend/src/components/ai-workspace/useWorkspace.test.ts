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
  abortAiConversation: vi.fn(),
  subscribeAiEvents: vi.fn(() => () => undefined),
  /** 假的全局 model（AI 工作台 ↔ 主工作区的桥）。
   *  ⚠️ **必须稳定**：测试要改它的字段并重渲染 ⇒ 每次返回新对象就测不了。 */
  bridge: {
    context: null as unknown,
    setContext: vi.fn(),
    clearContext: vi.fn(),
    lastUpdate: null,
    notifyUpdate: vi.fn(),
    expandSignal: 0,
    focusSignal: 0,
    /** ⚠️ **故意保留**这个字段：真实模型里它马上要删掉了。
     *  留在这里是为了钉住「工作台不会因为它而自动发命令」。 */
    injectRequest: null as { text: string; at: number } | null,
    requestExpand: vi.fn(),
    requestFocus: vi.fn(),
    requestInject: vi.fn(),
  },
}));

// 全局 model（AI 工作台 ↔ 主工作区的桥）
vi.mock('@umijs/max', () => ({
  useModel: () => mocks.bridge,
}));

vi.mock('@/services/api/ai/client', () => ({
  AI_API_BASE_URL: '/ai-api',
  aiUrl: (path: string) => `/ai-api${path}`,
  createAiCommandId: mocks.createAiCommandId,
  sendAiCommand: mocks.sendAiCommand,
  createAiConversation: mocks.createAiConversation,
  getAiState: mocks.getAiState,
  abortAiConversation: mocks.abortAiConversation,
  listAiAudit: vi.fn(),
  listAiPending: vi.fn(),
  listAiConversations: vi.fn(),
  approveAiPending: vi.fn(),
  rejectAiPending: vi.fn(),
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
    // ⚠️ `mockReset` 会清掉「一次性返回值」的队列 ——
    //    「重试复用同一个命令 id」那个用例排了两个 once 值，
    //    不清掉就会漏到后面的用例里（下一个用例会拿到 cmd-2）。
    mocks.createAiCommandId.mockReset();
    mocks.createAiCommandId.mockReturnValue('cmd-1');
    mocks.sendAiCommand.mockResolvedValue({ id: 'cmd-1', success: true });
    mocks.getAiState.mockResolvedValue(SNAPSHOT);
    mocks.createAiConversation.mockResolvedValue({
      conversationId: 'c-new',
      title: '新对话',
    });
    mocks.abortAiConversation.mockResolvedValue(undefined);
    mocks.bridge.context = null;
    // ⚠️ 不重置的话，上一个用例留下的注入请求会打乱本用例的调用次序
    mocks.bridge.injectRequest = null;
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
    // ⚠️ `result.current` 要等 React 的被动 effect 跑过才有值
    //    （不等的话在这台机器上会拿到 null）
    await vi.waitFor(() => {
      expect(result.current).toBeTruthy();
    });

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

  it('当前模型来自会话快照', async () => {
    // ⚠️ 快照里才有 `model`（服务端**没有**模型列表端点 ⇒ 只有这一个）
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ conversationId: 'c-old' }),
    );
    mocks.getAiState.mockResolvedValue({
      conversationId: 'c-old',
      messages: [],
      isStreaming: false,
      model: 'e2e-model',
    });

    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.model).toBe('e2e-model');
    });
  });

  it('「新对话」建一个新会话并切过去', async () => {
    mocks.createAiConversation
      .mockResolvedValueOnce({ conversationId: 'c-new', title: '新对话' })
      .mockResolvedValueOnce({ conversationId: 'c-second', title: '新对话' });

    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    await result.current.newConversation();

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-second');
    });
    // 会话 id 写进存储 ⇒ 侧栏（别的页面）下次挂载用的也是它
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toContain('c-second');
  });

  it('中止当前这一轮：叫服务端的 abort，并乐观地解禁输入', async () => {
    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    await result.current.abort();

    expect(mocks.abortAiConversation).toHaveBeenCalledWith('c-new');
    // ⚠️ 乐观解禁（不等服务端的 agent_settled 帧 ⇒ 那一帧丢了也不会卡住）
    await vi.waitFor(() => {
      expect(result.current.streaming).toBe(false);
    });
    expect(result.current.aborting).toBe(false);
  });

  it('中止失败时把原因挂在 abortError 上（不崩）', async () => {
    mocks.abortAiConversation.mockRejectedValue(new Error('服务不可达'));

    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    await result.current.abort();

    await vi.waitFor(() => {
      expect(result.current.abortError).toBeTruthy();
    });
    expect(result.current.abortError).toContain('服务不可达');
  });

  it('会话还没建好时中止不会报错', async () => {
    mocks.createAiConversation.mockImplementation(
      () =>
        new Promise(() => {
          // 永远不 resolve ⇒ 会话建不出来
        }),
    );

    const { result } = await renderHook(() => useWorkspace());
    // ⚠️ 同上：`result.current` 要等 React 的被动 effect 跑过才有值
    await vi.waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    await result.current.abort();

    expect(mocks.abortAiConversation).not.toHaveBeenCalled();
  });

  it('「历史对话」切到另一个会话并把它的历史带回来', async () => {
    mocks.getAiState.mockResolvedValue({
      conversationId: 'c-old',
      messages: [{ id: 'm1', role: 'USER', content: '建个任务', seq: 1 }],
      isStreaming: false,
    });

    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    await result.current.switchConversation('c-old');

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-old');
    });
    // 历史也跟着切过来了
    await vi.waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toContain('c-old');
  });

  it('即使桥上还留着注入请求，工作台也不自己发命令', async () => {
    // ⚠️ `renderHook` 要 **await**（返回的 `act` 是它解构出来的，不是模块导出）
    const { result, rerender } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    // 模拟「有人请求替用户发一句」（今天点「讨论」正是这么干的）
    mocks.bridge.injectRequest = {
      text: '已切换到当前任务：#1 测试',
      at: Date.now(),
    };
    rerender();
    // ⚠️ 等一拍：今天这里会真的发出去（effect 立刻跑 send）
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mocks.sendAiCommand).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it('用户自己说的那句话会带上当前上下文', async () => {
    mocks.bridge.context = { kind: 'task', task: { id: 6, title: '测试333' } };
    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });
    await result.current.send('这个任务做完了吗');

    expect(mocks.sendAiCommand).toHaveBeenCalledWith(
      'c-new',
      '这个任务做完了吗',
      { id: 'cmd-1', context: mocks.bridge.context },
    );
  });

  it('换了上下文之后，下一条命令带的是新的那个', async () => {
    const { result } = await renderHook(() => useWorkspace());
    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    mocks.bridge.context = { kind: 'task', task: { id: 6, title: '旧的' } };
    await result.current.send('第一条');
    mocks.bridge.context = { kind: 'task', task: { id: 7, title: '新的' } };
    await result.current.send('第二条');

    expect(mocks.sendAiCommand.mock.calls[0]?.[2]).toEqual({
      id: 'cmd-1',
      context: { kind: 'task', task: { id: 6, title: '旧的' } },
    });
    expect(mocks.sendAiCommand.mock.calls[1]?.[2]).toEqual({
      id: 'cmd-1',
      context: { kind: 'task', task: { id: 7, title: '新的' } },
    });
  });
});
