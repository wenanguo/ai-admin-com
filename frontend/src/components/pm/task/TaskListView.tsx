/**
 * **任务列表界面**（独立页与项目详情页共用）。
 *
 * ## 为什么抽出来
 *
 * 任务列表出现在两个地方：
 * - 菜单里的「任务」（`/pm/task`）—— **全部项目**的任务
 * - 项目详情页的「任务」页签 —— **当前这个项目**的任务
 *
 * ⚠️ 以前这是**两个各写各的页面**：字段不一样、呈现形态不一样
 * （一个是表格，另一个是「精简表格」/卡片/List）⇒ 用户看着像两个不同的页面，
 * 而且改一个字段要改两个地方。
 *
 * ⇒ 现在是**同一个组件**，唯一的差别是 `projectId`：
 * - 不传 ⇒ 全部项目（菜单里的入口）
 * - 传了 ⇒ 只看这个项目（项目详情页的页签）
 *
 * ## 别的页面想用这个界面
 *
 * ```tsx
 * <TaskListView />                        // 全部项目
 * <TaskListView projectId={projectId} />   // 只看某个项目
 * ```
 */
import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess, useModel } from '@umijs/max';
import { Alert, Button, Spin } from 'antd';
import type React from 'react';
import { useCallback, useMemo, useRef } from 'react';
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
import { createTask, deleteTasks, updateTask } from '@/services/api/pm/task';
import { filterTasks } from './filterTasks';
import TaskModalForm from './TaskModalForm';
import { useContentHeight } from './useContentHeight';
import { useTableBodyHeight } from './useTableBodyHeight';
import { useTaskDataset } from './useTaskDataset';

/** 任务列表界面的 props。 */
export interface TaskListViewProps {
  /**
   * 限定到某个项目。
   *
   * ⚠️ **不传 = 全部项目**（菜单里的入口）；传了 = 只看这个项目
   *    （项目详情页的「任务」页签）。
   */
  projectId?: number;
}

/**
 * 任务列表界面。
 *
 * 骨架逻辑（状态机 / 操作列 / 分页）在共享脚手架 `@/components/CrudTable` 里，
 * 这里只留「列定义 + service 调用 + 声明式 JSX」，与其它模块同范式。
 *
 * 一个特别之处：**任务响应里没有项目名与里程碑名**（后端的任务 schema 只带
 * assignee_by / reporter_by），所以项目与里程碑的名字是侧载列表在户端映射的
 * —— 一次拉两张表，列的 render 里查表，不是每行发请求。
 *
 * @param props `projectId` 限定项目；不传就是全部
 */
