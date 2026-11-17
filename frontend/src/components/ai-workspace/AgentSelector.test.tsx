/**
 * **智能体选择器**的测试（issue #101）。
 *
 * 钉死四件事：
 * 1. **加载中**有话说（不是白屏）；
 * 2. **读不到**要降级 + 能重试（不许白屏）；
 * 3. **只有一个智能体** ⇒ 只显示名字（不装下拉框）；
 * 4. **有多个** ⇒ 选一个 ⇒ 回传的是**智能体 id**（不是显示名）。
 */
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { AiAgentSummary } from '@/services/api/ai/types';
import { AgentSelector } from './AgentSelector';

/** 造一个智能体摘要。 */
function agent(id: string, name: string): AiAgentSummary {
  return {
    id,
    name,
    description: `${name}的说明`,
    capabilities: {
      model: 'test-model',
      skillCount: 1,
      mcpServerCount: 1,
      toolCount: 1,
    },
  };
}

describe('智能体选择器', () => {
  it('清单还在读 ⇒ 说「加载中」（不白屏）', async () => {
    const { getByText } = await render(
      <AgentSelector
        agents={[]}
        loading
        onReload={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    await expect.element(getByText(/智能体加载中/)).toBeVisible();
  });

  it('清单读不到 ⇒ 降级 + 能重试（不许白屏）', async () => {
    const onReload = vi.fn();
    const { getByText, getByRole } = await render(
      <AgentSelector
        agents={[]}
        loading={false}
        error="连不上 AI 服务"
        onReload={onReload}
        onChange={vi.fn()}
      />,
    );
    await expect.element(getByText(/智能体清单读不到/)).toBeVisible();
    // ⚠️ antd 会给**两个字**的按钮文案中间插空格（"重 试"）⇒ 名字要正则匹配。
    await userEvent.click(getByRole('button', { name: /重\s*试/ }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('一个智能体都没配 ⇒ 说清楚', async () => {
    const { getByText } = await render(
      <AgentSelector agents={[]} loading={false} onReload={vi.fn()} onChange={vi.fn()} />,
    );
    await expect.element(getByText('没有可用智能体')).toBeVisible();
  });

  it('只有一个智能体 ⇒ 只显示名字（不显示选择器）', async () => {
    const { getByText, getByRole } = await render(
      <AgentSelector
        agents={[agent('pm', 'PM 助手')]}
        loading={false}
        onReload={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    await expect.element(getByText('PM 助手')).toBeVisible();
    expect(getByRole('combobox').elements()).toHaveLength(0);
  });

  it('有多个智能体 ⇒ 选一个 ⇒ 回传它的 id', async () => {
    const onChange = vi.fn();
    const { getByRole, getByText } = await render(
      <AgentSelector
        agents={[agent('pm', 'PM 助手'), agent('qa', 'QA 助手')]}
        loading={false}
        onReload={vi.fn()}
        onChange={onChange}
      />,
    );

    await getByRole('combobox').click();
    await getByText('QA 助手').click();

    expect(onChange).toHaveBeenCalledWith('qa');
  });
});
