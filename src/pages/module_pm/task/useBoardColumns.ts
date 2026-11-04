import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDictOptions } from '@/components/pm/useDictOptions';
import type { TaskOut, TaskUpdateParams } from '@/services/api/pm/task';
import { listTasks, updateTask } from '@/services/api/pm/task';

/**
 * 看板的六列与「拖拽改状态」。
 *
 * 三条纪律:
 * 1. **只改 status_code 一个维度**:拖拽不跨里程碑、不换负责人、不动优先级 ——
 *    其余维度的修改走列表页的编辑弹窗。
 * 2. **整对象 PUT**:后端的更新 schema 继承创建 schema(没有 PATCH),
 *    缺一个必填字段就 422 ⇒ 请求体从**卡片自己的数据**拼出来。
 * 3. **写失败回滚**:卡片先落到目标列(乐观更新),写失败就放回原列;
 *    错误提示由请求层统一弹,这里只管位置。
 */

/** 看板列的线上码(字典 module_pm_task_status 里「还在流转」的六态) */
export type BoardStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done';

/**
 * 看板的六列(顺序即显示顺序)。
 *
 * ⚠️ 字典 module_pm_task_status 有**七**态,多出来的 `cancelled`(已取消)
 * **不进看板** —— 取消掉的任务已经退出工作流,取消操作走列表页的编辑弹窗。
 *
 * title 是**兜底文案**:列标题优先取字典的标签(字典改了就跟着改),
 * 字典没就绪时先用这里的文案,看板不会先空一片再跳字。
 */
export const BOARD_COLUMNS: { status: BoardStatus; title: string }[] = [
  { status: 'backlog', title: '待规划' },
  { status: 'todo', title: '待办' },
  { status: 'in_progress', title: '进行中' },
  { status: 'blocked', title: '阻塞' },
  { status: 'review', title: '评审' },
  { status: 'done', title: '已完成' },
];

/**
 * 看板一次拉满:后端 page_size 的上限是 100(PaginationQueryParam)。
 *
 * ⚠️ **看板只拉得到前 100 个任务** —— 排在后面的任务在看板上不出现
 * (页面上会有一条提示,不静默截断)。而且拉回来的任务里**已取消的会被丢掉**
 * (cancelled 不在六列里),所以卡片数可能比 100 还少。
 * 要翻页看全量请去任务列表页。
 */
const BOARD_LIST_PARAMS = { page_no: 1, page_size: 100 } as const;

/** 看板的一列 */
export interface BoardColumn {
  /** 列的线上码 */
  status: BoardStatus;
  /** 列标题(字典标签;字典没就绪时是兜底文案) */
  title: string;
  /** 这一列里的卡片 */
  tasks: TaskOut[];
}

/** useBoardColumns 的返回值 */
export interface BoardColumns {
  /** 六列(空列也在 —— 拖拽要有落点) */
  columns: BoardColumn[];
  /** 首屏还在拉 */
  loading: boolean;
  /** 后端一共多少个任务 */
  total: number;
  /** 看板被后端的 100 条上限截断了(只拉了第一页) */
  truncated: boolean;
  /** 把卡片挪到目标列:乐观更新 + 写失败回滚 */
  moveTask: (taskId: number, target: BoardStatus) => Promise<void>;
}

/**
 * 卡片 → 整对象 PUT 的请求体(只改 status_code)。
 *
 * 后端的 `ModulePmTaskUpdateSchema` 继承创建 schema,**没有 PATCH** ——
 * 缺一个必填字段就 422,所以卡片自己的字段要原样带回。
 *
 * **不回头 GET 详情**:看板的列表响应就是 `ModulePmTaskOutSchema`
 * (它继承创建 schema),卡片自带 PUT 需要的每一个字段;再 GET 一次只会
 * 多要一个 `…:detail` 权限(拖拽本身只要 `…:update`)。
 *
 * 三列**不是用户可编辑**的字段不带:reporter_id(创建人)、sort_order(看板排序)、
 * created_via_code(创建方式)—— 后端更新走 `model_dump(exclude_unset=True)`,
 * 不带的字段原样保留库里的值,带旧值反而是把库里的值原样写回去。
 */
function toUpdatePayload(
  task: TaskOut,
  statusCode: string,
): TaskUpdateParams | null {
  const { project_id, title, type_code, priority_code } = task;
  // 必填字段缺失的卡片不拖:后端的创建 schema 要求它们,缺一个 PUT 就 422
  if (
    project_id == null ||
    title == null ||
    type_code == null ||
    priority_code == null
  ) {
    return null;
  }

  return {
    project_id,
    title,
    type_code,
    priority_code,
    status_code: statusCode,
    milestone_id: task.milestone_id ?? null,
    parent_id: task.parent_id ?? null,
    description: task.description ?? null,
    estimate_hours: task.estimate_hours ?? null,
    actual_hours: task.actual_hours ?? null,
    assignee_id: task.assignee_id ?? null,
    reviewers: task.reviewers ?? null,
    labels: task.labels ?? null,
    start_date: task.start_date ?? null,
    due_date: task.due_date ?? null,
    blocked_reason: task.blocked_reason ?? null,
  };
}

/**
 * 看板的数据与「拖拽改状态」。
 *
 * 任务一次拉满(后端 page_size 上限 100),在**户端**按 status_code 分列 ——
 * 六列是产品的划分,不是后端的查询维度。
 */
export function useBoardColumns(): BoardColumns {
  const [tasks, setTasks] = useState<TaskOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // 列标题取字典(字典 module_pm_task_status 有七态,看板只用其中六态)
  const { options: statusOptions } = useDictOptions('module_pm_task_status');
  const statusLabels = useMemo(
    () => new Map(statusOptions.map((option) => [option.value, option.label])),
    [statusOptions],
  );

  useEffect(() => {
    let cancelled = false;
    listTasks(BOARD_LIST_PARAMS)
      .then((res) => {
        if (cancelled) return;
        setTasks(res?.data?.items ?? []);
        setTotal(res?.data?.total ?? 0);
        setLoading(false);
      })
      .catch(() => {
        // 失败提示由请求层统一弹,这里降级成空看板
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = useMemo<BoardColumn[]>(
    () =>
      BOARD_COLUMNS.map((column) => ({
        status: column.status,
        title: statusLabels.get(column.status) ?? column.title,
        // 不在六列里的任务(已取消)不进看板
        tasks: tasks.filter((task) => task.status_code === column.status),
      })),
    [tasks, statusLabels],
  );

  const moveTask = useCallback(
    async (taskId: number, target: BoardStatus) => {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) return;

      const from = task.status_code;
      // 落在原列:什么都不用做
      if (from === target) return;

      const payload = toUpdatePayload(task, target);
      if (!payload) return;

      // 乐观更新:卡片先落到目标列
      setTasks((prev) =>
        prev.map((item) =>
          item.id === taskId ? { ...item, status_code: target } : item,
        ),
      );

      try {
        await updateTask(taskId, payload);
      } catch {
        // 写失败:卡片回到原列(错误提示由请求层统一弹,这里只管位置)。
        // 只在卡片还停在目标列时回滚 —— 期间又被拖走的话,那次拖拽自己负责回滚
        setTasks((prev) =>
          prev.map((item) =>
            item.id === taskId && item.status_code === target
              ? { ...item, status_code: from }
              : item,
          ),
        );
      }
    },
    [tasks],
  );

  return {
    columns,
    loading,
    total,
    // 后端给的总数超过一页的容量 ⇒ 看板看到的是「前 100 个」
    truncated: total > BOARD_LIST_PARAMS.page_size,
    moveTask,
  };
}
