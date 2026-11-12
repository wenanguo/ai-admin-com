import type { ProjectOut } from '@/services/api/pm/project';

/**
 * **本地筛选** —— 把后端的筛选语义搬到浏览器里。
 *
 * ## 为什么需要它
 *
 * 列表与卡片视图改成用共享数据集（一次取全量）后，搜索与分页都在**本地**做。
 * ⚠️ 但「本地筛出来的结果」必须和「后端筛出来的结果」**一样**，
 * 否则用户换个视图，搜索结果就变了。
 *
 * ## 语义照抄后端
 *
 * 后端 `ModulePmProjectQueryParam.__post_init__`
 * （`~/project/AiAdmin/backend/app/plugin/module_pm_project/pm_project/schema.py`）：
 *
 * | 字段 | 后端 | 本地 |
 * | ---- | ---- | ---- |
 * | `code` / `name` / `status_code` / `priority_code` / `visibility_code` | `QueueEnum.like` ⇒ `LIKE %v%` | **包含**（大小写不敏感） |
 * | `owner_id` / `template_id` / `start_date` / `due_date` / `tags` / `extra_fields` | `QueueEnum.eq` ⇒ `=` | **严格相等** |
 *
 * MySQL 的 `utf8mb4_general_ci` 排序规则下 `LIKE` **大小写不敏感**
 * ⇒ 本地也用小写比较。
 */

/** LIKE（模糊匹配）的字段 —— 与后端的 `QueueEnum.like` 一一对应 */
export const LIKE_FIELDS = [
  'code',
  'name',
  'status_code',
  'priority_code',
  'visibility_code',
] as const;

/**
 * 列表搜索表单里**可搜索**的字段。
 *
 * ⚠️ 白名单：只认这些 key ⇒ ProTable 塞进来的其它参数（分页、排序、
 *   我们自己塞的版本号…）不会变成「一条都匹配不上」的筛选项。
 *
 * ⚠️ **新增可搜索列时，必须同时确认它的 LIKE / eq 归属**
 *    （对照上面的 `LIKE_FIELDS` 与后端的 `__post_init__`）——
 *    否则「后端筛得到、本地筛不到」的分裂会**悄悄回来**：
 *    归属写错时筛选结果不报错，只是少了一半（用户以为项目不存在）。
 */
export const SEARCHABLE_FIELDS = [
  'name',
  'code',
  'status_code',
  'priority_code',
  'owner_id',
] as const;

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
 * 按筛选条件过滤项目。
 *
 * @param projects 全量项目（共享数据集）
 * @param filters ProTable 的搜索参数（只认 `SEARCHABLE_FIELDS` 里的）
 */
export function filterProjects(
  projects: ProjectOut[],
  filters: Record<string, unknown>,
): ProjectOut[] {
  const active = SEARCHABLE_FIELDS.map((field) => ({
    field,
    raw: filters[field as string],
  })).filter(({ raw }) => !isEmptyValue(raw));

  if (active.length === 0) return projects;

  return projects.filter((project) =>
    active.every(({ field, raw }) => {
      const actual = (project as Record<string, unknown>)[field];
      return (LIKE_FIELDS as readonly string[]).includes(field)
        ? matchLike(actual, raw)
        : matchEq(actual, raw);
    }),
  );
}
