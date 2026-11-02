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
  NoticeCreateParams,
  NoticeOut,
} from '@/services/api/system/notice';
import {
  createNotice,
  deleteNotices,
  listNotices,
  updateNotice,
} from '@/services/api/system/notice';
import { toProTableRequest } from '@/services/paginate';
import NoticeModalForm from './ModalForm';

const requestNotices = toProTableRequest<NoticeOut>(listNotices);

/**
 * 公告管理 —— 后端菜单 route_path=/system/notice,component_path=module_system/notice/index。
 *
 * 骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」。
 */
const NoticeManagement: React.FC = () => {
  const access = useAccess();

  const crud = useCrudTable<NoticeOut, NoticeCreateParams>({
    create: createNotice,
    update: updateNotice,
    remove: deleteNotices,
  });

  const columns: ProColumns<NoticeOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '公告标题',
      dataIndex: 'notice_title',
      width: 200,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '公告类型',
      dataIndex: 'notice_type',
      width: 120,
      // 后端 notice_type 是普通字符串(没有枚举)⇒ 搜索框用自由文本,
      // 不做成受限下拉,否则搜不到不在候选列表里的类型
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        0: { text: '正常', status: 'Success' },
        1: { text: '禁用', status: 'Default' },
      },
    },
    { title: '创建时间', dataIndex: 'created_time', width: 180, search: false },
  ];

  const operationColumns = useCrudColumns<NoticeOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_system:notice:update',
    deletePerm: 'module_system:notice:delete',
    entityName: '公告',
  });

  return (
    <>
      <ProTable<NoticeOut>
        headerTitle="公告管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestNotices}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!access.hasPermission('module_system:notice:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <NoticeModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </>
  );
};

export default NoticeManagement;
