/**
 * 「当前讨论」条的测试。
 *
 * 钉死三件事：
 * 1. 没有上下文 ⇒ **什么都不渲染**（不占位）；
 * 2. 有上下文 ⇒ 显示**任务 id + 名称 + 项目 + 里程碑 + 状态**（用户要在这里
 *    确认「我聊的是哪条任务」）；
 * 3. 「结束讨论」能清掉当前上下文。
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { AiTaskContext } from '@/services/api/ai/types';
import { DiscussionBar } from './DiscussionBar';

/** 一个上下文（前端组装好的样子）。 */
const context: AiTaskContext = {
  task: {
    id: 21,
    project_id: 5,
    title: '输出需求规格说明书',
    status_code: 'in_progress',
    priority_code: 'P1',
    type_code: 'feature',
  },
  labels: { in_progress: '进行中', P1: '高', feature: '功能' },
  names: { assignee: '张三' },
  project: { id: 5, name: '财务对账系统升级' },
  milestone: { id: 11, name: 'M1 需求' },
};

describe('当前讨论条', () => {
  it('没有上下文 ⇒ 不渲染', async () => {
    const { container } = await render(
      <DiscussionBar context={null} onClear={() => undefined} />,
    );

    expect(
      container.querySelector('[data-testid="ai-context-bar"]'),
    ).toBeNull();
  });

  it('显示任务、项目、里程碑与状态', async () => {
    const { container } = await render(
      <DiscussionBar context={context} onClear={() => undefined} />,
    );

    const bar = container.querySelector('[data-testid="ai-context-bar"]');
    expect(bar).not.toBeNull();
    const text = bar?.textContent ?? '';
    // 任务
    expect(text).toContain('#21');
    expect(text).toContain('输出需求规格说明书');
    // 项目与里程碑
    expect(text).toContain('所属项目：财务对账系统升级');
    expect(text).toContain('所属里程碑：M1 需求');
    // 状态：中文 + 线上码两样（模型那边也是这个口径）
    expect(text).toContain('进行中（in_progress）');
    // 负责人
    expect(text).toContain('负责人：张三');
  });

  it('点「结束讨论」⇒ 回调', async () => {
    const onClear = vi.fn();
    const { getByRole } = await render(
      <DiscussionBar context={context} onClear={onClear} />,
    );

    await getByRole('button', { name: /结束讨论/ }).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
