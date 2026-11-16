/**
 * 「历史对话」的测试 —— **宽窄两种形态共用这一份实现**。
 *
 * 钉死五件事：
 * 1. 打开时读列表，列表项（标题 + 时间）渲染出来；
 * 2. **三态齐全**：加载中 / 空 / 失败（失败**能重试**）；
 * 3. 点一条 ⇒ 切到那个会话（`switchConversation` ⇒ 接着聊）；
 * 4. 标题**截断**（窄版只有 400px ⇒ 长标题不能把行撑破）；
 * 5. 列表来自 `listAiConversations()`（不是前端自己攒的）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { AiConversation } from '@/services/api/ai/types';
import { ConversationHistory } from './ConversationHistory';

const mocks = vi.hoisted(() => ({
  listAiConversations: vi.fn(),
}));

vi.mock('@/services/api/ai/client', () => ({
  listAiConversations: mocks.listAiConversations,
}));

/** 造一条会话（字段照服务端 `store.ts` 的 `ConversationRecord`）。 */
function conversation(
  overrides: Partial<AiConversation> = {},
): AiConversation {
  return {
    conversationId: 'c1',
    title: '关于预算的讨论',
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

/** 打开「历史对话」。 */
async function openHistory(): Promise<void> {
  const { getByRole } = await render(
    <ConversationHistory workspace={{ switchConversation: vi.fn() }} />,
  );
  await userEvent.click(getByRole('button', { name: '历史对话' }));
}

describe('AI 工作台的「历史对话」', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('打开时读列表，标题与时间都渲染出来', async () => {
    mocks.listAiConversations.mockResolvedValue([
      conversation(),
      conversation({ conversationId: 'c2', title: '第二个会话' }),
    ]);

    const { getByRole } = await render(
      <ConversationHistory workspace={{ switchConversation: vi.fn() }} />,
    );
    await userEvent.click(getByRole('button', { name: '历史对话' }));

    await expect.element(getByRole('button', { name: '历史对话' })).toBeVisible();
    // 列表读的是 `listAiConversations()`
    await vi.waitFor(() => {
      expect(mocks.listAiConversations).toHaveBeenCalledTimes(1);
    });
    await expect.element(getByRole('button', { name: /关于预算的讨论/ })).toBeVisible();
    await expect.element(getByRole('button', { name: /第二个会话/ })).toBeVisible();
    // 时间也有（相对时间，具体文案随时间变 ⇒ 只断言它不是空的）
    const time = document.querySelector<HTMLElement>(
      '[data-role="ai-history-item-time"]',
    );
    expect(time?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('空态：一个会话都没有时说一句', async () => {
    mocks.listAiConversations.mockResolvedValue([]);

    const { getByRole, getByText } = await render(
      <ConversationHistory workspace={{ switchConversation: vi.fn() }} />,
    );
    await userEvent.click(getByRole('button', { name: '历史对话' }));

    await expect.element(getByText('还没有历史对话')).toBeVisible();
  });

  it('失败态：说清原因，且能重试', async () => {
    mocks.listAiConversations.mockRejectedValueOnce(new Error('HTTP 502'));
    mocks.listAiConversations.mockResolvedValueOnce([conversation()]);

    const { getByRole, getByText } = await render(
      <ConversationHistory workspace={{ switchConversation: vi.fn() }} />,
    );
    await userEvent.click(getByRole('button', { name: '历史对话' }));

    await expect.element(getByText(/历史对话读不到/)).toBeVisible();

    // 点「重试」⇒ 再读一次 ⇒ 读到列表了
    // ⚠️ antd 会在两个汉字之间插一个空格 ⇒ 可访问名是「重 试」
    await userEvent.click(getByRole('button', { name: /重\s*试/ }));
    await expect.element(getByRole('button', { name: /关于预算的讨论/ })).toBeVisible();
    await vi.waitFor(() => {
      expect(mocks.listAiConversations).toHaveBeenCalledTimes(2);
    });
  });

  it('加载中：有个提示（不是空白）', async () => {
    // 一个**永不结束**的请求 ⇒ 停在加载中
    mocks.listAiConversations.mockImplementation(
      () => new Promise<AiConversation[]>(() => undefined),
    );

    const { getByRole, getByText } = await render(
      <ConversationHistory workspace={{ switchConversation: vi.fn() }} />,
    );
    await userEvent.click(getByRole('button', { name: '历史对话' }));

    await expect.element(getByText(/加载中/)).toBeVisible();
  });

  it('点一条 ⇒ 切到那个会话（接着聊）', async () => {
    mocks.listAiConversations.mockResolvedValue([
      conversation(),
      conversation({ conversationId: 'c2', title: '第二个会话' }),
    ]);
    const switchConversation = vi.fn(async () => undefined);

    const { getByRole } = await render(
      <ConversationHistory workspace={{ switchConversation }} />,
    );
    await userEvent.click(getByRole('button', { name: '历史对话' }));
    await userEvent.click(getByRole('button', { name: /第二个会话/ }));

    await vi.waitFor(() => {
      expect(switchConversation).toHaveBeenCalledWith('c2');
    });
  });

  it('长标题被截断（窄版只有 400px，不能把行撑破）', async () => {
    const longTitle = '一'.repeat(120);
    mocks.listAiConversations.mockResolvedValue([conversation({ title: longTitle })]);

    await openHistory();

    const title = await vi.waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        '[data-role="ai-history-item-title"]',
      );
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(title.style.textOverflow).toBe('ellipsis');
    expect(title.style.overflow).toBe('hidden');
    expect(title.style.whiteSpace).toBe('nowrap');
  });
});
