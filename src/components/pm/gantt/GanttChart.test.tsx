import dayjs from 'dayjs';
import type { GanttStatic } from 'dhtmlx-gantt';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import type { GanttChartHandle } from './GanttChart';
import { GanttChart } from './GanttChart';
import ganttCss from './gantt.css?raw';
import type { GanttRow } from './mapping';

/**
 * 甘特图组件(dhtmlx vanilla 封装)的单测。
 *
 * 钉死这些事:
 * 1. 行与条形:三行数据 ⇒ 三行网格 + 叶子行画出条形;
 * 2. 卸载不残留:组件卸载后 DOM 里不能再有 `.gantt_container`;
 * 3. 只读:readOnly 时条上没有拖拽手柄(不给拖、不给内联编辑);
 * 4. 拖拽回调:onAfterTaskDrag ⇒ onTaskDragEnd(rowId, {start_date, end_date});
 * 5. 回滚:revertTask 把行恢复成拖动前的日期(调用方不用知道旧日期);
 * 6. 缩放与滚动:setZoom 切级别、zoomToFit 不抛、scrollToToday 真的滚;
 * 7. 状态/优先级文案:查 labels,查不到回退线上码;
 * 8. **不造字典**:条形与状态标签只带线上码 class,颜色在 gantt.css 里
 *    (按 `.pm-gantt-<线上码>` 上色,TSX 里没有码表);
 * 9. **今天线按 dhtmlx 的周起点**(不是 dayjs locale 的周起点);
 * 10. 标题转义(不能把标题当 HTML 执行)、CSS 无死规则、
 *     重新灌数据后回滚不恢复旧日期、高度变化会同步给 dhtmlx、
 *     标签文字与底色对比度达标。
 */

/** 三行数据:一个项目分组行 + 两个任务行 */
const ROWS: GanttRow[] = [
  { id: 'p-1', text: '项目 A' },
  {
    id: 't-10',
    text: '任务甲',
    parent: 'p-1',
    start_date: '2026-09-01',
    end_date: '2026-09-12',
    assignee: '张三',
    status: 'in_progress',
    priority: 'high',
    css: 'pm-gantt-in_progress',
  },
  {
    id: 't-11',
    text: '任务乙',
    parent: 'p-1',
    start_date: '2026-09-05',
    end_date: '2026-09-20',
    assignee: '李四',
    status: 'done',
    priority: 'low',
    css: 'pm-gantt-done',
  },
];

/** 一条跨度很长的任务:时间轴比视口宽,才需要横向滚动 */
const WIDE_ROWS: GanttRow[] = [
  {
    id: 't-20',
    text: '长任务',
    start_date: '2025-01-01',
    end_date: '2027-06-12',
    status: 'in_progress',
    css: 'pm-gantt-in_progress',
  },
];

/** 从容器里取出 dhtmlx 实例(dhtmlx 把它挂在 init 的根元素上) */
function getInstance(container: HTMLElement): GanttStatic {
  const root = container.querySelector('.pm-gantt-root') as
    | (HTMLElement & { gantt?: GanttStatic })
    | null;
  const inst = root?.gantt;
  if (!inst) throw new Error('甘特实例没有挂到根元素上');
  return inst;
}

/** 模拟一次拖拽结束:dhtmlx 改完行日期后触发 onAfterTaskDrag */
function simulateDrag(
  inst: GanttStatic,
  id: string,
  start: string,
  end: string,
): void {
  const task = inst.getTask(id);
  task.start_date = inst.date.parseDate(start, '%Y-%m-%d');
  task.end_date = inst.date.parseDate(end, '%Y-%m-%d');
  inst.updateTask(id);
  inst.callEvent('onAfterTaskDrag', [id, 'move', new Event('drag')]);
}

