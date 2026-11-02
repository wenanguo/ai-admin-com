import {
  ModalForm,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import type {
  DictTypeCreateParams,
  DictTypeOut,
} from '@/services/api/system/dict';

export type TypeModalProps = {
  open: boolean;
  record?: DictTypeOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: DictTypeCreateParams) => Promise<boolean>;
};

/**
 * 字典类型新增/编辑弹窗。
 *
 * 字典类型是字典数据的归属方(dict_data.dict_type_id 指向它),
 * 所以类型编码(dict_type)就是业务侧读字典时用的 key。
 */
const TypeModalForm: React.FC<TypeModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  const isEdit = Boolean(record?.id);

  return (
    <ModalForm<DictTypeCreateParams>
      title={isEdit ? '编辑字典类型' : '新增字典类型'}
      open={open}
      initialValues={{
        dict_name: record?.dict_name ?? undefined,
        dict_type: record?.dict_type ?? undefined,
        dict_sort: record?.dict_sort ?? undefined,
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
        name="dict_name"
        label="字典名称"
        rules={[{ required: true }]}
      />
      <ProFormText
        name="dict_type"
        label="字典类型"
        rules={[{ required: true }]}
      />
      <ProFormDigit name="dict_sort" label="排序" />
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

export default TypeModalForm;
