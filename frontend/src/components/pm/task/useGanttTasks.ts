import { useCallback, useMemo } from 'react';
import type { GanttMapping } from '@/components/pm/gantt/mapping';
import {
  isTaskRowId,
  mapTasksToGantt,
  TASK_ROW_PREFIX,
} from '@/components/pm/gantt/mapping';
import type { TaskDateChange } from '@/components/pm/gantt/payload';
import { buildDateUpdatePayload } from '@/components/pm/gantt/payload';
import { useTaskDataset } from '@/components/pm/task/useTaskDataset';
import type { ProjectOption } from '@/components/pm/useProjectNames';
import { useProjectNames } from '@/components/pm/useProjectNames';
import type { TaskOut } from '@/services/api/pm/task';
import { updateTask } from '@/services/api/pm/task';

/**
 * 甘特视图的数据层:取数 → 映射成甘特行 → 拖拽写回。
 *
 * 三条纪律:
 * 1. **一次一页**:后端 page_size 上限 100,一次拉满一页;后端给的总数比
 *    **本次取回的条数**多 ⇒ `truncated` 为 true,**不静默丢**(页面据此提示)。
 *    ⚠️ 截断是**分页口径**:`total > items.length`。「因缺起止日期画不出条形」
 *    由 `mapping.excludedCount` 单独表达 —— 两者不重叠,页面不会同时弹
 *    「被截断」和「N 个任务未显示」两条互相矛盾的提示。
 * 2. **名字靠侧载**:任务响应里没有 project_by / milestone_by,项目名与
 *    里程碑名走 `useProjectNames` 的侧载映射 —— 不自己再造一套请求。
 * 3. **写回只管成败**:拖拽后整对象 PUT(后端没有 PATCH);失败返回 false,
 *    错误提示由请求层统一弹。**回滚不在这里做** —— 调用方拿 false 就去
 *    `chartRef.current?.revertTask(rowId)`(hook 不知道甘特图长什么样)。
 */

/** useGanttTasks 的返回值 */
export interface UseGanttTasksResult {
  /** 映射好的甘特行 + 被排除任务的统计 */
  mapping: GanttMapping;
  /** 首屏还在拉 */
  loading: boolean;
  /** 后端一共多少个任务 */
  total: number;
  /**
   * 后端总数大于**本次取回的条数** ⇒ 甘特只看到了一部分。
   *
   * 口径是**分页**:`total > items.length`。「因缺日期画不出条形」不算截断,
   * 那由 `mapping.excludedCount` 单独表达。
   */
  truncated: boolean;
  /**
   * 拖拽写回:成功 true / 失败 false。
   *
   * 失败(含「行不存在」「必填字段缺失」「日期为空」)都**不发请求**或把错误
   * 吞成 false —— 调用方据此回滚甘特行。
   */
  applyDateChange: (rowId: string, change: TaskDateChange) => Promise<boolean>;
  /** 重新取数 */
  reload: () => void;
  /**
   * 后端返回的**原始任务行**(未映射)。
   *
   * 给「编辑」用:甘特行(GanttRow)只有标题/日期/状态这些展示字段,
   * 而编辑表单要的是**完整的任务行**(类型、优先级、标签、负责人…),
   * 后端更新又是**整对象 PUT**(缺必填字段就 422)⇒ 必须拿原始行填表。
   */
  tasks: TaskOut[];
  /**
   * 项目下拉选项(筛选与表单共用)。
   *
   * 钩子内部本来就侧载了项目/里程碑 ⇒ 这里**透出去**给页面用,
   * 页面不要再单独调一次 `useProjectNames`(那会把侧载请求发两遍)。
   */
  projectOptions: ProjectOption[];
  /** 侧载是否还在途(表单的下拉在途时是空的) */
  optionsLoading: boolean;
  /** 项目 id → 项目名(讨论上下文里要带「所属项目」) */
  projectNames: Map<number, string>;
  /** 里程碑 id → 里程碑名(讨论上下文里要带「所属里程碑」) */
  milestoneNames: Map<number, string>;
}

