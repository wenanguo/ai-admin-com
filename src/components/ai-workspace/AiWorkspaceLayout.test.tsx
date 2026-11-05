/**
 * AI 工作台**布局外壳**的测试。
 *
 * 钉死三件事（规格 §3.1）：
 * 1. 侧栏是**常驻的一列**（不是抽屉）：展开 400px，折叠 40px；
 * 2. `⌘B` / `Ctrl+B` 能折叠与展开；
 * 3. 折叠状态存在 `localStorage`（`aipm.workspace` 的 `collapsed` 字段）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { AiWorkspaceLayout } from './AiWorkspaceLayout';
import { WORKSPACE_STORAGE_KEY } from './storage';

const mocks = vi.hoisted(() => ({
  createAiConversation: vi.fn(),
  getAiState: vi.fn(),
  subscribeAiEvents: vi.fn(() => () => undefined),
  listAiAudit: vi.fn(async () => ({ total: 0, items: [] })),
  listAiPending: vi.fn(async () => []),
}));

vi.mock('@/services/api/ai/client', () => ({
  AI_API_BASE_URL: '/ai-api',
  aiUrl: (path: string) => `/ai-api${path}`,
  createAiCommandId: vi.fn(() => 'cmd-1'),
  sendAiCommand: vi.fn(),
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

/** 侧栏（antd 的 `Layout.Sider` 渲染成 `aside`）。 */
function sider(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('.ant-layout-sider');
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

/** 读工作台状态里存的折叠状态。 */
function storedCollapsed(): boolean | undefined {
  const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as { collapsed?: boolean };
  return parsed.collapsed;
}

describe('AI 工作台布局外壳', () => {
  beforeEach(() => {
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

  it('侧栏是常驻的一列：展开 400px、折叠 40px', async () => {
    const { container } = await render(
      <AiWorkspaceLayout>
        <div>主内容</div>
      </AiWorkspaceLayout>,
    );

    expect(sider(container).style.width).toBe('400px');

    // 折叠：宽度收成 40px 的竖条，主内容那一列还在（不是盖上去）
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }),
    );

    await vi.waitFor(() => {
      expect(sider(container).style.width).toBe('40px');
    });
    expect(container.textContent).toContain('主内容');
  });

  it('⌘B / Ctrl+B 能折叠与展开', async () => {
    const { container } = await render(
      <AiWorkspaceLayout>
        <div>主内容</div>
      </AiWorkspaceLayout>,
    );

    await vi.waitFor(() => {
      expect(sider(container).style.width).toBe('400px');
    });

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(sider(container).style.width).toBe('40px');
    });

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(sider(container).style.width).toBe('400px');
    });
  });

  it('输入框里不劫持快捷键（那里 Ctrl+B 是加粗）', async () => {
    const { container } = await render(
      <AiWorkspaceLayout>
        <input aria-label="普通输入框" />
      </AiWorkspaceLayout>,
    );

    const input = container.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    input?.focus();

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(sider(container).style.width).toBe('400px');
  });

  it('折叠状态写进 localStorage，刷新后还在', async () => {
    const { container } = await render(
      <AiWorkspaceLayout>
        <div>主内容</div>
      </AiWorkspaceLayout>,
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(storedCollapsed()).toBe(true);
    });

    // 再挂一次（相当于刷新页面）⇒ 仍然是折叠的
    const second = await render(
      <AiWorkspaceLayout>
        <div>主内容</div>
      </AiWorkspaceLayout>,
    );
    expect(sider(second.container).style.width).toBe('40px');
    expect(sider(container).style.width).toBe('40px');
  });
});
