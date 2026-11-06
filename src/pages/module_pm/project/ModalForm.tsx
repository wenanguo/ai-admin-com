import {
  ModalForm,
  ProForm,
  ProFormDatePicker,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import { toProSelectRequest } from '@/components/pm/useDictOptions';
import type {
  ProjectCreateParams,
  ProjectOut,
} from '@/services/api/pm/project';
import { listUsers } from '@/services/api/system/user';

export type ProjectModalProps = {
  open: boolean;
  record?: ProjectOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ProjectCreateParams) => Promise<boolean>;
};

/**
 * 标签(JSON 数组字符串)的校验:后端存的就是字符串,前端只保证它是合法的
 * JSON 数组且元素都是字符串 —— 序列化是表单层的职责,service 层原样透传。
 */
function validateTags(_: unknown, value: string | undefined): Promise<void> {
  if (!value) return Promise.resolve();
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((tag) => typeof tag === 'string')
    ) {
      return Promise.reject(
        new Error('标签必须是字符串组成的 JSON 数组,如 ["财务","合规"]'),
      );
    }
    return Promise.resolve();
  } catch {
    return Promise.reject(
      new Error('标签必须是合法的 JSON 数组,如 ["财务","合规"]'),
    );
  }
}

const ProjectModalForm: React.FC<ProjectModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<ProjectCreateParams>
      title={record?.id ? '编辑项目' : '新增项目'}
      open={open}
      initialValues={{
        code: record?.code ?? undefined,
        name: record?.name ?? undefined,
        description: record?.description ?? undefined,
        owner_id: record?.owner_id ?? undefined,
        status_code: record?.status_code ?? undefined,
        priority_code: record?.priority_code ?? undefined,
        start_date: record?.start_date ?? undefined,
        due_date: record?.due_date ?? undefined,
        visibility_code: record?.visibility_code ?? undefined,
        tags: record?.tags ?? undefined,
      }}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      // 两列布局（字段多，一列排下来要滚很久）
      width={920}
      grid
      rowProps={{ gutter: 16 }}
      colProps={{ span: 12 }}
      // 标签在左边（原型就是左标签）：ProForm v3 默认竖排
      layout="horizontal"
      labelCol={{ span: 5 }}
      wrapperCol={{ span: 19 }}
      labelAlign="left"
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(values);
      }}
    >
      <ProFormText
        name="code"
        label="项目编码"
        fieldProps={{ placeholder: '如 AIPM-CORE' }}
        rules={[
          { required: true, message: '请输入项目编码' },
          // 后端 ModulePmProjectCreateSchema.code 的正则(租户内唯一)
          {
            pattern: /^[A-Z0-9_-]{2,32}$/,
            message: '项目编码需为 2-32 位大写字母/数字/下划线/连字符',
          },
        ]}
      />
      <ProFormText
        name="name"
        label="项目名称"
        rules={[{ required: true, message: '请输入项目名称' }]}
      />
      <ProFormTextArea
        name="description"
        label="项目描述"
        colProps={{ span: 24 }}
        fieldProps={{ rows: 3 }}
      />
      <ProFormSelect
        name="owner_id"
        label="负责人"
        showSearch
        debounceTime={300}
        fieldProps={{ placeholder: '输入姓名搜索' }}
        rules={[{ required: true, message: '请选择负责人' }]}
        /*
          远程搜索:候选来自 listUsers。⚠️ 这个接口在后端要
          module_system:user:query 权限;没有时只有这项表单填不了。
          ProFormSelect 默认 showSearch: true,与列级 select 不同
          (列级必须显式开,见工单页处理人列的注释)。

          行里的负责人(owner_by,后端随行返回的冗余字段)一并当候选:
          远程搜索只回一页(100 个用户),负责人不在这页里时,编辑框里
          只能显示一个裸 id。补进去就显示名字 —— 提交的值仍然是 id。
        */
        request={async ({ keyWords }: { keyWords?: string }) => {
          const keyword = keyWords?.trim();
          const res = await listUsers({
            page_no: 1,
            page_size: 100,
            ...(keyword ? { name: keyword } : {}),
          });
          const options = (res?.data?.items ?? []).flatMap((user) =>
            user.id == null
              ? []
              : [
                  {
                    label: user.name ?? user.username ?? String(user.id),
                    value: user.id,
                  },
                ],
          );
          const owner = record?.owner_by;
          if (keyword || !owner || owner.id == null) return options;
          if (options.some((option) => option.value === owner.id)) {
            return options;
          }
          return [
            {
              label: owner.name ?? owner.username ?? String(owner.id),
              value: owner.id,
            },
            ...options,
          ];
        }}
      />
      {/*
        字典下拉。

        ⚠️ 用 `ProFormSelect` + `toProSelectRequest`，**不用 `ProForm.Item`**：
        `ProForm.Item` 不是 `ProFormField`，它不会渲染栅格的 `Col`
        ⇒ 直接躺在 `Row` 里会被压成一条窄缝。
      */}
      <ProFormSelect
        name="status_code"
        label="状态"
        request={toProSelectRequest('module_pm_project_status')}
        rules={[{ required: true, message: '请选择状态' }]}
      />
      <ProFormSelect
        name="priority_code"
        label="优先级"
        request={toProSelectRequest('module_pm_priority')}
        rules={[{ required: true, message: '请选择优先级' }]}
      />
      <ProFormSelect
        name="visibility_code"
        label="可见性"
        request={toProSelectRequest('module_pm_visibility')}
        rules={[{ required: true, message: '请选择可见性' }]}
      />
      {/* ModalForm 默认 dateFormatter='string',提交的就是 YYYY-MM-DD 字符串 */}
      <ProFormDatePicker
        name="start_date"
        label="计划开始日期"
        rules={[{ required: true, message: '请选择计划开始日期' }]}
      />
      <ProFormDatePicker
        name="due_date"
        label="计划截止日期"
        rules={[{ required: true, message: '请选择计划截止日期' }]}
      />
      <ProFormTextArea
        name="tags"
        label="标签"
        fieldProps={{
          rows: 2,
          placeholder: '标签的 JSON 数组,如 ["财务","合规"]',
        }}
        rules={[{ validator: validateTags }]}
      />
    </ModalForm>
  );
};

export default ProjectModalForm;
