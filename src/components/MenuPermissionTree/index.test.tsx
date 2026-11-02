import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import MenuPermissionTree from './index';

/**
 * 菜单权限树的单测。
 *
 * 钉住四件事:
 * - 数据源是 `getCurrentUser()` 返回的 **menus 树**(带 children),
 *   不是 /platform/menu/tree 的扁平列表 —— 父子两级都要渲染出来
 * - 空菜单树不抛异常(RF5:后端可能一个菜单都没下发)
 * - 受控值:传入 value=[3] 时对应节点是勾选态
 * - 勾选子节点时,半选的父节点也要一起回传(后端要的是「勾选 + 半选」的并集)
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/services/api/system/user', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

/** 造一个成功信封 */
function envelope(data: unknown) {
  return {
    code: 0,
    msg: '获取当前用户信息成功',
    data,
    status_code: 200,
    success: true,
  };
}

/**
 * 系统管理(目录) → 角色管理(菜单,叶子) / 用户管理(菜单) → 新增用户(按钮)。
 *
 * 「角色管理」故意做成叶子:antd 的树是联动的(父节点要全选才算勾选),
 * 父节点只回传自己时显示的是**半选**态。
 */
const menuTree = [
  {
    id: 2,
    parent_id: null,
    name: '系统管理',
    type: 1,
    order: 1,
    route_path: '/system',
    title: '系统管理',
    permission: null,
    status: 0,
    hidden: false,
    children: [
      {
        id: 3,
        parent_id: 2,
        name: '角色管理',
        type: 2,
        order: 1,
        route_path: 'role',
        title: '角色管理',
        permission: 'module_system:role:query',
        status: 0,
        hidden: false,
        children: null,
      },
      {
        id: 4,
        parent_id: 2,
        name: '用户管理',
        type: 2,
        order: 2,
        route_path: 'user',
        title: '用户管理',
        permission: 'module_system:user:query',
        status: 0,
        hidden: false,
        children: [
          {
            id: 40,
            parent_id: 4,
            name: '新增用户',
            type: 3,
            order: 1,
            route_path: '',
            title: '新增用户',
            permission: 'module_system:user:create',
            status: 0,
            hidden: false,
            children: null,
          },
        ],
      },
    ],
  },
];

/** 等当前用户信息返回(组件在挂载时拉一次) */
async function waitForMenusLoaded() {
  await vi.waitFor(() => {
    expect(mocks.getCurrentUser).toHaveBeenCalled();
  });
}

describe('MenuPermissionTree 菜单权限树', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(envelope({ menus: menuTree }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it('渲染出菜单树的父子两级标题', async () => {
    const { getByText } = await render(<MenuPermissionTree />);
    await waitForMenusLoaded();

    await expect.element(getByText('系统管理')).toBeVisible();
    await expect.element(getByText('角色管理')).toBeVisible();
    await expect.element(getByText('新增用户')).toBeVisible();
  });

  it('菜单树为空时不抛异常,树照样渲染出来(RF5)', async () => {
    mocks.getCurrentUser.mockResolvedValue(envelope({ menus: [] }));

    const { getByRole, getByText } = await render(<MenuPermissionTree />);
    await waitForMenusLoaded();

    await expect.element(getByRole('tree')).toBeInTheDocument();
    expect(getByText('系统管理').elements()).toHaveLength(0);
  });

  it('受控值:传入的菜单 id 是勾选态', async () => {
    const { getByRole } = await render(<MenuPermissionTree value={[3]} />);
    await waitForMenusLoaded();

    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect
      .element(getByRole('treeitem', { name: '新增用户' }))
      .toHaveAttribute('aria-checked', 'false');
  });

  it('勾选子节点时把半选的父节点一起回传(去重后)', async () => {
    const onChange = vi.fn();

    const { getByRole } = await render(
      <MenuPermissionTree onChange={onChange} />,
    );
    await waitForMenusLoaded();

    await getByRole('checkbox', { name: '新增用户' }).click();

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const selected = onChange.mock.calls[0]?.[0] as number[];
    // 子节点勾上了
    expect(selected).toContain(40);
    // 半选的父节点也要带上(后端要的是并集)
    expect(selected).toContain(4);
    // 去重
    expect(new Set(selected).size).toBe(selected.length);
  });
});
