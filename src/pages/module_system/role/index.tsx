import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Popconfirm } from 'antd';
import type React from 'react';
import { useCallback, useState } from 'react';
import { CRUD_PAGINATION, useCrudTable } from '@/components/CrudTable';
import {
  createRole,
  deleteRoles,
  listRoles,
  updateRole,
} from '@/services/api/system/role';
import type { RoleCreateParams, RoleOut } from '@/services/api/system/types';
import { toProTableRequest } from '@/services/paginate';
import RoleModalForm, { DATA_SCOPE_OPTIONS } from './ModalForm';
import RolePermissionModal from './PermissionModal';

const requestRoles = toProTableRequest<RoleOut>(listRoles);

/**
 * 角色管理 —— 后端菜单 route_path=/system/role,component_path=module_system/role。
 *
 * 骨架逻辑(状态机 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」。
 */
const RoleManagement: React.FC = () => {
  const access = useAccess();

  const crud = useCrudTable<RoleOut, RoleCreateParams>({
    create: createRole,
    update: updateRole,
    remove: deleteRoles,
  });

  // 授权弹窗:被授权的角色 + 开关
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [permissionTarget, setPermissionTarget] = useState<RoleOut | undefined>(
    undefined,
  );

  const openPermission = useCallback((record: RoleOut) => {
    setPermissionTarget(record);
    setPermissionOpen(true);
  }, []);

  const closePermission = useCallback((open: boolean) => {
    setPermissionOpen(open);
  }, []);

  const columns: ProColumns<RoleOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '角色名称',
      dataIndex: 'name',
      width: 160,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '角色编码',
      dataIndex: 'code',
      width: 160,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    { title: '排序', dataIndex: 'order', width: 90, search: false },
    {
      title: '数据权限',
      dataIndex: 'data_scope',
      width: 140,
      search: false,
      // 文案与表单里的下拉共用一份(见 ModalForm 的 DATA_SCOPE_OPTIONS)
      valueEnum: Object.fromEntries(
        DATA_SCOPE_OPTIONS.map((option) => [
          option.value,
          { text: option.label },
        ]),
      ),
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
    { title: '描述', dataIndex: 'description', width: 200, search: false },
    { title: '创建时间', dataIndex: 'created_time', width: 180, search: false },
  ];

  /**
   * 操作列:编辑 / 授权 / 删除。
   *
   * 共享脚手架的 useCrudColumns 表达的是「编辑 + 删除」两个入口,
   * 角色页多一个「授权」(PUT /system/role/permission)——
   * 扩展脚手架不在本任务范围内,所以这里自己写这一列,
   * 但权限门控与删除二次确认仍然照脚手架的写法来。
   */
  const operationColumns: ProColumns<RoleOut>[] = [
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      render: (_, record) => [
        <Button
          key="edit"
          type="link"
          size="small"
          disabled={!access.hasPermission('module_system:role:update')}
          onClick={() => crud.openEdit(record)}
        >
          编辑
        </Button>,
        <Button
          key="permission"
          type="link"
          size="small"
          disabled={!access.hasPermission('module_system:role:permission')}
          onClick={() => openPermission(record)}
        >
          授权
        </Button>,
        <Popconfirm
          key="delete"
          title="确认删除该角色?"
          onConfirm={() => crud.handleDelete(record)}
          disabled={!access.hasPermission('module_system:role:delete')}
        >
          <Button
            type="link"
            size="small"
            danger
            disabled={!access.hasPermission('module_system:role:delete')}
          >
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <>
      <ProTable<RoleOut>
        headerTitle="角色管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestRoles}
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
            disabled={!access.hasPermission('module_system:role:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <RoleModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
      <RolePermissionModal
        open={permissionOpen}
        record={permissionTarget}
        onOpenChange={closePermission}
      />
    </>
  );
};

export default RoleManagement;
