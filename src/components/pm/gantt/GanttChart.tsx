/**
 * 甘特图组件 —— dhtmlx-gantt(Community Edition,MIT)的 **vanilla 封装**。
 *
 * ## 为什么是 vanilla 封装,而不是官方 React wrapper
 *
 * 官方 React wrapper 是**商业版**(npm 上的评估版带水印),不能进生产 ⇒
 * 只能自己拿 `init / parse / destructor` 这三步把 dhtmlx 包成 React 组件。
 *
 * ## 三条硬约束(都踩过坑)
 *
 * 1. **config 必须全部设完再 `init`**:dhtmlx 在 init 时建网格,之后再改
 *    `config.columns` 会被忽略(实测标题列被压成 90px)。
 * 2. **实例是全局的**:dhtmlx 导出的 `gantt` 是模块级单例,`destructor()`
 *    之后**不能再 init**(实测抛 `Cannot read properties of undefined`)⇒
 *    这里每次挂载都 `Gantt.getGanttInstance()` 拿一个**新实例**,卸载时
 *    销毁自己那一个。好处是卸载干净、多个测试之间互不污染。
 * 3. **模板返回的 HTML 不会被转义**:dhtmlx 直接把模板返回值塞进 DOM
 *    (实测 `<img onerror=alert(1)>` 原样执行)⇒ 模板里所有动态文本
 *    必须自己转义。
 *
 * ## 今天线为什么自己画
 *
 * 社区版**没有** `addMarker`(那是 Pro 的能力,实测 `addMarker` 是
 * `undefined`)⇒ 今天线用一条绝对定位的 div 画在时间轴上,位置由
 * `posFromDate` 换算。
 *
 * ## 左表格的宽度:自己算(不是 dhtmlx 算的)
 *
 * 社区版**没有**「网格 ↔ 时间轴」的分隔条(PRO 才有)⇒ 分隔条自己实现;
 * 宽度口径也自己算(见 `layout.ts`):
 * - **网格总宽跟着容器走**(容器窄 ⇒ 网格窄),但**标题列的最小宽度(160)
 *   优先保住** ⇒ 标题永远能看清任务名(以前被压成 `AIP...`,见 F1);
 * - dhtmlx 的网格宽度 = 各列宽度之和(实测:请求 320px 时它按列宽之和
 *   撑到 580px)⇒ 所以**列宽必须自己算准**,不能指望 `grid_width` 生效。
 *
 * ## 颜色从哪来(以及「不自己造字典」)
 *
 * 颜色**一律**是 antd token:组件用 `theme.useToken()` 取 token,注成
 * `--pm-gantt-*` CSS 变量,css 文件里只写 `var(--pm-gantt-*)` ⇒
 * 主题切换自动跟上,css 文件里没有一个色值。
 *
 * ⚠️ 变量挂在 **`document.documentElement`** 上(不是组件根元素):
 * dhtmlx 的 tooltip 挂在 `document.body` 下 ⇒ 挂在根元素上它拿不到,
 * tooltip 会永远是默认配色。
 *
 * **线上码 → 颜色的对照表只在 `gantt.css` 里**(按 `.pm-gantt-<线上码>`
 * 选择器写)。本文件**不造任何码表**:状态只把映射层给的
 * `statusCssClass(status_code)`(带线上码的 class)发出去,具体颜色由 css
 * 决定;优先级后端的线上码无从得知(规格也没要求语义色)⇒ 只发**中性**
 * 标签,文案查 `labels`,查不到回退线上码。
 */
import { theme } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import type {
  GanttStatic,
  GridColumn,
  Scales,
  SerializedTask,
  Task,
  ZoomLevel,
} from 'dhtmlx-gantt';
import { Gantt } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';
import type React from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import './gantt.css';
import type { ColumnWidths } from './layout';
import {
  COLUMN_SPECS,
  computeColumnWidths,
  computeGridWidth,
  maxGridWidth,
} from './layout';
import type { GanttRow } from './mapping';
import { formatRange, isGroupRowId, statusCssClass } from './mapping';
import type { TaskDateChange } from './payload';

/** dhtmlx 的日期格式 —— 与后端契约一致(YYYY-MM-DD) */
const DATE_FORMAT = '%Y-%m-%d';

