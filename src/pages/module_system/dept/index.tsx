import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Input } from 'antd';
import type React from 'react';
import { useCallback, useState } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import type { DeptCreateParams, DeptOut } from '@/services/api/system/dept';
import {
  batchSetDeptsStatus,
  createDept,
  deleteDepts,
  getDeptTree,
  updateDept,
} from '@/services/api/system/dept';
import type { ProTableParams } from '@/services/paginate';
import DeptModalForm from './ModalForm';

/**
 * 部门管理 —— 后端菜单 route_path=/system/dept,component_path=module_system/dept/index。
 *
 * 与其它模块有两点不一样(别照抄岗位页的 request 写法):
 *
 * 1. 后端**没有** `/system/dept/list`,只有 `/system/dept/tree` ⇒ 表格的 request 回调
 *    是手写的(不能用 `toProTableRequest`),数据是一棵树,不是分页列表
 * 2. 搜索也在**前端**做:后端没有带关键字的树接口,`onSearch` 里过滤已加载的树
 *
 * 其余骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里。
 */

/**
 * 过滤 + 整理部门树。
 *
 * 两件事一起做:
 * - **过滤**:按名称过滤。命中的节点**连同它的祖先**保留(否则搜到「研发部」
 *   却看不到它挂在哪个部门下面),所以自底向上地判断:自己命中,或者有后代命中,就留下
 * - **整理**:后端给叶子节点也返回 `children: []`,antd 的树形表格会把它当成
 *   「有子节点」⇒ 叶子行上多一个点了没反应的展开箭头。空的 children 一律去掉
 */
function filterDeptTree(nodes: DeptOut[], keyword: string): DeptOut[] {
  const kw = keyword.trim().toLowerCase();
  const result: DeptOut[] = [];

  for (const node of nodes) {
    const children = filterDeptTree(node.children ?? [], kw);
    const nameMatched = (node.name ?? '').toLowerCase().includes(kw);
    if (kw && !nameMatched && children.length === 0) continue;

    result.push({
      ...node,
      children: children.length > 0 ? children : undefined,
    });
  }

  return result;
}

/** 收集有子部门的节点 id(表格默认展开它们) */
function collectParentIds(nodes: DeptOut[]): number[] {
  const ids: number[] = [];
  for (const node of nodes) {
    const children = node.children ?? [];
    if (children.length > 0 && node.id != null) {
      ids.push(node.id);
      ids.push(...collectParentIds(children));
    }
  }
  return ids;
}

const DeptManagement: React.FC = () => {
  const access = useAccess();

  const [keyword, setKeyword] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([]);

  const crud = useCrudTable<DeptOut, DeptCreateParams>({
    create: createDept,
    update: updateDept,
    remove: deleteDepts,
  });

  /**
   * 表格的数据源。
   *
   * 后端只有树接口,所以这里不能用 `toProTableRequest` —— 手写成
   * `{ data, success, total }`(形状与它一致)。
   */
  const requestDepts = useCallback(async (params: ProTableParams) => {
    const res = await getDeptTree();
    const tree = res?.data ?? [];

    // 后端没有带关键字的树接口 ⇒ 关键字只在前端过滤
    const kw = typeof params.keyword === 'string' ? params.keyword : '';
    const data = filterDeptTree(tree, kw);

    // 有子部门的节点默认展开(树形表格不展开就只剩一层)
    setExpandedRowKeys(collectParentIds(data));

    return {
      data,
      success: res?.success ?? false,
      total: data.length,
    };
  }, []);

  const columns: ProColumns<DeptOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '部门名称', dataIndex: 'name', width: 180 },
    { title: '部门编码', dataIndex: 'code', width: 160 },
    { title: '排序', dataIndex: 'order', width: 90 },
    { title: '负责人', dataIndex: 'leader', width: 120 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        0: { text: '正常', status: 'Success' },
        1: { text: '禁用', status: 'Default' },
      },
    },
    { title: '创建时间', dataIndex: 'created_time', width: 180 },
  ];

  const operationColumns = useCrudColumns<DeptOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_system:dept:update',
    deletePerm: 'module_system:dept:delete',
    entityName: '部门',
  });

  /** 批量启停:后端是 PATCH,请求体 { ids, status } */
  const handleBatchStatus = async (status: number) => {
    if (selectedRowKeys.length === 0) return;
    try {
      await batchSetDeptsStatus(selectedRowKeys, status);
      crud.actionRef.current?.reload();
    } catch {
      // 失败提示由请求层统一弹,这里只需要把异常消化掉
    }
  };

  const batchDisabled =
    !access.hasPermission('module_system:dept:patch') ||
    selectedRowKeys.length === 0;

  return (
    <>
      <ProTable<DeptOut>
        headerTitle="部门管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestDepts}
        // 关键字变化会重新触发 request(后端没有带关键字的树接口,过滤在前端做)
        params={{ keyword }}
        // 整个搜索表单关掉:后端只有树接口,搜索框放在工具栏里
        search={false}
        pagination={CRUD_PAGINATION}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        expandable={{
          childrenColumnName: 'children',
          expandedRowKeys,
          onExpandedRowsChange: (keys) =>
            setExpandedRowKeys(
              keys.filter((key): key is number => typeof key === 'number'),
            ),
        }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) =>
            setSelectedRowKeys(
              keys.filter((key): key is number => typeof key === 'number'),
            ),
        }}
        toolBarRender={() => [
          <Input.Search
            key="search"
            allowClear
            placeholder="搜索部门名称"
            style={{ width: 220 }}
            onSearch={(value) => setKeyword(value.trim())}
            // 清空时也要把关键字清掉,否则过滤条件还挂着
            onChange={(event) => {
              if (!event.target.value) setKeyword('');
            }}
          />,
          <Button
            key="enable"
            disabled={batchDisabled}
            onClick={() => handleBatchStatus(0)}
          >
            启用
          </Button>,
          <Button
            key="disable"
            disabled={batchDisabled}
            onClick={() => handleBatchStatus(1)}
          >
            禁用
          </Button>,
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!access.hasPermission('module_system:dept:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <DeptModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </>
  );
};

export default DeptManagement;
