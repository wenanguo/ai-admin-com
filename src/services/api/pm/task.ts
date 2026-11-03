import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/**
 * 任务 service。
 *
 * 后端的坑:
 * - 更新是 `PUT /pm_task/update/{id}` 且要传**整对象** —— 后端
 *   `ModulePmTaskUpdateSchema` 继承 CreateSchema,没有 PATCH
 * - 删除的请求体是**裸数组**(不是 `{ ids }`),支持批量
 * - `reviewers` / `labels` 语义是数组和标签,但后端存的是**字符串** ——
 *   序列化/反序列化是表单层的职责,service 层原样透传
 * - `sort_order` / `created_via_code` 可空:后端 service 分别用 `0` / `'web'` 兜底
 * - `reporter_id` 可空:为 None 时后端用当前登录用户回填
 */

/** 后端 ModulePmTaskOutSchema.assignee_by / reporter_by —— 用户信息 {id, name, username} */
export interface TaskUserRef {
  id?: number | null;
  name?: string | null;
  username?: string | null;
}

/** 后端 ModulePmTaskOutSchema */
export interface TaskOut {
  id?: number | null;
  /** 所属项目(module_pm_project.id) */
  project_id?: number | null;
  /** 所属里程碑(module_pm_milestone.id) */
  milestone_id?: number | null;
  /** 父任务(module_pm_task.id,INV-02 不能跨项目) */
  parent_id?: number | null;
  /** 任务标题 */
  title?: string | null;
  /** 任务描述(Markdown) */
  description?: string | null;
  /** 类型(字典:module_pm_task_type,如 feature/bug/ops) */
  type_code?: string | null;
  /** 状态(字典:module_pm_task_status) */
  status_code?: string | null;
  /** 优先级(字典:module_pm_priority) */
  priority_code?: string | null;
  /** 预估工时(INV-09 >=0) */
  estimate_hours?: number | null;
  /** 实际工时(INV-09 >=0) */
  actual_hours?: number | null;
  /** 当前负责人(sys_user.id) */
  assignee_id?: number | null;
  /** 创建人(sys_user.id;后端在为空时用当前登录用户回填) */
  reporter_id?: number | null;
  /** 评审人ID列表(后端存字符串) */
  reviewers?: string | null;
  /** 标签数组(后端存字符串) */
  labels?: string | null;
  /** 计划开始日期 */
  start_date?: string | null;
  /** 计划截止日期 */
  due_date?: string | null;
  /** 实际开始日期 */
  actual_start_date?: string | null;
  /** 实际结束日期 */
  actual_end_date?: string | null;
  /** 看板拖拽排序(空时后端用 0 兜底) */
  sort_order?: number | null;
  /** 创建方式(字典:module_pm_task_created_via;空时后端用 'web' 兜底) */
  created_via_code?: string | null;
  /** 阻塞原因 */
  blocked_reason?: string | null;
  /** 负责人信息 {id, name, username} */
  assignee_by?: TaskUserRef | null;
  /** 报告人信息 {id, name, username} */
  reporter_by?: TaskUserRef | null;
  created_time?: string | null;
  updated_time?: string | null;
}

/** 后端 ModulePmTaskQueryParam */
export type TaskListParams = Partial<PageQuery> & {
  project_id?: number;
  milestone_id?: number;
  parent_id?: number;
  title?: string;
  type_code?: string;
  status_code?: string;
  priority_code?: string;
  estimate_hours?: number;
  actual_hours?: number;
  assignee_id?: number;
  reporter_id?: number;
  reviewers?: string;
  labels?: string;
  start_date?: string;
  due_date?: string;
  actual_start_date?: string;
  actual_end_date?: string;
  sort_order?: number;
  created_via_code?: string;
  blocked_reason?: string;
};

/** 后端 ModulePmTaskCreateSchema */
export type TaskCreateParams = {
  /** 所属项目(module_pm_project.id) */
  project_id: number;
  /** 所属里程碑(module_pm_milestone.id) */
  milestone_id?: number | null;
  /** 父任务(module_pm_task.id,INV-02 不能跨项目) */
  parent_id?: number | null;
  /** 任务标题 */
  title: string;
  /** 任务描述(Markdown) */
  description?: string | null;
  /** 类型(字典:module_pm_task_type,如 feature/bug/ops) */
  type_code: string;
  /** 状态(字典:module_pm_task_status) */
  status_code: string;
  /** 优先级(字典:module_pm_priority) */
  priority_code: string;
  /** 预估工时(INV-09 >=0) */
  estimate_hours?: number | null;
  /** 实际工时(INV-09 >=0) */
  actual_hours?: number | null;
  /** 当前负责人(sys_user.id) */
  assignee_id?: number | null;
  /** 创建人(sys_user.id);为 None 时后端用当前登录用户回填 */
  reporter_id?: number | null;
  /** 评审人ID列表(后端存字符串) */
  reviewers?: string | null;
  /** 标签数组(后端存字符串) */
  labels?: string | null;
  /** 计划开始日期 */
  start_date?: string | null;
  /** 计划截止日期 */
  due_date?: string | null;
  /** 实际开始日期 */
  actual_start_date?: string | null;
  /** 实际结束日期 */
  actual_end_date?: string | null;
  /** 看板拖拽排序(空时后端用 0 兜底) */
  sort_order?: number | null;
  /** 创建方式(字典:module_pm_task_created_via;空时后端用 'web' 兜底) */
  created_via_code?: string | null;
  /** 阻塞原因 */
  blocked_reason?: string | null;
};

/** 更新要传整对象:后端 UpdateSchema 继承 CreateSchema,必填集相同 */
export type TaskUpdateParams = TaskCreateParams;

/** 任务列表 */
export async function listTasks(
  params: TaskListParams,
): Promise<ApiResponse<PageResult<TaskOut>>> {
  return request<ApiResponse<PageResult<TaskOut>>>('/pm_task/list', {
    method: 'GET',
    params,
  });
}

/** 任务详情 */
export async function getTaskDetail(id: number): Promise<ApiResponse<TaskOut>> {
  return request<ApiResponse<TaskOut>>(`/pm_task/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建任务 */
export async function createTask(
  params: TaskCreateParams,
): Promise<ApiResponse<TaskOut>> {
  return request<ApiResponse<TaskOut>>('/pm_task/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新任务(整对象 PUT,后端没有 PATCH) */
export async function updateTask(
  id: number,
  params: TaskUpdateParams,
): Promise<ApiResponse<TaskOut>> {
  return request<ApiResponse<TaskOut>>(`/pm_task/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除任务(支持批量;后端请求体是裸数组,不是 { ids }) */
export async function deleteTasks(ids: number[]): Promise<ApiResponse<null>> {
  return request<ApiResponse<null>>('/pm_task/delete', {
    method: 'DELETE',
    data: ids,
  });
}
