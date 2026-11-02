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
import type { ParamCreateParams, ParamOut } from '@/services/api/system/param';
import {
  createParam,
  deleteParams,
  listParams,
  updateParam,
} from '@/services/api/system/param';
import { toProTableRequest } from '@/services/paginate';
import ParamModalForm from './ModalForm';

const requestParams = toProTableRequest<ParamOut>(listParams);

/**
 * 参数管理 —— 后端菜单 route_path=/system/param,component_path=module_system/params/index。
 *
 * 骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」。
 */
const ParamManagement: React.FC = () => {
  const access = useAccess();

  const crud = useCrudTable<ParamOut, ParamCreateParams>({
    create: createParam,
    update: updateParam,
    remove: deleteParams,
  });

  const columns: ProColumns<ParamOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '参数名称',
      dataIndex: 'config_name',
      width: 160,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '参数键',
      dataIndex: 'config_key',
      width: 180,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    { title: '参数值', dataIndex: 'config_value', width: 180, search: false },
    {
      title: '系统内置',
      dataIndex: 'config_type',
      width: 100,
      search: false,
      // 布尔列不能用 valueEnum:valueEnum 的匹配是拿 key 做相等判断,
      // false 是 falsy,容易被当成「没选」——直接渲染文案更稳
      render: (_, record) => (record.config_type ? '是' : '否'),
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

  const operationColumns = useCrudColumns<ParamOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_system:param:update',
    deletePerm: 'module_system:param:delete',
    entityName: '参数',
  });

  return (
    <>
      <ProTable<ParamOut>
        headerTitle="参数管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestParams}
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
            disabled={!access.hasPermission('module_system:param:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <ParamModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </>
  );
};

export default ParamManagement;
