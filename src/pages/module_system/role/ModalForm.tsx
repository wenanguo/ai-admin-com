import {
  ModalForm,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import type { RoleCreateParams, RoleOut } from '@/services/api/system/types';

export type RoleModalProps = {
  open: boolean;
  record?: RoleOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: RoleCreateParams) => Promise<boolean>;
};

/**
 * 数据权限的 5 档(后端 data_scope:
 * 1 仅本人 / 2 本部门 / 3 本部门及以下 / 4 全部 / 5 自定义)。
 *
 * 表格列的 valueEnum 与授权弹窗的下拉共用这一份 —— 文案只写一次。
 */
export const DATA_SCOPE_OPTIONS = [
  { label: '仅本人', value: 1 },
  { label: '本部门', value: 2 },
  { label: '本部门及以下', value: 3 },
  { label: '全部', value: 4 },
  { label: '自定义', value: 5 },
];

const RoleModalForm: React.FC<RoleModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<RoleCreateParams>
      title={record?.id ? '编辑角色' : '新增角色'}
      open={open}
      initialValues={{
        name: record?.name ?? undefined,
        code: record?.code ?? undefined,
        order: record?.order ?? undefined,
        data_scope: record?.data_scope ?? 1,
        status: record?.status ?? 0,
        description: record?.description ?? undefined,
      }}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(values);
      }}
    >
      <ProFormText name="name" label="角色名称" rules={[{ required: true }]} />
      <ProFormText
        name="code"
        label="角色编码"
        rules={[
          { required: true },
          {
            // 与后端 validate_required_code 的约束保持一致:
            // 字母开头,2-64 位,仅字母/数字/下划线
            pattern: /^[A-Za-z][A-Za-z0-9_]{1,63}$/,
            message: '角色编码需以字母开头,只能包含字母、数字和下划线',
          },
        ]}
      />
      <ProFormDigit name="order" label="排序" />
      <ProFormSelect
        name="data_scope"
        label="数据权限"
        options={DATA_SCOPE_OPTIONS}
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
        label="描述"
        fieldProps={{ rows: 3 }}
      />
    </ModalForm>
  );
};

export default RoleModalForm;
