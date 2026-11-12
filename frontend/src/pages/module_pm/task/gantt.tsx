import { PlusOutlined } from '@ant-design/icons';
import { Link, useAccess, useModel, useSearchParams } from '@umijs/max';
import { Alert, App, Button, Empty, Segmented, Select, Spin } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCrudTable } from '@/components/CrudTable';
import { buildAiTaskContext, mergeDictLabels } from '@/components/pm/aiContext';
import type {
  GanttChartHandle,
  GanttRowAction,
} from '@/components/pm/gantt/GanttChart';
import { GanttChart } from '@/components/pm/gantt/GanttChart';
import {
  computeTimelineWidth,
  NARROW_TIMELINE_WIDTH,
} from '@/components/pm/gantt/layout';
import type { TaskDateChange } from '@/components/pm/gantt/payload';
import TaskModalForm from '@/components/pm/task/TaskModalForm';
import { useAiTaskUpdate } from '@/components/pm/useAiTaskUpdate';
import { useDictOptions } from '@/components/pm/useDictOptions';
import type {
  TaskCreateParams,
  TaskOut,
  TaskUpdateParams,
} from '@/services/api/pm/task';
import { createTask, deleteTasks, updateTask } from '@/services/api/pm/task';
import { rowIdToTaskId, useGanttTasks } from './useGanttTasks';

/**
 * 任务甘特页 —— 路由 /pm/task/gantt。
 *
 * 甘特**没有菜单入口**:后端的菜单种子只种了列表页,甘特是子页面 ——
 * 入口在任务列表页的工具栏按钮(见 src/pages/module_pm/task/index.tsx),
 * 本页顶部给一条回列表的路(与看板页同款)。
 *
 * 四条纪律:
 * 1. **不静默丢**:
 *    - 「后端总数 > 本次取回的条数」⇒ 提示「共 N 条,已显示前 M 条」(分页口径);
 *    - 「缺计划起止日期,画不出条形」⇒ 提示「N 个任务没有计划起止日期,未显示」。
 *    两条**不混成一条**:前者是「没取到」,后者是「取到了但画不出来」。
 *    ⚠️ 两条提示里的数字**各说各的,不许互相矛盾**:
 *    - 「已显示前 M 条」的 M = **真正画进甘特的条数**(mapping.taskCount)
 *      —— 缺日期被排除的任务**画不出来**,算进 M 就是骗人
 *      (取回 100 条、其中 5 条缺日期 ⇒ 实际只画了 95 条,M 就得是 95);
 *    - 「N 个任务…未显示」的 N = mapping.excludedCount(取到了但没显示)。
 * 2. **拖拽写回**:整对象 PUT(后端没有 PATCH),写失败把条形**弹回**原位;
 *    错误提示由请求层统一弹,页面自己不弹 message。
 * 3. **页面不自己发 message**:成功/失败都不弹,只回滚界面。
 * 4. **页面本身不滚**(规格 §5.5):沿用 app shell 的满高布局 ⇒ 图表高度
 *    跟着**可用高度**走(不是写死的 520),左表格与时间轴共用 dhtmlx 的
 *    垂直滚动 ⇒ 屏幕上只有一条滚动条。
 */

/** 缩放级别(与 GanttChart 的 setZoom 一致) */
type ZoomLevel = 'day' | 'week' | 'month';

/** 页面可用高度的兜底值(还没量到之前的初值) */
const DEFAULT_PAGE_HEIGHT = 640;

/** 图表高度的兜底值 */
const DEFAULT_CHART_HEIGHT = 420;

/** 页面可用高度的下限(太矮就没法看了) */
const MIN_PAGE_HEIGHT = 320;

