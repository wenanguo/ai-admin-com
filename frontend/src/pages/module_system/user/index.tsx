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
 *
 * 骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」。
 */
const UserManagement: React.FC = () => {
  const access = useAccess();

  const crud = useCrudTable<UserOut, UserCreateParams>({
    create: createUser,
    // 更新时后端 UserUpdateSchema 里没有 password(只有创建才要密码),
    // 所以这里把 password 剥掉,别把明文密码发到更新接口
    update: async (id, values) => {
      const { password, ...rest } = values;
      return updateUser(id, rest);
    },
    remove: deleteUsers,
  });

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
  ];

  const operationColumns = useCrudColumns<UserOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_system:user:update',
    deletePerm: 'module_system:user:delete',
    entityName: '用户',
  });

  return (
    <>
      <ProTable<UserOut>
        headerTitle="用户管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestUsers}
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
            disabled={!access.hasPermission('module_system:user:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <UserModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </>
  );
};

export default UserManagement;
