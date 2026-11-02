import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import type { ParamCreateParams, ParamOut } from '@/services/api/system/param';

export type ParamModalProps = {
  open: boolean;
  record?: ParamOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ParamCreateParams) => Promise<boolean>;
};

/**
 * 参数新增/编辑弹窗。
 *
 * config_key 是唯一键 —— 后端不允许改,编辑模式下置为 disabled
 * (字段值仍在表单里,提交时原样带回,满足后端 update 的必填约束)。
 */
const ParamModalForm: React.FC<ParamModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  const isEdit = Boolean(record?.id);

  return (
    <ModalForm<ParamCreateParams>
      title={isEdit ? '编辑参数' : '新增参数'}
      open={open}
      initialValues={{
        config_name: record?.config_name ?? undefined,
        config_key: record?.config_key ?? undefined,
        config_value: record?.config_value ?? undefined,
        config_type: record?.config_type ?? false,
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
      <ProFormText
        name="config_name"
        label="参数名称"
        rules={[{ required: true }]}
      />
      <ProFormText
        name="config_key"
        label="参数键"
        rules={[{ required: true }]}
        disabled={isEdit}
      />
      <ProFormText name="config_value" label="参数值" />
      <ProFormSwitch name="config_type" label="系统内置" />
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

export default ParamModalForm;
