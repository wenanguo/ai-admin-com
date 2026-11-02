import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import type { RoleOut } from '@/services/api/system/types';
import RolePermissionModal from './PermissionModal';

/**
 * 角色授权弹窗的预填。
 *
 * 钉住一件事:**打开授权弹窗时,角色的现有权限已经填好了**。
 *
 * 后端 RoleOutSchema 里带着 menus / depts,所以预填走角色详情接口。
 * 不预填的话,打开弹窗直接点确定 = 提交 `menu_ids: []`,
 * 把角色的菜单权限清空(除非后端自己合并,前端不能指望)。
 *
 * 组件是真的:菜单树用真的 MenuPermissionTree,只把三个 service 换成假数据。
 */

const mocks = vi.hoisted(() => ({
  getRoleDetail: vi.fn(),
  setRolePermission: vi.fn(),
  getCurrentUser: vi.fn(),
  getDeptTree: vi.fn(),
}));

vi.mock('@/services/api/system/role', () => ({
  getRoleDetail: mocks.getRoleDetail,
  setRolePermission: mocks.setRolePermission,
}));

vi.mock('@/services/api/system/user', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/services/api/system/dept', () => ({
  getDeptTree: mocks.getDeptTree,
}));

/** 造一个成功信封 */
function envelope(data: unknown) {
  return {
    code: 0,
    msg: 'ok',
    data,
    status_code: 200,
    success: true,
  };
}

/**
 * 菜单树:系统管理(目录) → 角色管理(叶子) / 用户管理 → 新增用户。
 *
 * 角色已有的是「系统管理 + 角色管理」——
 * 父节点在、孩子**没选全**(用户管理没授权),所以「系统管理」是**半选**态。
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

/** 角色详情:已有「系统管理 + 角色管理」两个菜单、一个部门 */
const roleDetail = {
  id: 7,
  name: '运营',
  code: 'ops',
  order: 1,
  data_scope: 5,
  status: 0,
  description: '运营角色',
  menus: [
    { id: 2, name: '系统管理', type: 1, title: '系统管理' },
    { id: 3, name: '角色管理', type: 2, title: '角色管理' },
  ],
  depts: [{ id: 1, name: '总公司', code: 'hq' }],
};

/** 被授权的角色(列表行里只有基本字段) */
const record: RoleOut = {
  id: 7,
  name: '运营',
  code: 'ops',
  data_scope: 5,
};

describe('角色授权弹窗的预填', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRoleDetail.mockResolvedValue(envelope(roleDetail));
    mocks.setRolePermission.mockResolvedValue(envelope(null));
    mocks.getCurrentUser.mockResolvedValue(envelope({ menus: menuTree }));
    mocks.getDeptTree.mockResolvedValue(
      envelope([{ id: 1, name: '总公司', code: 'hq', children: [] }]),
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('打开时预填角色的现有菜单:全选的勾上,没选全的父节点是半选', async () => {
    const { getByRole } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(mocks.getRoleDetail).toHaveBeenCalledWith(7);
    });

    // 「角色管理」是叶子且被授权 ⇒ 全选
    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'true');
    // 「系统管理」的孩子没选全 ⇒ 半选(不是全选)
    // (父节点的可访问名里带折叠图标 ⇒ 用正则匹配)
    await expect
      .element(getByRole('treeitem', { name: /系统管理/ }))
      .toHaveAttribute('aria-checked', 'mixed');
    // 没授权的菜单当然不是勾选态
    await expect
      .element(getByRole('treeitem', { name: /用户管理/ }))
      .toHaveAttribute('aria-checked', 'false');
  });

  it('什么都不动直接提交,提交的就是角色现有的权限', async () => {
    const { getByRole } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(mocks.getRoleDetail).toHaveBeenCalled();
    });
    // 等预填落到表单上
    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'true');

    // 提交(antd 会在两个汉字之间插空格 ⇒ 「确 认」)
    await getByRole('button', { name: /确\s*认/ }).click();

    await vi.waitFor(() => {
      expect(mocks.setRolePermission).toHaveBeenCalled();
    });

    const payload = mocks.setRolePermission.mock.calls[0][0] as {
      data_scope: number;
      role_ids: number[];
      menu_ids: number[];
      dept_ids: number[];
    };

    // 菜单权限与角色**现有**的一致(没有被清空,也没有多出没授权的菜单)
    expect([...payload.menu_ids].sort((a, b) => a - b)).toEqual([2, 3]);
    // 数据范围与部门也照原样提交
    expect(payload.data_scope).toBe(5);
    expect(payload.dept_ids).toEqual([1]);
    expect(payload.role_ids).toEqual([7]);
  });
});
