/**
 * 「可用技能」入口的测试 —— 界面层。
 *
 * 钉死四件事：
 * 1. 按钮上显示技能**数量**
 * 2. 点开能看到每个技能的**名字与说明**
 * 3. 没有技能 ⇒ 空态（不是空白）
 * 4. 读失败 ⇒ 显示错误，**不许把整页搞崩**
 */
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { listAiSkills } from '@/services/api/ai/client';
import { SkillList } from './SkillList';

vi.mock('@/services/api/ai/client', () => ({
  listAiSkills: vi.fn(),
}));

describe('可用技能入口', () => {
  it('按钮上显示技能数量', async () => {
    vi.mocked(listAiSkills).mockResolvedValue([
      { name: 'create-task', description: '在 AiAdmin 里建任务。' },
      { name: 'list-tasks', description: '列出任务。' },
    ]);

    const { getByRole } = await render(<SkillList />);

    await expect
      .element(getByRole('button', { name: /可用技能 2/ }))
      .toBeVisible();
  });

  it('点开能看到每个技能的名字与说明', async () => {
    vi.mocked(listAiSkills).mockResolvedValue([
      { name: 'create-task', description: '在 AiAdmin 里建任务。' },
    ]);

    const { getByRole, getByText } = await render(<SkillList />);

    await userEvent.click(getByRole('button', { name: /可用技能/ }));

    await expect.element(getByText('create-task')).toBeVisible();
    await expect.element(getByText('在 AiAdmin 里建任务。')).toBeVisible();
    // ⚠️ Popover 渲染在 **portal** 里 ⇒ 不在 render 返回的 container 内
    expect(document.querySelectorAll('[data-role="skill-item"]')).toHaveLength(
      1,
    );
  });

  it('没有技能 ⇒ 空态', async () => {
    vi.mocked(listAiSkills).mockResolvedValue([]);

    const { getByRole, getByText } = await render(<SkillList />);

    await userEvent.click(getByRole('button', { name: /可用技能/ }));

    await expect.element(getByText('还没有技能')).toBeVisible();
  });

  it('读失败 ⇒ 显示错误，不崩', async () => {
    vi.mocked(listAiSkills).mockRejectedValue(new Error('AI 服务不可达'));

    const { getByRole, getByText } = await render(<SkillList />);

    await userEvent.click(getByRole('button', { name: /可用技能/ }));

    await expect.element(getByText('AI 服务不可达')).toBeVisible();
  });
});
