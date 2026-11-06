import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GanttMapping } from '@/components/pm/gantt/mapping';
import { mapTasksToGantt } from '@/components/pm/gantt/mapping';
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
 *    画出来的任务行数多 ⇒ `truncated` 为 true,**不静默丢**(页面据此提示)。
 * 2. **名字靠侧载**:任务响应里没有 project_by / milestone_by,项目名与
 *    里程碑名走 `useProjectNames` 的侧载映射 —— 不自己再造一套请求。
 * 3. **写回只管成败**:拖拽后整对象 PUT(后端没有 PATCH);失败返回 false,
 *    错误提示由请求层统一弹。**回滚不在这里做** —— 调用方拿 false 就去
 *    `chartRef.current?.revertTask(rowId)`(hook 不知道甘特图长什么样)。
 */

/** 一次拉一页(后端 page_size 的上限就是 100) */
const GANTT_LIST_PARAMS = { page_no: 1, page_size: 100 } as const;

/** 任务行 id 的前缀(与映射层一致:`t-{id}`) */
const TASK_ROW_PREFIX = 't-';

/** useGanttTasks 的返回值 */
export interface UseGanttTasksResult {
  /** 映射好的甘特行 + 被排除任务的统计 */
  mapping: GanttMapping;
  /** 首屏还在拉 */
  loading: boolean;
  /** 后端一共多少个任务 */
  total: number;
  /** 后端总数大于画出来的任务行数 ⇒ 甘特只看到了一部分 */
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
  if (!rowId.startsWith(TASK_ROW_PREFIX)) return null;
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
    // 后端给的总数超过画出来的任务行数 ⇒ 只看到了一部分
    truncated: total > mapping.taskCount,
    applyDateChange,
    reload,
  };
}
