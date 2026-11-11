import {
  ModalForm,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import type {
  PositionCreateParams,
  PositionOut,
} from '@/services/api/system/position';

export type PositionModalProps = {
  open: boolean;
  record?: PositionOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PositionCreateParams) => Promise<boolean>;
};

const PositionModalForm: React.FC<PositionModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<PositionCreateParams>
      title={record?.id ? '编辑岗位' : '新增岗位'}
      open={open}
      initialValues={record as PositionCreateParams}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(values);
      }}
    >
      <ProFormText name="name" label="岗位名称" rules={[{ required: true }]} />
      <ProFormText name="code" label="岗位编码" rules={[{ required: true }]} />
      <ProFormDigit name="order" label="排序" />
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

export default PositionModalForm;
