import {
  ModalForm,
  ProForm,
  ProFormDatePicker,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import { DictSelect } from '@/components/pm/DictSelect';
import type {
  MilestoneCreateParams,
  MilestoneOut,
} from '@/services/api/pm/milestone';
import { listProjects } from '@/services/api/pm/project';
import { RULE_ENGINE_STATUSES } from './constants';

export type MilestoneModalProps = {
  open: boolean;
  record?: MilestoneOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: MilestoneCreateParams) => Promise<boolean>;
};

/**
 * 表单的值:交付物用 JSON 文本编辑(方便手写),
 * 提交前还原成后端要的 dict —— 后端是 JSON 列,不是字符串。
 */
type MilestoneFormValues = Omit<MilestoneCreateParams, 'deliverables'> & {
  deliverables?: string;
};

/** 是不是一个 JSON 对象(不是数组、不是 null) */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 交付物(JSON 对象)的校验:表单里编辑的是 JSON 文本,
 * 前端只保证它能解析成一个 JSON **对象** —— 序列化是表单层的职责。
 */
function validateDeliverables(
  _: unknown,
  value: string | undefined,
): Promise<void> {
  if (!value?.trim()) return Promise.resolve();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isJsonObject(parsed)) {
      return Promise.reject(
        new Error('交付物必须是 JSON 对象,如 {"doc":"需求规格说明书"}'),
      );
    }
    return Promise.resolve();
  } catch {
    return Promise.reject(
      new Error('交付物必须是合法的 JSON 对象,如 {"doc":"需求规格说明书"}'),
    );
  }
}

/**
 * 表单的 JSON 文本 → 后端要的 dict。
 *
 * 校验规则已经保证它能解析(解析不了表单不会提交),这里的兜底只是
 * 「不把坏数据发给后端」。
 */
function toDeliverables(value?: string): Record<string, unknown> | null {
  if (!value?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 里程碑表单。
 *
 * 后端的坑:
 * - `deliverables` 是 **dict**(JSON 列),不是数组也不是字符串 —— 表单里用
 *   JSON 文本编辑,提交前还原成对象
 * - `progress` 是后端缓存的派生字段(任务完成率),**不在表单里**(也不提交)
 * - `health_score` 由规则/后端维护,v1 不开放手工改
 * - 更新是整对象 PUT(后端 UpdateSchema 继承 CreateSchema,必填集相同)
 */
const MilestoneModalForm: React.FC<MilestoneModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<MilestoneFormValues>
      title={record?.id ? '编辑里程碑' : '新增里程碑'}
      open={open}
      initialValues={{
        project_id: record?.project_id ?? undefined,
        name: record?.name ?? undefined,
        description: record?.description ?? undefined,
        start_date: record?.start_date ?? undefined,
        due_date: record?.due_date ?? undefined,
        status_code: record?.status_code ?? undefined,
        // 交付物存的是 dict,表单里编辑成 JSON 文本
        deliverables: record?.deliverables
          ? JSON.stringify(record.deliverables, null, 2)
          : undefined,
        sort_order: record?.sort_order ?? 0,
      }}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 交付物:JSON 文本 → dict(后端是 JSON 列)
        const payload: MilestoneCreateParams = {
          ...values,
          deliverables: toDeliverables(values.deliverables),
        };
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(payload);
      }}
    >
      <ProFormSelect
        name="project_id"
        label="所属项目"
        showSearch
        debounceTime={300}
        fieldProps={{ placeholder: '输入项目名搜索' }}
        rules={[{ required: true, message: '请选择所属项目' }]}
        /*
          远程搜索:候选来自 listProjects(与列表页的负责人下拉同款做法)。
          ProFormSelect 默认 showSearch: true,与列级 select 不同
          (列级必须显式开,见工单页处理人列的注释)。
        */
        request={async ({ keyWords }: { keyWords?: string }) => {
          const keyword = keyWords?.trim();
          const res = await listProjects({
            page_no: 1,
            page_size: 100,
            ...(keyword ? { name: keyword } : {}),
          });
          return (res?.data?.items ?? []).flatMap((project) =>
            project.id == null
              ? []
              : [
                  {
                    label: project.name ?? String(project.id),
                    value: project.id,
                  },
                ],
          );
        }}
      />
      <ProFormText
        name="name"
        label="里程碑名称"
        rules={[{ required: true, message: '请输入里程碑名称' }]}
      />
      <ProFormTextArea
        name="description"
        label="里程碑描述"
        fieldProps={{ rows: 3 }}
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
      <ProForm.Item
        name="status_code"
        label="状态"
        rules={[{ required: true, message: '请选择状态' }]}
      >
        {/* value/onChange 都是线上码(dict_value),提交「进行中」后端就是 422 */}
        <DictSelect
          dictType="module_pm_milestone_status"
          excludeValues={RULE_ENGINE_STATUSES}
        />
      </ProForm.Item>
      <ProFormTextArea
        name="deliverables"
        label="交付物"
        fieldProps={{
          rows: 3,
          placeholder: '交付物的 JSON 对象,如 {"doc":"需求规格说明书"}',
        }}
        rules={[{ validator: validateDeliverables }]}
      />
      <ProFormDigit
        name="sort_order"
        label="显示排序"
        min={0}
        fieldProps={{ placeholder: '越小越靠前' }}
        rules={[{ required: true, message: '请输入显示排序' }]}
      />
    </ModalForm>
  );
};

export default MilestoneModalForm;
