import {
  ModalForm,
  ProForm,
  ProFormDependency,
  ProFormSelect,
} from '@ant-design/pro-components';
import type React from 'react';
import DeptTreeSelect from '@/components/DeptTreeSelect';
import MenuPermissionTree from '@/components/MenuPermissionTree';
import { setRolePermission } from '@/services/api/system/role';
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
 * 角色授权弹窗 —— PUT /system/role/permission。
 *
 * 入参是 data_scope / role_ids / menu_ids / dept_ids 四个**平级**字段。
 * `data_scope === 5`(自定义)时才要选部门,其它档位不渲染部门选择器。
 */
const RolePermissionModal: React.FC<RolePermissionModalProps> = ({
  open,
  record,
  onOpenChange,
}) => {
  return (
    <ModalForm<RolePermissionFormValues>
      title="角色授权"
      open={open}
      initialValues={{
        data_scope: record?.data_scope ?? 1,
        menu_ids: [],
        dept_ids: [],
      }}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
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
        rules={[{ required: true }]}
      />
      <ProFormDependency name={['data_scope']}>
        {({ data_scope }) =>
          data_scope === 5 ? (
            <ProForm.Item name="dept_ids" label="部门范围">
              <DeptTreeSelect multiple placeholder="请选择部门" />
            </ProForm.Item>
          ) : null
        }
      </ProFormDependency>
      <ProForm.Item name="menu_ids" label="菜单权限">
        <MenuPermissionTree />
      </ProForm.Item>
    </ModalForm>
  );
};

export default RolePermissionModal;
