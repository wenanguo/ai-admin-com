/**
 * **里程碑**的列定义(共享)。
 *
 * ## 为什么抽出来
 *
 * 里程碑出现在两个地方：独立页 `/pm/milestone` 与项目详情页的「里程碑」页签。
 * 以前两边各写一份 ⇒ 改一个字段要改两个地方，而且两边**字段还不一样**
 * （详情页是卡片，没有「所属项目/健康度/排序」）。
 *
 * ⇒ 列定义收在这里，**一处**定义、两处使用。
 */
import type {
  ProColumns,
  ProFieldValueEnumType,
} from '@ant-design/pro-components';
import { Progress, Tooltip } from 'antd';
import { DictTag } from '@/components/pm/DictTag';
import {
  RULE_ENGINE_STATUSES,
  RULE_ENGINE_TOOLTIP,
} from '@/components/pm/ruleEngineStatus';
import type { MilestoneOut } from '@/services/api/pm/milestone';

/** 里程碑列的选项。 */
export interface MilestoneColumnsOptions {
  /** 状态的搜索下拉枚举 */
  statusValueEnum?: ProFieldValueEnumType;
  /**
   * 隐藏「所属项目」列。
   *
   * ⚠️ 项目详情页的「里程碑」页签里它就是当前项目 ⇒ 冗余。
   */
  hideProject?: boolean;
}

/**
 * 里程碑状态。
 *
 * ⚠️ 里程碑的状态**有两条规则独占写的**（规则引擎写的两个状态不能由用户改），
 *    所以这里不是简单的 DictTag —— 用共享的 `StatusCell` 那套渲染。
 */
function StatusCell({ value }: { value?: string | null }) {
  const tag = <DictTag dictType="module_pm_milestone_status" value={value} />;
  if (!value || !RULE_ENGINE_STATUSES.includes(value)) return tag;
  // Tooltip 的子元素要能接收事件与 ref —— DictTag 是函数组件、不透传
  // 未知属性,所以外面包一层 span(事件落在 span 上)。
  return (
    <Tooltip title={RULE_ENGINE_TOOLTIP}>
      <span>{tag}</span>
    </Tooltip>
  );
}

/**
 * 里程碑的列定义。
 *
 * @param options 字典枚举、要显示哪些列
 * @returns 列定义（**不含操作列** —— 操作列由页面追加）
 */
export function milestoneColumns(
  options: MilestoneColumnsOptions = {},
): ProColumns<MilestoneOut>[] {
  const { statusValueEnum, hideProject } = options;

  const columns: ProColumns<MilestoneOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '里程碑名称',
      dataIndex: 'name',
      width: 200,
      fieldProps: { placeholder: '支持模糊查询' },
    },
  ];

  if (!hideProject) {
    columns.push({
      title: '所属项目',
      dataIndex: 'project_id',
      width: 160,
      search: false,
      // 表格里读后端随行返回的 project_by 冗余字段,不用再查项目表
      render: (_, record) => record.project_by?.name ?? '-',
    });
  }

  columns.push(
    {
      title: '状态',
      dataIndex: 'status_code',
      width: 120,
      // 搜索下拉给全部五个状态:筛选是只读用途,规则独占写的两个状态也能筛
      valueEnum: statusValueEnum,
      render: (_, record) => <StatusCell value={record.status_code} />,
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 160,
      search: false,
      // progress 是后端缓存的派生字段,前端不重算
      render: (_, record) =>
        record.progress == null ? (
          '-'
        ) : (
          <Progress percent={record.progress} size="small" />
        ),
    },
    {
      title: '健康度',
      dataIndex: 'health_score',
      width: 100,
      search: false,
      render: (_, record) => record.health_score ?? '-',
    },
    {
      title: '计划区间',
      dataIndex: 'start_date',
      width: 200,
      search: false,
      render: (_, record) =>
        `${record.start_date ?? '-'} ~ ${record.due_date ?? '-'}`,
    },
    {
      title: '实际区间',
      dataIndex: 'actual_start_date',
      width: 200,
      search: false,
      render: (_, record) =>
        `${record.actual_start_date ?? '-'} ~ ${record.actual_end_date ?? '-'}`,
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 80,
      search: false,
    },
  );

  return columns;
}
