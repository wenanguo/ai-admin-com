/**
 * **项目卡片视图**（紧凑卡）的测试。
 *
 * 钉死四件事：
 * 1. 卡片渲染出项目名、状态标签、负责人；
 * 2. 点机器人 ⇒ 走**共享**的「与 AI 讨论」（setContext 带上这个项目的上下文），
 *    **没有**导航到详情页（机器人是标题链接的兄弟，不是嵌在链接里）；
 * 3. 筛选框输入 ⇒ 只剩匹配的项目（名称**或**编码命中即可）；
 * 4. 筛不出东西 ⇒ 显示空态（Empty），不是白屏。
 *
 * ⚠️ browser 模式的全局视口是**手机宽**（414×896）⇒ 卡片是 `xs={24}` 一列一行，
 *    断言按窄屏写。
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-react';
import { ProjectCardView } from './ProjectCardView';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn<(code: string) => boolean>(),
  setContext: vi.fn(),
  requestExpand: vi.fn(),
  requestFocus: vi.fn(),
  /** 「真的导航了」——用它证明点机器人不会顺手进详情页 */
  navigate: vi.fn(),
  reload: vi.fn(),
  /** 共享数据集里的两个项目（卡片视图与表格视图读的是同一份） */
  projects: [
    {
      id: 7,
      code: 'AIPM-CORE',
      name: 'AIPM 核心项目',
      status_code: 'planning',
      priority_code: 'P1',
      owner_by: { id: 3, name: '张三' },
      due_date: '2026-12-31',
    },
    {
      id: 8,
      code: 'BILLING',
      name: 'B 结算项目',
      status_code: 'in_progress',
      priority_code: 'P0',
      owner_by: { id: 4, name: '李四' },
      due_date: '2027-01-15',
    },
  ],
  /** 字典选项（状态 / 优先级）—— 标签与筛选项共用同一套 */
  dictOptions: {
    module_pm_project_status: [
      { value: 'planning', label: '规划中' },
      { value: 'in_progress', label: '进行中' },
    ],
    module_pm_priority: [
      { value: 'P0', label: '紧急' },
      { value: 'P1', label: '高' },
    ],
  },
}));

vi.mock('@umijs/max', () => ({
  // 详情页入口：渲染成普通链接，并记录「有没有真的导航」
  Link: ({ to, children }: { to: string; children?: ReactNode }) => (
    <a
      href={to}
      onClick={(event) => {
        event.preventDefault();
        mocks.navigate(to);
      }}
    >
      {children}
    </a>
  ),
  useAccess: () => ({ hasPermission: mocks.hasPermission }),
  // AI 工作台 ↔ 主工作区的桥（「与 AI 讨论」用它把上下文塞进去）
  useModel: () => ({
    setContext: mocks.setContext,
    requestExpand: mocks.requestExpand,
    requestFocus: mocks.requestFocus,
  }),
  request: vi.fn(),
}));

// 字典：卡片上的状态 / 优先级标签与筛选项都走它（不在这儿测字典请求）
vi.mock('@/components/pm/useDictOptions', () => ({
  useDictOptions: (dictType: string) => ({
    options:
      mocks.dictOptions[dictType as keyof typeof mocks.dictOptions] ?? [],
    loading: false,
  }),
}));

// 共享数据集：卡片视图读它（取数本身由 useProjectDataset 的用例把守）
vi.mock('./useProjectDataset', () => ({
  useProjectDataset: () => ({
    projects: mocks.projects,
    total: mocks.projects.length,
    loading: false,
    error: null,
    truncated: false,
    dataUpdatedAt: 0,
    reload: mocks.reload,
    patchProject: vi.fn(),
  }),
}));

// 写操作走 service：这里不发请求
vi.mock('@/services/api/pm/project', () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProjects: vi.fn(),
}));

// 新增 / 编辑弹窗不在本用例的范围内 ⇒ 换成空壳（省掉 pro-components 的表单）
vi.mock('./ProjectModalForm', () => ({
  default: () => null,
}));

/** 筛选行里的搜索框 */
function searchInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[placeholder="搜索项目名称/编码"]',
  );
  if (!input) {
    throw new Error('找不到卡片视图的搜索框');
  }
  return input;
}

/** 卡片（按 data-project-id 找） */
function card(container: HTMLElement, id: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-project-id="${id}"]`);
}

describe('项目卡片视图', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockReturnValue(true);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('渲染出项目名、状态标签、负责人', async () => {
    const { container } = await render(<ProjectCardView />);

    expect(container.textContent).toContain('AIPM 核心项目');
    // 状态标签：字典翻成中文（不是线上码）
    expect(container.textContent).toContain('规划中');
    // 负责人
    expect(container.textContent).toContain('张三');
    // 卡片根元素带 data-project-id（e2e 靠它数卡片、与表格的行数对比）
    expect(card(container, 7)).not.toBeNull();
  });

  it('点机器人 ⇒ 走共享的「与 AI 讨论」，且不进详情页', async () => {
    const { container } = await render(<ProjectCardView />);

    const robot = card(container, 7)?.querySelector<HTMLElement>(
      '[data-role="ai-discuss-button"]',
    );
    expect(robot).not.toBeNull();
    robot?.click();

    // 上下文带上**这个项目**
    expect(mocks.setContext).toHaveBeenCalledTimes(1);
    const context = mocks.setContext.mock.calls[0][0];
    expect(context.kind).toBe('project');
    expect(context.project?.id).toBe(7);
    expect(context.project?.name).toBe('AIPM 核心项目');

    // ⚠️ **没有**导航到详情页：机器人是标题链接的兄弟，不是嵌在链接里
    expect(mocks.navigate).not.toHaveBeenCalled();
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="/pm/project/7"]',
    );
    expect(link).not.toBeNull();
    expect(link?.querySelector('button')).toBeNull();

    // 反证：点项目名（详情页入口）**会**导航 ⇒ 上面那条断言不是空的
    link?.click();
    expect(mocks.navigate).toHaveBeenCalledWith('/pm/project/7');
  });

  it('筛选框输入 ⇒ 只剩匹配的项目（名称或编码命中即可）', async () => {
    const { container } = await render(<ProjectCardView />);
    const input = searchInput(container);

    // 按名称筛
    await userEvent.fill(input, '结算');
    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-project-id]')).toHaveLength(1);
    });
    expect(container.textContent).toContain('B 结算项目');
    expect(container.textContent).not.toContain('AIPM 核心项目');

    // 按编码筛（搜索框同时匹配 name 与 code）
    await userEvent.fill(input, 'BILLING');
    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-project-id]')).toHaveLength(1);
    });
    expect(container.textContent).toContain('B 结算项目');
  });

  it('筛不出东西 ⇒ 显示空态，不是白屏', async () => {
    const { container } = await render(<ProjectCardView />);
    const input = searchInput(container);

    await userEvent.fill(input, '不存在的项目');

    await vi.waitFor(() => {
      expect(container.textContent).toContain('没有符合条件的项目');
    });
    expect(container.querySelectorAll('[data-project-id]')).toHaveLength(0);
  });
});
