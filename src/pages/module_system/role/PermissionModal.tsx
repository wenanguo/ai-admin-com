import {
  ModalForm,
  ProForm,
  ProFormDependency,
  type ProFormInstance,
  ProFormSelect,
} from '@ant-design/pro-components';
import type React from 'react';
import { useEffect, useState } from 'react';
import DeptTreeSelect from '@/components/DeptTreeSelect';
import MenuPermissionTree from '@/components/MenuPermissionTree';
import type { BackendMenu } from '@/menu/adapter';
import type { DeptOut } from '@/services/api/system/dept';
import { getRoleDetail, setRolePermission } from '@/services/api/system/role';
import type { RoleOut } from '@/services/api/system/types';
import { DATA_SCOPE_OPTIONS } from './ModalForm';

export type RolePermissionModalProps = {
  open: boolean;
  /** 被授权的角色 */
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
 * 角色详情(现有权限的来源)的状态机。
 *
 * 用状态机而不是两个布尔量:「拿到详情」与「详情加载中」不可能同时成立,
 * 分开存会写出「加载中但已就绪」这种自相矛盾的状态。
 */
type RoleDetailState =
  /** 正在拉详情 */
  | { status: 'loading' }
  /** 拉到了:菜单 / 部门 / 数据范围都在里面 */
  | { status: 'loaded'; detail: RoleOut }
  /** 拉失败(提示由请求层统一弹) */
  | { status: 'failed' };

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
 * 角色授权弹窗 —— PUT /system/role/permission。
 *
 * 入参是 data_scope / role_ids / menu_ids / dept_ids 四个**平级**字段。
 * `data_scope === 5`(自定义)时才要选部门,其它档位不渲染部门选择器。
 *
 * ## 打开时预填角色的现有权限
 *
 * 后端 RoleOutSchema 里带着 `menus` 与 `depts`,所以用角色详情接口取当前状态。
 * 不预填的话,打开弹窗直接点确定 = 把角色的菜单权限清空(提交 `menu_ids: []`)。
 *
 * 详情没拿到之前**不让提交**:那会儿表单里的菜单是空的,提交等于清空权限。
 */
const RolePermissionModal: React.FC<RolePermissionModalProps> = ({
  open,
  record,
  onOpenChange,
}) => {
  // 表单实例(挂好了才能往里写值)
  const [formInstance, setFormInstance] = useState<
    ProFormInstance<RolePermissionFormValues> | undefined
  >(undefined);
  const [detailState, setDetailState] = useState<RoleDetailState>({
    status: 'failed',
  });

  // 打开时拉角色详情
  useEffect(() => {
    if (!open) return;

    const id = record?.id;
    if (id == null) return;

    let cancelled = false;
    setDetailState({ status: 'loading' });

    getRoleDetail(id)
      .then((res) => {
        if (cancelled) return;
        const detail = res?.data;
        if (!detail) {
          setDetailState({ status: 'failed' });
          return;
        }
        setDetailState({ status: 'loaded', detail });
      })
      .catch(() => {
        // 失败提示由请求层统一弹
        if (cancelled) return;
        setDetailState({ status: 'failed' });
      });

    return () => {
      cancelled = true;
    };
  }, [open, record?.id]);

  // 详情到位 **且** 表单挂好了 ⇒ 把角色的现有权限写回表单。
  // (谁先到都不怕:两个条件都满足才写)
  useEffect(() => {
    if (detailState.status !== 'loaded' || !formInstance) return;
    const { detail } = detailState;
    formInstance.setFieldsValue({
      data_scope: detail.data_scope ?? record?.data_scope ?? 1,
      menu_ids: menuIdsOf(detail.menus),
      dept_ids: deptIdsOf(detail.depts),
    });
  }, [detailState, formInstance, record?.data_scope]);

  // 详情没到位之前,表单里的控件都是禁用的 ——
  // 否则用户勾的菜单会被随后到达的预填覆盖掉。
  const detailReady = detailState.status === 'loaded';

  return (
    <ModalForm<RolePermissionFormValues>
      // 换一个角色就重新挂载 —— 表单是「一次性」的
      key={record?.id}
      title="角色授权"
      open={open}
      onInit={(_values, instance) => {
        // 表单挂好了(详情可能还没到,也可能已经到了)
        setFormInstance(instance);
      }}
      // 详情没到之前不让提交 —— 那会儿表单里的菜单是空的,提交等于清空权限
      submitter={{
        submitButtonProps: {
          loading: detailState.status === 'loading',
          disabled: detailState.status !== 'loaded',
        },
      }}
      initialValues={{
        data_scope: record?.data_scope ?? 1,
        menu_ids: [],
        dept_ids: [],
      }}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 没拿到角色的现有权限就不提交 —— 免得把菜单权限清空
        if (detailState.status !== 'loaded') return false;
        try {
          await setRolePermission({
            data_scope: values.data_scope,
            role_ids: record?.id ? [record.id] : [],
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
        disabled={!detailReady}
        rules={[{ required: true }]}
      />
      <ProFormDependency name={['data_scope']}>
        {({ data_scope }) =>
          data_scope === 5 ? (
            <ProForm.Item name="dept_ids" label="部门范围">
              <DeptTreeSelect
                multiple
                disabled={!detailReady}
                placeholder="请选择部门"
              />
            </ProForm.Item>
          ) : null
        }
      </ProFormDependency>
      <ProForm.Item name="menu_ids" label="菜单权限">
        <MenuPermissionTree disabled={!detailReady} />
      </ProForm.Item>
    </ModalForm>
  );
};

export default RolePermissionModal;