/**
 * 最近的「**自己会滚**」的祖先(内容区)。
 *
 * ⚠️ app shell 的内容区(`ai-workspace-content`)是 `overflow-y: auto` 的
 * 满高容器 ⇒ 页面要跟着它的**可用高度**走,而不是跟着视口走
 * (顶栏、AI 工作台、面包屑都在它上面)。
 */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * 页面**下面**还占着多少高度(页脚等)。
 *
 * ⚠️ app shell 的页脚是内容区里页面的**兄弟节点** ⇒ 页面高度必须把它
 * 也算进去,否则内容区就会多出一条滚动条(页面自己滚了)。
 */
function spaceBelow(page: HTMLElement, scrollParent: HTMLElement): number {
  /** 一个元素占的总高度(内容 + 上下外边距) */
  const occupied = (element: HTMLElement): number => {
    const style = window.getComputedStyle(element);
    const marginTop = Number.parseFloat(style.marginTop) || 0;
    const marginBottom = Number.parseFloat(style.marginBottom) || 0;
    return element.getBoundingClientRect().height + marginTop + marginBottom;
  };

  let total = 0;
  let node: HTMLElement = page;
  while (node.parentElement && node.parentElement !== scrollParent) {
    let sibling = node.nextElementSibling as HTMLElement | null;
    while (sibling) {
      total += occupied(sibling);
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }
    node = node.parentElement;
  }
  // node 现在是内容区的直接子元素 ⇒ 它的后续兄弟(页脚)也要算
  let sibling = node.nextElementSibling as HTMLElement | null;
  while (sibling) {
    total += occupied(sibling);
    sibling = sibling.nextElementSibling as HTMLElement | null;
  }
  return total;
}

