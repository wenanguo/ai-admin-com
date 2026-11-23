import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import type { RoleOut } from '@/services/api/system/types';
import RolePermissionModal, { RolePermissionForm } from './PermissionModal';

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

/**
 * 等「提交真的发生了」的**超时**（毫秒）。
 *
 * ⚠️ **为什么不用 vitest 的默认 1 秒**：
 * 点「确定」到提交落地要走一整条异步链（React 事件 ⇒ ProForm 的 submitter ⇒
 * `form.submit()` ⇒ antd 的 `validateFields()` ⇒ `onFinish` ⇒ 调接口）。
 * CI 的机器比本地慢**约 8 倍**（同一个文件：本地 ~1s，CI ~7.6s）⇒ 1 秒**不够**
 * ⇒ 偶发地「提交还没发生，等待就超时了」⇒ 用例随机翻车（2026-11-16 卡了 3 个 PR）。
 *
 * ⚠️ 这**不是 sleep**：断言本身没变（还是「提交必须发生」），只是给这条
 * 异步链留够时间（CI 上实测这条链要 1s 以上）。
 */
const SUBMIT_TIMEOUT_MS = 10_000;

/**
 * 等「提交按钮已经落在弹窗底部的操作区里」。
 *
 * ⚠️ **为什么必须等**（issue #154 的真因）：
 * ProComponents 的 `ModalForm` 挂载时会把提交按钮**先 inline 渲染在表单旁边**，
 * 等 footer 的 ref 挂上后再 `forceUpdate`、用 portal **搬进 footer**
 * ⇒ 中间 **DOM 节点会被换掉一次**
 * （见 `@ant-design/pro-components` → `form/layouts/_shared/useOverlayForm`
 * 的 `contentRender`：没有 `footerRef.current` 时直接渲染 `submitterDom`，
 * 有了就 `createPortal(submitterDom, footerRef.current)`）。
 *
 * 点得太早 ⇒ 点中那个「马上要被替换」的节点 ⇒ 点击丢失 ⇒ 提交没发生
 * ⇒ 用例在 CI 上**随机**翻车（本地几乎不复现，CI 上约 1/5）。
 *
 * ⚠️ 等的是**状态**（按钮的最终位置），不是时间 ⇒ **不是 sleep，也不是放宽超时**。
 */
