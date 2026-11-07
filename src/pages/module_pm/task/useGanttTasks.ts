import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GanttMapping } from '@/components/pm/gantt/mapping';
import {
  isTaskRowId,
  mapTasksToGantt,
  TASK_ROW_PREFIX,
} from '@/components/pm/gantt/mapping';
import type { TaskDateChange } from '@/components/pm/gantt/payload';
import { buildDateUpdatePayload } from '@/components/pm/gantt/payload';
import type { TaskOut } from '@/services/api/pm/task';
import { listTasks, updateTask } from '@/services/api/pm/task';
import { useProjectNames } from './useProjectNames';

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

/** 一次拉一页(后端 page_size 的上限就是 100) */
const GANTT_LIST_PARAMS = { page_no: 1, page_size: 100 } as const;

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
}

/** 行 id → 任务 id(不是任务行就返回 null) */
function rowIdToTaskId(rowId: string): number | null {
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
 * @param options.projectId 给了就按项目筛(后端列表接口的 project_id 参数)
 */
export function useGanttTasks(options?: {
  projectId?: number;
}): UseGanttTasksResult {
  const projectId = options?.projectId;

  // 项目名/里程碑名:侧载(useProjectNames),不自己发请求
  const { projectNames, milestoneNames } = useProjectNames();

  const [tasks, setTasks] = useState<TaskOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /** reload 的计数器:变了就重新取数(用计数器而不是函数当依赖,省一个 ref) */
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTasks({
      ...GANTT_LIST_PARAMS,
      ...(projectId ? { project_id: projectId } : {}),
    })
      .then((res) => {
        if (cancelled) return;
        setTasks(res?.data?.items ?? []);
        setTotal(res?.data?.total ?? 0);
      })
      .catch(() => {
        // 失败提示由请求层统一弹,这里降级成空甘特
        if (!cancelled) {
          setTasks([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadCount]);

  // 行数据:任务 + 侧载名字 ⇒ 甘特行
  const mapping = useMemo(
    () =>
      mapTasksToGantt(tasks, {
        projects: projectNames,
        milestones: milestoneNames,
      }),
    [tasks, projectNames, milestoneNames],
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
        setTasks((previous) =>
          previous.map((item) =>
            item.id === taskId
              ? {
                  ...item,
                  start_date: change.start_date,
                  due_date: change.end_date,
                }
              : item,
          ),
        );
        return true;
      } catch {
        // 错误提示由请求层统一弹,这里只管成败(调用方拿 false 去回滚甘特行)
        return false;
      }
    },
    [tasks],
  );

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  return {
    mapping,
    loading,
    total,
    // 后端给的总数超过本次取回的条数 ⇒ 只看到了一部分(分页口径)。
    // ⚠️ 不能拿 mapping.taskCount 比:taskCount 只数**画进了甘特**的任务,
    // 「缺日期被排除」的任务会让它偏小 ⇒ 明明一页取完了却报截断,
    // 与 excludedCount 的提示互相矛盾。
    truncated: total > tasks.length,
    applyDateChange,
    reload,
  };
}
