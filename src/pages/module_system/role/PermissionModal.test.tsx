import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import type { RoleOut } from '@/services/api/system/types';
import RolePermissionModal from './PermissionModal';

/**
 * 角色授权弹窗的预填。
 *
 * 钉住五件事:
 *
 * 1. **打开授权弹窗时,角色的现有权限已经填好了**。
 *    预填的数据源是**打开弹窗的那一行记录** —— 后端 `RoleOutSchema` 里带着
 *    `menus` / `depts`,角色**列表**接口就会返回它们(后端 `RoleModel.menus` /
 *    `depts` 是 `lazy="selectin"` 关系,查列表时一并加载)。
 *    不预填的话,打开弹窗直接点确定 = 提交 `menu_ids: []`,
 *    把角色的菜单权限清空(除非后端自己合并,前端不能指望)。
 * 2. **不再请求角色详情** ⇒ 授权不依赖 `module_system:role:detail` 权限
 *    (只有 `module_system:role:query` 的人也能用授权)。
 * 3. 记录里**没有**菜单/部门信息时**不许提交**:分不清「这个角色本来就没有权限」
 *    与「拿到的数据里没有权限信息」。
 * 4. 换角色时表单跟着换 —— 不会拿上一个角色的菜单去覆盖另一个角色。
 * 5. **提交路径上不存在「表单是空的」那一帧**:预填是同步的,
 *    打开后立刻点确定提交的也是角色现有的菜单;关掉再打开也一样。
 *
 * 组件是真的:菜单树用真的 MenuPermissionTree,只把 service 换成假数据。
 */

const mocks = vi.hoisted(() => ({
  getRoleDetail: vi.fn(),
  setRolePermission: vi.fn(),
  getCurrentUser: vi.fn(),
  getDeptTree: vi.fn(),
}));

