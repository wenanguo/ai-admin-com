import { describe, expect, it } from 'vitest';
import type { TaskOut } from '@/services/api/pm/task';
import { buildDateUpdatePayload, toDateChange } from './payload';

/**
 * 甘特拖拽写回载荷的单测。
 *
 * 钉死三件事:
 * 1. 载荷形状:后端是**整对象 PUT**(UpdateSchema 继承 CreateSchema,没有 PATCH),
 *    所以除了两个日期,其余字段一律从拖动前的那份 TaskOut 拷 —— 读-改-写;
 * 2. 必填缺失 ⇒ 返回 null(不发一个注定 422 的请求);
 * 3. 更新载荷**不含** reporter_id / sort_order / created_via_code 三列。
 */

/** 一条字段齐全的任务 —— 其余用例在此基础上挖洞 */
function makeTask(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    id: 10,
    project_id: 1,
    milestone_id: 2,
    parent_id: null,
    title: '写回用例',
    description: '拖之前的描述',
    type_code: 'feature',
    status_code: 'in_progress',
    priority_code: 'high',
    estimate_hours: 8,
    actual_hours: 2,
    assignee_id: 7,
    reviewers: '1,2',
    labels: '前端',
    start_date: '2026-09-01',
    due_date: '2026-09-12',
    reporter_id: 99,
    sort_order: 3,
    created_via_code: 'manual',
    blocked_reason: null,
    ...overrides,
  };
}

/** 拖拽后的新日期(change 用 dhtmlx 的 end_date 命名) */
const change = { start_date: '2026-10-05', end_date: '2026-10-20' };

describe('buildDateUpdatePayload 载荷形状', () => {
  it('两个日期取拖拽后的新值,其余必填字段取拖动前的值', () => {
    const payload = buildDateUpdatePayload(makeTask(), change);

    expect(payload).not.toBeNull();
    expect(payload?.start_date).toBe('2026-10-05');
    expect(payload?.due_date).toBe('2026-10-20');
    expect(payload?.project_id).toBe(1);
    expect(payload?.title).toBe('写回用例');
    expect(payload?.type_code).toBe('feature');
    expect(payload?.status_code).toBe('in_progress');
    expect(payload?.priority_code).toBe('high');
  });

  it('整对象 PUT 不能丢字段:before 里的可选字段原样带着', () => {
    const payload = buildDateUpdatePayload(makeTask(), change);

    expect(payload?.description).toBe('拖之前的描述');
    expect(payload?.assignee_id).toBe(7);
    expect(payload?.milestone_id).toBe(2);
    expect(payload?.estimate_hours).toBe(8);
    expect(payload?.actual_hours).toBe(2);
    expect(payload?.reviewers).toBe('1,2');
    expect(payload?.labels).toBe('前端');
    expect(payload?.blocked_reason).toBeNull();
  });

  it('更新载荷不带 reporter_id / sort_order / created_via_code 三列', () => {
    const payload = buildDateUpdatePayload(makeTask(), change);

    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty('reporter_id');
    expect(payload).not.toHaveProperty('sort_order');
    expect(payload).not.toHaveProperty('created_via_code');
  });
});

describe('buildDateUpdatePayload 必填缺失', () => {
  it('缺 type_code ⇒ 返回 null(不是缺字段的半个对象)', () => {
    const payload = buildDateUpdatePayload(
      makeTask({ type_code: undefined }),
      change,
    );
    expect(payload).toBeNull();
  });

  it('缺 project_id / title / status_code / priority_code 同样返回 null', () => {
    expect(
      buildDateUpdatePayload(makeTask({ project_id: null }), change),
    ).toBeNull();
    expect(
      buildDateUpdatePayload(makeTask({ title: undefined }), change),
    ).toBeNull();
    expect(
      buildDateUpdatePayload(makeTask({ status_code: undefined }), change),
    ).toBeNull();
    expect(
      buildDateUpdatePayload(makeTask({ priority_code: undefined }), change),
    ).toBeNull();
  });
});

describe('toDateChange 改名转换', () => {
  it('dhtmlx 的 end_date 就是后端的 due_date:只改名,不做别的加工', () => {
    expect(
      toDateChange({ start_date: '2026-09-01', end_date: '2026-09-12' }),
    ).toEqual({ start_date: '2026-09-01', end_date: '2026-09-12' });
  });
});
