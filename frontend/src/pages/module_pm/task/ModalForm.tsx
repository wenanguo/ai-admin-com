import {
  ModalForm,
  ProForm,
  ProFormDatePicker,
  ProFormDependency,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Alert, Spin } from 'antd';
import type React from 'react';
import { DictSelect } from '@/components/pm/DictSelect';
import { toProSelectRequest } from '@/components/pm/useDictOptions';
import type { ProjectOption } from '@/components/pm/useProjectNames';
import { listMilestones } from '@/services/api/pm/milestone';
import type {
  TaskCreateParams,
  TaskOut,
  TaskUpdateParams,
} from '@/services/api/pm/task';
import { listTasks } from '@/services/api/pm/task';
import { listUsers } from '@/services/api/system/user';

export type TaskModalProps = {
  open: boolean;
  record?: TaskOut;
  onOpenChange: (open: boolean) => void;
  /**
   * 提交载荷。
   *
   * 新增与更新的载荷**形状不同**(见 TaskCreateParams / TaskUpdateParams),
   * 所以这里是并集:表单自己知道是新增还是编辑。
   */
  onSubmit: (values: TaskCreateParams | TaskUpdateParams) => Promise<boolean>;
  /** 侧载的项目选项(列表页已拉过,表单不再发请求) */
  projectOptions: ProjectOption[];
  /** 侧载是否还在途(在途时下拉是空的,先转圈别让人干瞪眼) */
  optionsLoading: boolean;
};

/**
 * 表单值。
 *
 * 只包含表单里有的字段。**不在表单里**的字段有:
 *
 * - `actual_start_date` / `actual_end_date`:后端自己维护(实际起止)
 * - `reporter_id` / `sort_order` / `created_via_code`:这三列**不是用户可编辑的**
 *   (报告人是创建人、排序是看板顺序、创建方式是来源),新增时由 payload 构造器
 *   按固定规则补齐,更新时一个都不带
 *
 * 提交时表单外的字段一个都不带 ⇒ 后端 `model_dump(exclude_unset=True)`
 * 原样保留库里的值,不会被「整对象 PUT」抹掉。
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
  /** 评审人(逗号分隔的 id 字符串,不是数组) */
  reviewers?: string;
  /** 标签(JSON 数组字符串,不是数组) */
  labels?: string;
  /** 计划开始日期 */
  start_date?: string;
  /** 计划截止日期 */
  due_date?: string;
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
 * 用户远程搜索的候选(负责人用)。
 *
 * ⚠️ 这个接口在后端要 module_system:user:query 权限;
 * 没有时表单里只有这一项填不了,其它不受影响。
 *
 * `current` 是**行里的负责人**(后端随行返回的 assignee_by 冗余字段):
 * 远程搜索只回一页(100 个用户),负责人不在这页里时,编辑弹窗只能显示一个
 * 裸 id(3)。把它补进候选就显示名字了 —— 提交的值仍然是 id(后端要的是 id)。
 * 有搜索词时不补:补了也不匹配搜索词。
 */
async function fetchUserOptions(
  params: { keyWords?: string },
  current?: {
    id?: number | null;
    name?: string | null;
    username?: string | null;
  } | null,
) {
  const keyword = params.keyWords?.trim();
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
  if (keyword || !current || current.id == null) return options;
  if (options.some((option) => option.value === current.id)) return options;
  return [
    {
      label: current.name ?? current.username ?? String(current.id),
      value: current.id,
    },
    ...options,
  ];
}

/**
 * 列表行 → 表单值(只取表单里的字段)。
 *
 * 编辑**直接用列表行填表**,不再发详情请求:后端的列表返回
 * `ModulePmTaskOutSchema`(它继承 CreateSchema),行里已经带着表单要的
 * 每一个字段。再发一次 `/pm_project/pm_task/detail/` 只会多要一个 `…:detail` 权限 ——
 * 有 update 没 detail 的角色会打开一个「加载任务详情失败」的废弹窗。
 */
function toFormValues(row: TaskOut | undefined): Partial<TaskFormValues> {
  return {
    project_id: row?.project_id ?? undefined,
    milestone_id: row?.milestone_id ?? undefined,
    parent_id: row?.parent_id ?? undefined,
    title: row?.title ?? undefined,
    description: row?.description ?? undefined,
    type_code: row?.type_code ?? undefined,
    status_code: row?.status_code ?? undefined,
    priority_code: row?.priority_code ?? undefined,
    estimate_hours: row?.estimate_hours ?? undefined,
    actual_hours: row?.actual_hours ?? undefined,
    assignee_id: row?.assignee_id ?? undefined,
    reviewers: row?.reviewers ?? undefined,
    labels: row?.labels ?? undefined,
    start_date: row?.start_date ?? undefined,
    due_date: row?.due_date ?? undefined,
    blocked_reason: row?.blocked_reason ?? undefined,
  };
}

