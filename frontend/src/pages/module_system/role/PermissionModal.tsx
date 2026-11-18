import {
  ModalForm,
  ProForm,
  ProFormDependency,
  ProFormSelect,
} from '@ant-design/pro-components';
import { Typography } from 'antd';
import type React from 'react';
import { useState } from 'react';
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
  /**
   * 表单实例的「身份」—— 角色 id + 它现有的权限载荷。
   *
   * 与父组件挂这个组件时用的 `key` **同源**(同一个值),
   * 所以它既是「重建表单」的依据,也是「这个表单是为哪份记录建的」的凭据。
   */
  formKey: string;
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
 * - 表单的初始值与提交闭包**全部来自同一次渲染**;
 * - 不存在「表单还是旧角色的、提交却是新角色」的中间态;
 * - 也不存在「关闭再打开,表单还拿着上一次的状态」——
 *   `destroyOnHidden` 会把表单一起销毁,重开时按**当时**的记录重新初始化。
 *
 * ## 「能不能提交」只有一个事实源
 *
 * 提交按钮的 `disabled` 与 `onFinish` 的守卫**用的是同一个 `canSubmit`**,
 * 所以不可能出现「按钮可点、点了没反应、也不报错」的中间态:
 * 按钮能点 ⇒ `canSubmit` 为真 ⇒ `onFinish` 一定往下走(要么提交成功,
 * 要么接口报错由请求层弹出来)。
 *
 * ⚠️ **这里曾经踩过的坑**(issue #109):早先的守卫是
 * `useRef(roleId)`(初值只在实例创建时取一次)+「提交时拿它跟当前 roleId 比」。
 * 那个 ref 是**第二个事实源**,而且是**会过期**的:一旦记录变了而表单实例
 * 没跟着重建(例如有人把 `key` 从父组件上拿掉),这个 ref 就永远停在旧角色上
 * ⇒ `onFinish` 里 `return false` ⇒ **不提交、不报错、弹窗不关**
 * ⇒ 用户看到的就是「点了确定没反应」。
 * ⇒ 现在这份守卫改成了 `canSubmit`,它只依赖**当前这一次渲染**的事实,
 * 没有任何会过期的副本。
 */
/**
 * 授权表单 —— 单独导出是为了能**直接**测它:
 * 「记录变了但表单实例没重建」(漂移)这种情形在父组件里被 `key` 挡住了,
 * 只有绕过父组件直接渲染这个组件才造得出来。
 */
export const RolePermissionForm: React.FC<RolePermissionFormProps> = ({
  open,
  roleId,
  permission,
  formKey,
  onOpenChange,
}) => {
  /**
   * 这个表单实例是**为哪一份记录**建的 —— 实例出生时定下,之后不再变。
   *
   * 用 `useState` 的初值(而不是 `useRef`):它同样只在实例创建时算一次,
   * 但语义上就是「这个实例的身份」,而 `useRef` 很容易被误当成
   * 「当前的角色 id」—— 那才是 #109 那个坑的来源。
   *
   * 父组件用 `key={formKey}` 挂这个组件 ⇒ 记录一变,实例重建
   * ⇒ `boundFormKey` 总是与当前的 `formKey` 一致。
   */
  const [boundFormKey] = useState(formKey);

  /**
   * 漂移:记录已经变了,但这个表单实例**没有**跟着重建。
   *
   * 结构上不该发生(父组件的 `key` 就是为此存在的);
   * 万一有人以后把 `key` 拿掉,这里会**看见**它 ——
   * 于是按钮禁用 + 给出可见原因,**而不是**在 `onFinish` 里静默拒绝。
   */
  const drifted = boundFormKey !== formKey;

  /**
   * **能不能提交 —— 唯一的事实源。**
   *
   * - `permission === undefined`:拿不到角色现有的菜单/部门
   *   ⇒ 分不清「本来就没有权限」与「没拿到权限信息」
   *   ⇒ 不许提交(提交等于把菜单权限清空);
   * - `roleId === null`:不知道给哪个角色授权 ⇒ 不许提交;
   * - `drifted`:表单与当前记录已经对不上 ⇒ 不许提交(表单里是旧值)。
   *
   * 按钮的 `disabled` 与 `onFinish` 的守卫**都用它** ⇒ 同源。
   */
  const canSubmit = permission !== undefined && roleId !== null && !drifted;

  /** 不能提交时给用户看的原因(可见,不是「点了没反应」) */
  const blockedReason = drifted
    ? '这条记录已经更新过了(表单还是旧的)—— 请关掉弹窗重新打开后再授权。'
    : permission === undefined
      ? '这条记录里没有角色现有的菜单/部门信息,无法授权 —— 请刷新列表后重试。'
      : '这条记录没有角色 id,无法授权 —— 请刷新列表后重试。';

  return (
    <ModalForm<RolePermissionFormValues>
      title="角色授权"
      open={open}
      // 拿不到角色的现有权限就不让提交 —— 那等于把菜单权限清空
      submitter={{
        submitButtonProps: {
          disabled: !canSubmit,
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
        // ⚠️ **与按钮的 disabled 同源**(同一个 canSubmit)
        //    ⇒ 走到这里时按钮一定是可点的 ⇒ 这道守卫只可能挡住
        //    「程序化调用」,不会造成「点了确定没反应」。
        if (!canSubmit) return false;
        // ⚠️ **表单刚重建时，值可能还没灌进表单**（antd 的表单实例是新的）
        //    ⇒ **undefined 才回落**到记录里的值（记录才是事实源）；
        //    **空数组是用户的选择**（把菜单清空）⇒ 不回落。
        const dataScope = values.data_scope ?? permission.dataScope;
        const menuIds = values.menu_ids ?? permission.menuIds;
        const deptIds = values.dept_ids ?? permission.deptIds;
        try {
          await setRolePermission({
            data_scope: dataScope,
            role_ids: roleId != null ? [roleId] : [],
            menu_ids: menuIds,
            // 只有「自定义」才用部门范围,其它档位提交空数组
            dept_ids: dataScope === 5 ? deptIds : [],
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
        disabled={!canSubmit}
        // ⚠️ **故意不加 required 规则**：
        //    值**总是**来自记录（见 onFinish 的兜底）⇒ 这条规则只会造成
        //    「表单刚重建、值还没灌进来时，校验失败 ⇒ 点确定**静默没反应**」。
        //    ⇒ 宁可让 onFinish 兜底，也不要一个点不动的按钮。
      />
      <ProFormDependency name={['data_scope']}>
        {({ data_scope }) =>
          data_scope === 5 ? (
            <ProForm.Item name="dept_ids" label="部门范围">
              <DeptTreeSelect
                multiple
                disabled={!canSubmit}
                placeholder="请选择部门"
              />
            </ProForm.Item>
          ) : null
        }
      </ProFormDependency>
      <ProForm.Item name="menu_ids" label="菜单权限">
        <MenuPermissionTree disabled={!canSubmit} />
      </ProForm.Item>
      {!canSubmit && (
        <Typography.Text type="secondary" style={{ display: 'block' }}>
          {blockedReason}
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
 *
 * ## 「能不能点」与「能不能提交」是同一个事实源
 *
 * 两者都来自表单组件里的 `canSubmit`(见上面的说明)⇒
 * 不存在「按钮可点、点了没反应、也不报错」的中间态。
 * 按钮被禁用时,弹窗里**同时给出可见的原因**。
 */
const RolePermissionModal: React.FC<RolePermissionModalProps> = ({
  open,
  record,
  onOpenChange,
}) => {
  // 现有权限:全部由记录推导(没有异步加载 ⇒ 没有「状态旧 / 表单新」的窗口)
  const permission = permissionOf(record);
  const roleId = record?.id ?? null;
  // 表单实例的身份:角色 id + 现有权限载荷
  // (既是「重建表单」的 key,也是表单内部「我为谁而建」的凭据 —— 同一个值)
  const formKey = formKeyOf(roleId, permission);

  return (
    <RolePermissionForm
      // 换一个角色 / 权限载荷变了 ⇒ 表单重建(initialValues 只在初始化时生效)
      // ⚠️ `key` 与 `formKey` 是**同一个值**:
      //    `key` 负责「记录一变就重建表单」,`formKey` 负责让表单知道
      //    「自己是为哪份记录建的」(万一重建没发生 ⇒ 漂移 ⇒ 按钮禁用 + 可见原因)。
      key={formKey}
      formKey={formKey}
      open={open}
      roleId={roleId}
      permission={permission}
      onOpenChange={onOpenChange}
    />
  );
};

export default RolePermissionModal;