/** 「周」视图的刻度:上 month、下 week */
const WEEK_SCALES: Scales = [
  { unit: 'month', step: 1, format: '%F %Y' },
  { unit: 'week', step: 1, format: '%d' },
];

/** 缩放级别:日 / 周 / 月(默认落在「周」) */
const ZOOM_LEVELS: ZoomLevel[] = [
  {
    name: 'day',
    label: '日',
    scales: [{ unit: 'day', step: 1, format: '%d' }],
  },
  { name: 'week', label: '周', scales: WEEK_SCALES },
  {
    name: 'month',
    label: '月',
    scales: [{ unit: 'month', step: 1, format: '%F %Y' }],
  },
];

/**
 * 灌给 dhtmlx 的行:在 dhtmlx 的行之外带上负责人/状态/优先级与条形 class。
 *
 * 日期给**字符串**:`SerializedTask` 就是这个形态,dhtmlx 按
 * `config.date_format` 自己解析。
 */
interface GanttTaskData extends SerializedTask {
  /** 负责人显示名 */
  assignee?: string;
  /** 状态线上码 */
  status?: string;
  /** 优先级线上码 */
  priority?: string;
  /** 条形 class(映射层给的:带线上码,色值在 gantt.css) */
  css?: string;
}

/**
 * 一次拖动的快照:拖动**前**与拖动**后**的日期。
 *
 * 为什么两份都要:
 * - `before`:写回失败时回滚到这儿;
 * - `after`:写回还在飞的时候,数据刷新了也要**保住用户拖到的位置**
 *   (否则条形会先「弹回」旧位置,再在写回成功后跳回去 —— 闪一下)。
 */
interface DragSnapshot {
  /** 拖动前的日期 */
  before: TaskDateChange;
  /** 拖动后的日期(拖动结束时补上) */
  after?: TaskDateChange;
}

/** 命令式句柄:页面上的按钮直接调它 */
export interface GanttChartHandle {
  /** 回滚到拖动前的日期(写回失败时用,调用方不用知道旧日期) */
  revertTask(rowId: string): void;
  /** 切换缩放级别 */
  setZoom(level: 'day' | 'week' | 'month'): void;
  /** 时间轴自适应全部任务 */
  zoomToFit(): void;
  /** 滚到今天 */
  scrollToToday(): void;
}

/** 线上码 → 显示文案(页面用字典选项组装) */
export interface GanttChartLabels {
  /** 状态:线上码 → 显示文案 */
  status?: Record<string, string>;
  /** 优先级:线上码 → 显示文案 */
  priority?: Record<string, string>;
}

/** 组件 props */
export interface GanttChartProps {
  /** 甘特行(项目/里程碑分组行 + 任务行) */
  data: GanttRow[];
  /** 只读(没有 update 权限)⇒ 不给拖、不给内联编辑 */
  readOnly?: boolean;
  /** 拖拽结束:行 id + 新的起止日期 */
  onTaskDragEnd?: (rowId: string, change: TaskDateChange) => void;
  /** 图表高度(px) */
  height?: number;
  /** 状态/优先级的显示文案(查不到就回退线上码) */
  labels?: GanttChartLabels;
}

/** 默认高度 */
const DEFAULT_HEIGHT = 520;

/** HTML 转义 —— dhtmlx 的模板不转义,动态文本必须自己转 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 标签的 HTML。
 *
 * `extraClass` 决定颜色:状态标签带**线上码** class(映射层给的
 * `statusCssClass` ⇒ `pm-gantt-in_progress`),颜色由 gantt.css 按这个
 * class 上色;优先级标签带中性 class(`pm-gantt-tag--neutral`)。
 */
function tagHtml(text: string, extraClass: string): string {
  return `<span class="pm-gantt-tag ${extraClass}">${escapeHtml(text)}</span>`;
}

/** Date → YYYY-MM-DD(缺值给空串) */
function toDateString(date?: Date): string {
  return date ? dayjs(date).format('YYYY-MM-DD') : '';
}

/**
 * 时间轴要显示的区间:[数据最早 ~ 今天 - 7 天, 数据最晚 ~ 今天 + 7 天]。
 *
 * 为什么固定区间:dhtmlx 默认按数据算区间(前后各留一截),**今天常常在
 * 区间外** ⇒ 今天线会贴在边上、看起来像坏了。固定区间把今天框进来,
 * 「今天线 / 滚到今天」才有意义。
 */
