import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button } from 'antd';
import type React from 'react';
import { useMemo } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import { milestoneColumns } from '@/components/pm/columns/milestone';
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
    ...milestoneColumns({ statusValueEnum }),
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
