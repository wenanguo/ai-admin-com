import {
  ModalForm,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import type {
  DictDataCreateParams,
  DictDataOut,
  DictTypeOut,
} from '@/services/api/system/dict';

export type DataModalProps = {
  open: boolean;
  record?: DictDataOut;
  /** 当前选中的字典类型 —— 字典数据挂在它下面 */
  dictType?: DictTypeOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: DictDataCreateParams) => Promise<boolean>;
};

/**
 * 字典数据新增/编辑弹窗。
 *
 * 字典数据一定属于某个字典类型(dict_type_id),而页面上一次只处理一个类型
 * ⇒ 类型选择框只有「当前类型」一个选项,新增时默认选中它。
 *
 * ⚠️ 后端 `DictDataCreateSchema` 有**五个**必填字段:
 *   `dict_sort`(1–999)、`dict_label`、`dict_value`、`dict_type`、`dict_type_id`。
 *   `dict_type` 是字典类型的**编码**(如 user_status),不是 id ——
 *   它由当前选中的字典类型带出,这里做成只读字段(与上游 Vue 产品一致),
 *   少一个就是 422(`Field required`)。
 */
const DataModalForm: React.FC<DataModalProps> = ({
  open,
  record,
  dictType,
  onOpenChange,
  onSubmit,
}) => {
  const isEdit = Boolean(record?.id);
  const typeId = dictType?.id ?? undefined;

  return (
    <ModalForm<DictDataCreateParams>
      title={isEdit ? '编辑字典数据' : '新增字典数据'}
      open={open}
      initialValues={{
        // 排序:后端必填,默认 1(与上游一致)
        dict_sort: record?.dict_sort ?? 1,
        dict_label: record?.dict_label ?? undefined,
        dict_value: record?.dict_value ?? undefined,
        // 字典类型编码:后端必填 —— 取当前选中的字典类型的 dict_type
        dict_type: record?.dict_type ?? dictType?.dict_type ?? undefined,
        dict_type_id: record?.dict_type_id ?? typeId,
        css_class: record?.css_class ?? undefined,
        list_class: record?.list_class ?? undefined,
        is_default: record?.is_default ?? false,
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
      <ProFormDigit
        name="dict_sort"
        label="排序"
        min={1}
        max={999}
        fieldProps={{ precision: 0 }}
        rules={[
          { required: true, message: '请输入排序' },
          { type: 'number', min: 1, max: 999, message: '排序取值 1–999' },
        ]}
      />
      <ProFormText
        name="dict_label"
        label="字典标签"
        rules={[{ required: true, message: '请输入字典标签' }]}
      />
      <ProFormText
        name="dict_value"
        label="字典键值"
        rules={[{ required: true, message: '请输入字典键值' }]}
      />
      <ProFormSelect
        name="dict_type_id"
        label="字典类型"
        options={
          typeId === undefined
            ? []
            : [
                {
                  label: `${dictType?.dict_name ?? ''}(${dictType?.dict_type ?? ''})`,
                  value: typeId,
                },
              ]
        }
        rules={[{ required: true, message: '请选择字典类型' }]}
      />
      {/*
        字典类型**编码** —— 后端必填(dict_type),由当前选中的字典类型带出。
        只读展示:改它就得换字典类型,那是「字典类型」下拉的事。
      */}
      <ProFormText name="dict_type" label="数据类型" disabled />
      <ProFormText name="css_class" label="样式类名" />
      <ProFormText name="list_class" label="回显样式" />
      <ProFormSwitch name="is_default" label="是否默认" />
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

export default DataModalForm;
