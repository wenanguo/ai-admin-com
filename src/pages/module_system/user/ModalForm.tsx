import {
  ModalForm,
  ProForm,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import DeptTreeSelect from '@/components/DeptTreeSelect';
import { listRoles } from '@/services/api/system/role';
import type { UserCreateParams, UserOut } from '@/services/api/system/types';

export type UserModalProps = {
  open: boolean;
  record?: UserOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UserCreateParams) => Promise<boolean>;
};

const UserModalForm: React.FC<UserModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<UserCreateParams>
      title={record?.id ? '编辑用户' : '新增用户'}
      open={open}
      initialValues={record as UserCreateParams}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(values);
      }}
    >
      <ProFormText
        name="username"
        label="用户名"
        rules={[{ required: true }]}
      />
      {!record?.id && (
        <ProFormText.Password
          name="password"
          label="密码"
          rules={[{ required: true, min: 6 }]}
        />
      )}
      <ProFormText name="name" label="姓名" />
      <ProFormText name="mobile" label="手机号" />
      <ProFormText name="email" label="邮箱" />
      {/*
        部门:用部门树选择器,不用「部门 ID」数字框了 ——
        提交的字段名仍是 dept_id(number),后端契约没变。
      */}
      <ProForm.Item name="dept_id" label="部门">
        <DeptTreeSelect placeholder="请选择部门" />
      </ProForm.Item>
      {/*
        角色:新建用户时不选角色的话,这个账号登录后是空的(没有菜单也没有权限码)。
        后端 UserCreateSchema.role_ids 默认是 [],所以这里必须能选。
      */}
      <ProFormSelect
        name="role_ids"
        label="角色"
        mode="multiple"
        request={async () => {
          const res = await listRoles({ page_no: 1, page_size: 100 });
          return (res?.data?.items ?? [])
            .filter((role) => role.id != null)
            .map((role) => ({
              label: role.name ?? role.code ?? String(role.id),
              value: role.id as number,
            }));
        }}
      />
      <ProFormSelect
        name="status"
        label="状态"
        options={[
          { label: '正常', value: 0 },
          { label: '禁用', value: 1 },
        ]}
      />
      <ProFormTextArea
        name="description"
        label="备注"
        fieldProps={{ rows: 3 }}
      />
    </ModalForm>
  );
};

export default UserModalForm;
