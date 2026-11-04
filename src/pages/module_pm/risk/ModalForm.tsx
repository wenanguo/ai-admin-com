import {
  ModalForm,
  ProForm,
  ProFormDatePicker,
  ProFormDateTimePicker,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import { DictSelect } from '@/components/pm/DictSelect';
import { listProjects } from '@/services/api/pm/project';
import type { RiskCreateParams, RiskOut } from '@/services/api/pm/risk';
import { listUsers } from '@/services/api/system/user';

/** 风险表单的 props */
export type RiskModalProps = {
  open: boolean;
  /** 正在编辑的行(undefined = 新增) */
  record?: RiskOut;
  onOpenChange: (open: boolean) => void;
  /**
   * 提交载荷。
   *
   * 新增与更新的载荷**形状相同**(后端 UpdateSchema 继承 CreateSchema,
   * 必填集一模一样),只是创建方式的值不同 —— 见 toPayload。
   */
  onSubmit: (values: RiskCreateParams) => Promise<boolean>;
};

/**
 * 表单值。
 *
 * **不在表单里**的字段有两个:
 *
 * - `score`:分数是**算出来的**(概率 × 影响),用户填的是概率与影响
 * - `created_via_code`:创建方式不是用户可编辑的(是来源,不是状态)——
 *   新增固定「手动」,编辑原样回传行里的值
 * - `ai_suggestion`:AI 写路径的字段,人工登记的风险不带它
 */
type RiskFormValues = {
  /** 所属项目(必填) */
  project_id: number;
  /** 风险标题(必填) */
  title: string;
  /** 风险描述 */
  description?: string;
  /** 分类(字典 module_pm_risk_category,必填) */
  category_code: string;
  /** 概率 1-5(必填) */
  probability: number;
  /** 影响 1-5(必填) */
  impact: number;
  /** 状态(字典 module_pm_risk_status,必填) */
  status_code: string;
  /** 风险负责人(必填) */
  owner_id: number;
  /** 缓解措施 */
  mitigation_plan?: string;
  /** 应急计划 */
  contingency_plan?: string;
  /** 缓解措施截止日期 */
  due_date?: string;
  /** 升级触发时间 */
  trigger_date?: string;
};

/** 概率与影响的候选项(后端是 1-5;用下拉而不是数字输入,免得填出 7) */
const SCALE_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({
  label: String(value),
  value,
}));

/**
 * 所属项目的远程搜索候选。
 *
 * ⚠️ 这个接口在后端要 module_pm_project:query 权限;
 * 没有时表单里只有这一项填不了,其它不受影响。
 */
async function fetchProjectOptions(params: { keyWords?: string }) {
  const keyword = params.keyWords?.trim();
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
}

/**
 * 负责人的远程搜索候选。
 *
 * ⚠️ 这个接口在后端要 module_system:user:query 权限;
 * 没有时表单里只有这一项填不了,其它不受影响。
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
 * 列表行 → 表单值(只取表单里的字段)。
 *
 * 编辑**直接用列表行填表**,不再发详情请求:后端的列表返回
 * `ModulePmRiskOutSchema`(它继承 CreateSchema),行里已经带着表单要的
 * 每一个字段。再发一次 `/pm_risk/detail/` 只会多要一个 `…:detail` 权限 ——
 * 有 update 没 detail 的角色会打开一个「加载风险详情失败」的废弹窗。
 */
function toFormValues(row: RiskOut | undefined): Partial<RiskFormValues> {
  return {
    project_id: row?.project_id ?? undefined,
    title: row?.title ?? undefined,
    description: row?.description ?? undefined,
    category_code: row?.category_code ?? undefined,
    probability: row?.probability ?? undefined,
    impact: row?.impact ?? undefined,
    status_code: row?.status_code ?? undefined,
    owner_id: row?.owner_id ?? undefined,
    mitigation_plan: row?.mitigation_plan ?? undefined,
    contingency_plan: row?.contingency_plan ?? undefined,
    due_date: row?.due_date ?? undefined,
    trigger_date: row?.trigger_date ?? undefined,
  };
}

/**
 * 表单值 → 后端入参。
 *
 * 库里九个 **NOT NULL** 列一个都不能少(后端 `create_service` 不做兜底,
 * 直接 `CRUD.create(data=data)` ⇒ 少一个就是 INSERT NULL,新增必然 500):
 *
 * `project_id` / `title` / `category_code` / `probability` / `impact` /
 * `score` / `status_code` / `owner_id` / `created_via_code`
 *
 * 两个是**算出来/定死**的,不是用户填的:
 *
 * - `score` = 概率 × 影响(INV-08):后端**只存不算**,由前端算好送进去;
 *   概率与影响是人可改的,所以分数每次提交都跟着重算
 * - `created_via_code`:人登记的风险是「手动」(`manual`;字典里另一项是
 *   `ai_suggested`)。更新时**原样回传行里的值** —— 它不是用户可编辑的,
 *   但后端 UpdateSchema 继承 CreateSchema、这一列是必填,不带就 422
 *
 * 可空的列带 null:更新是**整对象 PUT**,带 null 才是「清空」,
 * 不带则是原样保留库里的值。
 */
