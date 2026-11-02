import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import MenuPermissionTree from './index';

/**
 * 菜单权限树的单测。
 *
 * 钉住五件事:
 * - 数据源是 `getCurrentUser()` 返回的 **menus 树**(带 children),
 *   不是 /platform/menu/tree 的扁平列表 —— 父子两级都要渲染出来
 * - 空菜单树不抛异常(RF5:后端可能一个菜单都没下发)
 * - 受控值:传入 value=[3] 时对应节点是勾选态
 * - 勾选子节点时,半选的父节点也要一起回传(后端要的是「勾选 + 半选」的并集)
 * - **半选的父节点不能进 Tree 的 checkedKeys**:rc-tree 的 conductCheck
 *   会把「勾中的父节点」的所有后代都算勾中,没勾的兄弟节点会被一起勾上,
 *   下一次交互就把没授权的菜单提交出去了
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
 *
 * 系统监控(目录) → 操作日志 / 登录日志 —— 这个父节点有**两个孩子**,
 * 专门用来钉住 conductCheck 的坑(见下面的回归用例)。
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
  {
    id: 5,
    parent_id: null,
    name: '系统监控',
    type: 1,
    order: 2,
    route_path: '/monitor',
    title: '系统监控',
    permission: null,
    status: 0,
    hidden: false,
    children: [
      {
        id: 6,
        parent_id: 5,
        name: '操作日志',
        type: 2,
        order: 1,
        route_path: 'operation-log',
        title: '操作日志',
        permission: 'module_system:log:query',
        status: 0,
        hidden: false,
        children: null,
      },
      {
        id: 7,
        parent_id: 5,
        name: '登录日志',
        type: 2,
        order: 2,
        route_path: 'login-log',
        title: '登录日志',
        permission: 'module_system:login_log:query',
        status: 0,
        hidden: false,
        children: null,
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

  it('父节点有两个孩子时,勾一个不会把兄弟也勾上', async () => {
    const onChange = vi.fn();

    const { getByRole } = await render(
      <MenuPermissionTree onChange={onChange} />,
    );
    await waitForMenusLoaded();

    // 「系统监控」的两个孩子:操作日志 / 登录日志
    await getByRole('checkbox', { name: '操作日志' }).click();

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    // 兄弟节点没有被勾上
    // (半选的父节点混进 checkedKeys 时,rc-tree 的 conductCheck
    //  会把它**所有**的后代都算勾中 —— 兄弟节点会被一起勾上)
    await expect
      .element(getByRole('treeitem', { name: '登录日志' }))
      .toHaveAttribute('aria-checked', 'false');

    // 再点一个别的节点:提交出去的 id 集合里也不该有那个兄弟
    await getByRole('checkbox', { name: '角色管理' }).click();

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    const submitted = onChange.mock.calls[1]?.[0] as number[];
    expect(submitted).toContain(6);
    expect(submitted).not.toContain(7);
  });
});
