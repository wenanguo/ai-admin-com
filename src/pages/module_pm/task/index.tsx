import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button } from 'antd';
import type React from 'react';
import { useMemo } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import { DictTag } from '@/components/pm/DictTag';
import { toValueEnum } from '@/components/pm/toValueEnum';
import { useDictOptions } from '@/components/pm/useDictOptions';
import type {
  TaskCreateParams,
  TaskOut,
  TaskUpdateParams,
} from '@/services/api/pm/task';
import {
  createTask,
  deleteTasks,
  listTasks,
  updateTask,
} from '@/services/api/pm/task';
import { listUsers } from '@/services/api/system/user';
import { toProTableRequest } from '@/services/paginate';
import TaskModalForm from './ModalForm';
import { useProjectNames } from './useProjectNames';

const requestTasks = toProTableRequest<TaskOut>(listTasks);

/**
 * id → 名字(侧载的映射表里查;查不到显示占位符)。
 *
 * 任务响应里**没有** project_by / milestone_by(只有 assignee_by/reporter_by),
 * 项目名与里程碑名靠侧载列表在户端映射 —— 见 useProjectNames。
 */
function lookupName(names: Map<number, string>, id?: number | null): string {
  if (id == null) return '-';
  return names.get(id) ?? '-';
}

/**
 * 任务管理列表页 —— 路由 /pm/task(菜单由后端下发,目录挂在 /pm 下)。
 *
 * 骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」,与其它模块同范式。
 *
 * 一个特别之处:**任务响应里没有项目名与里程碑名**(后端的任务 schema 只带
 * assignee_by / reporter_by),所以项目与里程碑的名字是侧载列表在户端映射的
 * —— 一次拉两张表,列的 render 里查表,不是每行发请求。
 */
