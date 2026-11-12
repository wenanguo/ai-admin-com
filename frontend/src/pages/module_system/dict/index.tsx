import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import {
  Button,
  Card,
  Col,
  Row,
  Table,
  type TableColumnsType,
  Typography,
} from 'antd';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { toAntdOperationColumn } from '@/components/AntdOperationColumn';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import type {
  DictDataCreateParams,
  DictDataOut,
  DictTypeCreateParams,
  DictTypeOut,
} from '@/services/api/system/dict';
import {
  createDictData,
  createDictType,
  deleteDictDatas,
  deleteDictTypes,
  listDictDatas,
  listDictTypes,
  updateDictData,
  updateDictType,
} from '@/services/api/system/dict';
import { toProTableRequest } from '@/services/paginate';
import DataModalForm from './DataModalForm';
import TypeModalForm from './TypeModalForm';

const requestDictDatas = toProTableRequest<DictDataOut>(listDictDatas);

/**
 * 左栏的字典类型列表。
 *
 * 左栏是 antd Table(不是 ProTable)⇒
 * - 分页参数固定 page_no=1 / page_size=100(一次拉够,类型数量有限)
 *   ⚠️ 上限 100 是 brief 的约定(左栏不分页、不搜索):类型超过 100 个会被**静默截断**。
 *     这是已知取舍,不是 bug —— 真要放开得先给左栏加分页与搜索。
 * - 刷新要自己管:共享脚手架的 actionRef 刷的是 ProTable,刷不到左栏
 */
