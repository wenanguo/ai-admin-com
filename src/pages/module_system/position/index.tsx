import { PlusOutlined } from '@ant-design/icons';
import type { ActionType } from '@ant-design/pro-components';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Popconfirm } from 'antd';
import type React from 'react';
import { useRef, useState } from 'react';
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
 * 后续新增业务页面按同一范式复制本文件。
 */
const PositionManagement: React.FC = () => {
  const access = useAccess();
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PositionOut | undefined>(undefined);

  const handleDelete = async (record: PositionOut) => {
    if (!record.id) return;
    try {
      await deletePositions([record.id]);
      // 成功提示由请求层统一弹(后端信封里的 msg),这里不要再弹一次
      actionRef.current?.reload();
    } catch {
      // 失败提示也由请求层统一弹,这里只需要把异常消化掉
    }
  };

  const handleEdit = (record: PositionOut) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditing(undefined);
    setModalOpen(true);
  };

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
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, record) => [
        <Button
          key="edit"
          type="link"
          size="small"
          disabled={!access.hasPermission('module_system:position:update')}
          onClick={() => handleEdit(record)}
        >
          编辑
        </Button>,
        <Popconfirm
          key="delete"
          title="确认删除该岗位?"
          onConfirm={() => handleDelete(record)}
          disabled={!access.hasPermission('module_system:position:delete')}
        >
          <Button
            type="link"
            size="small"
            danger
            disabled={!access.hasPermission('module_system:position:delete')}
          >
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <>
      <ProTable<PositionOut>
        headerTitle="岗位管理"
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        request={requestPositions}
        search={{ labelWidth: 80 }}
        pagination={{
          defaultPageSize: 10,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
        }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!access.hasPermission('module_system:position:create')}
            onClick={handleCreate}
          >
            新增
          </Button>,
        ]}
      />
      <PositionModalForm
        open={modalOpen}
        record={editing}
        onOpenChange={setModalOpen}
        onSubmit={async (values: PositionCreateParams) => {
          try {
            if (editing?.id) {
              await updatePosition(editing.id, values);
            } else {
              await createPosition(values);
            }
            actionRef.current?.reload();
            return true;
          } catch {
            return false;
          }
        }}
      />
    </>
  );
};

export default PositionManagement;
