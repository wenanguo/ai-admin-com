import type { TaskOut, TaskUpdateParams } from '@/services/api/pm/task';

/**
 * 甘特拖拽写回的载荷层 —— 把「拖拽后的新日期」翻译成后端要的更新载荷。
 *
 * 为什么单独一个纯函数文件:这一层不碰 dhtmlx、不发请求、不依赖 React,
 * 「拖一次到底要提交什么」的语义全在这一个地方说清楚;视图层只管在
 * 拖拽事件里调用它、拿返回值去 PUT。
 *
 * 关键口径(来自后端约束):
 * - 后端更新是**整对象 PUT**(`ModulePmTaskUpdateSchema` 继承 CreateSchema,
 *   没有 PATCH)⇒ 必填集与新增相同,少一个都 422;
 * - 更新**不带** `reporter_id` / `sort_order` / `created_via_code` 三列
 *   (后端 `model_dump(exclude_unset=True)`,不带的字段原样保留库里的值);
 * - 拖拽只该改两个日期 ⇒ 其余字段一律从拖动前的那份 `TaskOut` 拷(读-改-写)。
 */

/** 拖拽带来的日期变化:dhtmlx 侧用 end_date,后端侧叫 due_date */
export interface TaskDateChange {
  /** 新的计划开始日期(YYYY-MM-DD) */
  start_date: string;
  /** 新的计划截止日期(YYYY-MM-DD)—— 后端字段名是 due_date */
  end_date: string;
}

/**
 * dhtmlx 行 → 日期变化:只做**改名**,不做别的加工。
 *
 * dhtmlx 那边叫 `end_date`,后端叫 `due_date`,两边都是 YYYY-MM-DD 的串,
 * 原样搬过去即可 —— 任何「顺手截断/格式化」都是多一次出错的机会。
 * 缺值给空串:dhtmlx 的任务条一定有起止,真有缺值时下游的必填校验会挡住。
 */
export function toDateChange(task: {
  start_date?: string;
  end_date?: string;
}): TaskDateChange {
  return {
    start_date: task.start_date ?? '',
    end_date: task.end_date ?? '',
  };
}

/**
 * 拖动前的任务 + 日期变化 ⇒ 更新载荷;旧数据缺必填字段时返回 `null`。
 *
 * 返回 `null` 而不是「缺字段的半个对象」:后端整对象 PUT 缺任一必填字段
 * 就是 422。与其发一个注定失败的请求,不如让调用方当场报错/跳过。
 *
 * 可选字段的搬运规则:`before` 里**有**的才带上(值原样,包括 null);
 * `before` 里没有的就不带 ⇒ 后端 `exclude_unset=True` 原样保留库里的值,
 * 拖一次日期不会把没加载到的字段写成 null。
 */
export function buildDateUpdatePayload(
  before: TaskOut,
  change: TaskDateChange,
): TaskUpdateParams | null {
  const { project_id, title, type_code, status_code, priority_code } = before;

  // 必填集与新增相同(project_id / title / type_code / status_code / priority_code)
  if (
    project_id == null ||
    !title ||
    !type_code ||
    !status_code ||
    !priority_code
  ) {
    return null;
  }

  const payload: TaskUpdateParams = {
    project_id,
    title,
    type_code,
    status_code,
    priority_code,
    // 这次拖拽唯一要改的两列
    start_date: change.start_date,
    due_date: change.end_date,
  };

  // 其余字段从拖动前那份数据原样搬过来(整对象 PUT 不能丢字段)
  if (before.milestone_id !== undefined)
    payload.milestone_id = before.milestone_id;
  if (before.parent_id !== undefined) payload.parent_id = before.parent_id;
  if (before.description !== undefined)
    payload.description = before.description;
  if (before.estimate_hours !== undefined)
    payload.estimate_hours = before.estimate_hours;
  if (before.actual_hours !== undefined)
    payload.actual_hours = before.actual_hours;
  if (before.assignee_id !== undefined)
    payload.assignee_id = before.assignee_id;
  if (before.reviewers !== undefined) payload.reviewers = before.reviewers;
  if (before.labels !== undefined) payload.labels = before.labels;
  if (before.blocked_reason !== undefined)
    payload.blocked_reason = before.blocked_reason;

  return payload;
}