/* ------------------------------------------------------------------ */
/* 对比度计算(给 m10 用):WCAG 相对亮度与对比度                        */
/* ------------------------------------------------------------------ */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 解析 css 颜色(#rgb / #rrggbb / rgb() / rgba()) */
function parseCssColor(value: string): Rgba {
  const text = value.trim();
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const nums = (text.match(/[\d.]+/g) ?? []).map(Number);
  return {
    r: nums[0] ?? 0,
    g: nums[1] ?? 0,
    b: nums[2] ?? 0,
    a: nums[3] ?? 1,
  };
}

/** 半透明色叠在底色上 */
function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/** WCAG 相对亮度 */
function relativeLuminance(color: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

/** 两个不透明颜色的对比度 */
function contrastRatio(a: Rgba, b: Rgba): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

afterEach(async () => {
  await cleanup();
});

describe('GanttChart 渲染', () => {
  it('三行数据 ⇒ 三行网格,叶子行画出条形', async () => {
    const { container } = await render(<GanttChart data={ROWS} />);

    expect(container.querySelectorAll('.gantt_row')).toHaveLength(3);
    // 两个任务行各有条形(项目分组行是汇总条,不算叶子)
    expect(
      container.querySelectorAll('.gantt_task_line').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('卸载后不残留旧的甘特实例', async () => {
    const { unmount } = await render(<GanttChart data={ROWS} />);
    expect(document.querySelector('.gantt_container')).toBeTruthy();

    await unmount();

    expect(document.querySelector('.gantt_container')).toBeNull();
  });

  it('只读模式:条上没有拖拽手柄', async () => {
    const { container, rerender } = await render(
      <GanttChart data={ROWS} readOnly={false} />,
    );
    expect(
      container.querySelectorAll('.gantt_task_drag').length,
    ).toBeGreaterThan(0);

    await rerender(<GanttChart data={ROWS} readOnly={true} />);

    expect(container.querySelectorAll('.gantt_task_drag')).toHaveLength(0);
  });
});

describe('GanttChart 颜色:不造字典,颜色在 css 里', () => {
  it('条形与状态标签只带线上码 class,不带语义角色 class', async () => {
    const { container } = await render(<GanttChart data={ROWS} />);

    // 条形:映射层的 statusCssClass 给的线上码 class
    const bar = container.querySelector(
      '.gantt_task_line.pm-gantt-in_progress',
    );
    expect(bar).toBeTruthy();
    // ❌ 视图层自造的「码 → 语义角色」class 不该再出现
    expect(
      container.querySelector('.gantt_task_line[class*="pm-gantt-bar--"]'),
    ).toBeNull();

    // 状态标签:同一个线上码 class
    const tag = container.querySelector('.pm-gantt-tag.pm-gantt-in_progress');
    expect(tag).toBeTruthy();
    expect(
      container.querySelector('.pm-gantt-tag[class*="pm-gantt-tag--"]')
        ?.className,
    ).not.toContain('pm-gantt-in_progress');
  });

  it('优先级是中性标签(后端优先级码不做语义色)', async () => {
    const { container } = await render(
      <GanttChart
        data={ROWS}
        labels={{ priority: { high: '高', low: '低' } }}
      />,
    );

    const neutrals = [
      ...container.querySelectorAll('.pm-gantt-tag--neutral'),
    ] as HTMLElement[];
    expect(neutrals.length).toBeGreaterThan(0);
    // 分组行没有优先级(显示 '-'),任务行的优先级查字典得「高」
    expect(neutrals.map((el) => el.textContent)).toContain('高');
    // 中性标签不带任何线上码 class ⇒ 不会被 css 按状态上色
    for (const el of neutrals) {
      expect(el.className).not.toContain('pm-gantt-high');
      expect(el.className).not.toContain('pm-gantt-low');
    }
  });

  it('gantt.css 里按线上码上色(加状态只改 css,不改 TS)', async () => {
    // 已知线上码各一条规则
    for (const code of [
      'done',
      'in_progress',
      'review',
      'blocked',
      'todo',
      'backlog',
      'cancelled',
    ]) {
      expect(ganttCss).toContain(`.pm-gantt-${code}`);
    }
    // 兜底:未知码落默认色
    expect(ganttCss).toContain('--pm-gantt-state: var(--pm-gantt-info)');
    // 自造的语义角色 class 不该再出现
    expect(ganttCss).not.toContain('pm-gantt-bar--');
  });

  it('不同状态码的条形颜色不同(颜色真的按线上码生效)', async () => {
    const { container } = await render(<GanttChart data={ROWS} />);

    const inProgress = container.querySelector(
      '.gantt_task_line.pm-gantt-in_progress',
    ) as HTMLElement;
    const done = container.querySelector(
      '.gantt_task_line.pm-gantt-done',
    ) as HTMLElement;

    const bgOf = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
    expect(bgOf(inProgress)).not.toBe(bgOf(done));
  });

  it('标签文字与底色对比度达标(暗色主题下也不浅底浅字)', async () => {
    const { container } = await render(
      <GanttChart data={ROWS} labels={{ priority: { high: '高' } }} />,
    );

    const root = container.querySelector('.pm-gantt-root') as HTMLElement;
    const pageBg = parseCssColor(
      getComputedStyle(root).getPropertyValue('--pm-gantt-bg').trim(),
    );

    const tags = [...container.querySelectorAll('.pm-gantt-tag')];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const style = getComputedStyle(tag);
      const bg = compositeOver(parseCssColor(style.backgroundColor), pageBg);
      const fg = compositeOver(parseCssColor(style.color), bg);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('GanttChart 拖拽与回滚', () => {
  it('拖拽结束 ⇒ onTaskDragEnd 收到行 id 与新旧日期', async () => {
    const onTaskDragEnd = vi.fn();
    const { container } = await render(
      <GanttChart data={ROWS} onTaskDragEnd={onTaskDragEnd} />,
    );
    const inst = getInstance(container);

    simulateDrag(inst, 't-10', '2026-09-03', '2026-09-14');

    expect(onTaskDragEnd).toHaveBeenCalledTimes(1);
    expect(onTaskDragEnd).toHaveBeenCalledWith('t-10', {
      start_date: '2026-09-03',
      end_date: '2026-09-14',
    });
  });

  it('revertTask 把行恢复成拖动前的日期', async () => {
    const ref: RefObject<GanttChartHandle | null> = { current: null };
    const { container } = await render(
      <GanttChart ref={ref} data={ROWS} onTaskDragEnd={vi.fn()} />,
    );
    const inst = getInstance(container);

    // 拖动前:dhtmlx 先问「能不能拖」,组件在这里记下旧日期
    inst.callEvent('onBeforeTaskDrag', ['t-10', 'move', new Event('drag')]);
    simulateDrag(inst, 't-10', '2026-09-03', '2026-09-14');

    ref.current?.revertTask('t-10');

    const task = inst.getTask('t-10');
    expect(task.start_date).toEqual(
      inst.date.parseDate('2026-09-01', '%Y-%m-%d'),
    );
    expect(task.end_date).toEqual(
      inst.date.parseDate('2026-09-12', '%Y-%m-%d'),
    );
  });

  it('重新灌数据后回滚不会恢复上一批数据的日期', async () => {
    const ref: RefObject<GanttChartHandle | null> = { current: null };
    const { container, rerender } = await render(
      <GanttChart ref={ref} data={ROWS} onTaskDragEnd={vi.fn()} />,
    );
    const inst = getInstance(container);

    // 拖动前缓存了 t-10 的旧日期
    inst.callEvent('onBeforeTaskDrag', ['t-10', 'move', new Event('drag')]);

    // 页面灌了一批新数据(t-10 的日期变了)
    const newRows: GanttRow[] = [
      ROWS[0],
      { ...ROWS[1], start_date: '2026-10-01', end_date: '2026-10-10' },
      ROWS[2],
    ];
    await rerender(
      <GanttChart ref={ref} data={newRows} onTaskDragEnd={vi.fn()} />,
    );

    ref.current?.revertTask('t-10');

    const task = inst.getTask('t-10');
    expect(task.start_date).toEqual(
      inst.date.parseDate('2026-10-01', '%Y-%m-%d'),
    );
    expect(task.end_date).toEqual(
      inst.date.parseDate('2026-10-10', '%Y-%m-%d'),
    );
  });
});

describe('GanttChart 缩放与文案', () => {
  it('setZoom 切换缩放级别,zoomToFit 不抛', async () => {
    const ref: RefObject<GanttChartHandle | null> = { current: null };
    const { container } = await render(<GanttChart ref={ref} data={ROWS} />);
    const inst = getInstance(container);

    // 默认是「周」
    expect(inst.ext.zoom.getCurrentLevel()).toBe(1);

    ref.current?.setZoom('day');
    expect(inst.ext.zoom.getCurrentLevel()).toBe(0);

    ref.current?.setZoom('month');
    expect(inst.ext.zoom.getCurrentLevel()).toBe(2);

    expect(() => ref.current?.zoomToFit()).not.toThrow();
  });

  it('scrollToToday 把时间轴滚到今天', async () => {
    // 视口默认是手机宽(414px)⇒ 用一个宽容器,时间轴才真的能横向滚
    const host = document.createElement('div');
    host.style.width = '1200px';
    document.body.appendChild(host);
    const ref: RefObject<GanttChartHandle | null> = { current: null };

    await render(<GanttChart ref={ref} data={WIDE_ROWS} />, {
      container: host,
    });
    const timeline = host.querySelector('.gantt_task') as HTMLElement;
    expect(timeline.scrollLeft).toBe(0);

    ref.current?.scrollToToday();
    // dhtmlx 的横向滚动是异步的(滚动条 scroll 事件)
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });

    expect(timeline.scrollLeft).toBeGreaterThan(0);
    host.remove();
  });

  it('状态列显示字典文案,查不到回退线上码', async () => {
    const { container } = await render(
      <GanttChart data={ROWS} labels={{ status: { in_progress: '进行中' } }} />,
    );

    const text = [...container.querySelectorAll('.gantt_cell')]
      .map((c) => c.textContent ?? '')
      .join('|');
    expect(text).toContain('进行中');
    // done 没给文案 ⇒ 回退线上码
    expect(text).toContain('done');
  });

  it('高度变化 ⇒ 把新高度同步给 dhtmlx', async () => {
    const { container, rerender } = await render(
      <GanttChart data={ROWS} height={400} />,
    );
    const inst = getInstance(container);
    const spy = vi.spyOn(inst, 'setSizes');
    const areaHeight = () =>
      (container.querySelector('.gantt_data_area') as HTMLElement).clientHeight;

    const before = areaHeight();
    await rerender(<GanttChart data={ROWS} height={760} />);
    const after = areaHeight();

    // dhtmlx 的布局尺寸是算出来的 ⇒ 必须让它重算(setSizes = resize)
    expect(spy).toHaveBeenCalled();
    expect(after).toBeGreaterThan(before);
  });
});

describe('GanttChart 今天线与安全', () => {
  it('今天线按 dhtmlx 的周起点算(不依赖 dayjs 的 locale)', async () => {
    // ⚠️ 把 dayjs 的 locale 明确设成「周日开头」:组件**不能**依赖它,
    // 必须用 dhtmlx 自己的周起点(config.start_on_monday,默认周一)
    const previous = dayjs.locale();
    dayjs.locale('en');
    try {
      const { container } = await render(<GanttChart data={ROWS} />);
      const inst = getInstance(container);

      const weekStart = inst.date.week_start(new Date());
      const nextWeek = inst.date.add(weekStart, 7, 'day');
      const startPos = inst.posFromDate(weekStart);
      const endPos = inst.posFromDate(nextWeek);

      const line = container.querySelector('.pm-gantt-today') as HTMLElement;
      expect(line).toBeTruthy();
      const left = Number.parseFloat(line.style.left);

      // 今天必须落在 dhtmlx 的这一周列里
      expect(left).toBeGreaterThanOrEqual(startPos - 1);
      expect(left).toBeLessThan(endPos - 1);
      // 画在「今天这一天的起点」
      const todayStart = inst.posFromDate(dayjs().startOf('day').toDate());
      expect(Math.abs(left - todayStart)).toBeLessThan(1);
    } finally {
      dayjs.locale(previous);
    }
  });

  it('不用 dayjs 的 locale 周起点(渲染过程不调用 startOf("week"))', async () => {
    // dayjs 的 startOf('week') 跟着 locale 走(周日/周一不定)⇒ 组件
    // 不能用它;dayjs 的工厂函数拿不到 Dayjs.prototype ⇒ 从实例上取
    const proto = Object.getPrototypeOf(dayjs()) as {
      startOf: (unit?: string) => unknown;
    };
    const spy = vi.spyOn(proto, 'startOf');
    try {
      await render(<GanttChart data={ROWS} />);
      expect(spy.mock.calls.filter((call) => call[0] === 'week')).toHaveLength(
        0,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('标题按文本渲染,不当作 HTML 执行', async () => {
    const evil = '<img src=x onerror="window.__pmGanttXss = true">';
    const rows: GanttRow[] = [
      {
        id: 't-30',
        text: evil,
        start_date: '2026-09-01',
        end_date: '2026-09-12',
        status: 'todo',
        css: 'pm-gantt-todo',
      },
    ];

    const { container } = await render(<GanttChart data={rows} />);

    // 没有任何 img 元素被注入(标题列与条形上的文字都转义了)
    expect(container.querySelector('img')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pmGanttXss).toBe(
      undefined,
    );
    // 标题原文还在(只是当纯文本显示)
    const cell = container.querySelector('.gantt_cell_tree');
    expect(cell?.textContent).toContain(evil);
  });

  it('gantt.css 里没有针对 .gantt_task_scale 的死规则', async () => {
    // 今天线挂在 .gantt_data_area(dhtmlx 自己已经 position: relative)
    expect(ganttCss).not.toMatch(/\.gantt_task_scale\s*\{/);
  });
});