function useDictTypes() {
  const [types, setTypes] = useState<DictTypeOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DictTypeOut | undefined>(undefined);

  /**
   * 重新拉类型列表,并维持选中项:
   * - 首次进入默认选中第一个
   * - 已选中的还在列表里 ⇒ 保持选中(不打断用户)
   * - 已选中的被删了 ⇒ 退回列表里的第一个
   */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // page_size=100 是 brief 的约定(左栏不分页、不搜索):超过 100 个类型会被静默截断
      const res = await listDictTypes({ page_no: 1, page_size: 100 });
      const items = res?.data?.items ?? [];
      setTypes(items);
      setSelected((prev) => {
        if (!prev) return items[0];
        return items.find((item) => item.id === prev.id) ?? items[0];
      });
    } catch {
      // 失败提示由请求层统一弹;列表清空,右栏提示先选类型
      setTypes([]);
      setSelected(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { types, loading, selected, setSelected, reload };
}

/**
 * 字典管理 —— 后端菜单 route_path=/system/dict,component_path=module_system/dict/index。
 *
 * 本轮唯一的**主从结构**页面:左栏字典类型,右栏该类型下的字典数据。
 *
 * 权限码是**两套**,不要混用:
 * - 字典类型:module_system:dict_type:{create,update,delete}
 * - 字典数据:module_system:dict_data:{create,update,delete}
 */
const DictManagement: React.FC = () => {
  const access = useAccess();

  const {
    types,
    loading: typesLoading,
    selected,
    setSelected,
    reload: reloadTypes,
  } = useDictTypes();

  /**
   * 字典类型(左栏)。
   *
   * ⚠️ 左栏不是 ProTable ⇒ 脚手架的 `actionRef` **绑不到它**(那个 ref 刷的是 ProTable),
   * 所以**左栏的每一个写操作都必须自己调 `reloadTypes()`** ——
   * 漏掉不会报错,只会「写成功了但左栏列表不动」。
   */
  const typeCrud = useCrudTable<DictTypeOut, DictTypeCreateParams>({
    create: async (values) => {
      const res = await createDictType(values);
      // 左栏写路径:必须自己刷新(脚手架的 actionRef 绑不到左栏)
      await reloadTypes();
      return res;
    },
    update: async (id, values) => {
      const res = await updateDictType(id, values);
      // 左栏写路径:必须自己刷新(脚手架的 actionRef 绑不到左栏)
      await reloadTypes();
      return res;
    },
    remove: async (ids) => {
      await deleteDictTypes(ids);
      // 左栏写路径:必须自己刷新(脚手架的 actionRef 绑不到左栏)
      await reloadTypes();
    },
  });

  /** 字典数据(右栏)。右栏是 ProTable ⇒ 脚手架的 actionRef 刷得动 */
  const dataCrud = useCrudTable<DictDataOut, DictDataCreateParams>({
    create: createDictData,
    update: updateDictData,
    remove: deleteDictDatas,
  });

  const typeOperationColumns = useCrudColumns<DictTypeOut>({
    onEdit: typeCrud.openEdit,
    onDelete: typeCrud.handleDelete,
    editPerm: 'module_system:dict_type:update',
    deletePerm: 'module_system:dict_type:delete',
    entityName: '字典类型',
  });

  const dataOperationColumns = useCrudColumns<DictDataOut>({
    onEdit: dataCrud.openEdit,
    onDelete: dataCrud.handleDelete,
    editPerm: 'module_system:dict_data:update',
    deletePerm: 'module_system:dict_data:delete',
    entityName: '字典数据',
  });

  const typeColumns: TableColumnsType<DictTypeOut> = [
    { title: '字典名称', dataIndex: 'dict_name', width: 90, ellipsis: true },
    // 字典类型是业务侧读字典时用的 key,左栏窄也要看得全
    { title: '字典类型', dataIndex: 'dict_type', width: 120, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 50,
      // status 可能是 null(后端没给)⇒ 显示 '-',别把它当成 '禁用'
      render: (status: number | null | undefined) =>
        status == null ? '-' : status === 0 ? '正常' : '禁用',
    },
    ...typeOperationColumns.map((column) => toAntdOperationColumn(column, 110)),
  ];

  const dataColumns: ProColumns<DictDataOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '字典标签',
      dataIndex: 'dict_label',
      width: 140,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    { title: '字典键值', dataIndex: 'dict_value', width: 140, search: false },
    {
      title: '是否默认',
      dataIndex: 'is_default',
      width: 100,
      search: false,
      render: (_, record) => (record.is_default ? '是' : '否'),
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
    { title: '描述', dataIndex: 'description', width: 160, search: false },
    { title: '创建时间', dataIndex: 'created_time', width: 180, search: false },
  ];

  return (
    <>
      {/* wrap={false}:右栏是宽表格,让它横向滚动而不是把整行挤到下一行 */}
      <Row gutter={16} wrap={false}>
        <Col flex="420px">
          <Card
            title="字典类型"
            extra={
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={
                  !access.hasPermission('module_system:dict_type:create')
                }
                onClick={typeCrud.openCreate}
              >
                新增类型
              </Button>
            }
          >
            <Table<DictTypeOut>
              rowKey="id"
              size="small"
              columns={typeColumns}
              dataSource={types}
              loading={typesLoading}
              // 类型数量有限,一次拉够(左栏不分页);上限 100 见 useDictTypes 的注释
              pagination={false}
              // 左栏只有 420px 宽,列肯定放不下 ⇒ 横向滚动
              // (操作列 fixed:'right' ⇒ 必须有 scroll.x 才有粘性效果)
              scroll={{ x: 'max-content' }}
              onRow={(record) => ({
                onClick: () => setSelected(record),
                // 选中的行高亮 —— 用内联样式,不必为一行底色新增样式文件
                style:
                  record.id === selected?.id
                    ? { background: '#e6f4ff' }
                    : undefined,
              })}
            />
          </Card>
        </Col>
        <Col flex="1 1 0%" style={{ minWidth: 0 }}>
          {selected ? (
            <ProTable<DictDataOut>
              headerTitle={`字典数据 - ${selected.dict_name ?? ''}`}
              rowKey="id"
              actionRef={dataCrud.actionRef}
              columns={[...dataColumns, ...dataOperationColumns]}
              request={requestDictDatas}
              // 右栏只看当前类型下的数据 —— 选中类型变了 ProTable 会重新拉
              params={{ dict_type: selected.dict_type }}
              search={{ labelWidth: 80 }}
              pagination={CRUD_PAGINATION}
              // 主从分栏后右栏宽度有限,列宽按内容排,窄屏时横向滚动(而不是把表头挤成竖排)
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
                    !access.hasPermission('module_system:dict_data:create')
                  }
                  onClick={dataCrud.openCreate}
                >
                  新增数据
                </Button>,
              ]}
            />
          ) : (
            <Card>
              <Typography.Text type="secondary">
                请先选择左侧的字典类型
              </Typography.Text>
            </Card>
          )}
        </Col>
      </Row>

      <TypeModalForm
        open={typeCrud.modalOpen}
        record={typeCrud.editing}
        onOpenChange={typeCrud.closeModal}
        onSubmit={typeCrud.handleSubmit}
      />
      <DataModalForm
        open={dataCrud.modalOpen}
        record={dataCrud.editing}
        dictType={selected}
        onOpenChange={dataCrud.closeModal}
        onSubmit={dataCrud.handleSubmit}
      />
    </>
  );
};

export default DictManagement;
