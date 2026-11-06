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
 * ## 颜色从哪来
 *
 * 颜色**一律**是 antd token:组件用 `theme.useToken()` 取 token,注成
 * `--pm-gantt-*` CSS 变量挂在根元素上,`gantt.css` 里只写
 * `var(--pm-gantt-*)` ⇒ 主题切换自动跟上,css 文件里没有一个色值。
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
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import './gantt.css';
import type { GanttRow } from './mapping';
import { formatRange, statusCssClass } from './mapping';
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

/** 语态色:只用 antd 的语义深色(不用字典的 list_class —— 那是浅底预设色) */
type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'muted';

/**
 * 状态线上码 → 语态色。
 *
 * 字典 `module_pm_task_status` 的线上码是固定的七个(看板那边也写死了
 * 同一套码),这里只做「码 → 语义色」的翻译;字典新增的码走兜底色。
 */
const STATUS_TONES: Record<string, Tone> = {
  done: 'success',
  in_progress: 'primary',
  review: 'warning',
  blocked: 'error',
  todo: 'info',
  backlog: 'muted',
  cancelled: 'muted',
};

/** 优先级线上码 → 语态色(字典 `module_pm_priority`) */
const PRIORITY_TONES: Record<string, Tone> = {
  urgent: 'error',
  high: 'error',
  medium: 'warning',
  normal: 'warning',
  low: 'info',
};

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
  /** 条形 class(映射层给的 + 语义角色) */
  css?: string;
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

/** 状态/优先级标签的 HTML(class 只给语义角色,色值在 gantt.css 里) */
function tagHtml(text: string, tone: Tone): string {
  return `<span class="pm-gantt-tag pm-gantt-tag--${tone}">${escapeHtml(text)}</span>`;
}

/** 状态线上码 → 语态色 */
function statusTone(code?: string): Tone {
  return (code && STATUS_TONES[code]) || 'info';
}

