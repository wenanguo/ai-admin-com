/**
 * AI 工作台 ↔ 主工作区的桥（全局 model）的测试。
 *
 * 钉死一件事：**桥上没有「替用户发一句」的入口**。
 *
 * ⚠️ 为什么钉它：点「与 AI 讨论」曾经会替用户发一条命令（真调模型）。
 *    那条链路一旦回来，用户没说话也会烧 token ⇒ 必须有测试拦着。
 *    顺带也钉住「桥只负责上下文与界面信号，不负责发消息」。
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import type { AiTaskContext } from '@/services/api/ai/types';
import useAiBridgeModel from './ai-bridge';

describe('ai-bridge 模型', () => {
  it('没有替用户发消息的入口', async () => {
    const { result } = await renderHook(() => useAiBridgeModel());
    // ⚠️ `result.current` 是 React 的**被动 effect** 里写进去的
    //    ⇒ 不等它跑过就是 null（这台机器上浏览器里跑的是 React 的生产构建
    //    ⇒ 没有 `act` ⇒ 渲染不会同步刷完）。
    await vi.waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    expect(Object.keys(result.current)).not.toContain('requestInject');
    expect(Object.keys(result.current)).not.toContain('injectRequest');
  });

  it('设了上下文就能读到，清掉就没了', async () => {
    // ⚠️ `act` 是 `renderHook` 返回的（**不是**从 'vitest-browser-react' 导入的）
    const { act, result } = await renderHook(() => useAiBridgeModel());
    const context: AiTaskContext = {
      kind: 'task',
      task: { id: 6, title: '测试333' },
    };

    await vi.waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    act(() => {
      result.current.setContext(context);
    });
    // ⚠️ 同上：改完 state 要等下一次渲染把新值写回 `result.current`。
    await vi.waitFor(() => {
      expect(result.current.context).toEqual(context);
    });

    act(() => {
      result.current.clearContext();
    });
    await vi.waitFor(() => {
      expect(result.current.context).toBeNull();
    });
  });
});
