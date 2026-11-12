/**
 * 「与 AI 讨论」的共享实现（列表视图 / 卡片视图共用）测试。
 *
 * 钉死三件事：
 * 1. 点「与 AI 讨论」⇒ 把**这一行项目**设为当前讨论对象（上下文里有项目 id/名字）；
 * 2. 面板可能是收着的 ⇒ 必须**展开**它，并切到「对话」页签（点完就能说话）；
 * 3. 项目**没有 id** ⇒ 组不出上下文 ⇒ 什么都不做（不塞一个半截上下文进去）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from 'vitest-browser-react';
import { useDiscussProject } from './useDiscussProject';

const mocks = vi.hoisted(() => ({
  setContext: vi.fn(),
  requestExpand: vi.fn(),
  requestFocus: vi.fn(),
}));

vi.mock('@umijs/max', () => ({
  useModel: () => ({
    setContext: mocks.setContext,
    requestExpand: mocks.requestExpand,
    requestFocus: mocks.requestFocus,
  }),
}));

// 字典选项：上下文字段要把线上码翻成中文
vi.mock('@/components/pm/useDictOptions', () => ({
  useDictOptions: (dictType: string) => ({
    options:
      dictType === 'module_pm_project_status'
        ? [{ value: 'planning', label: '规划中' }]
        : [{ value: 'P1', label: '高' }],
    loading: false,
  }),
}));

/** 一个项目行（字段与后端随行返回的一致）。 */
function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    code: 'AIPM-CORE',
    name: 'AIPM 核心项目',
    status_code: 'planning',
    priority_code: 'P1',
    owner_by: { id: 3, name: '张三' },
    ...overrides,
  };
}

describe('useDiscussProject', () => {
  // 显式清一次：下面的「没调用过」断言不能靠上一个用例的残留
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('点讨论 ⇒ 设为当前讨论对象 + 展开面板 + 切到对话页签', async () => {
    const { result } = await renderHook(() => useDiscussProject());

    result.current(project());

    expect(mocks.setContext).toHaveBeenCalledTimes(1);
    const context = mocks.setContext.mock.calls[0][0];
    expect(context.kind).toBe('project');
    expect(context.project?.id).toBe(7);
    expect(context.project?.name).toBe('AIPM 核心项目');
    expect(context.projectCode).toBe('AIPM-CORE');
    // 字典线上码翻成中文（模型照抄线上码就会写出不存在的状态）
    expect(context.labels?.planning).toBe('规划中');
    expect(mocks.requestExpand).toHaveBeenCalledTimes(1);
    expect(mocks.requestFocus).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('项目没有 id ⇒ 组不出上下文 ⇒ 什么都不做', async () => {
    const { result } = await renderHook(() => useDiscussProject());

    result.current(project({ id: null }));

    expect(mocks.setContext).not.toHaveBeenCalled();
    expect(mocks.requestExpand).not.toHaveBeenCalled();
    expect(mocks.requestFocus).not.toHaveBeenCalled();
    cleanup();
  });
});
