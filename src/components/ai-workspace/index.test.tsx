/**
 * AI 工作台侧栏容器的测试 —— 只验**容器**（页签与头部），
 * 对话页签的行为在 `ChatPanel.test.tsx` 里。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { AiWorkspace } from './index';

const mocks = vi.hoisted(() => ({
  createAiConversation: vi.fn(),
  getAiState: vi.fn(),
  sendAiCommand: vi.fn(),
  createAiCommandId: vi.fn(),
  subscribeAiEvents: vi.fn(() => () => undefined),
  listAiAudit: vi.fn(async () => ({ total: 0, items: [] })),
  listAiPending: vi.fn(async () => []),
}));

vi.mock('@/services/api/ai/client', () => ({
  AI_API_BASE_URL: '/ai-api',
  aiUrl: (path: string) => `/ai-api${path}`,
  createAiCommandId: mocks.createAiCommandId,
  sendAiCommand: mocks.sendAiCommand,
  createAiConversation: mocks.createAiConversation,
  getAiState: mocks.getAiState,
  listAiAudit: mocks.listAiAudit,
  listAiPending: mocks.listAiPending,
  listAiConversations: vi.fn(),
}));

vi.mock('@/services/api/ai/sse', () => ({
  subscribeAiEvents: mocks.subscribeAiEvents,
  readSseFrames: vi.fn(),
  toAiEvent: vi.fn(),
}));

describe('AI 工作台侧栏', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 会话 id 存在 localStorage 里 ⇒ 清掉，否则上一条用例留下的会话
    // 会让这一条直接去读快照（走不到「新建会话失败」那条路）。
    localStorage.removeItem('aipm.workspace');
  });

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

  it('页签没打开就不读待确认与审计', async () => {
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

    // 侧栏挂在整个布局上（Task 4）⇒ 一挂上就发请求会让 AI 服务不可达时
    // 用户在别的页面上莫名其妙看到报错。
    expect(mocks.listAiPending).not.toHaveBeenCalled();
    expect(mocks.listAiAudit).not.toHaveBeenCalled();
  });

  it('打开「审计」页签才去读审计', async () => {
    mocks.createAiConversation.mockResolvedValue({
      conversationId: 'c1',
      title: '新对话',
    });
    mocks.getAiState.mockResolvedValue({
      conversationId: 'c1',
      messages: [],
      isStreaming: false,
    });

    const { getByRole } = await render(<AiWorkspace />);
    await getByRole('tab', { name: '审计' }).click();

    await vi.waitFor(() => {
      expect(mocks.listAiAudit).toHaveBeenCalledTimes(1);
    });
    // 待确认还没打开 ⇒ 不读
    expect(mocks.listAiPending).not.toHaveBeenCalled();
  });

  it('AI 服务连不上时在面板里说一声（不靠全局提示）', async () => {
    mocks.createAiConversation.mockRejectedValue(
      new Error('AI 事件流请求失败（HTTP 502）'),
    );

    const { getByText } = await render(<AiWorkspace />);

    await expect.element(getByText(/AI 服务未连接/)).toBeVisible();
  });
});
