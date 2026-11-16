/**
 * 项目详情页「成员」页签的测试（issue #66）。
 *
 * ## 为什么钉这条
 *
 * 以前成员表**没有载入状态** ⇒ 请求期间表格一片空白
 * ⇒ 用户看着像「这个项目没有成员」。
 * ⇒ 这里钉两件事：
 * 1. **请求期间有载入指示**（转圈）；
 * 2. **「加载中」与「确实没有成员」分得开** ⇒ 数据到了但为空 ⇒ 显示空状态、圈没了。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { getProjectMembers } from '@/services/api/pm/project';
import { MembersTab } from './MembersTab';

const mocks = vi.hoisted(() => ({
  getProjectMembers: vi.fn(),
}));

vi.mock('@/services/api/pm/project', () => ({
  getProjectMembers: mocks.getProjectMembers,
}));

// ⚠️ **必须把 `@umijs/max` 掉**：请求层（`@/services/api/...`）从它拿 `request`
//    ⇒ 不掉的话会把 umi 的整个 CLI 拉进浏览器测试环境（直接报
//    `The "original" argument must be of type Function`）。
vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

/** 表格里「转圈」的元素（antd Table 的 loading 遮罩）。 */
function spinner(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.ant-spin-spinning');
}

/** 表格的空状态（antd 的 Empty）。 */
function emptyState(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.ant-empty');
}

describe('项目成员页签', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('请求期间有载入指示(不是一片空白)', async () => {
    // ⚠️ **请求一直不返回** ⇒ 停在「载入中」那一刻
    mocks.getProjectMembers.mockReturnValue(new Promise(() => {}));

    const { container } = await render(<MembersTab projectId={7} />);

    await vi.waitFor(() => {
      expect(mocks.getProjectMembers).toHaveBeenCalledWith(7);
    });

    // 转圈在 ⇒ 用户知道「正在加载」
    await vi.waitFor(() => {
      expect(spinner(container)).not.toBeNull();
    });
    // 圈得真的占着地方（不是 0×0 的摆设）
    const box = spinner(container)!.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it('数据到了之后圈消失,成员渲染出来', async () => {
    mocks.getProjectMembers.mockResolvedValue({
      data: [
        {
          id: 1,
          user_id: 11,
          role_code: 'owner',
          joined_at: '2026-11-01T09:00:00',
          user_info: { id: 11, name: '张三', username: 'zhangsan' },
        },
      ],
    });

    const { container } = await render(<MembersTab projectId={7} />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('张三');
    });
    // 载入指示没了
    expect(spinner(container)).toBeNull();
  });

  it('「确实没有成员」与「加载中」分得开(空状态,不是圈)', async () => {
    mocks.getProjectMembers.mockResolvedValue({ data: [] });

    const { container } = await render(<MembersTab projectId={7} />);

    // 空状态出来了 ⇒ 说明请求已经结束(不是还在转圈)
    await vi.waitFor(() => {
      expect(emptyState(container)).not.toBeNull();
    });
    expect(spinner(container)).toBeNull();
  });

  it('请求失败 ⇒ 圈也要停(不能永远转)', async () => {
    mocks.getProjectMembers.mockRejectedValue(new Error('boom'));

    const { container } = await render(<MembersTab projectId={7} />);

    await vi.waitFor(() => {
      expect(spinner(container)).toBeNull();
    });
  });
});
