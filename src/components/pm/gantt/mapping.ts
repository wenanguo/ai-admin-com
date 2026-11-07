import type { TaskOut } from '@/services/api/pm/task';

/**
 * 甘特映射层 —— 后端任务行(TaskOut)→ dhtmlx 甘特行。
 *
 * 为什么单独一个纯函数文件:这一层不碰 dhtmlx 实例、不发请求、不依赖 React,
 * 「层级怎么拼、哪些任务进不了甘特」的口径全在这一个地方说清楚;
 * 视图层只管把结果喂给 gantt 实例,拖拽写回时再按行 id 前缀反解出任务 id。
 *
 * 口径(与设计文档一致):
 * - 层级:项目 → 里程碑 → 任务;任务有 parent_id 时改挂父任务(parent_id >
 *   milestone_id > project_id),子任务画在父任务条下面;
 * - 缺计划起止日期的任务画不出条形:不进行、不分组,只计数 + 记标题
 *   (页头提示用,不能静默丢);
 * - 状态只给 class 名(见 statusCssClass),具体颜色在 gantt.css 按 antd token 写,
 *   这里不出现任何色值。
 */

/** dhtmlx 甘特的一行:项目/里程碑分组行与任务行共用 */
export interface GanttRow {
  /** 行 id:项目 p-{id} / 里程碑 m-{id} / 任务 t-{id} —— 前缀区分三类行 */
  id: string;
  /** 行文本:分组行用项目/里程碑名,任务行用标题 */
  text: string;
  /** 父行 id(项目行为根,不设) */
  parent?: string;
  /** 计划开始(YYYY-MM-DD)—— 只有任务行有,分组行留给 dhtmlx 自己汇总 */
  start_date?: string;
  /** 计划截止(YYYY-MM-DD)—— 只有任务行有 */
  end_date?: string;
  /** 负责人显示名(优先 name,缺则 username) */
  assignee?: string;
  /**
   * 优先级:本层只有后端的线上码,原样透传 —— 码→显示文本的翻译
   * 归视图层(用本仓的字典工具),这个文件不自己造映射。
   */
  priority?: string;
  /** 状态线上码(如 in_progress)—— 给列模板做字典翻译用 */
  status?: string;
  /** 条形 class(按状态)—— 只给 class 名,色值在 gantt.css */
  css?: string;
}

/** mapTasksToGantt 的返回:行数据 + 被排除任务的统计 */
export interface GanttMapping {
  /**
   * 甘特行。
   *
   * 行序 = **按任务出现的顺序分组**:同一批任务的项目行/里程碑行先出来,
   * 跟着它们的任务行。单项目时看着像「分组行在前、任务行在后」,多项目时
   * 是 `[p-1,m-2,t-10,p-2,m-3,t-11]` 交替。
   */
  data: GanttRow[];
  /** 缺计划起止日期而没进甘特的任务数 —— 页头提示「N 个任务未显示」用 */
  excludedCount: number;
  /** 被排除的任务标题(最多 5 条,给提示列举用;更多的只计数) */
  excludedTitles: string[];
  /**
   * 实际进了甘特的**任务行数**(不含项目/里程碑分组行)。
   *
   * 给页面显示「画进甘特的任务条数」用。
   *
   * ⚠️ **不用它判「被截断」**:截断是**分页口径**(后端总数 > 本次取回的条数),
   * 由 useGanttTasks 用 `total > items.length` 判。taskCount 只数画进甘特的
   * 任务,「缺日期被排除」的任务会让它偏小 ⇒ 拿它判截断会算出假截断,
   * 与「N 个任务未显示」的提示互相矛盾。
   */
  taskCount: number;
}

/** 被排除标题的列举上限:提示是「举例」不是「清单」,5 条足够说明问题 */
const EXCLUDED_TITLES_LIMIT = 5;

/**
 * 任务行 → dhtmlx 行。
 *
 * 分组行(项目/里程碑)按需惰性创建、按 id 去重:两个任务共用一个项目时,
 * 项目行只能有一条,否则 dhtmlx 里同 id 行互相覆盖。任务行的 parent 只在
 * 同一个任务的处理里取,不依赖输入顺序(子任务排在父任务前面也能正确挂上)。
 */
