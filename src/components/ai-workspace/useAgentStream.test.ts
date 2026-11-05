/**
 * AI 流式状态机的测试 —— **不碰网络**。
 *
 * 事件流与快照读取都是**注入进来的假实现**：
 * 喂一串假事件，断言界面状态（气泡、命令卡片、本轮状态）怎么变。
 *
 * 为什么用注入而不是 vi.mock：
 * 订阅与快照读取是这两个hook **唯一的**外部依赖，
 * 注入之后测试不需要碰网络、不需要 mock 模块，
 * 也不会因为 AI 客户端的内部实现变了就假失败。
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import type { AiEvent, AiState } from '@/services/api/ai/types';
import { useAgentStream } from './useAgentStream';

/**
 * `@/services/api/ai/client` 会被这个 hook 间接 import（默认的快照读取），
 * 它顶层 import 了 `@umijs/max` 的 request ⇒ 测试里替换掉，免得加载真运行时。
 */
vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

/** 假的事件订阅：把回调存起来，测试自己往里喂事件。 */
function fakeSubscribe() {
  const captured: {
    onEvent?: (event: AiEvent) => void;
    onError?: (error: Error) => void;
  } = {};
  const subscribe = vi.fn(
    (
      _conversationId: string,
      onEvent: (event: AiEvent) => void,
      onError?: (error: Error) => void,
    ) => {
      captured.onEvent = onEvent;
      captured.onError = onError;
      return () => undefined;
    },
  );
  return { captured, subscribe };
}

/** 服务端快照（`GET /api/agent/:cid/state`）。 */
const SNAPSHOT: AiState = {
  conversationId: 'c1',
  messages: [
    { id: 'm1', role: 'USER', content: '建个任务', seq: 1 },
    { id: 'm2', role: 'ASSISTANT', content: '好的', seq: 2 },
  ],
  isStreaming: false,
  model: 'pi',
};

