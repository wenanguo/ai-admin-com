/**
 * 审计页签的测试 —— 界面层。
 *
 * 钉死五件事：
 * 1. 有数据时渲染命令、执行人与相对时间
 * 2. 用户发起的行显示执行人的名字
 * 3. 空态时给出说明
 * 4. **没有撤销按钮**（服务端没有撤销端点，画一个就是骗人）
 * 5. **append-only 脚注保留**（那是语义说明，不是装饰）
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import type { AiAuditRow } from '@/services/api/ai/types';
import { AuditPanel } from './AuditPanel';

/** 造一条审计行（字段照服务端 `audit-query.ts` 的 `AuditItem`）。 */
function audit(overrides: Partial<AiAuditRow> = {}): AiAuditRow {
  return {
    id: 'a1',
    command: 'batch_update_tasks',
    actorType: 'AI',
    actorName: '张三',
    args: { taskIds: ['t1'] },
    before: null,
    after: { dueDate: '2026-07-13' },
    undoOf: null,
    undoneAt: null,
    adopted: null,
    model: 'qwen-plus',
    tokens: 128,
    latencyMs: 320,
    traceId: 'trace-1',
    error: null,
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe('AI 审计页签', () => {
  it('有数据时渲染命令、执行人与相对时间', async () => {
    const { container, getByText } = await render(
      <AuditPanel items={[audit()]} />,
    );

    // 命令
    await expect
      .element(getByText('batch_update_tasks', { exact: true }))
      .toBeVisible();
    // 执行人（AI 起的头 ⇒ 执行人是 AI 助理）
    await expect.element(getByText('AI 助理', { exact: true })).toBeVisible();
    // 相对时间
    const time = container.querySelector('[data-role="audit-time"]');
    expect(time?.textContent).toContain('分钟前');
    // 有数据时脚注也在
    await expect
      .element(
        getByText(
          '审计记录 append-only：撤销是新增一条指向原记录的日志，不修改原记录。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  it('用户自己发起的行显示执行人的名字', async () => {
    const { getByText } = await render(
      <AuditPanel items={[audit({ actorType: 'USER', actorName: '李四' })]} />,
    );

    await expect.element(getByText('李四', { exact: true })).toBeVisible();
  });

  it('空态时给出说明', async () => {
    const { getByText } = await render(<AuditPanel items={[]} />);

    await expect
      .element(getByText('还没有审计记录', { exact: true }))
      .toBeVisible();
    await expect
      .element(getByText('AI 的每次写入都会记在这里', { exact: true }))
      .toBeVisible();
  });

  it('没有撤销按钮（服务端还没有撤销端点）', async () => {
    const { container, getByText } = await render(
      <AuditPanel items={[audit()]} />,
    );

    // 先确认这一行**真的渲染出来了**（不然「没有按钮」是因为「什么都没渲染」）
    await expect
      .element(getByText('batch_update_tasks', { exact: true }))
      .toBeVisible();

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(
      buttons.filter((button) => (button.textContent ?? '').includes('撤销')),
    ).toHaveLength(0);
  });

  it('保留 append-only 脚注', async () => {
    const { getByText } = await render(<AuditPanel items={[]} />);

    await expect
      .element(
        getByText(
          '审计记录 append-only：撤销是新增一条指向原记录的日志，不修改原记录。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });
});
