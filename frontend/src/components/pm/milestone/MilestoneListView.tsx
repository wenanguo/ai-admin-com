/**
 * **里程碑列表界面**（独立页与项目详情页共用）。
 *
 * ## 为什么抽出来
 *
 * 里程碑列表出现在两个地方：
 * - 菜单里的「里程碑」（`/pm/milestone`）—— **全部项目**的里程碑
 * - 项目详情页的「里程碑」页签 —— **当前这个项目**的里程碑
 *
 * ⚠️ 以前这是**两个各写各的页面**：一个是表格，另一个是卡片列表
 * ⇒ 用户看着像两个不同的页面，而且改一个字段要改两个地方。
 *
 * ⇒ 现在是**同一个组件**，唯一的差别是 `projectId`。
 */
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
import MilestoneModalForm from '@/components/pm/milestone/MilestoneModalForm';
import { toValueEnum } from '@/components/pm/toValueEnum';
import { useDictOptions } from '@/components/pm/useDictOptions';
import type {
  MilestoneCreateParams,
  MilestoneOut,
  MilestoneUpdateParams,
} from '@/services/api/pm/milestone';
import {
  createMilestone,
  deleteMilestones,
  listMilestones,
  updateMilestone,
} from '@/services/api/pm/milestone';
import { toProTableRequest } from '@/services/paginate';

const requestMilestones = toProTableRequest<MilestoneOut>(listMilestones);

/**
 * 竖排时间线的行序（后端默认按 id，那是录入顺序）。
 */
const TIMELINE_ORDER_BY = JSON.stringify([
  { due_date: 'asc' },
  { sort_order: 'asc' },
  { start_date: 'asc' },
]);

/** 里程碑列表界面的 props。 */
export interface MilestoneListViewProps {
  /**
   * 限定到某个项目。
   *
   * ⚠️ **不传 = 全部项目**（菜单里的入口）；传了 = 只看这个项目
   *    （项目详情页的「里程碑」页签）。
   */
  projectId?: number;
}

/**
 * 里程碑列表界面。
 *
 * 骨架逻辑（操作列 / 分页）在共享脚手架 `@/components/CrudTable` 里，
 * 这里只留「列定义 + service 调用 + 声明式 JSX」，与其它模块同范式。
 *
 * @param props `projectId` 限定项目；不传就是全部
 */
export function MilestoneListView({
  projectId,
}: MilestoneListViewProps): React.ReactElement {
  const access = useAccess();

  const crud = useCrudTable<
    MilestoneOut,
    MilestoneCreateParams | MilestoneUpdateParams
  >({
    create: createMilestone,
    update: updateMilestone,
    remove: deleteMilestones,
  });

  // 字典选项:表格标签(DictTag 内部也用它)与搜索下拉(valueEnum)共用,
  // useDictOptions 有模块级缓存,这里只发一次请求
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
        // ⚠️ **项目限定**：项目详情页的页签传了 projectId ⇒ 只看这个项目；
        //    菜单里的入口不传 ⇒ 全部项目。
        // 竖排时间线的行序(后端默认按 id,那是录入顺序)
        params={{
          order_by: TIMELINE_ORDER_BY,
          ...(projectId ? { project_id: projectId } : {}),
        }}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
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
}
