/**
 * AI 工作台侧栏容器的测试 —— 只验**容器**（页签与头部），
 * 对话页签的行为在 `ChatPanel.test.tsx` 里。
 */
import type React from 'react';
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
  approveAiPending: vi.fn(async () => undefined),
  /** 全局 model 的「写回广播」—— 批准后它应该被叫到。 */
  notifyUpdate: vi.fn(),
  /** 事件流订阅的回调（测试自己往里喂「连上了」与「断了」）。 */
  stream: {
    onEvent: undefined as ((event: unknown) => void) | undefined,
    onError: undefined as ((error: Error) => void) | undefined,
  },
}));

vi.mock('@umijs/max', () => ({
  // 全局 model（AI 工作台 ↔ 主工作区的桥）
  useModel: () => ({
    context: null,
    setContext: vi.fn(),
    clearContext: vi.fn(),
    lastUpdate: null,
    notifyUpdate: mocks.notifyUpdate,
    expandSignal: 0,
    requestExpand: vi.fn(),
  }),
  // 侧栏头部有进全宽页的入口（一个 `Link`）。
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/services/api/ai/client', () => ({
  AI_API_BASE_URL: '/ai-api',
  aiUrl: (path: string) => `/ai-api${path}`,
  createAiCommandId: mocks.createAiCommandId,
  sendAiCommand: mocks.sendAiCommand,
  createAiConversation: mocks.createAiConversation,
  getAiState: mocks.getAiState,
  abortAiConversation: vi.fn(),
  listAiAudit: mocks.listAiAudit,
  listAiPending: mocks.listAiPending,
  listAiConversations: vi.fn(),
  approveAiPending: mocks.approveAiPending,
  rejectAiPending: vi.fn(),
}));

vi.mock('@/services/api/ai/sse', () => ({
  subscribeAiEvents: (
    _conversationId: string,
    onEvent: (event: unknown) => void,
    onError?: (error: Error) => void,
  ) => {
    mocks.stream.onEvent = onEvent;
    mocks.stream.onError = onError;
    return () => undefined;
  },
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

  it('批准一条挂起的修改 ⇒ 广播「哪条任务变了」（左边据此刷新+高亮）', async () => {
    mocks.createAiConversation.mockResolvedValue({
      conversationId: 'c1',
      title: '新对话',
    });
    mocks.getAiState.mockResolvedValue({
      conversationId: 'c1',
      messages: [],
      isStreaming: false,
    });
    mocks.listAiPending.mockResolvedValue([
      {
        id: 'p1',
        command: 'mcp__aiadmin__update_task',
        args: { id: 6, status_code: 'done' },
        status: 'PENDING',
      },
    ]);

    const { getByRole, getByText } = await render(<AiWorkspace />);
    await getByRole('tab', { name: '待确认' }).click();
    await expect.element(getByText(/mcp__aiadmin__update_task/)).toBeVisible();

    await getByRole('button', { name: /确认执行/ }).click();

    await vi.waitFor(() => {
      expect(mocks.approveAiPending).toHaveBeenCalledWith('p1');
    });
    // ⚠️ 批准只是**唤醒**闸门 ⇒ 写还没落库 ⇒ 刷新信号要**延迟**发
    //    （立刻发的话，左边查到的还是旧值）
    await vi.waitFor(
      () => {
        expect(mocks.notifyUpdate).toHaveBeenCalledWith({
          entityType: 'task',
          entityId: 6,
          fields: [],
        });
      },
      { timeout: 3000 },
    );
  });

  it('AI 服务连不上时在面板里说一声（不靠全局提示）', async () => {
    mocks.createAiConversation.mockRejectedValue(
      new Error('AI 事件流请求失败（HTTP 502）'),
    );

    const { getByText } = await render(<AiWorkspace />);

    await expect.element(getByText(/AI 服务未连接/)).toBeVisible();
  });

  it('连不上时可以点「重试连接」重试一次', async () => {
    mocks.createAiConversation.mockRejectedValue(
      new Error('AI 事件流请求失败（HTTP 502）'),
    );

    const { getByRole, getByText } = await render(<AiWorkspace />);
    await expect.element(getByText(/AI 服务未连接/)).toBeVisible();

    // 第二次就连上了
    mocks.createAiConversation.mockResolvedValue({
      conversationId: 'c1',
      title: '新对话',
    });
    // ⚠️ antd 会在两个汉字之间插一个空格 ⇒ 可访问名是「重 试 连 接」
    await getByRole('button', { name: /重\s*试\s*连\s*接/ }).click();

    await vi.waitFor(() => {
      expect(mocks.createAiConversation).toHaveBeenCalledTimes(2);
    });
    // 重试成功后那条提示就没了
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-role="ai-connection-error"]'),
      ).toBeNull();
    });
  });

  it('事件流断了以后头部显示「AI 服务不可用」', async () => {
    mocks.createAiConversation.mockResolvedValue({
      conversationId: 'c1',
      title: '新对话',
    });
    mocks.getAiState.mockResolvedValue({
      conversationId: 'c1',
      messages: [],
      isStreaming: false,
    });

    const { container } = await render(<AiWorkspace />);
    await expect
      .element(
        container.querySelector<HTMLElement>(
          '[data-role="ai-unavailable-tag"]',
        ),
      )
      .toBeNull();

    // 连上了 ⇒ 不该显示「不可用」
    await vi.waitFor(() => {
      expect(mocks.stream.onEvent).toBeTypeOf('function');
    });
    mocks.stream.onEvent?.({
      type: 'connected',
      conversationId: 'c1',
      isStreaming: false,
    });
    // ⚠️ 等 React 把「连上了」这一帧刷出来（否则后面的「断了」会被一起批处理掉）
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    // 断了（token 过期 / 服务挂了）⇒ 必须看得见
    await vi.waitFor(() => {
      expect(mocks.stream.onError).toBeTypeOf('function');
    });
    mocks.stream.onError?.(new Error('AI 事件流请求失败（HTTP 401）'));

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-role="ai-unavailable-tag"]'),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain('AI 服务不可用');
  });

  it('页签切换会写进 localStorage,刷新后还在', async () => {
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

    // ⚠️ 页签要持久化（规格 §3.1 / U2）：刷新后还停在刚才那个页签
    await vi.waitFor(() => {
      const raw = localStorage.getItem('aipm.workspace');
      expect(raw).not.toBeNull();
      expect((JSON.parse(raw as string) as { tab?: string }).tab).toBe('audit');
    });
  });
});
