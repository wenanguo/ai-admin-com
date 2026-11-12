import {
  AppstoreOutlined,
  BarChartOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess, useModel, useNavigate } from '@umijs/max';
import { Alert, Button } from 'antd';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import { buildAiTaskContext, mergeDictLabels } from '@/components/pm/aiContext';
import { taskColumns } from '@/components/pm/columns/task';
import { toValueEnum } from '@/components/pm/toValueEnum';
import { useAiTaskUpdate } from '@/components/pm/useAiTaskUpdate';
import { useDictOptions } from '@/components/pm/useDictOptions';
import { useProjectNames } from '@/components/pm/useProjectNames';
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
import { toProTableRequest } from '@/services/paginate';
import TaskModalForm from './ModalForm';

const requestTasks = toProTableRequest<TaskOut>(listTasks);

/**
 * 任务管理列表页 —— 路由 /pm/task(菜单由后端下发,后端的路径是插件源码路径,
 * 靠 config/routes.ts 里的重定向路由落到本页)。
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
  const navigate = useNavigate();
  /** AI 工作台 ↔ 主工作区的桥（讨论上下文 / 写回信号 / 展开侧栏） */
  const aiBridge = useModel('ai-bridge');

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
    projectTotal,
    milestoneTotal,
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

  /**
   * 「与 AI 讨论」：把**这一行**设为当前讨论对象。
   *
   * ⚠️ 上下文由**前端**组装（不发请求）：列表页手上就有这一行，
   *    而且聊的就是用户看到的这一行（服务端去查详情还要 `…:detail` 权限，
   *    只有列表权限的角色会被 403）。
   */
  const discussTask = useCallback(
    (record: TaskOut) => {
      const context = buildAiTaskContext({
        task: record,
        projectName:
          record.project_id == null
            ? undefined
            : projectNames.get(record.project_id),
        milestoneName:
          record.milestone_id == null
            ? undefined
            : milestoneNames.get(record.milestone_id),
        // 字典中文名：服务端渲染成「in_progress（进行中）」
        // ⇒ 模型照抄线上码就不会写出不存在的状态
        labels: mergeDictLabels(statusOptions, typeOptions, priorityOptions),
      });
      if (!context) {
        return;
      }
      aiBridge.setContext(context);
      // 面板可能是收着的 ⇒ 展开它（不然用户看不到「正在讨论 #123」）
      aiBridge.requestExpand();
      // ⚠️ 顺便切到「对话」页签：点完「讨论」就该**马上能说话**
      aiBridge.requestFocus();
    },
    [
      aiBridge,
      milestoneNames,
      priorityOptions,
      projectNames,
      statusOptions,
      typeOptions,
    ],
  );

  const columns: ProColumns<TaskOut>[] = [
    ...taskColumns({
      statusValueEnum,
      priorityValueEnum,
      typeValueEnum,
      projectOptions,
      projectNames,
      milestoneNames,
      onDiscuss: discussTask,
    }),
  ];

  const operationColumns = useCrudColumns<TaskOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_pm_project:pm_task:update',
    deletePerm: 'module_pm_project:pm_task:delete',
    entityName: '任务',
  });

  /**
   * AI 写回成功 ⇒ 刷新表格 + 高亮那一行。
   *
   * ⚠️ 不刷新的话，用户看到的是「AI 说改好了，可我这边还是旧数据」
   *    ⇒ 看着像没生效。
   */
  const reloadTasks = useCallback(() => {
    crud.actionRef.current?.reload();
  }, [crud.actionRef]);
  const { rowClassName } = useAiTaskUpdate(reloadTasks);

  /*
    侧载有上限(后端 page_size 最大 100):项目与里程碑都会越攒越多,
    侧载到的是最新的 100 条 ⇒ 更早的实体在表格里查不到名字(显示为 -)。
    这条上限**不静默**:侧载被截断时给一条提示(与看板页、风险页同款)。

    ⚠️ 提示只说**真的被截断的那一个**:项目多、里程碑少是常态,把没被截断的
    也写进去等于夸大。侧载到的条数与后端的总数都比一比才知道截没截。
  */
  const projectTruncated = projectTotal > projectOptions.length;
  const milestoneTruncated = milestoneTotal > milestoneOptions.length;
  const sideLoadTruncated = projectTruncated || milestoneTruncated;
  const truncatedText = [
    projectTruncated
      ? `一共 ${projectTotal} 个项目,侧载只拿到最新的 ${projectOptions.length} 个,更早的在表格里显示为 -`
      : null,
    milestoneTruncated
      ? `一共 ${milestoneTotal} 个里程碑,侧载只拿到最新的 ${milestoneOptions.length} 个,更早的在表格里显示为 -`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(';');

  return (
    <>
      {sideLoadTruncated ? (
        <Alert
          type="info"
          showIcon
          title="项目名/里程碑名来自侧载列表,后端一次最多给 100 条"
          description={`${truncatedText}。表单的「所属里程碑」下拉按所选项目单独拉取(只含所选项目的里程碑),但它自己也受后端 100 条的上限约束 —— 所选项目的里程碑超过 100 个时,下拉里只有最新的 100 个。`}
        />
      ) : null}
      <ProTable<TaskOut>
        headerTitle="任务管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestTasks}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        // (内容区被右侧的 AI 工作台占掉一块,列宽被压到最小就会这样)
        scroll={{ x: 'max-content' }}
        // AI 写回成功 ⇒ 刚改的那一行高亮一下
        rowClassName={rowClassName}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        toolBarRender={() => [
          /*
            看板页(/pm/task/board)的入口:后端的菜单种子**没有**看板这一项
            (看板是子页面,不是独立菜单),所以入口放在列表页的工具栏上,
            与项目列表用「项目名称」链到详情页是同一个路子。
          */
          <Button
            key="board"
            icon={<AppstoreOutlined />}
            onClick={() => navigate('/pm/task/board')}
          >
            看板
          </Button>,
          /*
            甘特页(/pm/task/gantt)的入口:与看板同理 —— 后端的菜单种子没有
            这一项(它是子页面,不是独立菜单),所以入口放在列表页工具栏上。
          */
          <Button
            key="gantt"
            icon={<BarChartOutlined />}
            onClick={() => navigate('/pm/task/gantt')}
          >
            甘特
          </Button>,
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
        optionsLoading={optionsLoading}
      />
    </>
  );
};

export default TaskManagement;
