import {
  type ActionType,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { Button, Descriptions, Drawer, Tabs } from 'antd';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import type { CrudRecord } from '@/components/CrudTable';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useDeleteHandler,
} from '@/components/CrudTable';
import type {
  LoginLogOut,
  OperationLogDetailOut,
  OperationLogOut,
} from '@/services/api/system/log';
import {
  deleteLoginLogs,
  deleteOperationLogs,
  getLoginLogDetail,
  getOperationLogDetail,
  listLoginLogs,
  listOperationLogs,
} from '@/services/api/system/log';
import { toProTableRequest } from '@/services/paginate';

const requestLoginLogs = toProTableRequest<LoginLogOut>(listLoginLogs);
const requestOperationLogs =
  toProTableRequest<OperationLogOut>(listOperationLogs);

/** JSON 大文本的展示样式:超长换行 + 限高滚动 */
const JSON_STYLE: React.CSSProperties = {
  margin: 0,
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

/** 操作日志状态(后端 OperationLogOutSchema.status:0 成功 1 失败) */
function operationStatusText(status?: number | null): string {
  if (status === 0) return '成功';
  if (status === 1) return '失败';
  return '-';
}

/** 登录日志状态(后端 LoginLogOutSchema.status:1 成功 2 失败) */
function loginStatusText(status?: number | null): string {
  if (status === 1) return '成功';
  if (status === 2) return '失败';
  return '-';
}

/**
 * 只读页的「详情」列 —— 一个详情按钮。
 *
 * 共享脚手架的 `useCrudColumns` 只管「编辑 + 删除」的权限门控;
 * 「详情」是本模块特有的只读入口(不改数据 ⇒ 没有权限码),所以留在页面里。
 * 列名与脚手架的操作列区分开,免得两列都叫「操作」。
 */
function logDetailColumn<T extends CrudRecord>(
  onDetail: (record: T) => void,
): ProColumns<T>[] {
  return [
    {
      title: '详情',
      valueType: 'option',
      width: 80,
      search: false,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => onDetail(record)}>
          详情
        </Button>
      ),
    },
  ];
}

/**
 * 日志管理 —— 后端菜单 route_path=/system/log,component_path=module_system/log/index。
 *
 * 只读页:两个 tab(登录日志 / 操作日志),只有列表 + 详情抽屉,没有新增与编辑。
 *
 * 权限码是**两套**,命名不一致是后端现状:
 * - 登录日志:module_system:login_log:{query,delete}
 * - 操作日志:module_system:log:{query,delete}
 *
 * 权限门控与「删除 → 刷新 → 吞异常」都走共享脚手架
 * (`useCrudColumns` / `useDeleteHandler`),页面里不再抄第二份;
 * 两个 tab 的差别只剩删除接口的**请求体形状**(登录日志裸数组 / 操作日志 { ids })。
 */