export function TaskListView({
  projectId,
}: TaskListViewProps): React.ReactElement {
  const access = useAccess();
  /** AI 工作台 ↔ 主工作区的桥（讨论上下文 / 写回信号 / 展开侧栏） */
  const aiBridge = useModel('ai-bridge');

  /*
    **共享任务数据集** —— 与看板/甘特用的是同一份数据。
    ⇒ 切视图不用重新取数；看板拖完状态，列表里立刻能看到变化。
  */
  const dataset = useTaskDataset({ projectId });

  /**
   * 数据集的**最新快照**（给异步回调用）。
   *
   * ⚠️ `requestLocal` 是个 async 回调 ⇒ 它拿到的必须是**调用那一刻**的
   *    dataset ⇒ 用 ref 每次渲染时更新（而不是闭包捕获旧值）。
   */
  const datasetRef = useRef(dataset);
  datasetRef.current = dataset;

  /**
   * 等数据集到位（issue #9）。
   *
   * ⚠️ **为什么必须等**：ProTable 的 `request` 是**同步的本地切片** ⇒ 数据集没回来时
   *    它立即 resolve 空数组 ⇒ ProTable 以为「加载完了」⇒ 不显示 loading
   *    ⇒ 用户看到「空列表 → 数据突然冒出来」。
   *
   * ⚠️ **为什么不能靠 ProTable 的 `loading` prop**：它会被 ProTable 的
   *    **内部请求状态覆盖**（外部 loading 只在 useFetchData 里当初值用）。
   *
   * ⚠️ **为什么不用 `ensureQueryData` 的 promise**：那个 promise 会被 memo 复用
   *    ⇒ 可能早就 resolved ⇒ `await` 它等于没等。
   *
   * ⇒ 轮询 `loading`（最多 10 秒）⇒ 表格不会被永远卡住。
   */
  const waitForDataset = useCallback(async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (!datasetRef.current.loading) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, []);

  /**
   * 列表视图的高度 = 内容区的可用高度（与看板/甘特同一口径，issue #9）。
   *
   * ⚠️ 以前是 ProTable 的**自然高度**（10 行/页 ≈ 600px）⇒ 三个视图高度对不上。
   */
  const {
    ref: listRef,
    element: listElement,
    height: listHeight,
  } = useContentHeight<HTMLDivElement>();
  /** 表格体的高度（让表格体吃满剩余高度、表头固定） */
  const tableBodyHeight = useTableBodyHeight(listElement, listHeight);

  // 载荷有两种形状:新增带创建三列,更新不带 —— 见 services/api/pm/task.ts
  const crud = useCrudTable<TaskOut, TaskCreateParams | TaskUpdateParams>({
    create: createTask,
    update: updateTask,
    remove: deleteTasks,
    // ⚠️ 写操作后要**重新取全量**（本地筛选的数据源变了），
    //    而不是刷 ProTable（刷了也只是把同一份数据重新切一遍）。
    reload: dataset.reload,
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

  /**
   * 列表的取数：**在本地做**（过滤 + 分页）。
   *
   * ⚠️ 筛选语义照后端（LIKE / eq 的区别）—— 见 ./filterTasks。
   */
  const requestLocal = useCallback(
    async (params: {
      current?: number;
      pageSize?: number;
      [key: string]: unknown;
    }) => {
      // ⚠️ **等数据集到位**（issue #9）：见 `waitForDataset` 的注释。
      await waitForDataset();
      const { current, pageSize, ...filters } = params;
      const filtered = filterTasks(datasetRef.current.tasks, filters);
      const size = pageSize ?? 10;
      const start = ((current ?? 1) - 1) * size;
      return {
        data: filtered.slice(start, start + size),
        total: filtered.length,
        success: true,
      };
    },
    [waitForDataset],
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
    dataset.reload();
  }, [dataset]);
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
    <div ref={listRef} style={{ height: listHeight, position: 'relative' }}>
      {sideLoadTruncated ? (
        <Alert
          type="info"
          showIcon
          title="项目名/里程碑名来自侧载列表,后端一次最多给 100 条"
          description={`${truncatedText}。表单的「所属里程碑」下拉按所选项目单独拉取(只含所选项目的里程碑),但它自己也受后端 100 条的上限约束 —— 所选项目的里程碑超过 100 个时,下拉里只有最新的 100 个。`}
        />
      ) : null}
      <ProTable<TaskOut>
        // ⚠️ **不要 headerTitle**:标题在工作台上(`TaskWorkspace` 的那行)
        //    ⇒ 这里再写一遍就是同一个标题出现两次
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestLocal}
        /*
          ⚠️ **项目限定不在这里**：数据集取数时就已经限定了项目
          （useTaskDataset({ projectId })）⇒ 这里再传一遍是多余的。

          `__v` 是**数据集的版本号**（react-query 的 dataUpdatedAt）：
          数据集变了（写操作后重新取数、看板拖拽改状态）⇒ ProTable 重跑
          一次本地切片 ⇒ 表格立刻是新的。
          ⚠️ 它不在可搜索字段的白名单里 ⇒ 不会被当成筛选条件（见 filterTasks）。
        */
        params={{ __v: dataset.dataUpdatedAt }}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        /*
          ⚠️ **载入中要有提示**（issue #9）：
          `request` 是**同步的本地切片**（数据来自 `useTaskDataset`）⇒ 数据集没回来时
          它立即 resolve 一个空数组 ⇒ ProTable 认为「加载完成」⇒ 显示「暂无数据」
          ⇒ 用户看到「空列表 → 数据突然冒出来」。
          ⇒ 真正的解法在 `requestLocal` 里（`await dataset.ready`）：
            外部的 `loading` prop 会被 ProTable 的内部请求状态覆盖，不可靠。
        */
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        // (内容区被右侧的 AI 工作台占掉一块,列宽被压到最小就会这样)
        //
        // ⚠️ `y` = 表格体高度 ⇒ 表格体**内部滚动**、表头固定，
        //    高度跟着内容区走（三个视图统一，issue #9）
        scroll={{
          x: 'max-content',
          ...(tableBodyHeight === undefined ? {} : { y: tableBodyHeight }),
        }}
        // AI 写回成功 ⇒ 刚改的那一行高亮一下
        rowClassName={rowClassName}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        toolBarRender={() => [
          /*
            ⚠️ 看板/甘特的入口**不在这里了** —— 它们现在是**同一个页面**的
            另外两种视图（顶上的 Segmented 切）。
          */
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
      {/*
        ⚠️ **载入指示自己做**（issue #9）：
        ProTable 自带的 loading 遮罩挂在**表格体**上 ⇒ 表格体还没数据时高度为 0
        ⇒ 遮罩看不见 ⇒ 用户只看到「空列表」。

        ⇒ 这里在视图层画一个覆盖层（居中 Spin + 半透明底）⇒ 跟其它页面的
           载入表现一致，用户不会以为「这就是全部数据」。
      */}
      {dataset.loading ? (
        <div
          data-role="task-list-loading"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255, 255, 255, 0.55)',
            zIndex: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Spin />
            <span style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)' }}>
              载入中…
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
