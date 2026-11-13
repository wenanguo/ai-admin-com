/**
 * AI 工作台**布局外壳**的测试。
 *
 * 钉死四件事：
 * 1. 面板**默认关着**，右下角只有一个悬浮按钮（不占布局宽度、不挡内容）；
 * 2. 点悬浮按钮 ⇒ 浮层出现，按钮消失；
 * 3. `⌘B` / `Ctrl+B` 能开能关（输入框里不劫持）；
 * 4. 开关状态存在 `localStorage`（`aipm.workspace` 的 `open` 字段）。
 */

import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { AiWorkspaceShell } from './AiWorkspaceShell';
import { WORKSPACE_STORAGE_KEY } from './storage';

const mocks = vi.hoisted(() => ({
  createAiConversation: vi.fn(),
  getAiState: vi.fn(),
  subscribeAiEvents: vi.fn(() => () => undefined),
  listAiAudit: vi.fn(async () => ({ total: 0, items: [] })),
  listAiPending: vi.fn(async () => []),
}));

vi.mock('@umijs/max', () => ({
  // 全局 model（AI 工作台 ↔ 主工作区的桥）
  useModel: () => ({
    context: null,
    setContext: vi.fn(),
    clearContext: vi.fn(),
    lastUpdate: null,
    notifyUpdate: vi.fn(),
    expandSignal: 0,
    focusSignal: 0,
    requestExpand: vi.fn(),
    requestFocus: vi.fn(),
  }),
  // 外壳要知道当前路由（全宽页上不挂浮层）⇒ 给一个固定的路径。
  //
  // ⚠️ 用的是 `history` 而不是 `useLocation`：这个外壳挂在 `rootContainer` 上，
  // 不在 React Router 的上下文里 ⇒ `useLocation` 那套 hook 用不了。
  history: {
    location: { pathname: '/' },
    listen: () => () => undefined,
  },
}));

vi.mock('@/services/api/ai/client', () => ({
  AI_API_BASE_URL: '/ai-api',
  aiUrl: (path: string) => `/ai-api${path}`,
  createAiCommandId: vi.fn(() => 'cmd-1'),
  sendAiCommand: vi.fn(),
  createAiConversation: mocks.createAiConversation,
  getAiState: mocks.getAiState,
  abortAiConversation: vi.fn(),
  listAiAudit: mocks.listAiAudit,
  listAiPending: mocks.listAiPending,
  listAiConversations: vi.fn(),
  listAiSkills: vi.fn(),
  approveAiPending: vi.fn(),
  rejectAiPending: vi.fn(),
}));

vi.mock('@/services/api/ai/sse', () => ({
  subscribeAiEvents: mocks.subscribeAiEvents,
  readSseFrames: vi.fn(),
  toAiEvent: vi.fn(),
}));

/** 浮层面板（开着时才有）。 */
function panel(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-testid="ai-workspace-panel"]',
  );
}

/** 右下角的悬浮按钮（面板关着时才有）。 */
function launcher(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-testid="ai-workspace-launcher"]',
  );
}

/** 读工作台状态里存的「面板开着吗」。 */
function storedOpen(): boolean | undefined {
  const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as { open?: boolean };
  return parsed.open;
}

describe('AI 工作台布局外壳', () => {
  beforeEach(async () => {
    // ⚠️ **这个文件要宽视口**：侧栏带 `breakpoint="xl"`（1200px），
    //    窄于它时 antd 会自动把侧栏收成 40px 的竖条 ⇒
    //    「展开时 400px」这条断言在手机宽下根本测不到。
    //
    //    全局视口是**手机宽**（414×896，见 `vitest.config.ts`）⇒
    //    需要宽视口的测试文件自己声明。
    await page.viewport(1440, 900);
    vi.clearAllMocks();
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    mocks.createAiConversation.mockResolvedValue({
      conversationId: 'c1',
      title: '新对话',
    });
    mocks.getAiState.mockResolvedValue({
      conversationId: 'c1',
      messages: [],
      isStreaming: false,
    });
  });

  it('默认关着，只有右下角一个悬浮按钮', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );

    // 面板默认**不出现** ⇒ 不挡内容
    expect(panel(container)).toBeNull();
    expect(launcher(container)).not.toBeNull();
    expect(container.textContent).toContain('主内容');
  });

  it('点悬浮按钮 ⇒ 浮层出现，按钮消失', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );

    launcher(container)?.click();

    await vi.waitFor(() => {
      expect(panel(container)).not.toBeNull();
    });
    // 面板开着的时候**不再显示**那个按钮（面板右上角已经有 X 了）
    expect(launcher(container)).toBeNull();
  });

  it('⌘B / Ctrl+B 能开能关', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );

    expect(panel(container)).toBeNull();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(panel(container)).not.toBeNull();
    });

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(panel(container)).toBeNull();
    });
  });

  it('输入框里不劫持快捷键（那里 Ctrl+B 是加粗）', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <input aria-label="普通输入框" />
      </AiWorkspaceShell>,
    );

    const input = container.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    input?.focus();

    // ⚠️ 事件必须**派发在输入框上** ⇒ event.target 真的是那个 input。
    //    派发在 window 上时 event.target === window ⇒「目标是不是可编辑元素」
    //    永远为假 ⇒ 这条守卫根本不会被测到（测试会永远绿）。
    input?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    // React 的状态更新是异步的 ⇒ 先让它刷出来。
    // 守卫失效时面板会开 ⇒ 下面的断言就会红。
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    // 守卫生效 ⇒ 面板**没有**被打开
    await vi.waitFor(() => {
      expect(panel(container)).toBeNull();
    });
  });

  it('面板开关写进 localStorage，刷新后还在', async () => {
    await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(storedOpen()).toBe(true);
    });

    // 再挂一次（相当于刷新页面）⇒ 仍然是开着的
    const second = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    expect(panel(second.container)).not.toBeNull();
  });
});