const LogManagement: React.FC = () => {
  const loginActionRef = useRef<ActionType | undefined>(undefined);
  const operationActionRef = useRef<ActionType | undefined>(undefined);

  const [loginDetail, setLoginDetail] = useState<LoginLogOut | undefined>(
    undefined,
  );
  const [loginDetailOpen, setLoginDetailOpen] = useState(false);
  const [operationDetail, setOperationDetail] = useState<
    OperationLogDetailOut | undefined
  >(undefined);
  const [operationDetailOpen, setOperationDetailOpen] = useState(false);

  // 删除 → 刷新 → 吞异常:共享脚手架的一份实现,两个 tab 只差 remove 的请求体形状
  const handleDeleteLogin = useDeleteHandler<LoginLogOut>(
    deleteLoginLogs,
    loginActionRef,
  );
  const handleDeleteOperation = useDeleteHandler<OperationLogOut>(
    deleteOperationLogs,
    operationActionRef,
  );

  const handleLoginDetail = useCallback(async (record: LoginLogOut) => {
    if (!record.id) return;
    try {
      const res = await getLoginLogDetail(record.id);
      setLoginDetail(res?.data ?? undefined);
      setLoginDetailOpen(true);
    } catch {
      // 失败提示由请求层统一弹
    }
  }, []);

  const handleOperationDetail = useCallback(async (record: OperationLogOut) => {
    if (!record.id) return;
    try {
      // 列表接口不返回请求体 / 响应体,详情必须走详情接口
      const res = await getOperationLogDetail(record.id);
      setOperationDetail(res?.data ?? undefined);
      setOperationDetailOpen(true);
    } catch {
      // 失败提示由请求层统一弹
    }
  }, []);

  const loginColumns: ProColumns<LoginLogOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '用户名',
      dataIndex: 'username',
      width: 140,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        1: { text: '成功', status: 'Success' },
        2: { text: '失败', status: 'Error' },
      },
    },
    { title: '登录 IP', dataIndex: 'login_ip', width: 140, search: false },
    {
      title: '浏览器',
      dataIndex: 'request_browser',
      width: 140,
      search: false,
    },
    { title: '操作系统', dataIndex: 'request_os', width: 140, search: false },
    { title: '登录时间', dataIndex: 'created_time', width: 180, search: false },
  ];

  const operationColumns: ProColumns<OperationLogOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    { title: '描述', dataIndex: 'description', width: 200, search: false },
    {
      title: '请求方法',
      dataIndex: 'request_method',
      width: 120,
      fieldProps: { placeholder: '精确匹配' },
    },
    {
      title: '请求路径',
      dataIndex: 'request_path',
      width: 240,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '操作人',
      dataIndex: 'created_by',
      width: 120,
      search: false,
      render: (_, record) => record.created_by?.name ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        0: { text: '成功', status: 'Success' },
        1: { text: '失败', status: 'Error' },
      },
    },
    { title: '创建时间', dataIndex: 'created_time', width: 180, search: false },
  ];

  // 操作列:只读页不传 onEdit / editPerm ⇒ 脚手架不渲染「编辑」按钮,
  // 权限门控仍然只有脚手架这一份实现。
  const loginActionColumns = useCrudColumns<LoginLogOut>({
    onDelete: handleDeleteLogin,
    deletePerm: 'module_system:login_log:delete',
    entityName: '登录日志',
  });

  const operationActionColumns = useCrudColumns<OperationLogOut>({
    onDelete: handleDeleteOperation,
    deletePerm: 'module_system:log:delete',
    entityName: '操作日志',
  });

  return (
    <>
      <Tabs
        // antd 6 里 destroyInactiveTabPane 改名成 destroyOnHidden:
        // 未激活的 tab 不挂载 ⇒ 一次进页面只发一个列表请求
        destroyOnHidden
        items={[
          {
            key: 'login',
            label: '登录日志',
            children: (
              <ProTable<LoginLogOut>
                headerTitle="登录日志列表"
                rowKey="id"
                actionRef={loginActionRef}
                columns={[
                  ...loginColumns,
                  ...logDetailColumn<LoginLogOut>(handleLoginDetail),
                  ...loginActionColumns,
                ]}
                request={requestLoginLogs}
                search={{ labelWidth: 80 }}
                pagination={CRUD_PAGINATION}
                // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
                // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
                onRequestError={() => {}}
              />
            ),
          },
          {
            key: 'operation',
            label: '操作日志',
            children: (
              <ProTable<OperationLogOut>
                headerTitle="操作日志列表"
                rowKey="id"
                actionRef={operationActionRef}
                columns={[
                  ...operationColumns,
                  ...logDetailColumn<OperationLogOut>(handleOperationDetail),
                  ...operationActionColumns,
                ]}
                request={requestOperationLogs}
                search={{ labelWidth: 80 }}
                pagination={CRUD_PAGINATION}
                // 同上:只阻止 ProTable 重抛,提示由请求层统一弹
                onRequestError={() => {}}
              />
            ),
          },
        ]}
      />

      <Drawer
        title="登录日志详情"
        open={loginDetailOpen}
        onClose={() => setLoginDetailOpen(false)}
        size={720}
      >
        <Descriptions
          column={1}
          bordered
          size="small"
          items={[
            { key: 'id', label: 'ID', children: loginDetail?.id ?? '-' },
            { key: 'uuid', label: 'UUID', children: loginDetail?.uuid ?? '-' },
            {
              key: 'username',
              label: '用户名',
              children: loginDetail?.username ?? '-',
            },
            {
              key: 'status',
              label: '状态',
              children: loginStatusText(loginDetail?.status),
            },
            {
              key: 'login_ip',
              label: '登录 IP',
              children: loginDetail?.login_ip ?? '-',
            },
            {
              key: 'login_location',
              label: '登录地点',
              children: loginDetail?.login_location ?? '-',
            },
            {
              key: 'request_browser',
              label: '浏览器',
              children: loginDetail?.request_browser ?? '-',
            },
            {
              key: 'request_os',
              label: '操作系统',
              children: loginDetail?.request_os ?? '-',
            },
            {
              key: 'msg',
              label: '提示消息',
              children: loginDetail?.msg ?? '-',
            },
            {
              key: 'created_by',
              label: '创建人',
              children: loginDetail?.created_by?.name ?? '-',
            },
            {
              key: 'created_time',
              label: '创建时间',
              children: loginDetail?.created_time ?? '-',
            },
            {
              key: 'updated_time',
              label: '更新时间',
              children: loginDetail?.updated_time ?? '-',
            },
          ]}
        />
      </Drawer>

      <Drawer
        title="操作日志详情"
        open={operationDetailOpen}
        onClose={() => setOperationDetailOpen(false)}
        size={720}
      >
        <Descriptions
          column={1}
          bordered
          size="small"
          items={[
            { key: 'id', label: 'ID', children: operationDetail?.id ?? '-' },
            {
              key: 'request_path',
              label: '请求路径',
              children: operationDetail?.request_path ?? '-',
            },
            {
              key: 'request_method',
              label: '请求方法',
              children: operationDetail?.request_method ?? '-',
            },
            {
              key: 'response_code',
              label: '响应状态码',
              children: operationDetail?.response_code ?? '-',
            },
            {
              key: 'process_time',
              label: '处理耗时',
              children: operationDetail?.process_time ?? '-',
            },
            {
              key: 'status',
              label: '状态',
              children: operationStatusText(operationDetail?.status),
            },
            {
              key: 'description',
              label: '描述',
              children: operationDetail?.description ?? '-',
            },
            {
              key: 'operator',
              label: '操作人',
              children: operationDetail?.created_by?.name ?? '-',
            },
            {
              key: 'created_time',
              label: '创建时间',
              children: operationDetail?.created_time ?? '-',
            },
            {
              key: 'request_payload',
              label: '请求体',
              children: (
                <pre style={JSON_STYLE}>
                  {operationDetail?.request_payload ?? '-'}
                </pre>
              ),
            },
            {
              key: 'response_json',
              label: '响应体',
              children: (
                <pre style={JSON_STYLE}>
                  {operationDetail?.response_json ?? '-'}
                </pre>
              ),
            },
          ]}
        />
      </Drawer>
    </>
  );
};

export default LogManagement;