vi.mock('@/services/api/system/role', () => ({
  // getRoleDetail 仍然导出(它还在 service 层),但弹窗**不再调用**它 ——
  // 用例 2 断言它一次都没被调用。
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

/**
 * 被授权的角色 —— **列表里那一行**。
 *
 * 后端角色列表接口就会把角色现有的菜单/部门一起返回,
 * 所以预填直接用它,不再请求角色详情。
 */
const record: RoleOut = {
  id: 7,
  name: '运营',
  code: 'ops',
  data_scope: 5,
  menus: [
    { id: 2, name: '系统管理', type: 1, title: '系统管理' },
    { id: 3, name: '角色管理', type: 2, title: '角色管理' },
  ],
  depts: [{ id: 1, name: '总公司', code: 'hq' }],
};

/** 另一个角色:菜单完全不同(用户管理 + 它的按钮),数据权限也不是「自定义」 */
const otherRecord: RoleOut = {
  id: 8,
  name: '客服',
  code: 'kf',
  data_scope: 1,
  menus: [
    { id: 4, name: '用户管理', type: 2, title: '用户管理' },
    { id: 40, name: '新增用户', type: 3, title: '新增用户' },
  ],
  depts: [],
};

/** 旧 payload:记录里没有菜单/部门信息(分不清「本来就没有」与「没拿到」) */
const recordWithoutMenus: RoleOut = {
  id: 9,
  name: '访客',
  code: 'guest',
  data_scope: 1,
};

/** 从 setRolePermission 的调用里取出入参 */
function payloadOf(mock: { mock: { calls: unknown[][] } }) {
  const call = mock.mock.calls[0];
  return call?.[0] as {
    data_scope: number;
    role_ids: number[];
    menu_ids: number[];
    dept_ids: number[];
  };
}

describe('角色授权弹窗的预填', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 角色详情接口:故意返回**与记录不同**的菜单 ——
    // 任何还在拿详情预填的实现都会在这里露馅(而不是悄悄通过用例)。
    mocks.getRoleDetail.mockImplementation((id: number) =>
      Promise.resolve(
        envelope({
          id,
          menus: id === 8 ? [{ id: 2 }, { id: 3 }] : [{ id: 4 }, { id: 40 }],
        }),
      ),
    );
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

  it('预填不再请求角色详情(不依赖 module_system:role:detail 权限)', async () => {
    await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    // 预填的数据源就是那一行记录 ⇒ 没有第二次请求
    await vi.waitFor(() => {
      expect(mocks.getCurrentUser).toHaveBeenCalled();
    });
    expect(mocks.getRoleDetail).not.toHaveBeenCalled();
  });

  it('什么都不动直接提交,提交的就是角色现有的权限', async () => {
    const { getByRole } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

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

  it('打开后**立刻**提交,提交的也是角色现有的菜单(中间没有异步窗口)', async () => {
    const { getByRole } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    // 不等菜单树、不等任何请求 —— 预填是**同步**的:
    // 表单从第一帧就持有角色的菜单,确定按钮从第一帧就是可用的。
    // (有异步预填的实现会在这里要么点不动、要么提交空菜单)
    await getByRole('button', { name: /确\s*认/ }).click();

    await vi.waitFor(() => {
      expect(mocks.setRolePermission).toHaveBeenCalled();
    });

    const payload = payloadOf(mocks.setRolePermission);
    expect([...payload.menu_ids].sort((a, b) => a - b)).toEqual([2, 3]);
    expect(payload.role_ids).toEqual([7]);
  });

  it('关掉再打开,表单里还是角色的菜单(不会把菜单权限清空)', async () => {
    const { getByRole, rerender } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'true');

    // 关掉
    await rerender(
      <RolePermissionModal
        open={false}
        record={record}
        onOpenChange={() => {}}
      />,
    );
    // 再打开(同一个角色)
    await rerender(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    // 确定按钮可用,菜单也还在
    await expect
      .element(getByRole('button', { name: /确\s*认/ }))
      .toBeEnabled();
    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'true');

    await getByRole('button', { name: /确\s*认/ }).click();

    await vi.waitFor(() => {
      expect(mocks.setRolePermission).toHaveBeenCalled();
    });

    // 提交的是角色**现有**的菜单,不是空集
    const payload = payloadOf(mocks.setRolePermission);
    expect([...payload.menu_ids].sort((a, b) => a - b)).toEqual([2, 3]);
    expect(payload.role_ids).toEqual([7]);
  });

  it('同一个角色、但记录里的菜单变了 ⇒ 表单跟着重建(不提交旧菜单)', async () => {
    const { getByRole, rerender } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'true');

    // 同一个角色 id,但列表刷新后菜单变了(角色被别的管理员改过)
    // 用叶子节点「新增用户」(id=40)—— 有孩子的节点只被授权时是**半选**态
    await rerender(
      <RolePermissionModal
        open
        record={{
          ...record,
          menus: [{ id: 40, name: '新增用户', type: 3, title: '新增用户' }],
        }}
        onOpenChange={() => {}}
      />,
    );

    await expect
      .element(getByRole('treeitem', { name: '新增用户' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'false');

    await getByRole('button', { name: /确\s*认/ }).click();

    await vi.waitFor(() => {
      expect(mocks.setRolePermission).toHaveBeenCalled();
    });

    const payload = payloadOf(mocks.setRolePermission);
    expect(payload.menu_ids).toEqual([40]);
    expect(payload.role_ids).toEqual([7]);
  });

  it('记录里没有菜单信息时不许提交(分不清「本来就没有」与「没拿到」)', async () => {
    const { getByRole } = await render(
      <RolePermissionModal
        open
        record={recordWithoutMenus}
        onOpenChange={() => {}}
      />,
    );

    // 确定按钮禁用 ⇒ 提交路径不可达
    await expect
      .element(getByRole('button', { name: /确\s*认/ }))
      .toBeDisabled();

    // 菜单树也是禁用的(不让用户在「不知道现状」的状态下乱勾)
    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-disabled', 'true');

    // 一次请求都不该发出去
    expect(mocks.setRolePermission).not.toHaveBeenCalled();
  });

  it('换一个角色,表单里是**新**角色的菜单,不会提交上一个角色的', async () => {
    const { getByRole, rerender } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'true');

    // 弹窗还开着,换成另一个角色
    await rerender(
      <RolePermissionModal open record={otherRecord} onOpenChange={() => {}} />,
    );

    // 新角色的菜单是勾选态,旧角色的不是
    await expect
      .element(getByRole('treeitem', { name: /用户管理/ }))
      .toHaveAttribute('aria-checked', 'true');
    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'false');

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

    expect(payload.role_ids).toEqual([8]);
    expect([...payload.menu_ids].sort((a, b) => a - b)).toEqual([4, 40]);
    expect(payload.data_scope).toBe(1);
    expect(payload.dept_ids).toEqual([]);
  });
});
