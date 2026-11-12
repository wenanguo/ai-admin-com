import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button } from 'antd';
import type React from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import type {
  PositionCreateParams,
  PositionOut,
} from '@/services/api/system/position';
import {
  createPosition,
  deletePositions,
  listPositions,
  updatePosition,
} from '@/services/api/system/position';
import { toProTableRequest } from '@/services/paginate';
import PositionModalForm from './ModalForm';

const requestPositions = toProTableRequest<PositionOut>(listPositions);

/**
 * 岗位管理 —— 后端菜单 route_path=/system/position,component_path=module_system/position/index。
 *
 * 骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」。后续新增业务页面按同一范式。
 */
const PositionManagement: React.FC = () => {
  const access = useAccess();

  const crud = useCrudTable<PositionOut, PositionCreateParams>({
    create: createPosition,
    update: updatePosition,
    remove: deletePositions,
  });

  const columns: ProColumns<PositionOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '岗位名称',
      dataIndex: 'name',
      width: 160,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    { title: '岗位编码', dataIndex: 'code', width: 160, search: false },
    { title: '排序', dataIndex: 'order', width: 100, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        0: { text: '正常', status: 'Success' },
        1: { text: '禁用', status: 'Default' },
      },
    },
    { title: '描述', dataIndex: 'description', width: 200, search: false },
    { title: '创建时间', dataIndex: 'created_time', width: 180, search: false },
  ];

  const operationColumns = useCrudColumns<PositionOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_system:position:update',
    deletePerm: 'module_system:position:delete',
    entityName: '岗位',
  });

  return (
    <>
      <ProTable<PositionOut>
        headerTitle="岗位管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestPositions}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        // (操作列 fixed:'right' ⇒ 必须有 scroll.x 才有粘性效果)
        scroll={{ x: 'max-content' }}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!access.hasPermission('module_system:position:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <PositionModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </>
  );
};

export default PositionManagement;
