/**
 * 「挂起的写参数」工具的测试。
 *
 * 这层的作用：**批准之后确定要刷新哪一行** ⇒ 靠挂起记录里的参数反推。
 */
import { describe, expect, it } from 'vitest';
import { pendingChangedFields, pendingTaskId } from './pendingArgs';

describe('pendingTaskId', () => {
  it('update_task ⇒ 从 id 字段取任务 id', () => {
    expect(
      pendingTaskId({
        command: 'mcp__aiadmin__update_task',
        args: { id: 6, title: '测试333' },
      }),
    ).toBe(6);
  });

  it('patch_task_status ⇒ 从 ids 数组取', () => {
    expect(
      pendingTaskId({
        command: 'mcp__aiadmin__patch_task_status',
        args: { ids: [6, 7], status: 1 },
      }),
    ).toBe(6);
  });

  it('不是任务写操作 ⇒ undefined（别去刷别的页面）', () => {
    expect(
      pendingTaskId({ command: 'mcp__aiadmin__create_task', args: { id: 6 } }),
    ).toBeUndefined();
    expect(pendingTaskId({ command: 'update_task', args: {} })).toBeUndefined();
    expect(pendingTaskId(undefined)).toBeUndefined();
  });

  it('id 不是正整数 ⇒ undefined', () => {
    expect(
      pendingTaskId({ command: 'update_task', args: { id: 0 } }),
    ).toBeUndefined();
    expect(
      pendingTaskId({ command: 'update_task', args: { id: 1.5 } }),
    ).toBeUndefined();
    expect(
      pendingTaskId({ command: 'update_task', args: { id: '6' } }),
    ).toBeUndefined();
  });
});

describe('pendingChangedFields', () => {
  it('只报**真的变了**的可写字段（参数里还带着基线）', () => {
    const baseline = {
      id: 6,
      status_code: 'in_progress',
      actual_hours: null,
      description: null,
    };
    const fields = pendingChangedFields(
      {
        command: 'mcp__aiadmin__update_task',
        args: {
          id: 6,
          status_code: 'done',
          actual_hours: 8,
          description: '做完了',
        },
      },
      baseline,
    );

    expect(fields.sort()).toEqual([
      'actual_hours',
      'description',
      'status_code',
    ]);
  });

  it('值没变的字段不算（不然会显示“改了三个字段”）', () => {
    const baseline = {
      status_code: 'done',
      actual_hours: 8,
      description: '做完了',
    };
    const fields = pendingChangedFields(
      {
        command: 'update_task',
        args: {
          id: 6,
          status_code: 'done',
          actual_hours: 8,
          description: '做完了',
        },
      },
      baseline,
    );

    expect(fields).toEqual([]);
  });

  it('没有基线 ⇒ 不猜（空数组）', () => {
    expect(
      pendingChangedFields(
        { command: 'update_task', args: { status_code: 'done' } },
        undefined,
      ),
    ).toEqual([]);
  });
});
