import {
  ModalForm,
  ProForm,
  ProFormDatePicker,
  ProFormDependency,
  ProFormDigit,
  type ProFormInstance,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { Alert, Spin } from 'antd';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { DictSelect } from '@/components/pm/DictSelect';
import type { TaskCreateParams, TaskOut } from '@/services/api/pm/task';
import { getTaskDetail, listTasks } from '@/services/api/pm/task';
import { listUsers } from '@/services/api/system/user';
import type { MilestoneOption, ProjectOption } from './useProjectNames';

export type TaskModalProps = {
  open: boolean;
  record?: TaskOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TaskCreateParams) => Promise<boolean>;
  /** 侧载的项目选项(列表页已拉过,表单不再发请求) */
  projectOptions: ProjectOption[];
  /** 侧载的里程碑选项(表单里按所选项目过滤) */
  milestoneOptions: MilestoneOption[];
  /** 侧载是否还在途(在途时下拉是空的,先转圈别让人干瞪眼) */
  optionsLoading: boolean;
};

/**
 * 表单值。
 *
 * 只包含表单里有的字段:`actual_start_date` / `actual_end_date` /
 * `created_via_code` 都不在表单里(创建方式由后端兜底成 'web'),
 * 提交时也不带 —— 后端 update 用 `model_dump(exclude_unset=True)`,
 * 没带的字段原样保留,不会被人抹掉。
 */
type TaskFormValues = {
  /** 所属项目(必填) */
  project_id: number;
  /** 所属里程碑 */
  milestone_id?: number;
  /** 父任务 */
  parent_id?: number;
  /** 任务标题(必填) */
  title: string;
  /** 任务描述(Markdown) */
  description?: string;
  /** 类型(字典 module_pm_task_type) */
  type_code: string;
  /** 状态(字典 module_pm_task_status) */
  status_code: string;
  /** 优先级(字典 module_pm_priority) */
  priority_code: string;
  /** 预估工时(后端是 Decimal,提交数字) */
  estimate_hours?: number;
  /** 实际工时(后端是 Decimal,提交数字) */
  actual_hours?: number;
  /** 负责人 */
  assignee_id?: number;
  /** 报告人 */
  reporter_id?: number;
  /** 评审人(逗号分隔的 id 字符串,不是数组) */
  reviewers?: string;
  /** 标签(JSON 数组字符串,不是数组) */
  labels?: string;
  /** 计划开始日期 */
  start_date?: string;
  /** 计划截止日期 */
  due_date?: string;
  /** 看板拖拽排序 */
  sort_order?: number;
  /** 阻塞原因 */
  blocked_reason?: string;
};

/**
 * 标签(JSON 数组字符串)的校验:后端存的就是字符串,前端只保证它是合法的
 * JSON 数组且元素都是字符串 —— 序列化是表单层的职责,service 层原样透传。
 */
