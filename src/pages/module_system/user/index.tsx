import { PlusOutlined } from '@ant-design/icons';
import type { ActionType } from '@ant-design/pro-components';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Popconfirm } from 'antd';
import type React from 'react';
import { useRef, useState } from 'react';
import type { UserCreateParams, UserOut } from '@/services/api/system/types';
import {
  createUser,
  deleteUsers,
  listUsers,
  updateUser,
} from '@/services/api/system/user';
import { toProTableRequest } from '@/services/paginate';
import UserModalForm from './ModalForm';

const requestUsers = toProTableRequest<UserOut>(listUsers);

/**
 * 用户管理 —— 后端菜单 route_path=/system/user,component_path=module_system/user/index。
 * 后续新增业务页面按同一范式复制本文件。
 */
const UserManagement: React.FC = () => {
  const access = useAccess();
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserOut | undefined>(undefined);

  const handleDelete = async (record: UserOut) => {
    if (!record.id) return;
    await deleteUsers([record.id]);
    // 成功提示由请求层统一弹(后端信封里的 msg),这里不要再弹一次
    actionRef.current?.reload();
  };

  const handleEdit = (record: UserOut) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditing(undefined);
    setModalOpen(true);
  };

  const columns: ProColumns<UserOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '用户名',
      dataIndex: 'username',
      width: 160,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    { title: '姓名', dataIndex: 'name', width: 120 },
    {
      title: '手机号',
      dataIndex: 'mobile',
      width: 140,
      // 后端 UserQueryParam.mobile 有严格正则,这里先在前端挡掉非法值,避免请求直接 422
      formItemProps: {
        rules: [
          {
            pattern: /^1[3-9]\d{9}$/,
            message: '手机号格式不正确',
          },
        ],
      },
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 200,
      formItemProps: {
        rules: [
          {
            pattern: /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/,
            message: '邮箱格式不正确',
          },
        ],
      },
    },
    { title: '部门', dataIndex: 'dept_name', width: 140, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        0: { text: '正常', status: 'Success' },
        1: { text: '禁用', status: 'Default' },
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_time',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, record) => [
        <Button
          key="edit"
          type="link"
          size="small"
          disabled={!access.hasPermission('module_system:user:update')}
          onClick={() => handleEdit(record)}
        >
          编辑
        </Button>,
        <Popconfirm
          key="delete"
          title="确认删除该用户?"
          onConfirm={() => handleDelete(record)}
          disabled={!access.hasPermission('module_system:user:delete')}
        >
          <Button
            type="link"
            size="small"
            danger
            disabled={!access.hasPermission('module_system:user:delete')}
          >
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <>
      <ProTable<UserOut>
        headerTitle="用户管理"
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        request={requestUsers}
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
            disabled={!access.hasPermission('module_system:user:create')}
            onClick={handleCreate}
          >
            新增
          </Button>,
        ]}
      />
      <UserModalForm
        open={modalOpen}
        record={editing}
        onOpenChange={setModalOpen}
        onSubmit={async (values: UserCreateParams) => {
          try {
            if (editing?.id) {
              await updateUser(editing.id, values);
            } else {
              await createUser(values);
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

export default UserManagement;