function computeRange(data: GanttRow[]): { start: Date; end: Date } {
  const today = dayjs().startOf('day');
  let min: Dayjs | null = null;
  let max: Dayjs | null = null;

  for (const row of data) {
    if (!row.start_date || !row.end_date) continue;
    const start = dayjs(row.start_date);
    const end = dayjs(row.end_date);
    if (!min || start.isBefore(min)) min = start;
    if (!max || end.isAfter(max)) max = end;
  }

  const from = min?.isBefore(today) ? min : today;
  const to = max?.isAfter(today) ? max : today;
  return {
    start: from.subtract(7, 'day').toDate(),
    end: to.add(7, 'day').toDate(),
  };
}

/**
 * 本周起点(以 **dhtmlx 自己的**周起点为准)。
 *
 * ⚠️ 不能用 dayjs 的 `startOf('week')`:dayjs 的周起点跟着 **locale** 走
 * (缺省周日、`dayjs/locale/zh-cn` 是周一),而仓库里别的文件 import 了
 * `dayjs/locale/zh-cn` ⇒ 同一份代码的「周锚点」会随 import 顺序变;
 * dhtmlx 的列却**总是**按 `config.start_on_monday`(默认 true ⇒ 周一)排
 * ⇒ 锚点必须跟 dhtmlx 一致,不能跟 dayjs 的 locale 走。
 *
 * 这里优先用 dhtmlx 自己的 `date.week_start()`(它读的就是
 * `config.start_on_monday`);拿不到时按同一个 config 推导。
 */
function weekStart(inst: GanttStatic, today: Dayjs): Dayjs {
  const dhtmlxWeekStart = inst.date?.week_start;
  if (typeof dhtmlxWeekStart === 'function') {
    return dayjs(dhtmlxWeekStart.call(inst.date, today.toDate())).startOf(
      'day',
    );
  }
  // 兜底:dhtmlx 的 config.start_on_monday(默认 true ⇒ 周一)
  const monday = inst.config.start_on_monday !== false;
  const offset = monday ? (today.day() + 6) % 7 : today.day();
  return today.subtract(offset, 'day').startOf('day');
}

/**
 * 今天在时间轴上的像素位置。
 *
 * `posFromDate` 给的是**所在列**的起点:日视图下就是今天零点,周/月
 * 视图下是本周/本月的起点 ⇒ 直接拿来画线会偏。这里按当前刻度单位算出
 * 今天在列内的比例,再插值到列宽里。
 */
function todayPosition(inst: GanttStatic, today: Dayjs): number {
  const unit = inst.getState().scale_unit;
  const base =
    unit === 'month'
      ? today.startOf('month')
      : unit === 'week'
        ? weekStart(inst, today)
        : today.startOf('day');
  const span =
    unit === 'month'
      ? base.add(1, 'month').diff(base, 'day')
      : unit === 'week'
        ? 7
        : 1;

  const basePos = inst.posFromDate(base.toDate());
  const nextPos = inst.posFromDate(base.add(span, 'day').toDate());
  const width = nextPos - basePos;
  if (width <= 0) return basePos;

  const ratio = Math.min(Math.max(today.diff(base, 'day') / span, 0), 1);
  return basePos + width * ratio;
}

/** 甘特行 → dhtmlx 的 task(分组行没有日期,dhtmlx 自己画汇总条) */
function toGanttTasks(data: GanttRow[]): GanttTaskData[] {
  return data.map((row) => {
    // 条形 class:**只发线上码 class**(映射层给的),颜色由 gantt.css 按
    // `.pm-gantt-<线上码>` 上色;分组行没有状态 ⇒ 不给 class,走 dhtmlx
    // 自己的汇总条配色
    const css =
      row.css ?? (row.status ? statusCssClass(row.status) : undefined);
    return {
      id: row.id,
      text: row.text,
      parent: row.parent,
      start_date: row.start_date,
      end_date: row.end_date,
      // 分组行默认展开:不然子任务在树里是收着的,页面上看不到行
      open: true,
      assignee: row.assignee,
      status: row.status,
      priority: row.priority,
      css,
    };
  });
}

