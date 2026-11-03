import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/**
 * 里程碑 service。
 *
 * 后端的坑:
 * - 更新是 `PUT /pm_milestone/update/{id}` 且要传**整对象** —— 后端
 *   `ModulePmMilestoneUpdateSchema` 继承 CreateSchema,没有 PATCH
 * - 删除的请求体是**裸数组**(不是 `{ ids }`)
 * - `progress` 是后端缓存的**派生字段**(任务状态变更触发
 *   `ModulePmMilestoneService.recalc_progress` 维护),Create/Update 里**不传**,
 *   所以入参类型里没有它
 * - `deliverables` 是 dict(不是数组);`health_score` 是 0-100 的可写字段
 */

/** 后端 ModulePmMilestoneOutSchema.project_by —— 所属项目信息 {id, name, code} */
export interface MilestoneProjectBy {
  id?: number | null;
  name?: string | null;
  code?: string | null;
}

/** 后端 ModulePmMilestoneOutSchema */
export interface MilestoneOut {
  id?: number | null;
  /** 所属项目(module_pm_project.id) */
  project_id?: number | null;
  /** 里程碑名称 */
  name?: string | null;
  /** 里程碑描述 */
  description?: string | null;
  /** 计划开始日期 */
  start_date?: string | null;
  /** 计划截止日期 */
  due_date?: string | null;
  /** 实际开始日期 */
  actual_start_date?: string | null;
  /** 实际结束日期 */
  actual_end_date?: string | null;
  /** 状态(字典:module_pm_milestone_status) */
  status_code?: string | null;
  /** 交付物清单(dict,不是数组) */
  deliverables?: Record<string, unknown> | null;
  /** 显示排序 */
  sort_order?: number | null;
  /** 健康度 0-100(可写) */
  health_score?: number | null;
  /**
   * 进度 0-100 —— 后端缓存的派生字段,由任务完成率推算并维护,
   * 不在 Create/Update 入参里
   */
  progress?: number | null;
  /** 所属项目信息 {id, name, code} */
  project_by?: MilestoneProjectBy | null;
  created_time?: string | null;
  updated_time?: string | null;
}

/** 后端 ModulePmMilestoneQueryParam */
export type MilestoneListParams = Partial<PageQuery> & {
  project_id?: number;
  name?: string;
  start_date?: string;
  due_date?: string;
  actual_start_date?: string;
  actual_end_date?: string;
  status_code?: string;
  sort_order?: number;
  health_score?: number;
};

/** 后端 ModulePmMilestoneCreateSchema */
export type MilestoneCreateParams = {
  /** 所属项目(module_pm_project.id) */
  project_id: number;
  /** 里程碑名称 */
  name: string;
  /** 里程碑描述 */
  description?: string | null;
  /** 计划开始日期 */
  start_date: string;
  /** 计划截止日期 */
  due_date: string;
  /** 实际开始日期 */
  actual_start_date?: string | null;
  /** 实际结束日期 */
  actual_end_date?: string | null;
  /** 状态(字典:module_pm_milestone_status) */
  status_code: string;
  /** 交付物清单(dict,不是数组) */
  deliverables?: Record<string, unknown> | null;
  /** 显示排序 */
  sort_order: number;
  /** 健康度 0-100(可写) */
  health_score?: number | null;
};

/** 更新要传整对象:后端 UpdateSchema 继承 CreateSchema,必填集相同;派生字段 progress 不传 */
export type MilestoneUpdateParams = MilestoneCreateParams;

/** 里程碑列表 */
export async function listMilestones(
  params: MilestoneListParams,
): Promise<ApiResponse<PageResult<MilestoneOut>>> {
  return request<ApiResponse<PageResult<MilestoneOut>>>('/pm_milestone/list', {
    method: 'GET',
    params,
  });
}

/** 里程碑详情 */
export async function getMilestoneDetail(
  id: number,
): Promise<ApiResponse<MilestoneOut>> {
  return request<ApiResponse<MilestoneOut>>(`/pm_milestone/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建里程碑(progress 是后端派生字段,不进请求体) */
export async function createMilestone(
  params: MilestoneCreateParams,
): Promise<ApiResponse<MilestoneOut>> {
  return request<ApiResponse<MilestoneOut>>('/pm_milestone/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新里程碑(整对象 PUT,后端没有 PATCH;progress 不传) */
export async function updateMilestone(
  id: number,
  params: MilestoneUpdateParams,
): Promise<ApiResponse<MilestoneOut>> {
  return request<ApiResponse<MilestoneOut>>(`/pm_milestone/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除里程碑(后端请求体是裸数组,不是 { ids }) */
export async function deleteMilestones(
  ids: number[],
): Promise<ApiResponse<null>> {
  return request<ApiResponse<null>>('/pm_milestone/delete', {
    method: 'DELETE',
    data: ids,
  });
}
