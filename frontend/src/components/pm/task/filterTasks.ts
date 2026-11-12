import type { TaskOut } from '@/services/api/pm/task';

/**
 * **本地筛选** —— 把后端的筛选语义搬到浏览器里。
 *
 * ## 为什么需要它
 *
 * 列表改成用共享数据集（一次取全量）后，搜索与分页都在**本地**做。
 * ⚠️ 但「本地筛出来的结果」必须和「后端筛出来的结果」**一样**，
 * 否则用户换个视图，搜索结果就变了。
 *
 * ## 语义照抄后端
 *
 * 后端 `ModulePmTaskQueryParam.__post_init__`
 * （`~/project/AiAdmin/backend/app/plugin/module_pm_project/pm_task/schema.py`）：
 *
 * | 字段 | 后端 | 本地 |
 * | ---- | ---- | ---- |
 * | `title` / `status_code` / `priority_code` / `created_via_code` / `blocked_reason` | `QueueEnum.like` ⇒ `LIKE %v%` | **包含**（大小写不敏感） |
 * | 其余 | `QueueEnum.eq` ⇒ `=` | **严格相等** |
 *
 * MySQL 的 `utf8mb4_general_ci` 排序规则下 `LIKE` **大小写不敏感**
 * ⇒ 本地也用小写比较。
 */

/** LIKE（模糊匹配）的字段 —— 与后端的 `QueueEnum.like` 一一对应 */
export const LIKE_FIELDS = [
  'title',
  'status_code',
  'priority_code',
  'created_via_code',
  'blocked_reason',
] as const;

/**
 * 列表搜索表单里**可搜索**的字段。
 *
 * ⚠️ 白名单：只认这些 key ⇒ ProTable 塞进来的其它参数（分页、排序、
 *   我们自己塞的版本号…）不会变成「一条都匹配不上」的筛选项。
 */
export const SEARCHABLE_FIELDS = [
  'title',
  'project_id',
  'status_code',
  'priority_code',
  'type_code',
  'assignee_id',
] as const;

type SearchableField = (typeof SEARCHABLE_FIELDS)[number];

/** 值的「空」判定：与后端「参数为 None / 空串就不加条件」一致 */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/** LIKE 字段：包含（大小写不敏感） */
function matchLike(actual: unknown, expected: unknown): boolean {
  return String(actual ?? '')
    .toLowerCase()
    .includes(String(expected).toLowerCase());
}

/** eq 字段：严格相等（数字用字符串比 ⇒ 表单给的 '7' 能匹配 7） */
function matchEq(actual: unknown, expected: unknown): boolean {
  return String(actual ?? '') === String(expected);
}

/**
 * 按筛选条件过滤任务。
 *
 * @param tasks 全量任务（共享数据集）
 * @param filters ProTable 的搜索参数（只认 `SEARCHABLE_FIELDS` 里的）
 */
export function filterTasks(
  tasks: TaskOut[],
  filters: Record<string, unknown>,
): TaskOut[] {
  const active = SEARCHABLE_FIELDS.map((field) => ({
    field,
    raw: filters[field as string],
  })).filter(({ raw }) => !isEmptyValue(raw));

  if (active.length === 0) return tasks;

  return tasks.filter((task) =>
    active.every(({ field, raw }) => {
      const actual = (task as Record<string, unknown>)[field];
      return (LIKE_FIELDS as readonly string[]).includes(field)
        ? matchLike(actual, raw)
        : matchEq(actual, raw);
    }),
  );
}