/**
 * 表单值 → 后端入参(**不含**创建时才补的三列)。
 *
 * 必填字段(project_id / title / type_code / status_code / priority_code)
 * 一个都不能少 —— 后端缺任何一个都 422。
 * 没在表单里的字段(actual_start_date / actual_end_date / reporter_id /
 * sort_order / created_via_code)不提交,后端 `exclude_unset=True` ⇒ 原样保留。
 */
function toBasePayload(values: TaskFormValues): TaskUpdateParams {
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
    reviewers: values.reviewers ?? null,
    labels: values.labels ?? null,
    start_date: values.start_date ?? null,
    due_date: values.due_date ?? null,
    blocked_reason: values.blocked_reason ?? null,
  };
}

/**
 * 新增载荷:补上后端 **NOT NULL** 的三列。
 *
 * 这三列在库里都是 NOT NULL(`module_pm_task`),而后端 `create_service`
 * **不做任何兜底**(直接 `CRUD.create(data=data)`)⇒ 不带就是 INSERT NULL,
 * 新增必然 500。所以新增时必须由前端按固定规则补齐:
 *
 * - `reporter_id`:创建人 = 当前登录用户(拿不到就别提交,见组件里的处理)
 * - `sort_order`:看板排序,新建的任务一律 0
 * - `created_via_code`:创建方式 = 字典 `module_pm_task_created_via` 里的
 *   「手动」(`manual`)—— 字典里没有 'web' 这一项
 */
function toCreatePayload(
  values: TaskFormValues,
  reporterId: number,
): TaskCreateParams {
  return {
    ...toBasePayload(values),
    reporter_id: reporterId,
    sort_order: 0,
    created_via_code: 'manual',
  };
}

/** 整行字段（标题/描述这类长文本）：占满一行。 */
const FULL_WIDTH = { span: 24 } as const;

/**
 * 任务表单。
 *
 * 后端的坑:
 * - 更新是**整对象 PUT**(UpdateSchema 继承 CreateSchema,没有 PATCH),
 *   缺必填字段就 422 ⇒ 编辑时表单必须拿齐全部必填字段
 * - 编辑**直接用列表行填表**:列表返回的 `ModulePmTaskOutSchema` 继承
 *   CreateSchema,行里已经带着表单要的每一个字段 —— 不发详情请求,
 *   于是编辑只要 `…:update` 一个权限(详情接口另要 `…:detail`)
 * - `reviewers` 是逗号分隔的 id 字符串、`labels` 是 JSON 数组字符串 ——
 *   后端存的就是字符串,表单原样提交(不是数组)
 * - `estimate_hours` / `actual_hours` 是数字(后端是 Decimal)
 * - `reporter_id` / `sort_order` / `created_via_code` 不在表单里:
 *   新增时按固定规则补齐,更新时一个都不带
 *
 * ## 布局：两列
 *
 * 字段有十多个，一列排下来要滚很久 ⇒ 用 `ProForm` 自带的栅格
 * （`grid` + `rowProps` + `colProps`）排成**两列**，标题/描述这类长字段占整行。
 * 标签在**左边**（`labelCol`/`wrapperCol`），和原型一致。
 */