describe('AI 流式状态机', () => {
  it('text_delta 累积成一个气泡', async () => {
    const { captured, subscribe } = fakeSubscribe();

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState: async () => SNAPSHOT,
      }),
    );

    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
      captured.onEvent?.({ type: 'text_delta', delta: '你好' });
      captured.onEvent?.({ type: 'text_delta', delta: '，世界' });
    });

    // 三段事件只开**一个**气泡 —— 正文是累积的
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('assistant');
    expect(result.current.messages[0].text).toBe('你好，世界');
  });

  it('tool_call 追加一张卡片', async () => {
    const { captured, subscribe } = fakeSubscribe();

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState: async () => SNAPSHOT,
      }),
    );

    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
      captured.onEvent?.({
        type: 'tool_call',
        toolName: 'create_task',
        args: { title: 'SSO 登录' },
      });
    });

    expect(result.current.messages[0].commands).toHaveLength(1);
    expect(result.current.messages[0].commands[0].toolName).toBe('create_task');
    // 只有 tool_call ⇒ 还没有结果
    expect(result.current.messages[0].commands[0].status).toBe('running');
  });

  it('tool_result 把卡片更新成已执行', async () => {
    const { captured, subscribe } = fakeSubscribe();

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState: async () => SNAPSHOT,
      }),
    );

    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
      captured.onEvent?.({
        type: 'tool_call',
        toolName: 'create_task',
        args: { title: 'SSO 登录' },
      });
      captured.onEvent?.({
        type: 'tool_result',
        toolName: 'create_task',
        status: 'ok',
        summary: '已创建任务「SSO 登录」',
      });
    });

    // 结果落到**同一张**卡片上，不是新开一张
    expect(result.current.messages[0].commands).toHaveLength(1);
    expect(result.current.messages[0].commands[0].status).toBe('ok');
    expect(result.current.messages[0].commands[0].summary).toBe(
      '已创建任务「SSO 登录」',
    );
  });

  it('失败时 message_end.error 被保留下来', async () => {
    const { captured, subscribe } = fakeSubscribe();

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState: async () => SNAPSHOT,
      }),
    );

    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
      captured.onEvent?.({ type: 'text_delta', delta: '我先看看' });
      captured.onEvent?.({
        type: 'message_end',
        text: '我先看看',
        error: '模型调用失败',
      });
    });

    expect(result.current.messages[0].error).toBe('模型调用失败');
    expect(result.current.messages[0].text).toBe('我先看看');
  });

  it('agent_settled 结束本轮', async () => {
    const { captured, subscribe } = fakeSubscribe();

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState: async () => SNAPSHOT,
      }),
    );

    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
    });
    expect(result.current.streaming).toBe(true);

    await act(async () => {
      captured.onEvent?.({ type: 'agent_settled' });
    });

    // 结束本轮 ⇒ 输入解禁
    expect(result.current.streaming).toBe(false);
  });

  it('断线后用 getAiState 的快照重建', async () => {
    const { captured, subscribe } = fakeSubscribe();
    const loadState = vi.fn(async () => SNAPSHOT);

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState,
      }),
    );

    // 断线前本地攒了半句话
    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
      captured.onEvent?.({ type: 'text_delta', delta: '半句话' });
    });
    expect(result.current.messages).toHaveLength(1);

    // 重连：服务端先发一帧 connected ⇒ 用快照重建（不自己猜增量）
    await act(async () => {
      captured.onEvent?.({
        type: 'connected',
        conversationId: 'c1',
        isStreaming: false,
      });
    });

    await vi.waitFor(() => {
      expect(loadState).toHaveBeenCalledWith('c1');
    });
    // ⚠️ 超时给足：快照到了之后还要等「回放静默期」（兜底）才重建界面
    await vi.waitFor(
      () => {
        expect(result.current.messages.map((item) => item.text)).toEqual([
          '建个任务',
          '好的',
        ]);
      },
      { timeout: 3000 },
    );
    expect(result.current.streaming).toBe(false);
  });

  it('用户消息乐观上屏,快照里还没有时保留', async () => {
    const { captured, subscribe } = fakeSubscribe();
    const loadState = vi.fn(async () => ({
      ...SNAPSHOT,
      messages: [],
    }));

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState,
      }),
    );

    await act(async () => {
      result.current.appendUserMessage('本周所有 P0 顺延到下周一');
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('user');

    // 重连的快照还没落库这条消息 ⇒ 不能把它弄丢
    await act(async () => {
      captured.onEvent?.({
        type: 'connected',
        conversationId: 'c1',
        isStreaming: false,
      });
    });

    await vi.waitFor(() => {
      expect(loadState).toHaveBeenCalled();
    });
    await vi.waitFor(
      () => {
        expect(result.current.messages).toHaveLength(1);
      },
      { timeout: 3000 },
    );
    expect(result.current.messages[0].text).toBe('本周所有 P0 顺延到下周一');
  });

  it('回放的帧不上屏:快照才是真相,历史只渲染一遍', async () => {
    const { captured, subscribe } = fakeSubscribe();
    // 快照什么时候落地由测试控制（要模拟「快照落在回放的中间」）
    let resolveSnapshot: ((snapshot: AiState) => void) | undefined;
    const loadState = vi.fn(
      () =>
        new Promise<AiState>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState,
      }),
    );

    // 连上 ⇒ 拉快照
    await act(async () => {
      captured.onEvent?.({
        type: 'connected',
        conversationId: 'c1',
        isStreaming: false,
      });
    });

    // 快照落地
    await act(async () => {
      resolveSnapshot?.(SNAPSHOT);
      await Promise.resolve();
    });

    // ⚠️ 真实服务端在**同一个响应**里紧接着回放整段历史
    //    ⇒ 这些帧与快照赛跑 ⇒ 不能直接上屏（否则历史渲染两遍）。
    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
      captured.onEvent?.({ type: 'text_delta', delta: '好的' });
      captured.onEvent?.({ type: 'message_end', text: '好的' });
      captured.onEvent?.({ type: 'agent_settled' });
    });

    await vi.waitFor(() => {
      expect(result.current.messages.map((item) => item.text)).toEqual([
        '建个任务',
        '好的',
      ]);
    });
  });

  it('重建后本地已知的命令卡片不能消失', async () => {
    const { captured, subscribe } = fakeSubscribe();
    const loadState = vi.fn(async () => SNAPSHOT);

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState,
      }),
    );

    // 本地跑了一轮命令（卡片在本地）
    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
      captured.onEvent?.({
        type: 'tool_call',
        toolName: 'create_task',
        args: { title: 'SSO 登录' },
      });
      captured.onEvent?.({
        type: 'tool_result',
        toolName: 'create_task',
        status: 'ok',
        summary: '已创建任务「SSO 登录」',
      });
      captured.onEvent?.({ type: 'message_end', text: '好的' });
    });
    expect(result.current.messages[0].commands).toHaveLength(1);

    // 重连 ⇒ 快照重建（⚠️ 快照里**没有**工具调用历史）
    await act(async () => {
      captured.onEvent?.({
        type: 'connected',
        conversationId: 'c1',
        isStreaming: false,
      });
    });

    await vi.waitFor(
      () => {
        expect(result.current.messages.map((item) => item.text)).toEqual([
          '建个任务',
          '好的',
        ]);
      },
      { timeout: 3000 },
    );

    // ⚠️ 卡片不能消失：用户会以为命令根本没执行
    const commands = result.current.messages.flatMap((item) => item.commands);
    expect(commands).toHaveLength(1);
    expect(commands[0].toolName).toBe('create_task');
    expect(commands[0].status).toBe('ok');
  });

  it('回放里的命令卡片也会被合并回去', async () => {
    const { captured, subscribe } = fakeSubscribe();
    let resolveSnapshot: ((snapshot: AiState) => void) | undefined;
    const loadState = vi.fn(
      () =>
        new Promise<AiState>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState,
      }),
    );

    await act(async () => {
      captured.onEvent?.({
        type: 'connected',
        conversationId: 'c1',
        isStreaming: false,
      });
    });
    await act(async () => {
      resolveSnapshot?.(SNAPSHOT);
      await Promise.resolve();
    });

    // 回放里带一张命令卡片（服务端把历史**连同命令**一起回放）
    await act(async () => {
      captured.onEvent?.({ type: 'message_start', role: 'assistant' });
      captured.onEvent?.({ type: 'text_delta', delta: '好的' });
      captured.onEvent?.({
        type: 'tool_call',
        toolName: 'create_task',
        args: { title: 'SSO 登录' },
      });
      captured.onEvent?.({
        type: 'tool_result',
        toolName: 'create_task',
        status: 'ok',
        summary: '已创建任务「SSO 登录」',
      });
      captured.onEvent?.({ type: 'message_end', text: '好的' });
    });

    await vi.waitFor(() => {
      expect(result.current.messages.map((item) => item.text)).toEqual([
        '建个任务',
        '好的',
      ]);
    });

    const commands = result.current.messages.flatMap((item) => item.commands);
    expect(commands).toHaveLength(1);
    expect(commands[0].toolName).toBe('create_task');
    expect(commands[0].status).toBe('ok');
  });
});
