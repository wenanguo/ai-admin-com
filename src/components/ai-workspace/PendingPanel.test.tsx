/**
 * 待确认页签的测试 —— 界面层。
 *
 * 钉死四件事：
 * 1. 命中清单**逐行**渲染：原值带删除线、新值加重
 * 2. 规则算出来的警告条照原样渲染（前端只渲染，不生成）
 * 3. 三个按钮**是禁用的**（服务端还没有确认/取消/调整范围的写入口），
 *    并且有 Tooltip 说明「该能力尚未开放」
 * 4. 预览是**自由 JSON** ⇒ 缺字段时不能崩
 */
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { AiPendingRow } from '@/services/api/ai/types';
import { PendingPanel } from './PendingPanel';

/** 造一条待确认行（字段照服务端 `pending-query.ts` 的 `PendingItem`）。 */
function pending(overrides: Partial<AiPendingRow> = {}): AiPendingRow {
  return {
    id: 'p1',
    conversationId: 'c1',
    command: 'batch_update_tasks',
    args: { taskIds: ['t1', 't2', 't3'] },
    preview: {
      title: '把 3 个 P0 任务的截止日顺延到下周一',
      hits: [
        { title: '预付款模块对接', from: '07-01', to: '07-13', owner: '张三' },
        { title: '对账规则重构', from: '07-04', to: '07-13', owner: '李四' },
      ],
      warning: '顺延后仍无法解锁关键路径',
    },
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe('AI 待确认页签', () => {
  it('命中清单逐行渲染：原值带删除线、新值加重', async () => {
    const { container, getByText } = await render(
      <PendingPanel items={[pending()]} />,
    );

    // 每一行都渲染出来了
    await expect
      .element(getByText('预付款模块对接', { exact: true }))
      .toBeVisible();
    await expect
      .element(getByText('对账规则重构', { exact: true }))
      .toBeVisible();

    const hits = container.querySelectorAll('[data-role="pending-hit"]');
    expect(hits).toHaveLength(2);

    // 原值：删除线 + 次要色
    const from = hits[0]?.querySelector<HTMLElement>('[data-role="hit-from"]');
    expect(from?.textContent).toBe('07-01');
    expect(from?.style.textDecoration).toContain('line-through');

    // 新值：加重
    const to = hits[0]?.querySelector<HTMLElement>('[data-role="hit-to"]');
    expect(to?.textContent).toBe('07-13');
    expect(to?.style.fontWeight).toBe('600');
  });

  it('规则算出来的警告条照原样渲染', async () => {
    const { getByText } = await render(<PendingPanel items={[pending()]} />);

    await expect
      .element(getByText('顺延后仍无法解锁关键路径', { exact: true }))
      .toBeVisible();
  });

  it('三个按钮都是禁用的（服务端还没有写入口）', async () => {
    const { getByRole } = await render(<PendingPanel items={[pending()]} />);

    // ⚠️ antd 会在两个汉字之间插一个空格（「取消」→「取 消」）⇒ 用正则匹配
    for (const name of [/^确认执行$/, /^取\s*消$/, /^调整范围$/]) {
      const button = getByRole('button', { name });
      expect((button.element() as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('禁用按钮的 Tooltip 说明「该能力尚未开放」', async () => {
    const { container, getByRole, getByText } = await render(
      <PendingPanel items={[pending()]} />,
    );

    const button = getByRole('button', { name: /^确认执行$/ });
    // 禁用按钮不派发鼠标事件 ⇒ Tooltip 挂在包着它的 span 上
    const trigger = button.element().closest('[data-role="pending-action"]');
    expect(trigger).not.toBeNull();
    await userEvent.hover(trigger as HTMLElement);

    await expect
      .element(getByText('该能力尚未开放', { exact: true }))
      .toBeVisible();
    // 顺带确认触发器确实在页面里
    expect(
      container.querySelectorAll('[data-role="pending-action"]'),
    ).toHaveLength(3);
  });

  it('预览 JSON 缺字段时不崩', async () => {
    const { container, getByText } = await render(
      <PendingPanel
        items={[
          pending({ id: 'p1', preview: undefined }),
          pending({ id: 'p2', preview: {} }),
          pending({ id: 'p3', preview: { title: '只有一个标题' } }),
          pending({
            id: 'p4',
            preview: { hits: [{ title: '只有标题的命中行' }] },
          }),
          pending({ id: 'p5', preview: '根本不是对象' }),
        ]}
      />,
    );

    // 该渲染的照样渲染
    await expect
      .element(getByText('只有一个标题', { exact: true }))
      .toBeVisible();
    await expect
      .element(getByText('只有标题的命中行', { exact: true }))
      .toBeVisible();
    // 五张卡片都在
    expect(
      container.querySelectorAll('[data-role="pending-card"]'),
    ).toHaveLength(5);
    expect(
      container.querySelectorAll('[data-role="pending-command"]'),
    ).toHaveLength(5);
  });

  it('空态时给出说明', async () => {
    const { getByText } = await render(<PendingPanel items={[]} />);

    await expect
      .element(getByText('没有待确认的操作', { exact: true }))
      .toBeVisible();
    await expect
      .element(getByText('批量与破坏性操作会先在这里等你点头', { exact: true }))
      .toBeVisible();
  });
});