export function mapTasksToGantt(
  tasks: TaskOut[],
  names: { projects: Map<number, string>; milestones: Map<number, string> },
): GanttMapping {
  const data: GanttRow[] = [];
  /** 已创建的分组行 id → 行,去重用 */
  const groupRows = new Map<string, GanttRow>();

  /** 分组行不存在才创建(存在直接复用) */
  function ensureGroupRow(row: GanttRow): void {
    if (groupRows.has(row.id)) return;
    groupRows.set(row.id, row);
    data.push(row);
  }

  let excludedCount = 0;
  const excludedTitles: string[] = [];
  let taskCount = 0;

  // 哪些任务真的进了甘特:父任务没进来时,子任务不能挂在它身上
  // (悬空的 parent 引用会被 dhtmlx 当成根级/直接丢弃,而那个父任务
  //  还在 excludedCount 里,用户看不出自己少了什么)
  const includedTaskIds = new Set<number>();
  for (const task of tasks) {
    if (task.start_date && task.due_date && task.id != null) {
      includedTaskIds.add(task.id);
    }
  }

  for (const task of tasks) {
    // 缺计划开始或截止 ⇒ 画不出条形,整体不进甘特(分组行也不建,
    // 否则全是被排除任务的项目会留下空分组行)
    if (!task.start_date || !task.due_date) {
      excludedCount += 1;
      if (excludedTitles.length < EXCLUDED_TITLES_LIMIT && task.title) {
        excludedTitles.push(task.title);
      }
      continue;
    }

    // 项目行:名字来自侧载映射,查不到就兜底「项目 {id}」
    if (task.project_id != null) {
      ensureGroupRow({
        id: `p-${task.project_id}`,
        text: names.projects.get(task.project_id) ?? `项目 ${task.project_id}`,
      });
    }

    // 里程碑行:挂在所属项目行下,名字查不到就兜底「里程碑 {id}」
    if (task.milestone_id != null) {
      ensureGroupRow({
        id: `m-${task.milestone_id}`,
        text:
          names.milestones.get(task.milestone_id) ??
          `里程碑 ${task.milestone_id}`,
        parent: task.project_id != null ? `p-${task.project_id}` : undefined,
      });
    }

    // 任务行 parent 的优先级:parent_id > milestone_id > project_id
    // —— 有父任务就挂父任务(子任务条画在父任务条下),没有才逐级退回分组行。
    // ⚠️ 父任务**没进甘特**时(缺日期被排除,或压根没随这一页返回)不能挂它:
    // 那样会留下悬空的 parent 引用 ⇒ 子任务被 dhtmlx 丢弃。逐级回退。
    const hasParentTask =
      task.parent_id != null && includedTaskIds.has(task.parent_id);
    const parent = hasParentTask
      ? `t-${task.parent_id}`
      : task.milestone_id != null
        ? `m-${task.milestone_id}`
        : task.project_id != null
          ? `p-${task.project_id}`
          : undefined;

    taskCount += 1;
    data.push({
      id: `t-${task.id}`,
      text: task.title ?? '',
      parent,
      // 契约是 YYYY-MM-DD:后端万一给了带时间的串,砍掉时间部分,
      // 免得 dhtmlx 按日期格式解析不出
      start_date: task.start_date.slice(0, 10),
      end_date: task.due_date.slice(0, 10),
      assignee:
        task.assignee_by?.name ?? task.assignee_by?.username ?? undefined,
      priority: task.priority_code ?? undefined,
      status: task.status_code ?? undefined,
      css: statusCssClass(task.status_code),
    });
  }

  return { data, excludedCount, excludedTitles, taskCount };
}

/** 状态 class 前缀:gantt.css 里按 `.pm-gantt-<线上码>` 配 token 色 */
const STATUS_CLASS_PREFIX = 'pm-gantt-';

/** 任务行的 id 前缀(`t-{id}`) */
export const TASK_ROW_PREFIX = 't-';

/** 分组行(项目/里程碑)的 id 前缀 */
const GROUP_ROW_PREFIXES = ['p-', 'm-'] as const;

/**
 * 这一行是不是**分组行**(项目/里程碑汇总行)。
 *
 * 规格 §6.3:分组行**不可拖** —— 汇总条只反映子任务窗口,拖它没有意义;
 * 而且写回链路会缺该行的字段 ⇒ 整对象 PUT 必然失败 ⇒ 只能「恢复一半」。
 * ⇒ 视图层(dhtmlx 侧禁拖)与数据层(写回直接拒绝)都靠这个判断。
 */
export function isGroupRowId(rowId: string): boolean {
  return GROUP_ROW_PREFIXES.some((prefix) => rowId.startsWith(prefix));
}

/** 这一行是不是**任务行**(可拖、可写回) */
export function isTaskRowId(rowId: string): boolean {
  return rowId.startsWith(TASK_ROW_PREFIX);
}

/** 没有状态(未设置/被清空)时的兜底 class —— 有名有姓才能在 css 里接管它 */
const STATUS_CLASS_NONE = `${STATUS_CLASS_PREFIX}none`;

/**
 * 状态线上码 → 条形 class 名(如 in_progress → pm-gantt-in_progress)。
 *
 * 只做「拼名字」这一件事:色值全部留在 gantt.css(按 antd token 写),
 * 前端不按枚举硬编码颜色。空状态也必须给 class —— 返回 undefined 时
 * dhtmlx 走自己的默认样式,页面上就多出一种谁也没配过的表现。
 */
export function statusCssClass(status?: string | null): string {
  if (!status) return STATUS_CLASS_NONE;
  return `${STATUS_CLASS_PREFIX}${status}`;
}

/**
 * 起止日期 → 短区间文本:「09-01 ~ 09-12」(同年,省年份)。
 *
 * 甘特图里的行都在同屏、时间轴上已有年份刻度,tooltip/列表里再写全日期
 * 是重复信息。起止任一缺失时给「-」占位 —— 半截区间(「09-01 ~」)
 * 看着像渲染坏了,不如明说「没有」。
 */
export function formatRange(start?: string, end?: string): string {
  if (!start || !end) return '-';
  return `${start.slice(5, 10)} ~ ${end.slice(5, 10)}`;
}
