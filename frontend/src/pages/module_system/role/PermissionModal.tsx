import {
  ModalForm,
  ProForm,
  ProFormDependency,
  ProFormSelect,
} from '@ant-design/pro-components';
import { Typography } from 'antd';
import type React from 'react';
import { useRef } from 'react';
import DeptTreeSelect from '@/components/DeptTreeSelect';
import MenuPermissionTree from '@/components/MenuPermissionTree';
import type { BackendMenu } from '@/menu/adapter';
import type { DeptOut } from '@/services/api/system/dept';
import { setRolePermission } from '@/services/api/system/role';
import type { RoleOut } from '@/services/api/system/types';
import { DATA_SCOPE_OPTIONS } from './ModalForm';

export type RolePermissionModalProps = {
  open: boolean;
  /** 被授权的角色(列表里那一行,带着它现有的 menus / depts) */
  record?: RoleOut;
  onOpenChange: (open: boolean) => void;
};

/** 授权表单的字段(与后端 RolePermissionSettingSchema 对应) */
type RolePermissionFormValues = {
  /** 数据权限范围 1..5 */
  data_scope: number;
  /** 勾选的菜单 id(含半选的父节点) */
  menu_ids?: number[];
  /** 自定义数据权限时选中的部门 id */
  dept_ids?: number[];
};

/**
 * 角色「现有权限」 —— 全部从**打开弹窗的那一行记录**推导。
 *
 * 后端 `RoleOutSchema` 里带着 `menus` 与 `depts`,而且**角色列表接口就会返回它们**
 * (后端 `RoleModel.menus` / `depts` 是 `lazy="selectin"` 关系,查列表时一并加载)
 * ⇒ 预填不需要再请求角色详情,也就**不依赖 `module_system:role:detail` 权限**
 * (只有 `module_system:role:query` 的人也能用授权)。
 *
 * 记录里没有 menus / depts ⇒ 分不清「这个角色本来就没有权限」与
 * 「拿到的数据里没有权限信息」⇒ 这种情况**不许提交**。
 */
interface RolePermission {
  /** 数据权限范围 1..5 */
  dataScope: number;
  /** 角色已有的菜单 id(全选 ∪ 半选的并集) */
  menuIds: number[];
  /** 角色已有的部门 id(只有「自定义」才用得上) */
  deptIds: number[];
}

/**
 * 角色已有的菜单 id。
 *
 * 后端 RoleOutSchema.menus 用的是 MenuOutSchema(没有 children 字段),
 * 拿到的是**扁平列表**;这里同时兼容带 children 的树,两种形态都能摊平。
 */
function menuIdsOf(menus?: BackendMenu[] | null): number[] {
  const ids: number[] = [];

  const walk = (list: BackendMenu[] | null | undefined) => {
    for (const menu of list ?? []) {
      if (menu.id != null) ids.push(menu.id);
      walk(menu.children);
    }
  };

  walk(menus);
  return ids;
}

/** 角色已有的部门 id */
function deptIdsOf(depts?: DeptOut[] | null): number[] {
  const ids: number[] = [];
  for (const dept of depts ?? []) {
    if (dept.id != null) ids.push(dept.id);
  }
  return ids;
}

/**
 * 从记录推导角色现有的权限。
 *
 * 「拿不到」有两种,只有一种是不许提交的:
 * - `menus` 是**空数组** ⇒ 这个角色本来就没有菜单(可以提交空菜单集);
 * - `menus` 是 undefined / null ⇒ 拿到的数据里没有权限信息(分不清上面那种)⇒ 不许提交。
 *
 * 返回 undefined = 拿不到 ⇒ 调用方必须拒绝提交。
 */
function permissionOf(record: RoleOut | undefined): RolePermission | undefined {
  // 没有角色 id ⇒ 连「给哪个角色授权」都不知道
  if (!record || record.id == null) return undefined;

  const { menus, depts, data_scope: dataScope } = record;

  // 菜单必须是数组(空数组也行):undefined = 没拿到权限信息
  if (!Array.isArray(menus)) return undefined;
  // 数据权限范围必须拿到:填错了就是悄悄改了角色的数据范围
  if (typeof dataScope !== 'number') return undefined;
  // 「自定义」才用部门;那会儿部门也得拿到,
  // 否则提交 dept_ids: [] = 把角色的自定义部门范围清空
  if (dataScope === 5 && !Array.isArray(depts)) return undefined;

  return {
    dataScope,
    menuIds: menuIdsOf(menus),
    deptIds: deptIdsOf(depts),
  };
}

/**
 * 表单的「身份」—— 角色 id + 它现有的权限载荷。
 *
 * 载荷也要进 key:`initialValues` **只在表单初始化时生效**,
 * 记录变了(列表刷新了、角色被改过)而表单没重建 ⇒ 表单里还是**旧权限**,
 * 提交上去就是把旧菜单覆盖回去。
 */
function formKeyOf(roleId: number | null, permission?: RolePermission): string {
  if (!permission) return `${roleId ?? 'none'}:unknown`;
  return [
    roleId ?? 'none',
    permission.dataScope,
    permission.menuIds.join(','),
    permission.deptIds.join(','),
  ].join(':');
}

/** 授权表单的属性 */
type RolePermissionFormProps = {
  open: boolean;
  /** 被授权的角色 id(拿不到就是 null ⇒ 不许提交) */
  roleId: number | null;
  /** 角色现有的权限(undefined = 拿不到 ⇒ 不许提交) */
  permission?: RolePermission;
  onOpenChange: (open: boolean) => void;
};

