import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Progress, Tooltip } from 'antd';
import type React from 'react';
import { useMemo } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import { DictTag } from '@/components/pm/DictTag';
import { toValueEnum } from '@/components/pm/toValueEnum';
import { useDictOptions } from '@/components/pm/useDictOptions';
import type {
  MilestoneCreateParams,
  MilestoneOut,
} from '@/services/api/pm/milestone';
import {
  createMilestone,
  deleteMilestones,
  listMilestones,
  updateMilestone,
} from '@/services/api/pm/milestone';
import { toProTableRequest } from '@/services/paginate';
import { RULE_ENGINE_STATUSES, RULE_ENGINE_TOOLTIP } from './constants';
import MilestoneModalForm from './ModalForm';

const requestMilestones = toProTableRequest<MilestoneOut>(listMilestones);

/**
 * 竖排时间线的阅读顺序:显示排序 → 计划开始日。
 *
 * 后端的默认排序是 id,那是「录入顺序」不是「时间线顺序」——
 * 里程碑页是竖着读的时间线,行序必须由前端显式指定。
 * 后端协议:order_by 是 JSON 字符串的 [{字段: 'asc'|'desc'}] 数组。
 */
const TIMELINE_ORDER_BY = JSON.stringify([
  { sort_order: 'asc' },
  { start_date: 'asc' },
]);

/**
 * 状态列:规则独占的状态(at_risk/missed)加一句说明,
 * 免得有人以为是手工设的(INV-13)。
 *
 * Tooltip 的子元素要能接收事件与 ref —— DictTag 是函数组件、不透传
 * 未知属性,所以外面包一层 span(事件落在 span 上)。
 */
function StatusCell({ value }: { value?: string | null }) {
  const tag = <DictTag dictType="module_pm_milestone_status" value={value} />;
  if (!value || !RULE_ENGINE_STATUSES.includes(value)) return tag;
  return (
    <Tooltip title={RULE_ENGINE_TOOLTIP}>
      <span>{tag}</span>
    </Tooltip>
  );
}

/**
 * 里程碑管理页 —— 路由 /pm/milestone(菜单由后端下发,目录挂在 /pm 下)。
 *
 * v1 是**竖排时间线**(行按「显示排序 → 计划开始日」纵向读),不做甘特 ——
 * 甘特是 v1.1 的事(见 AIPM 前端设计 §5.2)。
 *
 * 骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」,与其它模块同范式。
 *
 * 两个字段是**后端算的**,前端只显示不重算:
 * - `progress`:后端按任务完成率算好并缓存的进度(0-100)
 * - `health_score`:后端的健康度(0-100)
 */
const MilestoneManagement: React.FC = () => {
  const access = useAccess();

  const crud = useCrudTable<MilestoneOut, MilestoneCreateParams>({
    create: createMilestone,
    update: updateMilestone,
    remove: deleteMilestones,
  });

  // 字典选项:表格标签(DictTag 内部也用它)与搜索下拉(valueEnum)共用,
  // useDictOptions 有模块级缓存,这里两种类型只发一次请求
  const { options: statusOptions } = useDictOptions(
    'module_pm_milestone_status',
  );

  const statusValueEnum = useMemo(
    () => toValueEnum(statusOptions),
    [statusOptions],
  );

  const columns: ProColumns<MilestoneOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '里程碑名称',
      dataIndex: 'name',
      width: 200,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '所属项目',
      dataIndex: 'project_id',
      width: 160,
      search: false,
      // 表格里读后端随行返回的 project_by 冗余字段,不用再查项目表
      render: (_, record) => record.project_by?.name ?? '-',
    },
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
  ];

  const operationColumns = useCrudColumns<MilestoneOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_pm_project:pm_milestone:update',
    deletePerm: 'module_pm_project:pm_milestone:delete',
    entityName: '里程碑',
  });

  return (
    <>
      <ProTable<MilestoneOut>
        headerTitle="里程碑管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestMilestones}
        // 竖排时间线的行序(后端默认按 id,那是录入顺序)
        params={{ order_by: TIMELINE_ORDER_BY }}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        // (内容区被右侧的 AI 工作台占掉一块,列宽被压到最小就会这样)
        scroll={{ x: 'max-content' }}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={
              !access.hasPermission('module_pm_project:pm_milestone:create')
            }
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <MilestoneModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </>
  );
};

export default MilestoneManagement;