function validateLabels(_: unknown, value: string | undefined): Promise<void> {
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

/**
 * 用户远程搜索的候选(负责人与报告人共用)。
 *
 * ⚠️ 这个接口在后端要 module_system:user:query 权限;
 * 没有时表单里只有这两项填不了,其它不受影响。
 */
async function fetchUserOptions(params: { keyWords?: string }) {
  const keyword = params.keyWords?.trim();
  const res = await listUsers({
    page_no: 1,
    page_size: 100,
    ...(keyword ? { name: keyword } : {}),
  });
  return (res?.data?.items ?? []).flatMap((user) =>
    user.id == null
      ? []
      : [
          {
            label: user.name ?? user.username ?? String(user.id),
            value: user.id,
          },
        ],
  );
}

/**
 * 详情 → 表单值(只取表单里的字段)。
 *
 * 编辑是**读-改-写**:后端的 UpdateSchema 继承 CreateSchema,PUT 要带全部
 * 必填字段,所以表单必须拿完整的详情来填,不能只拿列表行。
 */
function toFormValues(detail: TaskOut): Partial<TaskFormValues> {
  return {
    project_id: detail.project_id ?? undefined,
    milestone_id: detail.milestone_id ?? undefined,
    parent_id: detail.parent_id ?? undefined,
    title: detail.title ?? undefined,
    description: detail.description ?? undefined,
    type_code: detail.type_code ?? undefined,
    status_code: detail.status_code ?? undefined,
    priority_code: detail.priority_code ?? undefined,
    estimate_hours: detail.estimate_hours ?? undefined,
    actual_hours: detail.actual_hours ?? undefined,
    assignee_id: detail.assignee_id ?? undefined,
    reporter_id: detail.reporter_id ?? undefined,
    reviewers: detail.reviewers ?? undefined,
    labels: detail.labels ?? undefined,
    start_date: detail.start_date ?? undefined,
    due_date: detail.due_date ?? undefined,
    sort_order: detail.sort_order ?? undefined,
    blocked_reason: detail.blocked_reason ?? undefined,
  };
}

/**
 * 表单值 → 后端入参。
 *
 * 必填字段(project_id / title / type_code / status_code / priority_code)
 * 一个都不能少 —— 后端缺任何一个都 422。
 * 没在表单里的字段(actual_start_date / actual_end_date / created_via_code)
 * 不提交,后端 `exclude_unset=True` ⇒ 原样保留。
 */
function toPayload(values: TaskFormValues): TaskCreateParams {
  return {
    project_id: values.project_id,
    title: values.title,
    type_code: values.type_code,
    status_code: values.status_code,
    priority_code: values.priority_code,
    milestone_id: values.milestone_id ?? null,
    parent_id: values.parent_id ?? null,
    description: values.description ?? null,
    estimate_hours: values.estimate_hours ?? null,
    actual_hours: values.actual_hours ?? null,
    assignee_id: values.assignee_id ?? null,
    reporter_id: values.reporter_id ?? null,
    reviewers: values.reviewers ?? null,
    labels: values.labels ?? null,
    start_date: values.start_date ?? null,
    due_date: values.due_date ?? null,
    sort_order: values.sort_order ?? null,
    blocked_reason: values.blocked_reason ?? null,
  };
}

/**
 * 任务表单。
 *
 * 后端的坑:
 * - 更新是**整对象 PUT**(UpdateSchema 继承 CreateSchema,没有 PATCH),
 *   缺必填字段就 422 ⇒ 编辑时先 GET 详情填表,保存时把必填字段一起 PUT
 * - `reviewers` 是逗号分隔的 id 字符串、`labels` 是 JSON 数组字符串 ——
 *   后端存的就是字符串,表单原样提交(不是数组)
 * - `estimate_hours` / `actual_hours` / `sort_order` 是数字(后端是 Decimal)
 * - `created_via_code` 不在表单里:后端为空时自己兜底成 'web'
 */
const TaskModalForm: React.FC<TaskModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
  projectOptions,
  milestoneOptions,
  optionsLoading,
}) => {
  // 编辑对象的 id(新增时是 null)
  const taskId = record?.id ?? null;
  const editing = taskId != null;

  // 详情(读-改-写的「读」):异步到达,到了再回填表单
  const [detail, setDetail] = useState<TaskOut | undefined>(undefined);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);

  // 表单实例:详情是异步到的,initialValues 只在表单挂载那一刻生效,
  // 只能拿到实例之后用 setFieldsValue 回填
  const formRef = useRef<ProFormInstance<TaskFormValues> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!open || taskId == null) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailFailed(false);
    getTaskDetail(taskId)
      .then((res) => {
        if (cancelled) return;
        setDetail(res?.data ?? undefined);
        setDetailId(taskId);
        setDetailLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailFailed(true);
        setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, taskId]);

  useEffect(() => {
    // 迟到的旧详情不能污染当前打开的表单
    if (!detail || detailId !== taskId) return;
    formRef.current?.setFieldsValue(toFormValues(detail));
  }, [detail, detailId, taskId]);

  // 详情没到手之前不渲染表单(免得人对着空表单提交);
  // 侧载还在途时同理 —— 项目/里程碑的下拉这时是空的
  const formReady =
    !optionsLoading && (!editing || (!detailLoading && !detailFailed));

  return (
    <ModalForm<TaskFormValues>
      title={editing ? '编辑任务' : '新增任务'}
      open={open}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      // 顺带保证每次打开都是一张干净的表单(不会带上一次的残留值)
      modalProps={{
        destroyOnHidden: true,
        okButtonProps: { disabled: !formReady },
      }}
      // 表单实例在这里拿:onInit 在表单挂载时触发
      onInit={(_values, form) => {
        formRef.current = form;
      }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(toPayload(values));
      }}
    >
      {formReady ? (
        <>
          <ProFormSelect
            name="project_id"
            label="所属项目"
            showSearch
            fieldProps={{
              optionFilterProp: 'label',
              placeholder: '选择所属项目',
            }}
            // 候选来自侧载的项目列表(页面已经拉过,不再单独发请求)
            options={projectOptions}
            rules={[{ required: true, message: '请选择所属项目' }]}
          />
          {/* 里程碑与父任务都跟着所选项目走(INV-02:不能跨项目) */}
          <ProFormDependency name={['project_id']}>
            {({ project_id }: { project_id?: number }) => (
              <ProFormSelect
                name="milestone_id"
                label="所属里程碑"
                showSearch
                fieldProps={{
                  optionFilterProp: 'label',
                  placeholder: '先选项目,再选里程碑',
                }}
                options={milestoneOptions.filter(
                  (option) => option.projectId === project_id,
                )}
              />
            )}
          </ProFormDependency>
          <ProFormDependency name={['project_id']}>
            {({ project_id }: { project_id?: number }) => (
              <ProFormSelect
                name="parent_id"
                label="父任务"
                showSearch
                debounceTime={300}
                fieldProps={{ placeholder: '搜索同项目的父任务' }}
                /*
                  父任务是**同项目**的任务(INV-02),所以没有项目就不给候选。
                  远程搜索:候选来自 listTasks,按标题过滤。
                */
                request={async ({ keyWords }: { keyWords?: string }) => {
                  if (project_id == null) return [];
                  const keyword = keyWords?.trim();
                  const res = await listTasks({
                    page_no: 1,
                    page_size: 100,
                    project_id,
                    ...(keyword ? { title: keyword } : {}),
                  });
                  return (res?.data?.items ?? []).flatMap((task) =>
                    // 自己不能当自己的父任务
                    task.id == null || task.id === taskId
                      ? []
                      : [
                          {
                            label: task.title ?? String(task.id),
                            value: task.id,
                          },
                        ],
                  );
                }}
              />
            )}
          </ProFormDependency>
          <ProFormText
            name="title"
            label="任务标题"
            rules={[{ required: true, message: '请输入任务标题' }]}
          />
          <ProFormTextArea
            name="description"
            label="任务描述"
            fieldProps={{ rows: 3, placeholder: '支持 Markdown' }}
          />
          <ProForm.Item
            name="type_code"
            label="类型"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            {/* value/onChange 都是线上码(dict_value),提交「功能」后端就是 422 */}
            <DictSelect dictType="module_pm_task_type" />
          </ProForm.Item>
          <ProForm.Item
            name="status_code"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <DictSelect dictType="module_pm_task_status" />
          </ProForm.Item>
          <ProForm.Item
            name="priority_code"
            label="优先级"
            rules={[{ required: true, message: '请选择优先级' }]}
          >
            <DictSelect dictType="module_pm_priority" />
          </ProForm.Item>
          <ProFormSelect
            name="assignee_id"
            label="负责人"
            showSearch
            debounceTime={300}
            fieldProps={{ placeholder: '输入姓名搜索' }}
            request={fetchUserOptions}
          />
          <ProFormSelect
            name="reporter_id"
            label="报告人"
            showSearch
            debounceTime={300}
            fieldProps={{ placeholder: '输入姓名搜索' }}
            request={fetchUserOptions}
          />
          {/* 工时与排序是数字(后端是 Decimal,不是字符串) */}
          <ProFormDigit
            name="estimate_hours"
            label="预估工时"
            min={0}
            fieldProps={{ placeholder: '预估工时(>= 0)' }}
          />
          <ProFormDigit
            name="actual_hours"
            label="实际工时"
            min={0}
            fieldProps={{ placeholder: '实际工时(>= 0)' }}
          />
          {/* ModalForm 默认 dateFormatter='string',提交的就是 YYYY-MM-DD 字符串 */}
          <ProFormDatePicker
            name="start_date"
            label="计划开始日期"
            fieldProps={{ placeholder: '计划开始日期' }}
          />
          <ProFormDatePicker
            name="due_date"
            label="计划截止日期"
            fieldProps={{ placeholder: '计划截止日期' }}
          />
          <ProFormDigit
            name="sort_order"
            label="排序"
            min={0}
            fieldProps={{ placeholder: '看板拖拽排序' }}
          />
          <ProFormText
            name="reviewers"
            label="评审人"
            fieldProps={{ placeholder: '评审人 id,逗号分隔,如 3,5' }}
          />
          <ProFormTextArea
            name="labels"
            label="标签"
            fieldProps={{
              rows: 2,
              placeholder: '标签的 JSON 数组,如 ["财务","合规"]',
            }}
            rules={[{ validator: validateLabels }]}
          />
          <ProFormTextArea
            name="blocked_reason"
            label="阻塞原因"
            fieldProps={{ rows: 2 }}
          />
        </>
      ) : (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          {detailFailed ? (
            <Alert
              type="error"
              showIcon
              message="加载任务详情失败"
              description="后端的更新是整对象 PUT,没有详情填不了表。请关闭后重试。"
            />
          ) : (
            <Spin
              tip={editing ? '正在加载任务详情…' : '正在加载项目与里程碑…'}
            />
          )}
        </div>
      )}
    </ModalForm>
  );
};

export default TaskModalForm;
