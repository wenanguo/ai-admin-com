import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button } from 'antd';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import type {
  TicketCreateParams,
  TicketOut,
  TicketStatus,
} from '@/services/api/system/ticket';
import {
  batchUpdateTickets,
  createTicket,
  deleteTickets,
  listTickets,
  updateTicket,
} from '@/services/api/system/ticket';
import { listUsers } from '@/services/api/system/user';
import { toProTableRequest } from '@/services/paginate';
import TicketModalForm, {
  TICKET_STATUS_OPTIONS,
  TicketBatchModalForm,
} from './ModalForm';

const requestTickets = toProTableRequest<TicketOut>(listTickets);

/**
 * 状态徽标 —— 与表格 valueEnum 的取值一一对应
 * (0 待处理 / 1 处理中 / 2 已完成 / 3 已关闭)。
 */
const TICKET_STATUS_BADGE: Record<
  TicketStatus,
  'Default' | 'Processing' | 'Success'
> = {
  0: 'Default',
  1: 'Processing',
  2: 'Success',
  3: 'Default',
};

/**
 * 工单管理 —— 后端菜单 route_path=/system/ticket,component_path=module_system/ticket/index。
 *
 * 骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」。后续新增业务页面按同一范式。
 */
const TicketManagement: React.FC = () => {
  const access = useAccess();

  const crud = useCrudTable<TicketOut, TicketCreateParams>({
    create: createTicket,
    update: updateTicket,
    remove: deleteTickets,
  });

  // 批量更新:先勾选行,再选目标状态
  const [selectedRows, setSelectedRows] = useState<TicketOut[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);

  const selectedIds = useMemo(
    () => selectedRows.flatMap((row) => (row.id == null ? [] : [row.id])),
    [selectedRows],
  );

  const openBatch = useCallback(() => setBatchOpen(true), []);

  // ⚠️ 必须**如实**反映 ModalForm 传过来的开关状态:
  // ModalForm 在打开时也会回调 onOpenChange(true),
  // 无条件置 false 会让弹窗一打开就被关掉
  const closeBatch = useCallback((open: boolean) => setBatchOpen(open), []);

  const handleBatchSubmit = useCallback(
    async (status: TicketStatus) => {
      try {
        // 批量更新 = 批量改状态:入参只有 { ids, status },方法 PUT
        await batchUpdateTickets({ ids: selectedIds, status });
        // 成功提示由请求层统一弹(后端信封里的 msg),这里不要再弹一次
        setSelectedRows([]);
        crud.actionRef.current?.reload();
        setBatchOpen(false);
        return true;
      } catch {
        // 失败提示也由请求层统一弹;返回 false 让弹窗保持打开
        return false;
      }
    },
    [crud.actionRef, selectedIds],
  );

  const columns: ProColumns<TicketOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '工单标题',
      dataIndex: 'title',
      width: 220,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '工单类型',
      dataIndex: 'ticket_type',
      width: 120,
      // 后端 TicketTypeEnum 的四个值(见 app/common/enums.py):
      // suggestion / bug / optimize / other
      valueEnum: {
        suggestion: { text: '建议' },
        bug: { text: '缺陷' },
        optimize: { text: '优化' },
        other: { text: '其他' },
      },
    },
    {
      title: '处理人',
      dataIndex: 'assigned_id',
      width: 140,
      valueType: 'select',
      /**
       * ⚠️ 列级 select **必须**显式开 showSearch,否则远程搜索是死代码。
       *
       * 列级 select 渲染的是普通 antd Select,能不能搜只看 fieldProps.showSearch:
       * 不开的话 rc-select 的输入框是 readOnly(readOnly: !showSearch),
       * onSearch 永远不触发 ⇒ ProComponents 不会带着关键字去请求,
       * 下拉里永远只有第一页(page_size: 100)那批人。
       *
       * (规格里写的 ProFormSelect 默认 showSearch: true,
       *  所以「ProFormSelect + 远程搜索」的写法没问题,换成列级 select 就必须补上。)
       */
      fieldProps: { showSearch: true },
      /**
       * 远程搜索防抖(毫秒)。ProComponents 的默认是 0 —— 每敲一个字发一次请求。
       */
      debounceTime: 300,
      /**
       * 搜索项:处理人是用户 —— 远程搜索,候选来自 listUsers。
       *
       * ⚠️ 这个接口在后端要 `module_system:user:query` 权限;
       *    没有这个权限时只有这一项搜索用不了,列表本身不受影响。
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
      // 表格里显示处理人的名字 —— 后端随工单一起返回 assigned_by,
      // 不用再查一次用户表。
      // ⚠️ assigned_by 可能是 null(工单还没指派处理人)⇒ 给个占位符,不能崩
      render: (_, record) => record.assigned_by?.name ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      // 后端 TicketBatchSchema.status 的 0..3,文案与批量更新弹窗共用
      // (TICKET_STATUS_OPTIONS)
      valueEnum: Object.fromEntries(
        TICKET_STATUS_OPTIONS.map((option) => [
          option.value,
          { text: option.label, status: TICKET_STATUS_BADGE[option.value] },
        ]),
      ),
    },
    { title: '创建时间', dataIndex: 'created_time', width: 180, search: false },
  ];

  const operationColumns = useCrudColumns<TicketOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_system:ticket:update',
    deletePerm: 'module_system:ticket:delete',
    entityName: '工单',
  });

  return (
    <>
      <ProTable<TicketOut>
        headerTitle="工单管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestTickets}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (_, rows) => setSelectedRows(rows),
        }}
        toolBarRender={() => [
          // 勾选了行才出现「批量更新」(后端只支持批量改状态)
          ...(selectedIds.length > 0
            ? [
                <Button
                  key="batch"
                  icon={<EditOutlined />}
                  disabled={
                    !access.hasPermission('module_system:ticket:update')
                  }
                  onClick={openBatch}
                >
                  批量更新
                </Button>,
              ]
            : []),
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!access.hasPermission('module_system:ticket:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <TicketModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
      <TicketBatchModalForm
        open={batchOpen}
        count={selectedIds.length}
        onOpenChange={closeBatch}
        onSubmit={handleBatchSubmit}
      />
    </>
  );
};

export default TicketManagement;