const TaskManagement: React.FC = () => {
  const access = useAccess();

  // 载荷有两种形状:新增带创建三列,更新不带 —— 见 services/api/pm/task.ts
  const crud = useCrudTable<TaskOut, TaskCreateParams | TaskUpdateParams>({
    create: createTask,
    update: updateTask,
    remove: deleteTasks,
  });

  // 侧载的项目/里程碑名字:一次拉两张表,列里查表映射成名字
  const {
    projectNames,
    milestoneNames,
    projectOptions,
    milestoneOptions,
    loading: optionsLoading,
  } = useProjectNames();

  // 字典选项:表格标签(DictTag 内部也用它)与搜索下拉(valueEnum)共用,
  // useDictOptions 有模块级缓存,这里三个类型各只发一次请求
  const { options: statusOptions } = useDictOptions('module_pm_task_status');
  const { options: typeOptions } = useDictOptions('module_pm_task_type');
  const { options: priorityOptions } = useDictOptions('module_pm_priority');

  const statusValueEnum = useMemo(
    () => toValueEnum(statusOptions),
    [statusOptions],
  );
  const typeValueEnum = useMemo(() => toValueEnum(typeOptions), [typeOptions]);
  const priorityValueEnum = useMemo(
    () => toValueEnum(priorityOptions),
    [priorityOptions],
  );

  const columns: ProColumns<TaskOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '任务标题',
      dataIndex: 'title',
      width: 220,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '所属项目',
      dataIndex: 'project_id',
      width: 160,
      valueType: 'select',
      // 搜索下拉的候选来自侧载的项目列表(页面已经拉过,不再发请求)
      fieldProps: { options: projectOptions, showSearch: true },
      // 表格里显示的是侧载映射出来的项目名(响应里没有 project_by)
      render: (_, record) => lookupName(projectNames, record.project_id),
    },
    {
      title: '所属里程碑',
      dataIndex: 'milestone_id',
      width: 160,
      search: false,
      render: (_, record) => lookupName(milestoneNames, record.milestone_id),
    },
    {
      title: '状态',
      dataIndex: 'status_code',
      width: 110,
      valueEnum: statusValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_task_status" value={record.status_code} />
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority_code',
      width: 100,
      valueEnum: priorityValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_priority" value={record.priority_code} />
      ),
    },
    {
      title: '类型',
      dataIndex: 'type_code',
      width: 100,
      valueEnum: typeValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_task_type" value={record.type_code} />
      ),
    },
    {
      title: '负责人',
      dataIndex: 'assignee_id',
      width: 130,
      valueType: 'select',
      // ⚠️ 列级 select 必须显式开 showSearch,否则远程搜索是死代码
      // (rc-select 的输入框 readOnly,onSearch 永远不触发) —— 见工单页处理人列
      fieldProps: { showSearch: true },
      // 远程搜索防抖(毫秒);ProComponents 的默认是 0,每敲一个字发一次请求
      debounceTime: 300,
      /*
        搜索项:负责人是用户,候选来自 listUsers,按姓名远程搜。
        ⚠️ 这个接口在后端要 module_system:user:query 权限;
        没有这个权限时只有这一项搜索用不了,列表本身不受影响。
      */
      request: async ({ keyWords }: { keyWords?: string }) => {
        const keyword = keyWords?.trim();
        const res = await listUsers({
          page_no: 1,
          page_size: 100,
          ...(keyword ? { name: keyword } : {}),
        });
        return (res?.data?.items ?? []).flatMap((user) =>
          user.id == null
            ? []
            : [
                {
                  label: user.name ?? user.username ?? String(user.id),
                  value: user.id,
                },
              ],
        );
      },
      // 表格里读后端随行返回的 assignee_by 冗余字段,不用再查用户表
      render: (_, record) => record.assignee_by?.name ?? '-',
    },
    {
      title: '报告人',
      dataIndex: 'reporter_id',
      width: 130,
      search: false,
      render: (_, record) => record.reporter_by?.name ?? '-',
    },
    {
      title: '计划起止',
      dataIndex: 'start_date',
      width: 200,
      search: false,
      render: (_, record) =>
        `${record.start_date ?? '-'} ~ ${record.due_date ?? '-'}`,
    },
    {
      title: '实际起止',
      dataIndex: 'actual_start_date',
      width: 200,
      search: false,
      render: (_, record) =>
        `${record.actual_start_date ?? '-'} ~ ${record.actual_end_date ?? '-'}`,
    },
    {
      title: '估时',
      dataIndex: 'estimate_hours',
      width: 90,
      search: false,
      render: (_, record) => record.estimate_hours ?? '-',
    },
    {
      title: '实际工时',
      dataIndex: 'actual_hours',
      width: 100,
      search: false,
      render: (_, record) => record.actual_hours ?? '-',
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 80,
      search: false,
      render: (_, record) => record.sort_order ?? '-',
    },
    {
      title: '阻塞原因',
      dataIndex: 'blocked_reason',
      width: 180,
      search: false,
      render: (_, record) => record.blocked_reason ?? '-',
    },
    {
      // 创建方式有字典(module_pm_task_created_via:manual/nl_chat/import/api),
      // 跟其它字典列一样渲染成中文标签
      title: '创建方式',
      dataIndex: 'created_via_code',
      width: 110,
      search: false,
      render: (_, record) => (
        <DictTag
          dictType="module_pm_task_created_via"
          value={record.created_via_code}
        />
      ),
    },
  ];

  const operationColumns = useCrudColumns<TaskOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_pm_project:pm_task:update',
    deletePerm: 'module_pm_project:pm_task:delete',
    entityName: '任务',
  });

  return (
    <>
      <ProTable<TaskOut>
        headerTitle="任务管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestTasks}
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
            disabled={!access.hasPermission('module_pm_project:pm_task:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <TaskModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
        projectOptions={projectOptions}
        milestoneOptions={milestoneOptions}
        optionsLoading={optionsLoading}
      />
    </>
  );
};

export default TaskManagement;
