import { describe, expect, it } from 'vitest';
import type { TaskOut } from '@/services/api/pm/task';
import { filterTasks, LIKE_FIELDS, SEARCHABLE_FIELDS } from './filterTasks';

/**
 * 本地筛选的单测。
 *
 * ⚠️ **语义必须照后端**，不然「切到本地筛」之后结果就变了：
 * 后端 `ModulePmTaskQueryParam.__post_init__`（`~/project/AiAdmin/backend/app/plugin/module_pm_project/pm_task/schema.py`）：
 *
 * - `title` / `status_code` / `priority_code` / `created_via_code` / `blocked_reason`
 *   ⇒ **LIKE %v%**（`attr.like(f"%{val}%")`，MySQL 的 `utf8mb4_general_ci` **大小写不敏感**）
 * - 其余字段 ⇒ **eq**
 */

function task(overrides: Partial<TaskOut>): TaskOut {
  return { id: 1, title: '登录页改版', status_code: 'todo', ...overrides };
}

describe('filterTasks', () => {
  it('没有筛选条件 ⇒ 原样返回', () => {
    const tasks = [task({}), task({ id: 2 })];
    expect(filterTasks(tasks, {})).toHaveLength(2);
  });

  it('title 是「包含」不是「等于」', () => {
    const tasks = [
      task({ id: 1, title: '登录页改版' }),
      task({ id: 2, title: '订单导出' }),
    ];
    expect(filterTasks(tasks, { title: '登录' }).map((t) => t.id)).toEqual([1]);
  });

  it('title 的模糊匹配大小写不敏感（与 MySQL 的 LIKE 一致）', () => {
    const tasks = [task({ id: 1, title: 'Login Page' })];
    expect(filterTasks(tasks, { title: 'login' })).toHaveLength(1);
    expect(filterTasks(tasks, { title: 'LOGIN' })).toHaveLength(1);
  });

  it('空值条件不参与过滤（后端「参数为 None 就不加条件」）', () => {
    const tasks = [task({ id: 1 }), task({ id: 2, title: '别的' })];
    expect(filterTasks(tasks, { title: '' })).toHaveLength(2);
    expect(filterTasks(tasks, { title: undefined })).toHaveLength(2);
    expect(filterTasks(tasks, { title: null })).toHaveLength(2);
  });

  it('project_id 是严格相等（不是包含）', () => {
    const tasks = [
      task({ id: 1, project_id: 3 }),
      task({ id: 2, project_id: 33 }),
    ];
    expect(filterTasks(tasks, { project_id: 3 }).map((t) => t.id)).toEqual([1]);
  });

  it('status_code 是 LIKE（后端就是 like）⇒ `todo` 也匹配 `todo_x`', () => {
    const tasks = [
      task({ id: 1, status_code: 'todo' }),
      task({ id: 2, status_code: 'todo_x' }),
      task({ id: 3, status_code: 'done' }),
    ];
    expect(
      filterTasks(tasks, { status_code: 'todo' }).map((t) => t.id),
    ).toEqual([1, 2]);
  });

  it('数字字段用字符串比较（表单给的是字符串）', () => {
    const tasks = [
      task({ id: 1, assignee_id: 7 }),
      task({ id: 2, assignee_id: 8 }),
    ];
    expect(filterTasks(tasks, { assignee_id: '7' }).map((t) => t.id)).toEqual([
      1,
    ]);
  });

  it('不在可搜索字段里的 key 一律忽略（不能把列表清空）', () => {
    const tasks = [task({ id: 1 })];
    expect(filterTasks(tasks, { __v: 12345 })).toHaveLength(1);
    expect(filterTasks(tasks, { not_a_column: 'x' })).toHaveLength(1);
  });

  it('LIKE 字段清单与后端一致', () => {
    expect([...LIKE_FIELDS].sort()).toEqual(
      [
        'blocked_reason',
        'created_via_code',
        'priority_code',
        'status_code',
        'title',
      ].sort(),
    );
    expect([...SEARCHABLE_FIELDS].sort()).toEqual(
      [
        'assignee_id',
        'priority_code',
        'project_id',
        'status_code',
        'title',
        'type_code',
      ].sort(),
    );
  });
});
