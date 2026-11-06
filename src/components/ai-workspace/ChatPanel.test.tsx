/**
 * 对话页签的测试 —— 界面层。
 *
 * 钉死五件事：
 * 1. 用户气泡右对齐、助手气泡左对齐且带头像
 * 2. 命令卡片的状态标签由事件驱动（执行中 / 已执行 / 失败）
 * 3. 这一轮失败时（`message_end.error`）气泡里有一条错误提示
 * 4. 空对话时的 5 条快捷 chips **只填输入框**，不直接发送
 * 5. 服务端做不了的快捷 chip 必须标「暂未开放」（不许承诺没有的能力）
 * 6. 流式中输入禁用，并提示「本轮进行中…」
 */

import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { ChatPanel } from './ChatPanel';
import { QUICK_PROMPTS } from './Composer';
import type { ChatMessage } from './useAgentStream';

/** 造一条助手消息。 */
function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm2',
    role: 'assistant',
    text: '',
    commands: [],
    ...overrides,
  };
}

describe('AI 对话页签', () => {
  it('用户气泡右对齐、助手气泡左对齐且带头像', async () => {
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', text: '建个任务', commands: [] },
      assistant({ id: 'm2', text: '好的' }),
    ];

    const { container } = await render(
      <ChatPanel messages={messages} onSend={() => undefined} />,
    );

    const user = container.querySelector<HTMLElement>('[data-role="user"]');
    const bot = container.querySelector<HTMLElement>('[data-role="assistant"]');
    expect(user).not.toBeNull();
    expect(bot).not.toBeNull();
    // 右对齐 / 左对齐
    expect(user?.style.marginLeft).toBe('auto');
    expect(bot?.style.marginRight).toBe('auto');
    // 助手带头像
    expect(bot?.querySelector('.ant-avatar')).not.toBeNull();
  });

  it('命令卡片的状态标签跟着事件走', async () => {
    const messages: ChatMessage[] = [
      assistant({
        commands: [
          { id: 'c1', toolName: 'create_task', status: 'running' },
          { id: 'c2', toolName: 'update_task', status: 'ok' },
          { id: 'c3', toolName: 'delete_task', status: 'error' },
        ],
      }),
    ];

    const { getByText } = await render(
      <ChatPanel messages={messages} onSend={() => undefined} />,
    );

    await expect.element(getByText('执行中')).toBeVisible();
    await expect.element(getByText('已执行')).toBeVisible();
    await expect.element(getByText('失败')).toBeVisible();
    // 命令名用等宽字体（规格 §2.3）
    await expect.element(getByText('create_task')).toBeVisible();
  });

  it('这一轮失败时气泡里有一条错误提示', async () => {
    const messages: ChatMessage[] = [
      assistant({ text: '我先看看', error: '模型调用失败' }),
    ];

    const { getByText } = await render(
      <ChatPanel messages={messages} onSend={() => undefined} />,
    );

    await expect.element(getByText('模型调用失败')).toBeVisible();
  });

  it('空对话时的快捷 chips 只填输入框,不直接发送', async () => {
    const onSend = vi.fn();

    const { getByRole, getByText } = await render(
      <ChatPanel messages={[]} onSend={onSend} />,
    );

    const chip = getByText('@AI 建一个 SSO 登录任务');
    await expect.element(chip).toBeVisible();
    await chip.click();

    await vi.waitFor(() => {
      const input = getByRole('textbox').element() as HTMLInputElement;
      expect(input.value).toBe('@AI 建一个 SSO 登录任务');
    });
    // 只填不发
    expect(onSend).not.toHaveBeenCalled();
  });

  it('服务端做不了的快捷 chip 必须标「暂未开放」', async () => {
    const { container } = await render(
      <ChatPanel messages={[]} onSend={() => undefined} />,
    );

    const chips = Array.from(container.querySelectorAll('.ant-tag')).map(
      (tag) => tag.textContent ?? '',
    );

    // 五条 chip 都在
    expect(chips).toHaveLength(QUICK_PROMPTS.length);

    // ⚠️ AI 服务当前**只有 `create_task` 一条命令**
    //    ⇒ 除建任务外的 chip 都拿不到结论 ⇒ 必须标出来
    //    （不许承诺服务端没有的能力）。
    const notOpen = chips.filter(
      (text) => !text.includes('@AI 建一个 SSO 登录任务'),
    );
    expect(notOpen).toHaveLength(4);
    for (const text of notOpen) {
      expect(text).toContain('暂未开放');
    }

    // 唯一能答的那条不标
    const available = chips.find((text) =>
      text.includes('@AI 建一个 SSO 登录任务'),
    );
    expect(available).toBeDefined();
    expect(available).not.toContain('暂未开放');
  });

  it('流式中输入禁用并提示本轮进行中', async () => {
    const { getByRole, getByText } = await render(
      <ChatPanel messages={[]} streaming onSend={() => undefined} />,
    );

    await expect.element(getByText('本轮进行中…')).toBeVisible();
    const input = getByRole('textbox').element() as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('⭐ 本轮进行中时有「停止生成」按钮（不然用户没有出路）', async () => {
    const onStop = vi.fn();

    const { getByRole } = await render(
      <ChatPanel
        messages={[]}
        streaming
        onSend={() => undefined}
        onStop={onStop}
      />,
    );

    const button = getByRole('button', { name: /停止生成/ });
    await expect.element(button).toBeVisible();
    await button.click();

    await vi.waitFor(() => {
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  it('不进行中时没有「停止生成」按钮', async () => {
    const { container } = await render(
      <ChatPanel
        messages={[]}
        onSend={() => undefined}
        onStop={() => undefined}
      />,
    );

    expect(container.querySelector('[data-role="ai-stop-button"]')).toBeNull();
  });

  it('回车发送', async () => {
    const onSend = vi.fn();

    const { getByRole } = await render(
      <ChatPanel messages={[]} onSend={onSend} />,
    );

    const input = getByRole('textbox').element() as HTMLInputElement;
    await userEvent.fill(input, '建个任务');
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('建个任务');
    });
  });
});