/** 优先级线上码 → 语态色 */
function priorityTone(code?: string): Tone {
  return (code && PRIORITY_TONES[code]) || 'info';
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
        ? today.startOf('week')
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
    // 条形 class:状态色 class(来自映射层) + 语义角色 class(决定颜色);
    // 分组行没有状态 ⇒ 不给 class,走 dhtmlx 自己的汇总条配色
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
      css: css ? `${css} pm-gantt-bar--${statusTone(row.status)}` : undefined,
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
    /** 拖动前的日期:行 id → 旧起止(回滚用) */
    const dragBeforeRef = useRef(new Map<string, TaskDateChange>());
    /** 最新的 props:模板与事件回调都从这里读,避免重建实例 */
    const labelsRef = useRef<GanttChartLabels | undefined>(labels);
    const readOnlyRef = useRef(readOnly);
    const onDragEndRef = useRef(onTaskDragEnd);

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

      // ⚠️ 顺序:config 必须全部设完再 init(dhtmlx 在 init 时建网格,
      // 之后再改 columns 会被忽略)
      inst.config.date_format = DATE_FORMAT;
      inst.config.columns = buildColumns(labelsRef);
      inst.config.scales = WEEK_SCALES;
      inst.config.row_height = 36;
      inst.config.scale_height = 44;
      inst.config.grid_width = 320;
      inst.config.min_column_width = 40;
      inst.config.autofit = true;
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

      inst.init(box);

      // 拖动前:把旧日期存下来,回滚时用(调用方不用知道旧日期)
      inst.attachEvent('onBeforeTaskDrag', (id) => {
        const task = inst.getTask(id);
        dragBeforeRef.current.set(String(id), {
          start_date: toDateString(task.start_date),
          end_date: toDateString(task.end_date),
        });
        return true;
      });
      // 拖动后:把新日期报给页面
      inst.attachEvent('onAfterTaskDrag', (id) => {
        const task = inst.getTask(id);
        onDragEndRef.current?.(String(id), {
          start_date: toDateString(task.start_date),
          end_date: toDateString(task.end_date),
        });
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

    // 数据变化:重设区间 → 重新灌数据
    useEffect(() => {
      const inst = instRef.current;
      if (!inst) return;
      const range = computeRange(data);
      inst.config.start_date = range.start;
      inst.config.end_date = range.end;
      inst.clearAll();
      inst.parse({ data: toGanttTasks(data), links: [] });
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

    // 字典文案变了:列模板要重画
    // ⚠️ 用文案内容当依赖:页面每次渲染都可能传一个新的 labels 对象,
    // 拿对象当依赖会每次都重画一遍
    const labelsKey = JSON.stringify(labels ?? {});
    useEffect(() => {
      instRef.current?.render();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [labelsKey]);

    useImperativeHandle(
      ref,
      () => ({
        revertTask(rowId: string) {
          const inst = instRef.current;
          const before = dragBeforeRef.current.get(rowId);
          if (!inst || !before) return;
          const task = inst.getTask(rowId);
          if (!task) return;
          task.start_date = before.start_date
            ? inst.date.parseDate(before.start_date, DATE_FORMAT)
            : undefined;
          task.end_date = before.end_date
            ? inst.date.parseDate(before.end_date, DATE_FORMAT)
            : undefined;
          inst.updateTask(rowId);
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

    // 颜色:antd token → CSS 变量(css 文件里只写 var(--pm-gantt-*))
    const style = {
      height,
      '--pm-gantt-bg': token.colorBgContainer,
      '--pm-gantt-head-bg': token.colorFillAlter,
      '--pm-gantt-border': token.colorBorderSecondary,
      '--pm-gantt-text': token.colorText,
      '--pm-gantt-text-light': token.colorTextSecondary,
      '--pm-gantt-on-solid': token.colorTextLightSolid,
      '--pm-gantt-primary': token.colorPrimary,
      '--pm-gantt-success': token.colorSuccess,
      '--pm-gantt-error': token.colorError,
      '--pm-gantt-warning': token.colorWarning,
      '--pm-gantt-info': token.colorInfo,
      '--pm-gantt-muted': token.colorTextSecondary,
      '--pm-gantt-today': token.colorError,
      '--pm-gantt-radius': String(token.borderRadius),
    } as React.CSSProperties;

    return <div className="pm-gantt-root" ref={boxRef} style={style} />;
  },
);

/**
 * 列定义。
 *
 * 模板返回的是 **HTML 字符串**(不是 ReactNode),且 dhtmlx **不转义**
 * ⇒ 动态文本自己转义。字典文案从 ref 里取(模板在 dhtmlx 内部被调用,
 * 拿不到 React 的闭包 ⇒ 用 ref 拿「最新」的文案)。
 */
function buildColumns(
  labelsRef: React.RefObject<GanttChartLabels | undefined>,
): GridColumn[] {
  /** 线上码 → 显示文案(查不到就回退线上码) */
  const text = (kind: keyof GanttChartLabels, code?: string): string => {
    if (!code) return '-';
    return labelsRef.current?.[kind]?.[code] ?? code;
  };

  return [
    { name: 'text', label: '任务', tree: true, width: '*', align: 'left' },
    {
      name: 'assignee',
      label: '负责人',
      width: 90,
      align: 'left',
      template: (task: Task) =>
        escapeHtml((task as GanttTaskData).assignee ?? ''),
    },
    {
      name: 'status',
      label: '状态',
      width: 90,
      align: 'left',
      template: (task: Task) =>
        tagHtml(
          text('status', (task as GanttTaskData).status),
          statusTone((task as GanttTaskData).status),
        ),
    },
    {
      name: 'priority',
      label: '优先级',
      width: 80,
      align: 'left',
      template: (task: Task) =>
        tagHtml(
          text('priority', (task as GanttTaskData).priority),
          priorityTone((task as GanttTaskData).priority),
        ),
    },
    {
      name: 'dates',
      label: '起止',
      width: 120,
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
