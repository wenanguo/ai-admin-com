import type { GanttStatic } from 'dhtmlx-gantt';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import type { GanttChartHandle } from './GanttChart';
import { GanttChart } from './GanttChart';
import type { GanttRow } from './mapping';

/**
 * 甘特图组件(dhtmlx vanilla 封装)的单测。
 *
 * 钉死七件事:
 * 1. 行与条形:三行数据 ⇒ 三行网格 + 叶子行画出条形;
 * 2. 卸载不残留:组件卸载后 DOM 里不能再有 `.gantt_container`
 *    (dhtmlx 实例是全局的,残留实例会顶掉下一个图表);
 * 3. 只读:readOnly 时条上没有拖拽手柄(不给拖、不给内联编辑);
 * 4. 拖拽回调:onAfterTaskDrag ⇒ onTaskDragEnd(rowId, {start_date, end_date});
 * 5. 回滚:revertTask 把行恢复成拖动前的日期(调用方不用知道旧日期);
 * 6. 缩放与滚动:setZoom 切级别、zoomToFit 不抛、scrollToToday 真的滚;
 * 7. 状态/优先级文案:查 labels,查不到回退线上码。
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
    // 条形带上了状态色 class(颜色由 antd token 注入,不在 css 里写死色值)
    expect(
      container.querySelector('.gantt_task_line.pm-gantt-bar--primary'),
    ).toBeTruthy();
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
});
