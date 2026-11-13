/**
 * 「可用技能」区块的测试 —— 界面层。
 *
 * 钉死三件事：
 * 1. 每个技能的**名字与说明**都渲染出来
 * 2. 没有技能 ⇒ 显示空态（不是空白）
 * 3. 读失败 ⇒ 显示错误，**不许把整页搞崩**
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { SkillList } from './SkillList';

vi.mock('@/services/api/ai/client', () => ({
  listAiSkills: vi.fn(),
}));

const { listAiSkills } = await import('@/services/api/ai/client');

describe('可用技能区块', () => {
  it('列出每个技能的名字与说明', async () => {
    vi.mocked(listAiSkills).mockResolvedValue([
      { name: 'create-task', description: '在 AiAdmin 里建任务。' },
      { name: 'list-tasks', description: '列出任务。' },
    ]);

    const { container, getByText } = await render(<SkillList />);

    await expect.element(getByText('create-task')).toBeVisible();
    await expect.element(getByText('在 AiAdmin 里建任务。')).toBeVisible();
    expect(container.querySelectorAll('[data-role="skill-item"]')).toHaveLength(
      2,
    );
  });

  it('没有技能 ⇒ 显示空态', async () => {
    vi.mocked(listAiSkills).mockResolvedValue([]);

    const { container, getByText } = await render(<SkillList />);

    await expect.element(getByText('还没有技能')).toBeVisible();
    expect(container.querySelectorAll('[data-role="skill-item"]')).toHaveLength(
      0,
    );
  });

  it('读失败 ⇒ 显示错误，不崩', async () => {
    vi.mocked(listAiSkills).mockRejectedValue(new Error('AI 服务不可达'));

    const { getByText } = await render(<SkillList />);

    await expect.element(getByText('AI 服务不可达')).toBeVisible();
  });
});
