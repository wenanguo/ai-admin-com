import { describe, expect, it } from 'vitest';
import type { TaskOut } from '@/services/api/pm/task';
import { formatRange, mapTasksToGantt, statusCssClass } from './mapping';

/**
 * 甘特映射层的单测。
 *
 * 钉死三件事:
 * 1. 层级拼装:项目/里程碑分组行按需去重生成,任务行 parent 按
 *    parent_id > milestone_id > project_id 兜底(有父任务就绝不挂里程碑);
 * 2. 排除口径:缺计划起止日期的任务不进行、不分组,只计数 + 报标题(封顶 5 条);
 * 3. 两个格式化函数的边界:空状态也有 class、缺日期给「-」。
 */

/** 一条「能画进甘特」的完整任务 —— 其余用例在此基础上覆盖字段 */
function makeTask(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    id: 10,
    project_id: 1,
    milestone_id: 2,
    title: 'A',
    start_date: '2026-09-01',
    due_date: '2026-09-12',
    status_code: 'in_progress',
    priority_code: 'high',
    ...overrides,
  };
}

/** 侧载名字映射(项目/里程碑),与 useGanttTasks 将来喂进来的一致 */
const names = {
  projects: new Map<number, string>([[1, 'Alpha 项目']]),
  milestones: new Map<number, string>([[2, 'M1 里程碑']]),
};

describe('mapTasksToGantt 层级拼装', () => {
  it('一条完整任务 → 项目/里程碑/任务三行,里程碑挂项目、任务挂里程碑', () => {
    const mapping = mapTasksToGantt([makeTask()], names);

    // 行序即显示序:分组行在前、任务行在后
    expect(mapping.data.map((row) => row.id)).toEqual(['p-1', 'm-2', 't-10']);

    const projectRow = mapping.data.find((row) => row.id === 'p-1');
    const milestoneRow = mapping.data.find((row) => row.id === 'm-2');
    const taskRow = mapping.data.find((row) => row.id === 't-10');

    // 分组行文本来自侧载名字映射
    expect(projectRow?.text).toBe('Alpha 项目');
    expect(milestoneRow?.text).toBe('M1 里程碑');
    expect(milestoneRow?.parent).toBe('p-1');

    expect(taskRow?.parent).toBe('m-2');
    expect(taskRow?.start_date).toBe('2026-09-01');
    expect(taskRow?.end_date).toBe('2026-09-12');
    // 只有任务行带日期:分组行留给 dhtmlx 自己画汇总条
    expect(projectRow?.start_date).toBeUndefined();
    expect(milestoneRow?.end_date).toBeUndefined();
  });

  it('侧载名字查不到时,分组行兜底「项目 {id}」/「里程碑 {id}」', () => {
    const mapping = mapTasksToGantt(
      [makeTask({ project_id: 7, milestone_id: 8 })],
      { projects: new Map(), milestones: new Map() },
    );
    expect(mapping.data.find((row) => row.id === 'p-7')?.text).toBe('项目 7');
    expect(mapping.data.find((row) => row.id === 'm-8')?.text).toBe('里程碑 8');
  });

  it('没有里程碑的任务直接挂项目行', () => {
    const mapping = mapTasksToGantt(
      [makeTask({ id: 11, milestone_id: undefined })],
      names,
    );
    // 不建里程碑行,只有项目行 + 任务行
    expect(mapping.data.map((row) => row.id)).toEqual(['p-1', 't-11']);
    expect(mapping.data.find((row) => row.id === 't-11')?.parent).toBe('p-1');
  });

  it('有 parent_id 的任务挂父任务行,不挂里程碑(优先级 parent_id 最高)', () => {
    const mapping = mapTasksToGantt(
      [
        makeTask({ id: 20, title: '父任务' }),
        makeTask({ id: 10, parent_id: 20, title: '子任务' }),
      ],
      names,
    );
    // 两个任务共享同一项目/里程碑:分组行只建一次
    expect(mapping.data.map((row) => row.id)).toEqual([
      'p-1',
      'm-2',
      't-20',
      't-10',
    ]);

    // 子任务有 milestone_id 也不挂,父任务优先
    expect(mapping.data.find((row) => row.id === 't-10')?.parent).toBe('t-20');
    // 父任务自身的挂载不受子任务影响(仍挂里程碑)
    expect(mapping.data.find((row) => row.id === 't-20')?.parent).toBe('m-2');
  });
});

describe('mapTasksToGantt 排除口径', () => {
  it('缺计划开始日期的任务不进行、不分组,只计数并报标题', () => {
    const mapping = mapTasksToGantt(
      [makeTask({ id: 12, title: '没开始日', start_date: undefined })],
      names,
    );
    // 连项目/里程碑分组行都不建:被排除的任务整体不进甘特
    expect(mapping.data).toHaveLength(0);
    expect(mapping.excludedCount).toBe(1);
    expect(mapping.excludedTitles).toEqual(['没开始日']);
  });

  it('缺计划截止日期同样被排除', () => {
    const mapping = mapTasksToGantt(
      [makeTask({ id: 13, title: '没截止日', due_date: undefined })],
      names,
    );
    expect(mapping.data.find((row) => row.id === 't-13')).toBeUndefined();
    expect(mapping.excludedCount).toBe(1);
    expect(mapping.excludedTitles).toContain('没截止日');
  });

  it('被排除的标题最多列 5 条,超出的只计数', () => {
    const tasks = Array.from({ length: 7 }, (_, i) =>
      makeTask({
        id: 100 + i,
        title: `无日期任务 ${i}`,
        start_date: undefined,
      }),
    );
    const mapping = mapTasksToGantt(tasks, names);
    expect(mapping.excludedCount).toBe(7);
    expect(mapping.excludedTitles).toHaveLength(5);
    expect(mapping.excludedTitles[0]).toBe('无日期任务 0');
  });
});

describe('statusCssClass 状态条形 class', () => {
  it('有状态:返回包含线上码的非空 class 名', () => {
    expect(statusCssClass('in_progress')).toBeTruthy();
    expect(statusCssClass('in_progress')).toContain('in_progress');
  });

  it('空状态也有 class(返回 undefined 会让没状态的任务样式失控)', () => {
    expect(statusCssClass(undefined)).toBeTruthy();
    expect(statusCssClass(null)).toBeTruthy();
  });
});

describe('formatRange 起止区间文本', () => {
  it('同年区间省年份:「09-01 ~ 09-12」', () => {
    expect(formatRange('2026-09-01', '2026-09-12')).toBe('09-01 ~ 09-12');
  });

  it('起止缺失给「-」占位', () => {
    expect(formatRange(undefined, undefined)).toBe('-');
  });
});