const TaskModalForm: React.FC<TaskModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
  projectOptions,
  optionsLoading,
}) => {
  // 编辑对象的 id(新增时是 null)
  const taskId = record?.id ?? null;
  const editing = taskId != null;

  // 当前登录用户:新增任务的创建人(reporter_id)是后端的 NOT NULL 列,
  // 只能由前端带 —— 拿不到就不能提交(宁可报错也不发一个 null 上去)
  // ⚠️ useModel('@@initialState') 拿到的是**模型**(initialState / loading / …),
  // 真正的初始状态在它的 initialState 上(与 plugin-access 的读法一致)
  const { initialState } = useModel('@@initialState');
  const currentUserId = initialState?.currentUser?.id ?? null;

  // 侧载还在途时,项目/里程碑的下拉是空的 —— 先转圈别让人干瞪眼
  // 新增必须有当前登录用户(编辑不带 reporter_id,不受影响)
  const reporterMissing = !editing && currentUserId == null;
  const formReady = !optionsLoading && !reporterMissing;

  return (
    <ModalForm<TaskFormValues>
      title={editing ? '编辑任务' : '新增任务'}
      open={open}
      // 两列布局 ⇒ 弹窗要宽一点,否则每列挤得没法看
      width={920}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      // 顺带保证每次打开都是一张干净的表单(不会带上一次的残留值)
      modalProps={{
        destroyOnHidden: true,
        okButtonProps: { disabled: !formReady },
      }}
      // 两列栅格：默认每格半宽,单个字段可以用 `colProps` 改成整行
      grid
      rowProps={{ gutter: 16 }}
      colProps={{ span: 12 }}
      // 标签在**左边**（原型就是左标签）：ProForm v3 默认是竖排，要显式改
      layout="horizontal"
      labelCol={{ span: 5 }}
      wrapperCol={{ span: 19 }}
      labelAlign="left"
      // 表单值直接来自列表行(编辑)或空(新增)—— 同步就有,不用等详情
      initialValues={toFormValues(record)}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 新增要带上后端 NOT NULL 的三列;更新一个都不带
        // (后端 `exclude_unset=True` ⇒ 库里的值原样保留)
        if (!editing) {
          // 拿不到当前登录用户就别提交(弹窗里已经给了错误提示)
          if (currentUserId == null) return false;
          // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
          return onSubmit(toCreatePayload(values, currentUserId));
        }
        return onSubmit(toBasePayload(values));
      }}
    >
      {formReady ? (
        <>
          {/* 标题占整行 */}
          <ProFormText
            name="title"
            label="任务标题"
            colProps={FULL_WIDTH}
            rules={[{ required: true, message: '请输入任务标题' }]}
          />
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
          {/*
            里程碑与父任务都跟着所选项目走(INV-02:不能跨项目)。

            里程碑的候选是**按所选项目单独拉**的(不是全局侧载的那 100 条):
            侧载只覆盖最新的 100 个里程碑,跨项目一多就漏 —— 按项目拉才能只取
            所选项目的那些(依赖 project_id 变化重新请求)。
            ⚠️ 按项目拉也躲不开后端 100 条的上限:单个项目的里程碑超过 100 个时,
            下拉里只有最新的 100 个。
          */}
          <ProFormSelect
            name="milestone_id"
            label="所属里程碑"
            showSearch
            dependencies={['project_id']}
            fieldProps={{
              optionFilterProp: 'label',
              placeholder: '先选项目,再选里程碑',
            }}
            request={async ({
              project_id,
            }: {
              project_id?: number;
              keyWords?: string;
            }) => {
              if (project_id == null) return [];
              const res = await listMilestones({
                page_no: 1,
                page_size: 100,
                project_id,
              });
              return (res?.data?.items ?? []).flatMap((milestone) =>
                milestone.id == null
                  ? []
                  : [
                      {
                        label: milestone.name ?? String(milestone.id),
                        value: milestone.id,
                      },
                    ],
              );
            }}
          />
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
          {/*
            字典下拉（类型 / 状态 / 优先级）。

            ⚠️ 用 `ProFormSelect` + `toProSelectRequest`，**不用 `ProForm.Item`**：
            `ProForm.Item` 不是 `ProFormField`，它不会渲染栅格的 `Col`
            ⇒ 直接躺在 `Row` 里会被压成一条窄缝（实测宽度只剩 60px）。
            `toProSelectRequest` 与 `DictSelect` 共用同一份字典缓存。
          */}
          <ProFormSelect
            name="type_code"
            label="类型"
            request={toProSelectRequest('module_pm_task_type')}
            rules={[{ required: true, message: '请选择类型' }]}
          />
          <ProFormSelect
            name="status_code"
            label="状态"
            request={toProSelectRequest('module_pm_task_status')}
            rules={[{ required: true, message: '请选择状态' }]}
          />
          <ProFormSelect
            name="priority_code"
            label="优先级"
            request={toProSelectRequest('module_pm_priority')}
            rules={[{ required: true, message: '请选择优先级' }]}
          />
          <ProFormSelect
            name="assignee_id"
            label="负责人"
            showSearch
            debounceTime={300}
            fieldProps={{ placeholder: '输入姓名搜索' }}
            // 行里的负责人(assignee_by)一并当候选:远程搜索只回一页,
            // 负责人不在那一页里时,编辑框里就只是个裸 id
            request={(params) => fetchUserOptions(params, record?.assignee_by)}
          />
          {/* 工时是数字(后端是 Decimal,不是字符串) */}
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
          <ProFormText
            name="reviewers"
            label="评审人"
            fieldProps={{ placeholder: '评审人 id,逗号分隔,如 3,5' }}
          />
          <ProFormTextArea
            name="labels"
            label="标签"
            colProps={FULL_WIDTH}
            fieldProps={{
              rows: 2,
              placeholder: '标签的 JSON 数组,如 ["财务","合规"]',
            }}
            rules={[{ validator: validateLabels }]}
          />
          <ProFormTextArea
            name="blocked_reason"
            label="阻塞原因"
            colProps={FULL_WIDTH}
            fieldProps={{ rows: 2 }}
          />
          <ProFormTextArea
            name="description"
            label="任务描述"
            colProps={FULL_WIDTH}
            fieldProps={{ rows: 3, placeholder: '支持 Markdown' }}
          />
        </>
      ) : (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          {reporterMissing ? (
            <Alert
              type="error"
              showIcon
              message="拿不到当前登录用户"
              description="新增任务要带上创建人(后端的必填列),请刷新页面后重试。"
            />
          ) : (
            <Spin tip="正在加载项目与里程碑…" />
          )}
        </div>
      )}
    </ModalForm>
  );
};

export default TaskModalForm;