/** 行 id → 任务 id(不是任务行就返回 null) */
export function rowIdToTaskId(rowId: string): number | null {
  // ⚠️ **分组行(项目/里程碑)直接拒绝**:规格 §6.3 说分组行不可拖,
  // 它的汇总条只反映子任务窗口;后端也没有「项目行」这种对象 ⇒
  // 写回去必然 422 ⇒ 直接不发请求(不发就是最快的拒绝)。
  if (!isTaskRowId(rowId)) return null;
  const id = Number(rowId.slice(TASK_ROW_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 甘特视图的数据。
 *
 * @param options.projectId 数据集的**范围**（限定到某个项目 ⇒ 后端请求带 project_id）
 * @param options.filterProjectId 在**已加载的数据集**里再收窄（甘特页面上的项目下拉）
 *   ⚠️ 不再改后端请求 ⇒ 改下拉不用重新取数 ⇒ 切视图也不用重新取数
 */
export function useGanttTasks(options?: {
  projectId?: number;
  filterProjectId?: number;
}): UseGanttTasksResult {
  const projectId = options?.projectId;
  const filterProjectId = options?.filterProjectId;

  // 项目名/里程碑名:侧载(useProjectNames),不自己发请求
  const {
    projectNames,
    milestoneNames,
    projectOptions,
    loading: optionsLoading,
  } = useProjectNames();

  /*
    **共享任务数据集** —— 与列表、看板是同一份数据。
    ⇒ 切到甘特不用重新取数；甘特拖完日期，列表里立刻能看到变化。
  */
  const { tasks, total, loading, truncated, reload, patchTask } =
    useTaskDataset({ projectId });

  // ⚠️ **本地按项目收窄**：下拉选的项目只在这份数据里筛（不再改后端请求）
  const visibleTasks = useMemo(
    () =>
      filterProjectId == null
        ? tasks
        : tasks.filter((task) => task.project_id === filterProjectId),
    [filterProjectId, tasks],
  );

  // 行数据:任务 + 侧载名字 ⇒ 甘特行
  const mapping = useMemo(
    () =>
      mapTasksToGantt(visibleTasks, {
        projects: projectNames,
        milestones: milestoneNames,
      }),
    [visibleTasks, projectNames, milestoneNames],
  );

  const applyDateChange = useCallback(
    async (rowId: string, change: TaskDateChange) => {
      const taskId = rowIdToTaskId(rowId);
      if (taskId == null) return false;

      // 按行 id 找原始任务:找不到就没得写(不发请求)
      const task = tasks.find((item) => item.id === taskId);
      if (!task) return false;

      // 日期为空 ⇒ 写过去也是坏数据,不发请求
      if (!change.start_date || !change.end_date) return false;

      // 旧数据缺必填字段 ⇒ 整对象 PUT 注定 422,不发请求
      const payload = buildDateUpdatePayload(task, change);
      if (!payload) return false;

      try {
        await updateTask(taskId, payload);
        // ⚠️ 写回成功后要把新日期写回**本地 state**:
        // mapping 的 useMemo 依赖 projectNames/milestoneNames ⇒ 侧载的名字晚到时
        // mapping 会重算。若 state 里还是旧日期,重算出来的行就是旧日期 ⇒
        // 甘特图重新 parse() 时会把用户刚拖完的条「弹回」旧位置(而服务端已是新值)。
        // ⚠️ 改的是**共享数据** ⇒ 列表视图里那一行的日期也立刻变了
        patchTask({
          ...task,
          start_date: change.start_date,
          due_date: change.end_date,
        });
        return true;
      } catch {
        // 错误提示由请求层统一弹,这里只管成败(调用方拿 false 去回滚甘特行)
        return false;
      }
    },
    [patchTask, tasks],
  );

  return {
    mapping,
    loading,
    total,
    // 后端给的总数超过本次取回的条数 ⇒ 只看到了一部分(分页口径)。
    // ⚠️ 不能拿 mapping.taskCount 比:taskCount 只数**画进了甘特**的任务,
    // 「缺日期被排除」的任务会让它偏小 ⇒ 明明一页取完了却报截断,
    // 与 excludedCount 的提示互相矛盾。
    truncated,
    applyDateChange,
    reload,
    tasks,
    projectOptions,
    optionsLoading,
    projectNames,
    milestoneNames,
  };
}