/** 甘特页 */
const TaskGantt: React.FC = () => {
  const access = useAccess();
  /** 二次确认弹窗(用 App 的实例,主题才跟着) */
  const { modal } = App.useApp();
  /** AI 工作台 ↔ 主工作区的桥(讨论上下文 / 写回信号 / 展开侧栏) */
  const aiBridge = useModel('ai-bridge');

  /** 按项目筛选(后端列表接口的 project_id 参数) */
  /*
    从项目详情页的「任务」页签点「甘特」进来时，地址上带着 project_id
    ⇒ 甘特也只看**这个项目**（否则项目限定会在跳转里悄悄丢掉）。
  */
  const [searchParams] = useSearchParams();
  const [projectId, setProjectId] = useState<number | undefined>(
    searchParams.get('project_id')
      ? Number(searchParams.get('project_id'))
      : undefined,
  );
  /** 缩放级别(「日/周/月」 */
  const [zoom, setZoom] = useState<ZoomLevel>('week');

  const {
    mapping,
    loading,
    total,
    truncated,
    applyDateChange,
    reload,
    tasks,
    projectOptions,
    optionsLoading,
    projectNames,
    milestoneNames,
  } = useGanttTasks({ projectId });

  /** 甘特图的命令式句柄(回滚 / 缩放 / 滚动) */
  const chartRef = useRef<GanttChartHandle | null>(null);
  /** 页面根元素(量「可用高度」用) */
  const pageRef = useRef<HTMLDivElement | null>(null);
  /** 宽度观察器(容器出现/消失时都要重建) */
  const observerRef = useRef<ResizeObserver | null>(null);
  /** 页面可用高度(内容区里还剩多少) */
  const [pageHeight, setPageHeight] = useState(DEFAULT_PAGE_HEIGHT);
  /** 图表高度(跟着容器走) */
  const [chartHeight, setChartHeight] = useState(DEFAULT_CHART_HEIGHT);
  /** 图表容器宽度(用来算时间轴还剩多宽) */
  const [containerWidth, setContainerWidth] = useState(0);

  // 项目筛选的候选:侧载的项目列表(不自己发请求)
  //
  // ⚠️ 项目/里程碑的侧载在 useGanttTasks 内部已经做过了 ⇒ 这里直接用
  // 钩子透出来的选项,**不再单独调一次 useProjectNames**(那会把侧载
  // 请求发两遍 —— 项目、里程碑各两遍)。
  // 里程碑名在分组行的标题上,由钩子内部的映射提供。

  // 状态/优先级的显示文案:查字典(线上码 → 中文);查不到就回退线上码
  const { options: statusOptions } = useDictOptions('module_pm_task_status');
  const { options: priorityOptions } = useDictOptions('module_pm_priority');
  const { options: typeOptions } = useDictOptions('module_pm_task_type');

  const labels = useMemo(
    () => ({
      status: Object.fromEntries(
        statusOptions.map((option) => [option.value, option.label]),
      ),
      priority: Object.fromEntries(
        priorityOptions.map((option) => [option.value, option.label]),
      ),
    }),
    [statusOptions, priorityOptions],
  );

  /**
   * 传给甘特图的行数据。
   *
   * ⚠️ **必须 useMemo 住身份**:GanttChart 在 `data` 身份变化时会重新灌
   * 数据(拖动还在飞的行会保住用户拖到的位置,写失败后仍能回滚)。
   * 页面每次渲染都造新数组的话,拖动位置会被反复重置。
   */
  const data = useMemo(() => mapping.data, [mapping.data]);

  /**
   * 量「可用高度」:内容区(clientHeight)减去页面已经占掉的部分。
   *
   * ⇒ 页面高度 = 可用高度 ⇒ **页面自己不滚**(规格 §5.5),
   * 滚动条只在 dhtmlx 的左表格/时间轴里。
   */
  const measurePageHeight = useCallback(() => {
    const page = pageRef.current;
    if (!page) return;
    const scrollParent = findScrollParent(page);
    if (!scrollParent) return;
    const pageRect = page.getBoundingClientRect();
    const parentStyle = window.getComputedStyle(scrollParent);
    const paddingBottom = Number.parseFloat(parentStyle.paddingBottom) || 0;
    const pageStyle = window.getComputedStyle(page);
    const marginBottom = Number.parseFloat(pageStyle.marginBottom) || 0;
    const available = Math.round(
      scrollParent.clientHeight -
        // 页面已经占掉的顶部空间(内容区的内边距 + 页面自己的外边距)
        (pageRect.top - scrollParent.getBoundingClientRect().top) -
        // 页面下面还有的东西(页脚)
        spaceBelow(page, scrollParent) -
        marginBottom -
        paddingBottom,
    );
    setPageHeight(Math.max(MIN_PAGE_HEIGHT, available));
  }, []);

  // 内容区尺寸变了(窗口缩放、AI 工作台收放)⇒ 重新量可用高度
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const scrollParent = findScrollParent(page);
    if (!scrollParent) return;
    measurePageHeight();
    const observer = new ResizeObserver(() => measurePageHeight());
    observer.observe(scrollParent);
    return () => observer.disconnect();
  }, [measurePageHeight]);

  // 量容器宽度与图表高度
  //
  // ⚠️ 用**回调 ref**而不是 useEffect:图表容器只在「加载完了且有任务」时
  // 才挂载 ⇒ useEffect(…, []) 跑的时候它还不存在,量不到。
  const attachChartBox = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const measure = () => {
      setContainerWidth(element.clientWidth);
      setChartHeight(element.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  // 卸载时断开观察器
  useEffect(() => () => observerRef.current?.disconnect(), []);

  /**
   * 拖拽结束:写回;写失败就把条弹回拖动前的位置。
   *
   * ⚠️ 写回**成功**时不用回滚 —— 数据 hook 已经把新日期写回本地 state,
   * 甘特图会按新数据重画,条就停在用户拖的位置上。
   */
  const handleTaskDragEnd = useCallback(
    async (rowId: string, change: TaskDateChange) => {
      const ok = await applyDateChange(rowId, change);
      if (!ok) {
        chartRef.current?.revertTask(rowId);
      }
    },
    [applyDateChange],
  );

  /** 拖拽改期要 update 权限;没有就只能看 */
  const canUpdate = access.hasPermission('module_pm_project:pm_task:update');
  /** 新建任务要 create 权限 */
  const canCreate = access.hasPermission('module_pm_project:pm_task:create');
  /** 删除任务要 delete 权限 */
  const canDelete = access.hasPermission('module_pm_project:pm_task:delete');

  /**
   * 增删改:甘特页也有这三个动作。
   *
   * ⚠️ 甘特页**没有 ProTable** ⇒ `useCrudTable` 的默认刷新(刷 ProTable)
   * 在这儿是空转 ⇒ 必须把自己的刷新回调(`reload`,重新取数)传进去,
   * 否则新建/编辑/删除之后页面纹丝不动 ⇒ 看着像「没生效」。
   */
  /** AI 写回成功 ⇒ 重新取数(甘特上的条形与日期要跟着变) */
  useAiTaskUpdate(reload);

  const crud = useCrudTable<TaskOut, TaskCreateParams | TaskUpdateParams>({
    create: createTask,
    update: updateTask,
    remove: deleteTasks,
    reload,
  });

  /**
   * 行操作(操作列的「编辑」/「删除」按钮点一下)。
   *
   * ⚠️ **编辑要用原始任务行**:后端更新是**整对象 PUT**(缺必填字段就 422)
   * ⇒ 表单必须拿齐类型/优先级/标签等全部字段。甘特行(GanttRow)只有展示
   * 用的那几个 ⇒ 这里用行 id 反查原始行。
   *
   * ⚠️ 删除要有二次确认:列表页用的是 Popconfirm(在表格单元格里),
   * 甘特的按钮在 dhtmlx 的网格里 ⇒ 用 antd 的确认弹窗。
   */
  const handleRowAction = useCallback(
    (action: GanttRowAction, rowId: string) => {
      const taskId = rowIdToTaskId(rowId);
      if (taskId == null) return;
      const task = tasks.find((item) => item.id === taskId);
      if (!task) return;

      if (action === 'edit') {
        crud.openEdit(task);
        return;
      }

      if (action === 'discuss') {
        // 「与 AI 讨论」：把这一行设为当前讨论对象(上下文由前端组装)
        const context = buildAiTaskContext({
          task,
          projectName:
            task.project_id == null
              ? undefined
              : projectNames.get(task.project_id),
          milestoneName:
            task.milestone_id == null
              ? undefined
              : milestoneNames.get(task.milestone_id),
          labels: mergeDictLabels(statusOptions, typeOptions, priorityOptions),
        });
        if (!context) return;
        aiBridge.setContext(context);
        aiBridge.requestExpand();
        // ⚠️ 顺便切到「对话」页签：点完「讨论」就该**马上能说话**
        aiBridge.requestFocus();
        return;
      }

      modal.confirm({
        title: '确认删除该任务?',
        content: `「${task.title ?? '该任务'}」删除后不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          // 失败提示由请求层统一弹;handleDelete 内部已经吞掉异常
          await crud.handleDelete(task);
        },
      });
    },
    [
      aiBridge,
      crud,
      milestoneNames,
      modal,
      priorityOptions,
      projectNames,
      statusOptions,
      tasks,
      typeOptions,
    ],
  );

  /** 本次取回的任务条数(画进甘特的 + 因缺日期被排除的) */
  const fetched = mapping.taskCount + mapping.excludedCount;
  /** 有没有可排期的任务(画进甘特的任务条数 > 0) */
  const hasChart = mapping.taskCount > 0;

  /**
   * 时间轴还剩多宽 ⇒ 挤不挤。
   *
   * ⚠️ 判据是**时间轴的宽度**(不是容器宽度):左表格的总宽是跟着容器
   * 走的(见 layout.ts),容器窄 ⇒ 表格窄 ⇒ 时间轴相对地宽一点。
   */
  const timelineWidth =
    containerWidth > 0 ? computeTimelineWidth(containerWidth) : 0;
  const narrow = timelineWidth > 0 && timelineWidth < NARROW_TIMELINE_WIDTH;

  return (
    <div
      ref={pageRef}
      className="flex flex-col gap-4"
      style={{ height: pageHeight }}
    >
      {/* 页面标题:与看板页同款 */}
      <div className="flex items-center gap-3">
        <span className="text-base font-semibold">任务甘特</span>
        {/* 甘特没有菜单入口,列表页才是入口 —— 这里给一条回去的路 */}
        <Link to="/pm/task" className="text-sm">
          返回任务列表
        </Link>
      </div>

      {truncated ? (
        <Alert
          type="info"
          showIcon
          title={`共 ${total} 条,已显示前 ${mapping.taskCount} 条`}
          description={`甘特一次只拉一页(后端 page_size 上限 100),本次取回 ${fetched} 条、其中 ${mapping.taskCount} 条画进了甘特;其余任务请到「任务管理」页查看。`}
        />
      ) : null}

      {mapping.excludedCount > 0 ? (
        <Alert
          type="info"
          showIcon
          title={`${mapping.excludedCount} 个任务没有计划起止日期,未显示`}
          description={
            mapping.excludedTitles.length > 0
              ? `例如:${mapping.excludedTitles.join('、')}。给任务补上计划开始与截止日期后就会出现在甘特上。`
              : '给任务补上计划开始与截止日期后就会出现在甘特上。'
          }
        />
      ) : null}

      {narrow ? (
        <Alert
          type="warning"
          showIcon
          title="时间轴空间有限？拖动左表格与时间轴之间的分隔条"
          description="往左拖分隔条可以把左表格收窄、时间轴放宽;拖到最左时时间轴能占满整宽。"
        />
      ) : null}

      {/* 工具栏:项目筛选 + 缩放 + 今天/适应 + 新增 */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          allowClear
          className="w-60"
          placeholder="按项目筛选"
          value={projectId}
          options={projectOptions}
          onChange={(value) => setProjectId(value ?? undefined)}
        />
        <Segmented<ZoomLevel>
          disabled={!hasChart}
          value={zoom}
          options={[
            { label: '日', value: 'day' },
            { label: '周', value: 'week' },
            { label: '月', value: 'month' },
          ]}
          onChange={(value) => {
            setZoom(value);
            chartRef.current?.setZoom(value);
          }}
        />
        {/* ⚠️ 没有可排期任务时图表根本没挂载 ⇒ 这两个按钮点了没反应
            (点了空气比不给点更糟)⇒ 直接禁用 */}
        <Button
          disabled={!hasChart}
          onClick={() => chartRef.current?.scrollToToday()}
        >
          今天
        </Button>
        <Button
          disabled={!hasChart}
          onClick={() => chartRef.current?.zoomToFit()}
        >
          适应
        </Button>
        {/* 新增任务:与列表页的工具栏同一个位置(操作在最后) */}
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canCreate}
          onClick={crud.openCreate}
          title="新建的任务要填「计划开始日期」「计划截止日期」才会出现在甘特上"
        >
          新增任务
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spin />
        </div>
      ) : mapping.taskCount === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="没有可排期的任务 —— 任务需要计划开始与截止日期才会出现在甘特上"
        />
      ) : (
        <div
          ref={attachChartBox}
          data-testid="pm-gantt-box"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <GanttChart
            ref={chartRef}
            data={data}
            readOnly={!canUpdate}
            labels={labels}
            height={chartHeight}
            canEdit={canUpdate}
            canDelete={canDelete}
            canDiscuss
            onRowAction={handleRowAction}
            onTaskDragEnd={(rowId, change) => {
              void handleTaskDragEnd(rowId, change);
            }}
          />
        </div>
      )}

      {/* 新增/编辑弹窗:与列表页共用同一个表单(后端契约只有一份) */}
      <TaskModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
        projectOptions={projectOptions}
        optionsLoading={optionsLoading}
      />
    </div>
  );
};

export default TaskGantt;
