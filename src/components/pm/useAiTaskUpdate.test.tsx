/**
 * 「AI 写回 ⇒ 刷新 + 高亮」的 hook 测试。
 *
 * 钉死三件事：
 * 1. 收到写回信号 ⇒ **重新取数**（左边列表/看板/甘特都得看到新值）；
 * 2. 被改的那一行**高亮**（行 class 落到目标 id 上）；
 * 3. 刷两次（后端是「请求结束才 commit」⇒ 立刻查可能读到旧值）。
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from 'vitest-browser-react';
import { useAiTaskUpdate } from './useAiTaskUpdate';

const mocks = vi.hoisted(() => ({
  lastUpdate: null as null | {
    entityType: 'task';
    entityId: number;
    fields: string[];
    at: number;
  },
}));

vi.mock('@umijs/max', () => ({
  useModel: () => ({ lastUpdate: mocks.lastUpdate }),
}));

/** 一个写回信号。 */
function update(entityId: number, fields: string[] = ['status_code']) {
  mocks.lastUpdate = { entityType: 'task', entityId, fields, at: Date.now() };
}

describe('useAiTaskUpdate', () => {
  it('没有写回信号 ⇒ 不刷新、不高亮', async () => {
    mocks.lastUpdate = null;
    const reload = vi.fn();
    const { result } = await renderHook(() => useAiTaskUpdate(reload));

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.highlightedId).toBeUndefined();
    expect(result.current.rowClassName({ id: 6 })).toBe('');
    cleanup();
  });

  it('收到写回信号 ⇒ 刷新 + 高亮那一行', async () => {
    mocks.lastUpdate = null;
    const reload = vi.fn();
    const { result, rerender } = await renderHook(() =>
      useAiTaskUpdate(reload),
    );

    update(6);
    await rerender();

    expect(reload).toHaveBeenCalled();
    expect(result.current.highlightedId).toBe(6);
    expect(result.current.rowClassName({ id: 6 })).toBe('pm-ai-updated-row');
    // 别的行不高亮
    expect(result.current.rowClassName({ id: 7 })).toBe('');
    cleanup();
  });

  it('刷两次（写回落库有延迟 ⇒ 立刻查可能读到旧值）', async () => {
    mocks.lastUpdate = null;
    const reload = vi.fn();
    const { rerender } = await renderHook(() => useAiTaskUpdate(reload));

    update(6);
    await rerender();

    expect(reload).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(reload).toHaveBeenCalledTimes(2);
    cleanup();
  });
});
