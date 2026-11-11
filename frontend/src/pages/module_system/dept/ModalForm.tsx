import {
  ModalForm,
  ProForm,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import DeptTreeSelect from '@/components/DeptTreeSelect';
import type { DeptCreateParams, DeptOut } from '@/services/api/system/dept';

export type DeptModalProps = {
  open: boolean;
  record?: DeptOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: DeptCreateParams) => Promise<boolean>;
};

/**
 * 部门新增/编辑弹窗。
 *
 * 「上级部门」用部门树选择器 —— 编辑时把当前部门**连同它的子树**排除掉,
 * 否则能把自己选成自己的上级(后端会造出环)。
 */
const DeptModalForm: React.FC<DeptModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<DeptCreateParams>
      title={record?.id ? '编辑部门' : '新增部门'}
      open={open}
      initialValues={{
        name: record?.name ?? undefined,
        code: record?.code ?? undefined,
        order: record?.order ?? undefined,
        leader: record?.leader ?? undefined,
        phone: record?.phone ?? undefined,
        email: record?.email ?? undefined,
        parent_id: record?.parent_id ?? undefined,
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
      <ProFormText name="name" label="部门名称" rules={[{ required: true }]} />
      <ProFormText
        name="code"
        label="部门编码"
        rules={[
          { required: true },
          {
            // 与后端 validate_required_code 的长度约束保持一致(2–64 个字符)
            // (backend/app/core/validator.py)
            min: 2,
            max: 64,
            message: '长度 2–64 个字符',
          },
          {
            // 与后端 validate_required_code 的正则保持一致
            // (backend/app/core/validator.py)
            pattern: /^[A-Za-z][A-Za-z0-9_]*$/,
            message: '字母开头，仅允许字母、数字、下划线',
          },
        ]}
      />
      {/*
        长度与取值范围跟后端的 schema 对齐
        (backend/app/api/v1/module_system/dept/schema.py):
        phone ≤ 20 / email ≤ 128 / order ≥ 0 —— 不在表单里挡就是 422 toast。
      */}
      <ProFormDigit
        name="order"
        label="排序"
        min={0}
        rules={[{ type: 'number', min: 0, message: '排序不能小于 0' }]}
      />
      <ProFormText name="leader" label="负责人" />
      <ProFormText
        name="phone"
        label="联系电话"
        rules={[{ max: 20, message: '联系电话不超过 20 个字符' }]}
      />
      <ProFormText
        name="email"
        label="邮箱"
        rules={[{ max: 128, message: '邮箱不超过 128 个字符' }]}
      />
      <ProForm.Item name="parent_id" label="上级部门">
        <DeptTreeSelect
          excludeId={record?.id ?? undefined}
          placeholder="不选则为顶级部门"
        />
      </ProForm.Item>
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

export default DeptModalForm;
