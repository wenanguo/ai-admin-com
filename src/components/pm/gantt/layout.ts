/**
 * 甘特的**宽度计算** —— 纯函数:不碰 dhtmlx、不碰 DOM、不发请求。
 *
 * 为什么单独一个文件:
 * 1. 「左表格多宽、标题列多宽、容器窄了怎么办」这套口径是**规格 §5.3** 的
 *    落点(标题列要能看清、网格总宽跟着容器走、还能拖分隔条调)⇒ 它必须
 *    能被**单测直接验**(不起浏览器),也必须被**页面与组件共用**
 *    (页面用它判断「时间轴还剩多少」,组件用它算各列宽)。
 * 2. dhtmlx 社区版**没有**「网格 ↔ 时间轴」的分隔条(那是 PRO 的能力,
 *    社区版只有列内的 resizer)⇒ 分隔条自己实现,但**宽度口径**必须
 *    与列宽口径同源,否则拖出来的宽度和自动算出来的宽度对不上。
 *
 * ## 三个数字的关系
 *
 * - **网格总宽**(左表格):跟着容器走(容器窄 ⇒ 网格窄),但**标题列的最小
 *   宽度优先保住** ⇒ 网格再窄也不会把标题压成「三个点」。
 * - **时间轴宽度** = 容器宽 - 网格总宽 ⇒ 网格窄了,时间轴就宽。
 * - **标题列**:自然宽 220、最小宽 160(可读的下限)、最大宽 520。
 */

/** 各列的宽度规格:自然宽(想要多宽)/ 最小宽(再挤也不能更窄)/ 最大宽 */
export const COLUMN_SPECS = {
  /** 任务标题(树形) */
  title: { width: 220, min: 160, max: 520 },
  /** 负责人 */
  assignee: { width: 84, min: 64, max: 160 },
  /** 状态 */
  status: { width: 84, min: 64, max: 160 },
  /** 优先级 */
  priority: { width: 72, min: 56, max: 140 },
  /** 起止日期(合并成一列) */
  dates: { width: 112, min: 104, max: 220 },
  /** 操作列(编辑 / 删除) */
  actions: { width: 124, min: 116, max: 160 },
} as const;

/** 列名 */
export type ColumnKey = keyof typeof COLUMN_SPECS;

/** 各列宽度(px) */
export type ColumnWidths = Record<ColumnKey, number>;

/** 网格(左表格)的最小总宽 = 各列最小宽之和(标题列 160 不能破) */
export const MIN_GRID_WIDTH = Object.values(COLUMN_SPECS).reduce(
  (sum, spec) => sum + spec.min,
  0,
);

/** 网格的最大总宽(再宽标题列也不更好看,留给时间轴更划算) */
export const MAX_GRID_WIDTH = 620;

/** 时间轴至少要留的宽度(拖分隔条时的下限) */
export const MIN_TIMELINE_WIDTH = 420;

/**
 * 网格占容器宽度的比例。
 *
 * 0.42:左表格拿走四成,时间轴拿走六成 —— 时间轴是甘特的主信息。
 */
export const GRID_WIDTH_RATIO = 0.42;

/**
 * 时间轴少于这个宽度就算「挤」⇒ 页面给提示(收起 AI 工作台 / 拖分隔条)。
 *
 * 比 MIN_TIMELINE_WIDTH 大:分隔条能拖到 420,但 420 已经挺挤了 ⇒
 * 提前提醒用户有更宽的办法。
 */
export const NARROW_TIMELINE_WIDTH = 560;

/** 把一个数夹在 [min, max] 之间 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 网格总宽的**上限**:容器宽 - 时间轴下限(且不超过 MAX_GRID_WIDTH)。
 *
 * ⚠️ 容器窄到连 MIN_GRID_WIDTH 都放不下时,上限也取 MIN_GRID_WIDTH
 * (这时左表格宁可溢出,也不能把标题列压到不可读)。
 */
export function maxGridWidth(containerWidth: number): number {
  return Math.max(
    MIN_GRID_WIDTH,
    Math.min(MAX_GRID_WIDTH, containerWidth - MIN_TIMELINE_WIDTH),
  );
}

/**
 * 容器宽 ⇒ 网格总宽。
 *
 * @param containerWidth 图表容器的宽度(px)
 * @param override 用户拖分隔条拖出来的宽度(给了就以它为准,只做夹取)
 */
export function computeGridWidth(
  containerWidth: number,
  override?: number | null,
): number {
  const upper = maxGridWidth(containerWidth);
  if (override != null) {
    return clamp(Math.round(override), MIN_GRID_WIDTH, upper);
  }
  return clamp(
    Math.round(containerWidth * GRID_WIDTH_RATIO),
    MIN_GRID_WIDTH,
    upper,
  );
}

/**
 * 网格总宽 ⇒ 各列宽度(整数,加起来正好等于网格总宽)。
 *
 * 口径:
 * - **空间不够时先压别的列**(起止 → 优先级 → 状态 → 负责人),标题列**最后**
 *   才被压 ⇒ 标题列的最小宽度(160)优先保住;
 * - **空间富余时先给标题列**(它最需要宽度),其余列再分。
 */
export function computeColumnWidths(gridWidth: number): ColumnWidths {
  const target = Math.max(Math.round(gridWidth), MIN_GRID_WIDTH);
  const widths: ColumnWidths = {
    title: COLUMN_SPECS.title.width,
    assignee: COLUMN_SPECS.assignee.width,
    status: COLUMN_SPECS.status.width,
    priority: COLUMN_SPECS.priority.width,
    dates: COLUMN_SPECS.dates.width,
    actions: COLUMN_SPECS.actions.width,
  };
  let total = Object.values(widths).reduce((sum, width) => sum + width, 0);

  if (total > target) {
    // 空间不够:先压别的列,标题列最后压(保住它的最小宽)
    for (const key of [
      'dates',
      'priority',
      'status',
      'assignee',
      'title',
      'actions',
    ] as const) {
      if (total <= target) break;
      const spec = COLUMN_SPECS[key];
      const reduce = Math.min(widths[key] - spec.min, total - target);
      widths[key] -= reduce;
      total -= reduce;
    }
  } else if (total < target) {
    // 空间富余:先给标题列,其余列再分
    for (const key of [
      'title',
      'dates',
      'status',
      'assignee',
      'priority',
      'actions',
    ] as const) {
      if (total >= target) break;
      const spec = COLUMN_SPECS[key];
      const add = Math.min(spec.max - widths[key], target - total);
      widths[key] += add;
      total += add;
    }
  }

  return widths;
}

/** 容器宽 ⇒ 时间轴还剩多宽(px) */
export function computeTimelineWidth(containerWidth: number): number {
  return containerWidth - computeGridWidth(containerWidth);
}
