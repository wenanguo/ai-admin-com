/**
 * **风险**的列定义(共享)。
 *
 * ## 为什么抽出来
 *
 * 风险出现在两个地方：独立页 `/pm/risk` 与项目详情页的「风险」页签。
 * 以前两边各写一份 ⇒ 改一个字段要改两个地方，而且两边**呈现形态还不一样**
 * （详情页是一个 List，不是表格）。
 *
 * ⇒ 列定义收在这里，**一处**定义、两处使用。
 */
import type {
  ProColumns,
  ProFieldValueEnumType,
} from '@ant-design/pro-components';
import { Tag } from 'antd';
import { DictTag } from '@/components/pm/DictTag';
import {
  RISK_LEVEL_COLOR,
  riskLevel,
  riskLevelLabel,
} from '@/components/pm/riskLevel';
import type { RiskOut } from '@/services/api/pm/risk';
import { listUsers } from '@/services/api/system/user';

/** 下拉选项(label 给人看，value 是实体 id) */
export interface ColumnOption {
  label: string;
  value: number;
}

/** 风险列的选项。 */
export interface RiskColumnsOptions {
  /** 状态的搜索下拉枚举 */
  statusValueEnum?: ProFieldValueEnumType;
  /** 分类的搜索下拉枚举 */
  categoryValueEnum?: ProFieldValueEnumType;
  /** 所属项目的下拉候选（搜索栏用） */
  projectOptions?: ColumnOption[];
  /** 项目 id → 项目名（侧载映射，响应里没有 project_by） */
  projectNames?: Map<number, string>;
  /**
   * 隐藏「所属项目」列。
   *
   * ⚠️ 项目详情页的「风险」页签里它就是当前项目 ⇒ 冗余。
   */
  hideProject?: boolean;
}

/**
 * id → 名字(查表,不发请求)。
 *
 * ⚠️ 侧载只拿到最新的 100 条 ⇒ 更早的项目**查不到名字**
 *    ⇒ 这时**退回显示 id**（不是空）—— 页面下方那条截断提示里也这么说的。
 */
function lookupProjectName(
  names: Map<number, string> | undefined,
  id?: number | null,
): string {
  if (id == null) return '-';
  return names?.get(id) ?? String(id);
}

/**
 * 风险的列定义。
 *
 * @param options 字典枚举、侧载映射、要显示哪些列
 * @returns 列定义（**不含操作列** —— 操作列由页面追加）
 */
export function riskColumns(
  options: RiskColumnsOptions = {},
): ProColumns<RiskOut>[] {
  const {
    statusValueEnum,
    categoryValueEnum,
    projectOptions,
    projectNames,
    hideProject,
  } = options;

  const columns: ProColumns<RiskOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '风险标题',
      dataIndex: 'title',
      width: 220,
      fieldProps: { placeholder: '支持模糊查询' },
    },
  ];

  if (!hideProject) {
    columns.push({
      title: '所属项目',
      dataIndex: 'project_id',
      width: 160,
      valueType: 'select',
      // 搜索下拉的候选来自侧载的项目列表(页面已经拉过,不再发请求)
      fieldProps: { options: projectOptions, showSearch: true },
      // 表格里显示的是侧载映射出来的项目名(响应里没有 project_by)
      render: (_, record) => lookupProjectName(projectNames, record.project_id),
    });
  }

  columns.push(
    {
      title: '分类',
      dataIndex: 'category_code',
      width: 100,
      valueEnum: categoryValueEnum,
      render: (_, record) => (
        <DictTag
          dictType="module_pm_risk_category"
          value={record.category_code}
        />
      ),
    },
    {
      // 概率与影响不进搜索栏:热力图就是它们的筛选器(两个维度要一起选)
      title: '概率',
      dataIndex: 'probability',
      width: 80,
      search: false,
      render: (_, record) => record.probability ?? '-',
    },
    {
      title: '影响',
      dataIndex: 'impact',
      width: 80,
      search: false,
      render: (_, record) => record.impact ?? '-',
    },
    {
      title: '分数',
      dataIndex: 'score',
      width: 80,
      search: false,
      render: (_, record) => record.score ?? '-',
    },
    {
      /*
        等级是**派生量**:后端只有 score(= 概率 × 影响),没有 level 字段 ——
        阈值在共享件 riskLevel 里,这一列只负责把分数翻译成等级标签。
        (刻意不给 dataIndex:分数列已经用了 score,两列不能共用一个键)
      */
      title: '等级',
      key: 'level',
      width: 90,
      search: false,
      render: (_, record) => {
        if (record.score == null) return '-';
        const level = riskLevel(record.score);
        return (
          <Tag color={RISK_LEVEL_COLOR[level]}>{riskLevelLabel(level)}</Tag>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status_code',
      width: 110,
      valueEnum: statusValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_risk_status" value={record.status_code} />
      ),
    },
    {
      title: '负责人',
      dataIndex: 'owner_id',
      width: 130,
      valueType: 'select',
      // ⚠️ 列级 select 必须显式开 showSearch,否则远程搜索是死代码
      // (rc-select 的输入框 readOnly,onSearch 永远不触发) —— 见工单页处理人列
      fieldProps: { showSearch: true },
      // 远程搜索防抖(毫秒);ProComponents 的默认是 0,每敲一个字发一次请求
      debounceTime: 300,
      /*
        搜索项:负责人是用户,候选来自 listUsers,按姓名远程搜。
        ⚠️ 这个接口在后端要 module_system:user:query 权限;
        没有这个权限时只有这一项搜索用不了,列表本身不受影响。
      */
      request: async ({ keyWords }: { keyWords?: string }) => {
        const keyword = keyWords?.trim();
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
      },
      // 表格里读后端随行返回的 owner_by 冗余字段,不用再查用户表
      render: (_, record) => record.owner_by?.name ?? '-',
    },
    {
      title: '缓解措施截止',
      dataIndex: 'due_date',
      width: 140,
      search: false,
      render: (_, record) => record.due_date ?? '-',
    },
    {
      /*
        创建方式没有字典(风险模块的字典只有分类与状态;库里这一列的值是
        manual / ai_suggested),所以显示原值,不套 DictTag。
      */
      title: '创建方式',
      dataIndex: 'created_via_code',
      width: 110,
      search: false,
      render: (_, record) => record.created_via_code ?? '-',
    },
  );

  return columns;
}
