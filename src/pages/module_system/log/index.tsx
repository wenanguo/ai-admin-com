import {
  type ActionType,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Descriptions, Drawer, Popconfirm, Tabs } from 'antd';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { CRUD_PAGINATION } from '@/components/CrudTable';
import type {
  LoginLogOut,
  OperationLogDetailOut,
  OperationLogOut,
} from '@/services/api/system/log';
import {
  deleteLoginLogs,
  deleteOperationLogs,
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

/**
 * 只读页的操作列:删除(带二次确认)+ 详情(只读抽屉)。
 *
 * 共享脚手架的 `useCrudColumns` 固定渲染「编辑」按钮,而日志页是只读的
 * (没有新增、没有编辑),所以这里本地实现一份只含删除的版本 ——
 * 权限门控(`access.hasPermission`)与脚手架保持一致:
 * 权限码写错会**静默禁用**按钮,是最难发现的一类 bug。
 */
function useLogActionColumns<T extends { id?: number | null }>(options: {
  /** 点「删除」 */
  onDelete: (record: T) => void | Promise<void>;
  /** 删除按钮的权限码 */
  deletePerm: string;
  /** 实体中文名,用于删除二次确认的文案 */
  entityName: string;
  /** 点「详情」(不给就不渲染这个按钮) */
  onDetail?: (record: T) => void;
}): ProColumns<T>[] {
  const access = useAccess();
  const { onDelete, deletePerm, entityName, onDetail } = options;

  return [
    {
      title: '操作',
      valueType: 'option',
      width: 140,
      render: (_, record) => [
        ...(onDetail
          ? [
              <Button
                key="detail"
                type="link"
                size="small"
                onClick={() => onDetail(record)}
              >
                详情
              </Button>,
            ]
          : []),
        <Popconfirm
          key="delete"
          title={`确认删除该${entityName}?`}
          onConfirm={() => onDelete(record)}
          disabled={!access.hasPermission(deletePerm)}
        >
          <Button
            type="link"
            size="small"
            danger
            disabled={!access.hasPermission(deletePerm)}
          >
            删除
          </Button>
        </Popconfirm>,
      ],
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
 */
const LogManagement: React.FC = () => {
  const loginActionRef = useRef<ActionType | undefined>(undefined);
  const operationActionRef = useRef<ActionType | undefined>(undefined);

  const [detail, setDetail] = useState<OperationLogDetailOut | undefined>(
    undefined,
  );
  const [detailOpen, setDetailOpen] = useState(false);

  const handleDeleteLogin = useCallback(async (record: LoginLogOut) => {
    if (!record.id) return;
    try {
      await deleteLoginLogs([record.id]);
      // 成功提示由请求层统一弹(后端信封里的 msg),这里不要再弹一次
      loginActionRef.current?.reload();
    } catch {
      // 失败提示也由请求层统一弹,这里只需要把异常消化掉
    }
  }, []);

  const handleDeleteOperation = useCallback(async (record: OperationLogOut) => {
    if (!record.id) return;
    try {
      await deleteOperationLogs([record.id]);
      operationActionRef.current?.reload();
    } catch {
      // 同上
    }
  }, []);

  const handleDetail = useCallback(async (record: OperationLogOut) => {
    if (!record.id) return;
    try {
      // 列表接口不返回请求体 / 响应体,详情必须走详情接口
      const res = await getOperationLogDetail(record.id);
      setDetail(res?.data ?? undefined);
      setDetailOpen(true);
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

  const loginActionColumns = useLogActionColumns<LoginLogOut>({
    onDelete: handleDeleteLogin,
    deletePerm: 'module_system:login_log:delete',
    entityName: '登录日志',
  });

  const operationActionColumns = useLogActionColumns<OperationLogOut>({
    onDelete: handleDeleteOperation,
    onDetail: handleDetail,
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
                columns={[...loginColumns, ...loginActionColumns]}
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
                columns={[...operationColumns, ...operationActionColumns]}
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
        title="操作日志详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={720}
      >
        <Descriptions
          column={1}
          bordered
          size="small"
          items={[
            { key: 'id', label: 'ID', children: detail?.id ?? '-' },
            {
              key: 'request_path',
              label: '请求路径',
              children: detail?.request_path ?? '-',
            },
            {
              key: 'request_method',
              label: '请求方法',
              children: detail?.request_method ?? '-',
            },
            {
              key: 'response_code',
              label: '响应状态码',
              children: detail?.response_code ?? '-',
            },
            {
              key: 'process_time',
              label: '处理耗时',
              children: detail?.process_time ?? '-',
            },
            {
              key: 'status',
              label: '状态',
              children: operationStatusText(detail?.status),
            },
            {
              key: 'description',
              label: '描述',
              children: detail?.description ?? '-',
            },
            {
              key: 'operator',
              label: '操作人',
              children: detail?.created_by?.name ?? '-',
            },
            {
              key: 'created_time',
              label: '创建时间',
              children: detail?.created_time ?? '-',
            },
            {
              key: 'request_payload',
              label: '请求体',
              children: (
                <pre style={JSON_STYLE}>{detail?.request_payload ?? '-'}</pre>
              ),
            },
            {
              key: 'response_json',
              label: '响应体',
              children: (
                <pre style={JSON_STYLE}>{detail?.response_json ?? '-'}</pre>
              ),
            },
          ]}
        />
      </Drawer>
    </>
  );
};

export default LogManagement;