/**
 * 授权表单(单独一个组件,靠 key 重建)。
 *
 * ## 为什么单独拆一个组件
 *
 * 这个组件实例**与表单实例同生共死**:父组件用
 * `key = 角色 id + 现有权限载荷` 挂它,记录一变就整个重建。
 * 于是下面这件事由结构保证,而不是靠时序:
 *
 * - 表单的初始值、提交闭包、这个组件的 ref **全部来自同一次渲染**;
 * - 不存在「表单还是旧角色的、提交却是新角色」的中间态;
 * - 也不存在「关闭再打开,表单还拿着上一次的状态」——
 *   `destroyOnHidden` 会把表单一起销毁,重开时按**当时**的记录重新初始化。
 */
const RolePermissionForm: React.FC<RolePermissionFormProps> = ({
  open,
  roleId,
  permission,
  onOpenChange,
}) => {
  // 拿不到角色的现有权限 ⇒ 不许提交(提交等于把菜单权限清空)
  const ready = permission !== undefined;

  /**
   * 这个表单实例是为哪个角色建的。
   *
   * 组件因为 key 变化而重建 ⇒ 这个 ref 里的 roleId 永远与表单里的初始值同源。
   * 提交时再核一遍:对不上就拒掉(结构上不可能,留着当兜底 ——
   * 万一有人以后把 roleId 从 key 里拿掉,这里会先炸而不是悄悄提交错角色)。
   */
  const boundRoleIdRef = useRef(roleId);

  return (
    <ModalForm<RolePermissionFormValues>
      title="角色授权"
      open={open}
      // 拿不到角色的现有权限就不让提交 —— 那等于把菜单权限清空
      submitter={{
        submitButtonProps: {
          disabled: !ready,
        },
      }}
      initialValues={{
        data_scope: permission?.dataScope ?? 1,
        menu_ids: permission?.menuIds ?? [],
        dept_ids: permission?.deptIds ?? [],
      }}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 拿不到角色的现有权限就不提交 —— 免得把菜单权限清空
        if (!permission) return false;
        // 表单与角色对不上 ⇒ 宁可拒掉(拿一个角色的菜单覆盖另一个角色)
        if (boundRoleIdRef.current !== roleId) return false;
        try {
          await setRolePermission({
            data_scope: values.data_scope,
            role_ids: roleId != null ? [roleId] : [],
            menu_ids: values.menu_ids ?? [],
            // 只有「自定义」才用部门范围,其它档位提交空数组
            dept_ids: values.data_scope === 5 ? (values.dept_ids ?? []) : [],
          });
          return true;
        } catch {
          // 失败提示由请求层统一弹;返回 false 让弹窗保持打开
          return false;
        }
      }}
    >
      <ProFormSelect
        name="data_scope"
        label="数据权限"
        options={DATA_SCOPE_OPTIONS}
        disabled={!ready}
        rules={[{ required: true }]}
      />
      <ProFormDependency name={['data_scope']}>
        {({ data_scope }) =>
          data_scope === 5 ? (
            <ProForm.Item name="dept_ids" label="部门范围">
              <DeptTreeSelect
                multiple
                disabled={!ready}
                placeholder="请选择部门"
              />
            </ProForm.Item>
          ) : null
        }
      </ProFormDependency>
      <ProForm.Item name="menu_ids" label="菜单权限">
        <MenuPermissionTree disabled={!ready} />
      </ProForm.Item>
      {!ready && (
        <Typography.Text type="secondary" style={{ display: 'block' }}>
          这条记录里没有角色现有的菜单/部门信息,无法授权 —— 请刷新列表后重试。
        </Typography.Text>
      )}
    </ModalForm>
  );
};

/**
 * 角色授权弹窗 —— PUT /system/role/permission。
 *
 * 入参是 data_scope / role_ids / menu_ids / dept_ids 四个**平级**字段。
 * `data_scope === 5`(自定义)时才要选部门,其它档位不渲染部门选择器。
 *
 * ## 打开时预填角色的现有权限
 *
 * 预填的数据源是**打开弹窗的那一行记录**(`record.menus` / `record.depts`),
 * 角色列表接口就带着它们 ⇒ 没有第二次请求,也就没有额外的权限依赖。
 *
 * ## 为什么「提交前不可能拿到一份空菜单」
 *
 * 预填是**同步**的:表单的初始值直接由记录算出来(`initialValues`),
 * 没有「先渲染空表单、再把详情填进去」的两段式 ⇒ 不存在「状态已就绪、
 * 表单还是空的」那一帧。
 *
 * 另外三处保证表单与角色始终对齐:
 * - `key`(角色 id + 现有权限载荷):记录一变,表单整个重建,
 *   新表单**带着新角色的初始值**挂载(同一次提交里完成,中间没有一帧
 *   「新角色 + 旧表单」);
 * - `destroyOnHidden`:关掉弹窗 = 销毁表单;再打开时按当时的记录重新初始化
 *   (关掉再打开不会把上一次的状态带过来);
 * - 拿不到记录里的菜单/部门时,确定按钮**禁用**、`onFinish` 也**拒绝提交**
 *   —— 分不清「这个角色本来就没有权限」与「拿到的数据里没有权限信息」时,
 *   宁可不做,也不能把角色的菜单清空。
 */
const RolePermissionModal: React.FC<RolePermissionModalProps> = ({
  open,
  record,
  onOpenChange,
}) => {
  // 现有权限:全部由记录推导(没有异步加载 ⇒ 没有「状态旧 / 表单新」的窗口)
  const permission = permissionOf(record);
  const roleId = record?.id ?? null;

  return (
    <RolePermissionForm
      // 换一个角色 / 权限载荷变了 ⇒ 表单重建(initialValues 只在初始化时生效)
      key={formKeyOf(roleId, permission)}
      open={open}
      roleId={roleId}
      permission={permission}
      onOpenChange={onOpenChange}
    />
  );
};

export default RolePermissionModal;
