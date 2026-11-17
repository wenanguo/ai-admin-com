/**
 * 窄版 AI 工作台面板的**拖动与调宽**。
 *
 * ## 钉住的事
 *
 * 1. 拖左边缘 ⇒ 宽度变（并有下限 320 / 上限「不超过内容区宽」）；
 * 2. 拖标题 ⇒ 位置变（面板变成可自由摆放的窗口）；
 * 3. 宽度与位置**刷新后还在**（存 `localStorage`）；
 * 4. **最大化 ↔ 窄版来回切换** ⇒ 调好的位置与宽度**不丢**；
 * 5. 窄屏（手机）形态**不允许拖**（仍是占满整宽）；
 * 6. 拖动中**不误选中文本**，松手后恢复。
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
  listAiSkills: vi.fn(async () => []),
  listAiAgents: vi.fn(async () => []),
  approveAiPending: vi.fn(),
  rejectAiPending: vi.fn(),
}));

vi.mock('@/services/api/ai/sse', () => ({
  subscribeAiEvents: mocks.subscribeAiEvents,
  readSseFrames: vi.fn(),
  toAiEvent: vi.fn(),
}));

/** 造一个指针事件（浏览器里真有 `PointerEvent` ⇒ 直接用）。 */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
): PointerEvent {
  return new PointerEvent(type, {
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
  });
}

/** 窄版浮层面板。 */
function panel(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-testid="ai-workspace-panel"]',
  );
}

/** 拖左边缘调宽度的把手。 */
function resizeHandle(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-testid="ai-workspace-resize-handle"]',
  );
}

/** 拖标题移动面板的把手。 */
function dragHandle(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-testid="ai-workspace-drag-handle"]',
  );
}

/** 读存储里的面板几何。 */
function storedPanel():
  | { left: number; top: number; width: number }
  | undefined {
  const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as {
    panel?: { left: number; top: number; width: number };
  };
  return parsed.panel;
}

/** 打开面板（点右下角的悬浮按钮）。 */
async function openPanel(container: HTMLElement): Promise<void> {
  container
    .querySelector<HTMLElement>('[data-testid="ai-workspace-launcher"]')
    ?.click();
  await vi.waitFor(() => {
    expect(panel(container)).not.toBeNull();
  });
}