async function waitForSubmitButtonInFooter() {
  await expect
    .poll(() =>
      [...document.querySelectorAll('.ant-modal-footer button')].some((button) =>
        /确\s*认/.test(button.textContent ?? ''),
      ),
    )
    .toBe(true);
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

    await vi.waitFor(
      () => {
        expect(mocks.setRolePermission).toHaveBeenCalled();
      },
      { timeout: SUBMIT_TIMEOUT_MS },
    );

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
    // ⚠️ **把两个异步依赖吊住**(永不 resolve)——
    //    「中间没有异步窗口」从此不是「碰巧没赶上」,而是**物理上不可能有**:
    //    菜单树 / 部门树的数据永远不来 ⇒ 提交的菜单只能来自 record 的**同步预填**。
    //    (有异步预填的实现 ⇒ 这里提交的是空菜单 ⇒ 用例红)
    mocks.getCurrentUser.mockReturnValue(new Promise(() => {}));
    mocks.getDeptTree.mockReturnValue(new Promise(() => {}));

    const { getByRole } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    // ⚠️ **等提交按钮已经在弹窗 footer 里**（真因见 `waitForSubmitButtonInFooter` 的注释）：
    //    ProComponents 的 `ModalForm` 挂载时会先把按钮 inline 渲染在表单旁边,
    //    随后 portal 搬进 footer ⇒ **DOM 节点会被换掉一次**。
    //    点得太早 ⇒ 点中那个「马上要被替换」的节点 ⇒ 点击丢失 ⇒ 提交没发生
    //    ⇒ 这条用例在 CI 上随机翻车(issue #154)。
    await waitForSubmitButtonInFooter();

    await getByRole('button', { name: /确\s*认/ }).click();

    await vi.waitFor(
      () => {
        expect(mocks.setRolePermission).toHaveBeenCalled();
      },
      { timeout: SUBMIT_TIMEOUT_MS },
    );

    const payload = payloadOf(mocks.setRolePermission);
    expect([...payload.menu_ids].sort((a, b) => a - b)).toEqual([2, 3]);
    expect(payload.role_ids).toEqual([7]);
  });

  it('确定按钮最终落在弹窗底部的操作区里(挂载时会被搬一次)', async () => {
    await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    // 提交按钮最终在 footer 里（挂载时它会被 portal 搬一次 ⇒ 节点会换）
    await waitForSubmitButtonInFooter();

    // 搬干净了：整个弹窗里**只有一个**「确认」按钮，且它在 footer 里
    const confirms = [...document.querySelectorAll('button')].filter((button) =>
      /确\s*认/.test(button.textContent ?? ''),
    );
    expect(confirms).toHaveLength(1);
    expect(confirms[0].closest('.ant-modal-footer')).toBeTruthy();
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

    await vi.waitFor(
      () => {
        expect(mocks.setRolePermission).toHaveBeenCalled();
      },
      { timeout: SUBMIT_TIMEOUT_MS },
    );

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

    await vi.waitFor(
      () => {
        expect(mocks.setRolePermission).toHaveBeenCalled();
      },
      { timeout: SUBMIT_TIMEOUT_MS },
    );

    const payload = payloadOf(mocks.setRolePermission);
    expect(payload.menu_ids).toEqual([40]);
    expect(payload.role_ids).toEqual([7]);
  });

  it('记录里没有菜单信息时不许提交(分不清「本来就没有」与「没拿到」)', async () => {
    const { getByRole, getByText } = await render(
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

    // ⚠️ **禁用必须带一个可见的原因**(issue #109 的验收标准):
    //    「按钮可点、点了没反应、也不报错」是最糟的体验 ⇒ 禁用就要说清为什么。
    await expect
      .element(getByText(/这条记录里没有角色现有的菜单\/部门信息/))
      .toBeVisible();

    // 一次请求都不该发出去
    expect(mocks.setRolePermission).not.toHaveBeenCalled();
  });

  it('换角色后确定按钮依然可点,点确定真的提交(不存在「点了没反应」)', async () => {
    const { getByRole, rerender } = await render(
      <RolePermissionModal open record={record} onOpenChange={() => {}} />,
    );

    await expect
      .element(getByRole('treeitem', { name: '角色管理' }))
      .toHaveAttribute('aria-checked', 'true');

    // 换成另一个角色(弹窗还开着)
    await rerender(
      <RolePermissionModal open record={otherRecord} onOpenChange={() => {}} />,
    );

    // ⚠️ **按钮必须可点** —— 这条与「允许提交」是同一个事实源(canSubmit):
    //    可点 ⇒ 点了就一定会走到 setRolePermission,不会静默拒绝。
    const confirm = getByRole('button', { name: /确\s*认/ });
    await expect.element(confirm).toBeEnabled();

    await confirm.click();

    await vi.waitFor(
      () => {
        expect(mocks.setRolePermission).toHaveBeenCalled();
      },
      { timeout: SUBMIT_TIMEOUT_MS },
    );

    // 提交的是**新**角色的 id 与它的菜单
    const payload = payloadOf(mocks.setRolePermission);
    expect(payload.role_ids).toEqual([8]);
    expect([...payload.menu_ids].sort((a, b) => a - b)).toEqual([4, 40]);
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

    await vi.waitFor(
      () => {
        expect(mocks.setRolePermission).toHaveBeenCalled();
      },
      { timeout: SUBMIT_TIMEOUT_MS },
    );

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

/**
 * 表单实例与记录「漂移」(记录变了但表单没重建)时的行为。
 *
 * ⚠️ 这个情形在 `RolePermissionModal` 里被 `key` 挡住了
 *    (记录一变 ⇒ 整个表单重建)⇒ 只能**绕过父组件**直接渲染表单组件才造得出来。
 *
 * 钉住的是**修法本身**(issue #109):
 * 早先的实现里,这种漂移会让 `onFinish` 拿一个**会过期的 ref**
 * (`useRef(roleId)` 的初值)跟当前角色比 ⇒ 不一致就 `return false`
 * ⇒ **不提交、不报错、弹窗不关** ⇒ 用户看到「点了确定没反应」。
 *
 * ⇒ 现在这种情形必须是**可见的**:按钮禁用 + 给出原因。
 */
describe('角色授权表单的漂移保护', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setRolePermission.mockResolvedValue(envelope(null));
    mocks.getCurrentUser.mockResolvedValue(envelope({ menus: menuTree }));
    mocks.getDeptTree.mockResolvedValue(
      envelope([{ id: 1, name: '总公司', code: 'hq', children: [] }]),
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('记录变了但表单没重建 ⇒ 按钮禁用并说明原因(而不是静默拒绝提交)', async () => {
    const permission = {
      dataScope: 5,
      menuIds: [2, 3],
      deptIds: [1],
    };

    const { getByRole, getByText, rerender } = await render(
      <RolePermissionForm
        open
        roleId={7}
        permission={permission}
        formKey="7:5:2,3:1"
        onOpenChange={() => {}}
      />,
    );

    // 身份与记录一致 ⇒ 可点
    await expect
      .element(getByRole('button', { name: /确\s*认/ }))
      .toBeEnabled();

    // 记录变了(同一个角色,菜单变了),但**表单实例没有重建**
    await rerender(
      <RolePermissionForm
        open
        roleId={7}
        permission={permission}
        formKey="7:5:40:1"
        onOpenChange={() => {}}
      />,
    );

    // ⇒ 可见:按钮禁用 + 说清为什么
    await expect
      .element(getByRole('button', { name: /确\s*认/ }))
      .toBeDisabled();
    await expect
      .element(getByText(/这条记录已经更新过了/))
      .toBeVisible();

    // 一个请求都不该发出去
    expect(mocks.setRolePermission).not.toHaveBeenCalled();
  });
});