export const GanttChart = forwardRef<GanttChartHandle, GanttChartProps>(
  function GanttChart(
    { data, readOnly = false, onTaskDragEnd, height = DEFAULT_HEIGHT, labels },
    ref,
  ) {
    const { token } = theme.useToken();
    const boxRef = useRef<HTMLDivElement | null>(null);
    const instRef = useRef<GanttStatic | null>(null);
    /** 拖动前后的日期快照:行 id → 快照(回滚用) */
    const dragSnapshotsRef = useRef(new Map<string, DragSnapshot>());
    /** 最新的 props:模板与事件回调都从这里读,避免重建实例 */
    const labelsRef = useRef<GanttChartLabels | undefined>(labels);
    const readOnlyRef = useRef(readOnly);
    const onDragEndRef = useRef(onTaskDragEnd);
    /** 当前网格(左表格)总宽(px)—— 分隔条的位置与 dhtmlx 的 grid_width */
    const [gridWidth, setGridWidth] = useState(0);
    const gridWidthRef = useRef(0);
    /** 图表容器的宽度(px)—— 网格总宽跟着它走 */
    const containerWidthRef = useRef(0);
    /** 用户拖分隔条拖出来的网格宽(null = 跟着容器走) */
    const manualGridWidthRef = useRef<number | null>(null);
    /** 当前悬停的条形 tooltip(内容 + 位置) */
    const [tip, setTip] = useState<{
      text: string;
      from: string;
      to: string;
      x: number;
      y: number;
    } | null>(null);

    /** 把今天线挪到今天的位置(渲染/缩放之后都要重算) */
    const syncTodayLine = () => {
      const inst = instRef.current;
      const box = boxRef.current;
      if (!inst || !box) return;
      const area = box.querySelector<HTMLElement>('.gantt_data_area');
      if (!area) return;
      let line = box.querySelector<HTMLElement>('.pm-gantt-today');
      if (!line) {
        line = document.createElement('div');
        line.className = 'pm-gantt-today';
        area.appendChild(line);
      }
      line.style.left = `${todayPosition(inst, dayjs())}px`;
    };

    /**
     * 把「网格总宽」落到 dhtmlx 上。
     *
     * ⚠️ dhtmlx 的网格宽度 = **各列宽度之和**(实测:请求 320px 时它按
     * 列宽之和撑开)⇒ 必须**自己把列宽算准**,不能只设 `grid_width`。
     */
    const applyGridWidth = useCallback((target: number) => {
      const inst = instRef.current;
      if (!inst) return;
      const widths = computeColumnWidths(target);
      inst.config.columns = buildColumns(labelsRef.current, widths);
      inst.config.grid_width = target;
      inst.setSizes();
      gridWidthRef.current = target;
      setGridWidth(target);
      syncTodayLine();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 最新的 props 同步到 ref(声明在最前面:挂载时初始化用的就是最新值)
    useEffect(() => {
      labelsRef.current = labels;
      readOnlyRef.current = readOnly;
      onDragEndRef.current = onTaskDragEnd;
    });

    // 挂载:建实例 → 设全部 config → 建缩放扩展 → init → 挂事件
    useEffect(() => {
      const box = boxRef.current;
      if (!box) return;

      // 每次挂载拿一个**新实例**:dhtmlx 导出的 gantt 是全局单例,
      // destructor 之后不能再 init(实测会抛)
      const inst = Gantt.getGanttInstance();
      instRef.current = inst;

      const containerWidth = box.clientWidth || 900;
      containerWidthRef.current = containerWidth;
      const target = computeGridWidth(containerWidth);

      // ⚠️ 顺序:config 必须全部设完再 init(dhtmlx 在 init 时建网格,
      // 之后再改 columns 会被忽略)
      inst.config.date_format = DATE_FORMAT;
      inst.config.columns = buildColumns(
        labelsRef.current,
        computeColumnWidths(target),
      );
      inst.config.scales = WEEK_SCALES;
      inst.config.row_height = 36;
      inst.config.scale_height = 44;
      inst.config.grid_width = target;
      // 时间轴上一列的最小宽度(格子太小刻度看不清)
      inst.config.min_column_width = 40;
      inst.config.readonly = readOnlyRef.current;
      inst.config.drag_move = !readOnlyRef.current;
      inst.config.drag_resize = !readOnlyRef.current;
      inst.config.drag_progress = false;
      inst.config.drag_links = false;
      inst.config.show_links = false;

      // 缩放是**扩展**(不是 config):要在 init 之前把级别准备好
      inst.ext.zoom.init({ levels: ZOOM_LEVELS });

      // 条形的 class 走模板:dhtmlx v10 不再把 task.css 直接挂到条上
      // (实测 class 丢失)⇒ 用 task_class 模板把映射层给的 class 贴回去
      inst.templates.task_class = (_start, _end, task) =>
        (task as GanttTaskData).css ?? '';

      // 条形上的文字(= 标题)也要转义:dhtmlx 默认的 task_text 模板直接
      // 把 task.text 塞进 DOM ⇒ 标题里的尖括号会被当 HTML
      inst.templates.task_text = (_start, _end, task) =>
        escapeHtml(task.text ?? '');

      // 条形的 tooltip 文案:列里只显示 `MM-DD ~ MM-DD`(省宽度),
      // **完整日期在这里给**(规格 §5.3)。
      // ⚠️ 这份模板同时被 dhtmlx 用作条形的 aria-label(可访问名)⇒
      // 读屏也能听到完整日期。
      inst.templates.tooltip_text = (start, end, task) => {
        const title = escapeHtml(task?.text ?? '');
        const from = toDateString(start);
        const to = toDateString(end);
        return `<div class="pm-gantt-tooltip-title">${title}</div><div class="pm-gantt-tooltip-dates">${from} ~ ${to}</div>`;
      };

      inst.init(box);
      gridWidthRef.current = target;
      setGridWidth(target);

      // 拖动前:把旧日期存下来,回滚时用(调用方不用知道旧日期)
      inst.attachEvent('onBeforeTaskDrag', (id) => {
        const rowId = String(id);
        // 分组行(项目/里程碑)**不可拖**(规格 §6.3):汇总条只反映
        // 子任务窗口,拖它没有意义,而且写回会缺字段 ⇒ 必然失败。
        // 返回 false = 取消这次拖动(dhtmlx 的 onBeforeTaskDrag 语义)。
        if (isGroupRowId(rowId)) return false;
        const task = inst.getTask(id);
        dragSnapshotsRef.current.set(rowId, {
          before: {
            start_date: toDateString(task.start_date),
            end_date: toDateString(task.end_date),
          },
        });
        return true;
      });
      // 拖动后:把新日期报给页面
      inst.attachEvent('onAfterTaskDrag', (id) => {
        const rowId = String(id);
        const task = inst.getTask(id);
        const change: TaskDateChange = {
          start_date: toDateString(task.start_date),
          end_date: toDateString(task.end_date),
        };
        const snapshot = dragSnapshotsRef.current.get(rowId);
        if (snapshot) snapshot.after = change;
        onDragEndRef.current?.(rowId, change);
      });
      // 每次重绘后重算今天线的位置(缩放/改尺寸都会重绘)
      inst.attachEvent('onGanttRender', () => {
        syncTodayLine();
      });

      inst.ext.zoom.setLevel('week');

      return () => {
        inst.destructor();
        instRef.current = null;
        // dhtmlx 销毁后可能还留着骨架,清干净免得下一个图表被顶掉
        box.innerHTML = '';
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 容器宽度变了 ⇒ 网格总宽跟着变(标题列的最小宽度优先保住)
    useEffect(() => {
      const box = boxRef.current;
      if (!box) return;
      const observer = new ResizeObserver(() => {
        const width = box.clientWidth;
        if (width === containerWidthRef.current) return;
        containerWidthRef.current = width;
        applyGridWidth(computeGridWidth(width, manualGridWidthRef.current));
      });
      observer.observe(box);
      return () => observer.disconnect();
    }, [applyGridWidth]);

    // 数据变化:重设区间 → 重新灌数据
    useEffect(() => {
      const inst = instRef.current;
      if (!inst) return;
      const range = computeRange(data);
      inst.config.start_date = range.start;
      inst.config.end_date = range.end;

      // ⚠️ **不要整表清空快照**(见 F3):
      // 「拖完 → 写失败 → 回滚」这条链必须在**任何** data 变化下都还能
      // 回滚(侧载名字晚到 ⇒ mapping 重算 ⇒ 新数组 ⇒ 旧代码在这里把快照
      // 全清了 ⇒ 回滚静默失效 ⇒ 条形停在拖后的位置,与服务端不一致)。
      // 这里只清掉两种快照:
      // - 行已经不在数据里了(回滚没有对象);
      // - 行的日期被**别处**改了(既不是拖动前也不是拖动后)⇒ 快照已过期。
      const rows = new Map(data.map((row) => [row.id, row]));
      const same = (a?: string, b?: string): boolean => (a ?? '') === (b ?? '');
      for (const [rowId, snapshot] of dragSnapshotsRef.current) {
        const row = rows.get(rowId);
        if (!row) {
          dragSnapshotsRef.current.delete(rowId);
          continue;
        }
        const isBefore =
          same(row.start_date, snapshot.before.start_date) &&
          same(row.end_date, snapshot.before.end_date);
        const isAfter =
          !!snapshot.after &&
          same(row.start_date, snapshot.after.start_date) &&
          same(row.end_date, snapshot.after.end_date);
        if (!isBefore && !isAfter) dragSnapshotsRef.current.delete(rowId);
      }

      inst.clearAll();
      inst.parse({ data: toGanttTasks(data), links: [] });

      // 写回还在飞的行:保持用户拖到的位置(别被新数据「弹回」旧位置)
      for (const [rowId, snapshot] of dragSnapshotsRef.current) {
        const keep = snapshot.after ?? snapshot.before;
        if (!keep.start_date || !keep.end_date) continue;
        const task = inst.getTask(rowId);
        if (!task) continue;
        task.start_date = inst.date.parseDate(keep.start_date, DATE_FORMAT);
        task.end_date = inst.date.parseDate(keep.end_date, DATE_FORMAT);
        inst.updateTask(rowId);
      }
      syncTodayLine();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    // 只读切换:改 config 后重绘(拖拽手柄是渲染时决定的)
    useEffect(() => {
      const inst = instRef.current;
      if (!inst) return;
      inst.config.readonly = readOnly;
      inst.config.drag_move = !readOnly;
      inst.config.drag_resize = !readOnly;
      inst.render();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readOnly]);

    // 高度变化:dhtmlx 的布局尺寸是算出来的,容器高度变了要让它重算
    // (setSizes 就是 dhtmlx 公开的「resize 图表」入口,内部等价 render)
    useEffect(() => {
      const inst = instRef.current;
      if (!inst) return;
      inst.setSizes();
      syncTodayLine();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [height]);

    // 字典文案变了:列模板要重画
    // ⚠️ 用文案内容当依赖:页面每次渲染都可能传一个新的 labels 对象,
    // 拿对象当依赖会每次都重画一遍
    const labelsKey = JSON.stringify(labels ?? {});
    useEffect(() => {
      instRef.current?.render();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [labelsKey]);

    // 颜色:antd token → CSS 变量(css 文件里只写 var(--pm-gantt-*))
    //
    // ⚠️ 挂在 `document.documentElement` 上:dhtmlx 的 tooltip 挂在
    // `document.body` 下 ⇒ 挂在组件根元素上它拿不到这些变量。
    const cssVars = useMemoCssVars(token);
    useEffect(() => {
      const root = document.documentElement;
      for (const [key, value] of Object.entries(cssVars)) {
        root.style.setProperty(key, value);
      }
      return () => {
        for (const key of Object.keys(cssVars)) root.style.removeProperty(key);
      };
    }, [cssVars]);

    /**
     * 拖分隔条:调左表格的总宽。
     *
     * ⚠️ 社区版没有这个分隔条(PRO 才有)⇒ 自己放一个把手在网格与
     * 时间轴之间,拖动时改 `grid_width` + 各列宽。
     */
    const onSplitterPointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = gridWidthRef.current;
        const containerWidth = containerWidthRef.current;

        const onMove = (moveEvent: PointerEvent) => {
          const upper = maxGridWidth(containerWidth);
          const next = Math.min(
            Math.max(startWidth + (moveEvent.clientX - startX), 0),
            upper,
          );
          manualGridWidthRef.current = next;
          applyGridWidth(next);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      },
      [applyGridWidth],
    );

    /**
     * 鼠标在时间轴上移动 ⇒ 显示条形的 tooltip(标题 + **完整日期**)。
     *
     * ⚠️ **自己实现**,不用 dhtmlx 的 tooltip 扩展:那个扩展在社区版里
     * 要靠「鼠标真的在动」才显示(实测第一次 mousemove 不出 tooltip),
     * 而且它的显示逻辑依赖内部的防抖时序,行为不可控 ⇒ 自己画一个,
     * 颜色/位置都在自己的控制里。
     */
    const onTimelineMouseMove = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        const inst = instRef.current;
        const box = boxRef.current;
        const target = (event.target as HTMLElement | null)?.closest?.(
          '[data-task-id]',
        ) as HTMLElement | null;
        if (!inst || !box || !target) {
          setTip(null);
          return;
        }
        const id = target.getAttribute('data-task-id');
        const task = id ? inst.getTask(id) : null;
        if (!task) {
          setTip(null);
          return;
        }
        const rect = box.getBoundingClientRect();
        setTip({
          text: task.text ?? '',
          from: toDateString(task.start_date),
          to: toDateString(task.end_date),
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        revertTask(rowId: string) {
          const inst = instRef.current;
          const snapshot = dragSnapshotsRef.current.get(rowId);
          if (!inst || !snapshot) return;
          const task = inst.getTask(rowId);
          if (!task) return;
          task.start_date = snapshot.before.start_date
            ? inst.date.parseDate(snapshot.before.start_date, DATE_FORMAT)
            : undefined;
          task.end_date = snapshot.before.end_date
            ? inst.date.parseDate(snapshot.before.end_date, DATE_FORMAT)
            : undefined;
          inst.updateTask(rowId);
          // 回滚完了:快照没用了(留着会让下一次数据刷新把条形又拉到
          // 拖后的位置)
          dragSnapshotsRef.current.delete(rowId);
        },
        setZoom(level: 'day' | 'week' | 'month') {
          instRef.current?.ext.zoom.setLevel(level);
        },
        zoomToFit() {
          instRef.current?.ext.zoom.zoomToFit();
        },
        scrollToToday() {
          const inst = instRef.current;
          if (!inst) return;
          const left = todayPosition(inst, dayjs());
          inst.scrollTo(Math.max(0, left - 100));
        },
      }),
      [],
    );

    return (
      <div className="pm-gantt-wrap" style={{ height }}>
        {/* dhtmlx 的 init 目标(它会往里塞自己的 DOM) */}
        <div
          className="pm-gantt-root"
          ref={boxRef}
          onMouseMove={onTimelineMouseMove}
          onMouseLeave={() => setTip(null)}
        />
        {/* 分隔条:网格 ↔ 时间轴(社区版没有,自己实现) */}
        {gridWidth > 0 ? (
          <hr
            className="pm-gantt-splitter"
            style={{ left: gridWidth }}
            aria-orientation="vertical"
            aria-label="拖动调整左侧表格宽度"
            title="拖动调整左侧表格宽度"
            onPointerDown={onSplitterPointerDown}
          />
        ) : null}
        {/* 条形的 tooltip:标题 + 完整日期(列里只显示 MM-DD) */}
        {tip ? (
          <div
            className="pm-gantt-tooltip"
            style={{ left: tip.x + 12, top: tip.y + 12 }}
            role="tooltip"
          >
            <div className="pm-gantt-tooltip-title">{tip.text}</div>
            <div className="pm-gantt-tooltip-dates">
              {tip.from} ~ {tip.to}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

/** antd token → `--pm-gantt-*` CSS 变量 */
function useMemoCssVars(token: ReturnType<typeof theme.useToken>['token']) {
  return useMemo(
    () =>
      ({
        '--pm-gantt-bg': token.colorBgContainer,
        '--pm-gantt-head-bg': token.colorFillAlter,
        '--pm-gantt-border': token.colorBorderSecondary,
        '--pm-gantt-text': token.colorText,
        '--pm-gantt-text-light': token.colorTextSecondary,
        // 语义色三档(实色 / 浅底 / 中间色):gantt.css 按线上码取用
        '--pm-gantt-primary': token.colorPrimary,
        '--pm-gantt-primary-bg': token.colorPrimaryBg,
        '--pm-gantt-primary-border': token.colorPrimaryBorder,
        '--pm-gantt-success': token.colorSuccess,
        '--pm-gantt-success-bg': token.colorSuccessBg,
        '--pm-gantt-success-border': token.colorSuccessBorder,
        '--pm-gantt-error': token.colorError,
        '--pm-gantt-error-bg': token.colorErrorBg,
        '--pm-gantt-error-border': token.colorErrorBorder,
        '--pm-gantt-warning': token.colorWarning,
        '--pm-gantt-warning-bg': token.colorWarningBg,
        '--pm-gantt-warning-border': token.colorWarningBorder,
        '--pm-gantt-info': token.colorInfo,
        '--pm-gantt-info-bg': token.colorInfoBg,
        '--pm-gantt-info-border': token.colorInfoBorder,
        // 中性档(优先级标签 / backlog、cancelled 这类状态)
        '--pm-gantt-muted': token.colorTextSecondary,
        '--pm-gantt-muted-bg': token.colorFillQuaternary,
        '--pm-gantt-muted-border': token.colorFillSecondary,
        '--pm-gantt-today': token.colorError,
        '--pm-gantt-radius': String(token.borderRadius),
        // dhtmlx 的 tooltip 挂在 body 下 ⇒ 变量也得在 documentElement 上
        '--dhx-gantt-font-family': 'inherit',
        '--dhx-gantt-tooltip-background': 'var(--pm-gantt-bg)',
        '--dhx-gantt-tooltip-color': 'var(--pm-gantt-text)',
        '--dhx-gantt-tooltip-border': `1px solid var(--pm-gantt-border)`,
      }) as Record<string, string>,
    [token],
  );
}

/**
 * 列定义。
 *
 * 模板返回的是 **HTML 字符串**(不是 ReactNode),且 dhtmlx **不转义**
 * ⇒ 动态文本自己转义。字典文案从参数里取(模板在 dhtmlx 内部被调用,
 * 拿不到 React 的闭包 ⇒ 传进来的对象要是「最新」的文案)。
 *
 * ⚠️ 各列宽度**自己算**(见 `layout.ts`):dhtmlx 的网格宽度 = 列宽之和
 * ⇒ 列宽算错,标题列就会被压成「三个点」。
 */
function buildColumns(
  labels: GanttChartLabels | undefined,
  widths: ColumnWidths,
): GridColumn[] {
  /** 线上码 → 显示文案(查不到就回退线上码) */
  const text = (kind: keyof GanttChartLabels, code?: string): string => {
    if (!code) return '-';
    return labels?.[kind]?.[code] ?? code;
  };

  return [
    {
      name: 'text',
      label: '任务',
      tree: true,
      width: widths.title,
      min_width: COLUMN_SPECS.title.min,
      max_width: COLUMN_SPECS.title.max,
      align: 'left',
      // 标题也要转义(dhtmlx 的模板不转义,默认渲染会把标题当 HTML)
      // 树形缩进由 dhtmlx 自己加在模板内容**前面**⇒ 不受影响
      template: (task: Task) => escapeHtml(task.text ?? ''),
    },
    {
      name: 'assignee',
      label: '负责人',
      width: widths.assignee,
      min_width: COLUMN_SPECS.assignee.min,
      align: 'left',
      template: (task: Task) =>
        escapeHtml((task as GanttTaskData).assignee ?? ''),
    },
    {
      name: 'status',
      label: '状态',
      width: widths.status,
      min_width: COLUMN_SPECS.status.min,
      align: 'left',
      // class 用映射层的 statusCssClass(带线上码)⇒ 颜色在 gantt.css 里
      template: (task: Task) => {
        const status = (task as GanttTaskData).status;
        return tagHtml(text('status', status), statusCssClass(status));
      },
    },
    {
      name: 'priority',
      label: '优先级',
      width: widths.priority,
      min_width: COLUMN_SPECS.priority.min,
      align: 'left',
      // 优先级**不做语义色**(后端线上码无从得知,规格也没要求)⇒ 中性标签
      template: (task: Task) =>
        tagHtml(
          text('priority', (task as GanttTaskData).priority),
          'pm-gantt-tag--neutral',
        ),
    },
    {
      name: 'dates',
      label: '起止',
      width: widths.dates,
      min_width: COLUMN_SPECS.dates.min,
      align: 'left',
      template: (task: Task) =>
        escapeHtml(
          formatRange(
            toDateString(task.start_date),
            toDateString(task.end_date),
          ),
        ),
    },
  ];
}
