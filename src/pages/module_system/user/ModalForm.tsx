import {
  ModalForm,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
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
      <ProFormDigit name="dept_id" label="部门 ID" />
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