function toPayload(
  values: RiskFormValues,
  createdViaCode: string,
): RiskCreateParams {
  return {
    project_id: values.project_id,
    title: values.title,
    description: values.description ?? null,
    category_code: values.category_code,
    probability: values.probability,
    impact: values.impact,
    score: values.probability * values.impact,
    status_code: values.status_code,
    owner_id: values.owner_id,
    mitigation_plan: values.mitigation_plan ?? null,
    contingency_plan: values.contingency_plan ?? null,
    due_date: values.due_date ?? null,
    trigger_date: values.trigger_date ?? null,
    created_via_code: createdViaCode,
  };
}

/**
 * 风险表单。
 *
 * 后端的坑:
 * - 更新是**整对象 PUT**(UpdateSchema 继承 CreateSchema,没有 PATCH),
 *   缺必填字段就 422 ⇒ 编辑时表单必须拿齐全部必填字段
 * - 编辑**直接用列表行填表**:列表返回的 `ModulePmRiskOutSchema` 继承
 *   CreateSchema,行里已经带着表单要的每一个字段 —— 不发详情请求,
 *   于是编辑只要 `…:update` 一个权限(详情接口另要 `…:detail`)
 * - `score` 后端**不算**,由前端按概率 × 影响算好送进去
 * - `created_via_code` 不是用户可编辑的:新增固定「手动」,
 *   编辑原样回传行里的值(AI 建议登记的风险不会被改成「手动」)
 */
const RiskModalForm: React.FC<RiskModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  // 编辑对象的 id(新增时是 null)
  const editing = record?.id != null;

  return (
    <ModalForm<RiskFormValues>
      title={editing ? '编辑风险' : '新增风险'}
      open={open}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      // 顺带保证每次打开都是一张干净的表单(不会带上一次的残留值)
      modalProps={{ destroyOnHidden: true }}
      // 表单值直接来自列表行(编辑)或空(新增)—— 同步就有,不用等详情
      initialValues={toFormValues(record)}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 创建方式不是用户可编辑的:新增固定「手动」,编辑原样回传行里的值
        const createdViaCode = editing
          ? (record?.created_via_code ?? 'manual')
          : 'manual';
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(toPayload(values, createdViaCode));
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
          远程搜索:候选来自 listProjects(候选可能很多,不做侧载)。
          ProFormSelect 默认 showSearch: true,与列级 select 不同
          (列级必须显式开,见工单页处理人列的注释)。
        */
        request={fetchProjectOptions}
      />
      <ProFormText
        name="title"
        label="风险标题"
        rules={[{ required: true, message: '请输入风险标题' }]}
      />
      <ProFormTextArea
        name="description"
        label="风险描述"
        fieldProps={{ rows: 3, placeholder: '支持 Markdown' }}
      />
      <ProForm.Item
        name="category_code"
        label="分类"
        rules={[{ required: true, message: '请选择分类' }]}
      >
        {/* value/onChange 都是线上码(dict_value),提交「进度」后端就是 422 */}
        <DictSelect dictType="module_pm_risk_category" />
      </ProForm.Item>
      {/* 概率与影响都是 1-5:用下拉,免得填出后端不认的值 */}
      <ProFormSelect
        name="probability"
        label="概率"
        options={SCALE_OPTIONS}
        fieldProps={{ placeholder: '选择概率(1-5)' }}
        rules={[{ required: true, message: '请选择概率' }]}
      />
      <ProFormSelect
        name="impact"
        label="影响"
        options={SCALE_OPTIONS}
        fieldProps={{ placeholder: '选择影响(1-5)' }}
        rules={[{ required: true, message: '请选择影响' }]}
      />
      <ProForm.Item
        name="status_code"
        label="状态"
        rules={[{ required: true, message: '请选择状态' }]}
      >
        <DictSelect dictType="module_pm_risk_status" />
      </ProForm.Item>
      <ProFormSelect
        name="owner_id"
        label="负责人"
        showSearch
        debounceTime={300}
        fieldProps={{ placeholder: '输入姓名搜索' }}
        rules={[{ required: true, message: '请选择负责人' }]}
        request={fetchUserOptions}
      />
      <ProFormTextArea
        name="mitigation_plan"
        label="缓解措施"
        fieldProps={{ rows: 2 }}
      />
      <ProFormTextArea
        name="contingency_plan"
        label="应急计划"
        fieldProps={{ rows: 2 }}
      />
      {/* ModalForm 默认 dateFormatter='string',提交的就是 YYYY-MM-DD 字符串 */}
      <ProFormDatePicker
        name="due_date"
        label="缓解措施截止"
        fieldProps={{ placeholder: '缓解措施截止日期' }}
      />
      {/* 升级触发时间是 datetime(后端是 DateTime 列) */}
      <ProFormDateTimePicker
        name="trigger_date"
        label="升级触发时间"
        fieldProps={{ placeholder: '升级触发时间' }}
      />
    </ModalForm>
  );
};

export default RiskModalForm;
