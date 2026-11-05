/**
 * AI 工作台侧栏容器的测试 —— 只验**容器**（页签与头部），
 * 对话页签的行为在 `ChatPanel.test.tsx` 里。
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { AiWorkspace } from './index';

const mocks = vi.hoisted(() => ({
  createAiConversation: vi.fn(),
  getAiState: vi.fn(),
  sendAiCommand: vi.fn(),
  createAiCommandId: vi.fn(),
  subscribeAiEvents: vi.fn(() => () => undefined),
}));

vi.mock('@/services/api/ai/client', () => ({
  AI_API_BASE_URL: '/ai-api',
  aiUrl: (path: string) => `/ai-api${path}`,
  createAiCommandId: mocks.createAiCommandId,
  sendAiCommand: mocks.sendAiCommand,
  createAiConversation: mocks.createAiConversation,
  getAiState: mocks.getAiState,
  listAiAudit: vi.fn(),
  listAiPending: vi.fn(),
  listAiConversations: vi.fn(),
}));

vi.mock('@/services/api/ai/sse', () => ({
  subscribeAiEvents: mocks.subscribeAiEvents,
  readSseFrames: vi.fn(),
  toAiEvent: vi.fn(),
}));

describe('AI 工作台侧栏', () => {
  it('有头部与三个页签', async () => {
    mocks.createAiConversation.mockResolvedValue({
      conversationId: 'c1',
      title: '新对话',
    });
    mocks.getAiState.mockResolvedValue({
      conversationId: 'c1',
      messages: [],
      isStreaming: false,
    });

    const { getByText } = await render(<AiWorkspace />);

    await expect.element(getByText('AI 工作台')).toBeVisible();
    await expect.element(getByText('对话')).toBeVisible();
    await expect.element(getByText('待确认')).toBeVisible();
    await expect.element(getByText('审计')).toBeVisible();
  });
});