describe('窄版面板可拖动', () => {
  beforeEach(async () => {
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

  it('默认还是「右边 400px、顶到上下沿」（一个字没改）', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(container);

    const element = panel(container)!;
    expect(element.style.right).toBe('0px');
    expect(element.style.bottom).toBe('0px');
    expect(element.style.width).toBe('400px');
    // ⚠️ 没拖过 ⇒ **没有**把手的几何（left/top/height 都不设）
    expect(element.style.left).toBe('');
    expect(element.style.height).toBe('');
  });

  it('拖左边缘 ⇒ 宽度变大，并写进 localStorage', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(container);

    const handle = resizeHandle(container)!;
    const element = panel(container)!;
    const box = element.getBoundingClientRect();

    handle.dispatchEvent(pointer('pointerdown', box.left, 300));
    window.dispatchEvent(pointer('pointermove', box.left - 120, 300));
    window.dispatchEvent(pointer('pointerup', box.left - 120, 300));

    await vi.waitFor(() => {
      expect(element.style.width).toBe('520px');
    });
    // ⚠️ **右边缘不动**（拖的是左边缘 ⇒ 面板右边还钉在视口右边）
    expect(element.style.left).toBe(`${1440 - 520}px`);
    expect(storedPanel()?.width).toBe(520);
  });

  it('宽度有下限（320px）与上限（不超过内容区宽）', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(container);

    const handle = resizeHandle(container)!;
    const element = panel(container)!;
    const box = element.getBoundingClientRect();

    // 往右猛拖 ⇒ 宽度不能小于 320
    handle.dispatchEvent(pointer('pointerdown', box.left, 300));
    window.dispatchEvent(pointer('pointermove', box.left + 2000, 300));
    window.dispatchEvent(pointer('pointerup', box.left + 2000, 300));
    await vi.waitFor(() => {
      expect(element.style.width).toBe('320px');
    });

    // 往左猛拖 ⇒ 宽度不能超过内容区宽（这里内容区就是整个视口）
    handle.dispatchEvent(pointer('pointerdown', box.left, 300));
    window.dispatchEvent(pointer('pointermove', box.left - 5000, 300));
    window.dispatchEvent(pointer('pointerup', box.left - 5000, 300));
    await vi.waitFor(() => {
      expect(Number.parseInt(element.style.width, 10)).toBeLessThanOrEqual(
        1440,
      );
    });
  });

  it('拖标题 ⇒ 位置变了（面板变成可自由摆放的窗口）', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(container);

    const handle = dragHandle(container)!;
    const element = panel(container)!;
    const box = element.getBoundingClientRect();

    handle.dispatchEvent(pointer('pointerdown', box.left + 20, 20));
    window.dispatchEvent(pointer('pointermove', box.left - 180, 140));
    window.dispatchEvent(pointer('pointerup', box.left - 180, 140));

    await vi.waitFor(() => {
      expect(element.style.left).not.toBe('');
      expect(Number.parseInt(element.style.left, 10)).toBeLessThan(box.left);
    });
    expect(Number.parseInt(element.style.top, 10)).toBeGreaterThan(0);
    expect(storedPanel()?.left).toBeLessThan(1440 - 400);
  });

  it('位置与宽度刷新后还在（localStorage）', async () => {
    const first = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(first.container);

    const handle = resizeHandle(first.container)!;
    const element = panel(first.container)!;
    const box = element.getBoundingClientRect();
    handle.dispatchEvent(pointer('pointerdown', box.left, 300));
    window.dispatchEvent(pointer('pointermove', box.left - 120, 300));
    window.dispatchEvent(pointer('pointerup', box.left - 120, 300));
    await vi.waitFor(() => {
      expect(storedPanel()?.width).toBe(520);
    });

    // 再挂一次（相当于刷新页面）⇒ 宽度还是那样
    const second = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(second.container);
    expect(panel(second.container)?.style.width).toBe('520px');
  });

  it('最大化 ↔ 窄版来回切换 ⇒ 调好的位置与宽度不丢', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(container);

    const handle = resizeHandle(container)!;
    const element = panel(container)!;
    const box = element.getBoundingClientRect();
    handle.dispatchEvent(pointer('pointerdown', box.left, 300));
    window.dispatchEvent(pointer('pointermove', box.left - 120, 300));
    window.dispatchEvent(pointer('pointerup', box.left - 120, 300));
    await vi.waitFor(() => {
      expect(element.style.width).toBe('520px');
    });

    // 最大化 ⇒ 再返回 ⇒ 窄版还是那个宽度
    container
      .querySelector<HTMLElement>('[data-role="ai-workspace-expand-button"]')
      ?.click();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="ai-workspace-wide-overlay"]'),
      ).not.toBeNull();
    });
    container
      .querySelector<HTMLElement>('[data-role="ai-back-button"]')
      ?.click();
    await vi.waitFor(() => {
      expect(panel(container)?.style.width).toBe('520px');
    });
  });

  it('拖动中禁用文本选择，松手后恢复', async () => {
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(container);

    const handle = dragHandle(container)!;
    const element = panel(container)!;
    const box = element.getBoundingClientRect();

    handle.dispatchEvent(pointer('pointerdown', box.left + 20, 20));
    await vi.waitFor(() => {
      expect(document.body.style.userSelect).toBe('none');
    });

    window.dispatchEvent(pointer('pointerup', box.left + 20, 20));
    await vi.waitFor(() => {
      expect(document.body.style.userSelect).not.toBe('none');
    });
    expect(element.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it('窄屏（手机）形态不允许拖（仍是占满整宽，也没有把手）', async () => {
    await page.viewport(500, 800);
    const { container } = await render(
      <AiWorkspaceShell>
        <div>主内容</div>
      </AiWorkspaceShell>,
    );
    await openPanel(container);

    expect(resizeHandle(container)).toBeNull();
    expect(panel(container)?.style.width).toBe('100vw');
  });
});
