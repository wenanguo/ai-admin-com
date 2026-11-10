/**
 * 「当前讨论的任务」上下文的组装测试。
 *
 * 钉死三件事：
 * 1. 上下文里的 `task` 是**能直接 PUT 出去的那份**（整对象 PUT 的基线）：
 *    必填字段一个都不能少；
 * 2. **不带**那些不是用户可编辑的列（报告人 / 排序 / 创建方式）
 *    —— 带上反而会改掉它们；
 * 3. 字典中文名合成一张表（三个字典的线上码互不重叠）。
 */
import { describe, expect, it } from 'vitest';
import type { TaskOut } from '@/services/api/pm/task';
import { buildAiTaskContext, mergeDictLabels } from './aiContext';

/** 一个任务行（列表接口给的那份）。 */
function makeTask(overrides?: Partial<TaskOut>): TaskOut {
  return {
    id: 6,
    project_id: 5,
    milestone_id: 5,
    parent_id: 7,
    title: '测试333',
    description: null,
    type_code: 'feature',
    status_code: 'in_progress',
    priority_code: 'P1',
    estimate_hours: null,
    actual_hours: null,
    assignee_id: 6,
    start_date: null,
    due_date: null,
    ...overrides,
  } as TaskOut;
}

describe('buildAiTaskContext', () => {
  it('带齐整对象 PUT 的必填字段', () => {
    const context = buildAiTaskContext({ task: makeTask() });

    expect(context).not.toBeNull();
    for (const key of [
      'id',
      'project_id',
      'title',
      'type_code',
      'status_code',
      'priority_code',
    ]) {
      expect(context?.task).toHaveProperty(key);
    }
  });

  it('不带报告人 / 排序 / 创建方式（不是用户可编辑的列）', () => {
    const context = buildAiTaskContext({ task: makeTask() });

    expect(context?.task).not.toHaveProperty('reporter_id');
    expect(context?.task).not.toHaveProperty('sort_order');
    expect(context?.task).not.toHaveProperty('created_via_code');
  });

  it('带上项目与里程碑的名字（模型要能说出“这条属于谁”）', () => {
    const context = buildAiTaskContext({
      task: makeTask(),
      projectName: '财务对账系统升级',
      milestoneName: 'M5 已延期',
    });

    expect(context?.project).toEqual({ id: 5, name: '财务对账系统升级' });
    expect(context?.milestone).toEqual({ id: 5, name: 'M5 已延期' });
  });

  it('没有 id ⇒ null（没法回填，也没法高亮）', () => {
    expect(
      buildAiTaskContext({ task: makeTask({ id: undefined }) }),
    ).toBeNull();
  });

  it('空值保持 null（服务端会把 null 的键整个去掉）', () => {
    const context = buildAiTaskContext({ task: makeTask() });

    expect(context?.task['description']).toBeNull();
    expect(context?.task['actual_hours']).toBeNull();
  });
});

describe('mergeDictLabels', () => {
  it('三个字典合成一张表（线上码不重叠）', () => {
    const labels = mergeDictLabels(
      [{ value: 'in_progress', label: '进行中' }],
      [{ value: 'P1', label: '高' }],
      [{ value: 'feature', label: '功能' }],
    );

    expect(labels).toEqual({
      in_progress: '进行中',
      P1: '高',
      feature: '功能',
    });
  });

  it('空字典 ⇒ 空表', () => {
    expect(mergeDictLabels()).toEqual({});
  });
});
