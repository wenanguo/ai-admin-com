/**
 * **任务**的列定义(共享)。
 *
 * ## 为什么抽出来
 *
 * 任务列表出现在两个地方：
 * - 独立页 `/pm/task`（ProTable + 搜索 + 分页 + 增删改 + 看板/甘特切换）
 * - 项目详情页的「任务」页签（`/pm/project/:id`）
 *
 * ⚠️ 以前两边**各写一份**列定义 ⇒ 加一个字段要改两个地方，
 * 而且两边**字段还不一样**（详情页只有 5 列，列表页有 18 列）⇒ 「看起来不是同一个东西」。
 *
 * ⇒ 列定义收在这里，**一处**定义、两处使用。
 *
 * ## 用法
 *
 * ```tsx
 * const columns = [
 *   ...taskColumns({ statusValueEnum, projectNames, milestoneNames }),
 *   ...operationColumns,   // 操作列由页面自己接（它要 CRUD 的回调）
 * ];
 * ```
 *
 * ⚠️ **操作列不在这里**：它要页面的 `onEdit` / `onDelete` ⇒ 由页面追加。
 */
import { CommentOutlined } from '@ant-design/icons';
import type {
  ProColumns,
  ProFieldValueEnumType,
} from '@ant-design/pro-components';
import { Button } from 'antd';
import { DictTag } from '@/components/pm/DictTag';
import type { TaskOut } from '@/services/api/pm/task';
import { listUsers } from '@/services/api/system/user';

/** 下拉选项(label 给人看，value 是实体 id) */
export interface ColumnOption {
  label: string;
  value: number;
}

/** 任务列的选项。 */
export interface TaskColumnsOptions {
  /** 状态的搜索下拉枚举 */
  statusValueEnum?: ProFieldValueEnumType;
  /** 优先级的搜索下拉枚举 */
  priorityValueEnum?: ProFieldValueEnumType;
  /** 类型的搜索下拉枚举 */
  typeValueEnum?: ProFieldValueEnumType;
  /** 所属项目的下拉候选（搜索栏用） */
  projectOptions?: ColumnOption[];
  /** 项目 id → 项目名（侧载映射，响应里没有 project_by） */
  projectNames?: Map<number, string>;
  /** 里程碑 id → 里程碑名（侧载映射，响应里没有 milestone_by） */
  milestoneNames?: Map<number, string>;
  /**
   * 「与 AI 讨论」的回调。
   *
   * ⚠️ **给了才有那一列**：详情页的项目任务里不重复提供讨论入口
   *    （讨论对象就是当前项目 ⇒ 没有意义）。
   */
  onDiscuss?: (record: TaskOut) => void;
  /**
   * 隐藏「所属项目」列。
   *
   * ⚠️ 项目详情页的「任务」页签里它就是当前项目 ⇒ 冗余。
   */
  hideProject?: boolean;
}

/** id → 名字（查表，不发请求）。 */
function lookupName(
  names: Map<number, string> | undefined,
  id?: number | null,
): string {
  if (id == null) return '-';
  return names?.get(id) ?? '-';
}

/**
 * 任务的列定义。
 *
 * @param options 字典枚举、侧载映射、要显示哪些列
 * @returns 列定义（**不含操作列** —— 操作列由页面追加）
 */
export function taskColumns(
  options: TaskColumnsOptions = {},
): ProColumns<TaskOut>[] {
  const {
    statusValueEnum,
    priorityValueEnum,
    typeValueEnum,
    projectOptions,
    projectNames,
    milestoneNames,
    onDiscuss,
    hideProject,
  } = options;

  const columns: ProColumns<TaskOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
  ];

  if (onDiscuss) {
    columns.push({
      /**
       * 「与 AI 讨论」入口。
       *
       * ⚠️ 放在**操作列前面**、单独一列：讨论**不改数据** ⇒ 不该跟
       *    「编辑/删除」挤在一起（那两个是有破坏性的）。
       */
      title: '与 AI 讨论',
      dataIndex: 'id',
      width: 110,
      search: false,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<CommentOutlined />}
          onClick={() => onDiscuss(record)}
        >
          讨论
        </Button>
      ),
    });
  }

  columns.push({
    title: '任务标题',
    dataIndex: 'title',
    width: 220,
    fieldProps: { placeholder: '支持模糊查询' },
  });

  if (!hideProject) {
    columns.push({
      title: '所属项目',
      dataIndex: 'project_id',
      width: 160,
      valueType: 'select',
      // 搜索下拉的候选来自侧载的项目列表(页面已经拉过,不再发请求)
      fieldProps: { options: projectOptions, showSearch: true },
      // 表格里显示的是侧载映射出来的项目名(响应里没有 project_by)
      render: (_, record) => lookupName(projectNames, record.project_id),
    });
  }

  columns.push(
    {
      title: '所属里程碑',
      dataIndex: 'milestone_id',
      width: 160,
      search: false,
      render: (_, record) => lookupName(milestoneNames, record.milestone_id),
    },
    {
      title: '状态',
      dataIndex: 'status_code',
      width: 110,
      valueEnum: statusValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_task_status" value={record.status_code} />
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority_code',
      width: 100,
      valueEnum: priorityValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_priority" value={record.priority_code} />
      ),
    },
    {
      title: '类型',
      dataIndex: 'type_code',
      width: 100,
      valueEnum: typeValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_task_type" value={record.type_code} />
      ),
    },
    {
      title: '负责人',
      dataIndex: 'assignee_id',
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
      // 表格里读后端随行返回的 assignee_by 冗余字段,不用再查用户表
      render: (_, record) => record.assignee_by?.name ?? '-',
    },
    {
      title: '报告人',
      dataIndex: 'reporter_id',
      width: 130,
      search: false,
      render: (_, record) => record.reporter_by?.name ?? '-',
    },
    {
      title: '计划起止',
      dataIndex: 'start_date',
      width: 200,
      search: false,
      render: (_, record) =>
        `${record.start_date ?? '-'} ~ ${record.due_date ?? '-'}`,
    },
    {
      title: '实际起止',
      dataIndex: 'actual_start_date',
      width: 200,
      search: false,
      render: (_, record) =>
        `${record.actual_start_date ?? '-'} ~ ${record.actual_end_date ?? '-'}`,
    },
    {
      title: '估时',
      dataIndex: 'estimate_hours',
      width: 90,
      search: false,
      render: (_, record) => record.estimate_hours ?? '-',
    },
    {
      title: '实际工时',
      dataIndex: 'actual_hours',
      width: 100,
      search: false,
      render: (_, record) => record.actual_hours ?? '-',
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 80,
      search: false,
      render: (_, record) => record.sort_order ?? '-',
    },
    {
      title: '阻塞原因',
      dataIndex: 'blocked_reason',
      width: 180,
      search: false,
      render: (_, record) => record.blocked_reason ?? '-',
    },
    {
      // 创建方式有字典(module_pm_task_created_via:manual/nl_chat/import/api),
      // 跟其它字典列一样渲染成中文标签
      title: '创建方式',
      dataIndex: 'created_via_code',
      width: 110,
      search: false,
      render: (_, record) => (
        <DictTag
          dictType="module_pm_task_created_via"
          value={record.created_via_code}
        />
      ),
    },
  );

  return columns;
}
