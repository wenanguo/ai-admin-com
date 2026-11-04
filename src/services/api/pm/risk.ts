import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/**
 * 风险 service。
 *
 * 后端的坑:
 * - 更新是 `PUT /pm_risk/update/{id}` 且要传**整对象** —— 后端
 *   `ModulePmRiskUpdateSchema` 继承 CreateSchema,没有 PATCH
 * - 删除的请求体是**裸数组**(不是 `{ ids }`)
 * - `score` 后端**必填且不负责计算** —— 由调用方按 `probability × impact` 算好传入,
 *   少了就是 422
 * - `ai_suggestion` 语义是对象,但创建/更新走 dict;查询参数里它却是 **JSON 字符串**
 * - `owner_by` 不在 schema 里,但后端 service 会给 list / detail 的每一行补上
 *   (app/plugin/module_pm_risk/pm_risk/service.py 的 _fill_owner_by)——
 *   负责人姓名直接读它,不用再查用户表
 */

/** 后端 ModulePmRiskOutSchema.owner_by —— 负责人信息 {id, name, username} */
export interface RiskOwnerBy {
  id?: number | null;
  name?: string | null;
  username?: string | null;
}

/** 后端 ModulePmRiskOutSchema */
export interface RiskOut {
  id?: number | null;
  /** 所属项目(module_pm_project.id) */
  project_id?: number | null;
  /** 风险标题 */
  title?: string | null;
  /** 风险描述 */
  description?: string | null;
  /** 分类(字典:module_pm_risk_category) */
  category_code?: string | null;
  /** 概率 1-5 */
  probability?: number | null;
  /** 影响 1-5 */
  impact?: number | null;
  /** 分数(必填,由调用方按 probability × impact 计算,后端不算) */
  score?: number | null;
  /** 状态(字典:module_pm_risk_status) */
  status_code?: string | null;
  /** 风险负责人 ID(sys_user.id) */
  owner_id?: number | null;
  /** 负责人信息 {id, name, username}(后端 service 随行补上) */
  owner_by?: RiskOwnerBy | null;
  /** 缓解措施 */
  mitigation_plan?: string | null;
  /** 应急计划 */
  contingency_plan?: string | null;
  /** 缓解措施截止日期 */
  due_date?: string | null;
  /** 升级触发时间(datetime) */
  trigger_date?: string | null;
  /** 创建方式(manual/ai_suggested) */
  created_via_code?: string | null;
  /** AI原始建议(dict) */
  ai_suggestion?: Record<string, unknown> | null;
  created_time?: string | null;
  updated_time?: string | null;
}

/** 后端 ModulePmRiskQueryParam */
export type RiskListParams = Partial<PageQuery> & {
  project_id?: number;
  title?: string;
  category_code?: string;
  probability?: number;
  impact?: number;
  score?: number;
  status_code?: string;
  owner_id?: number;
  mitigation_plan?: string;
  contingency_plan?: string;
  due_date?: string;
  trigger_date?: string;
  created_via_code?: string;
  /** AI 原始建议(查询参数是 JSON 字符串) */
  ai_suggestion?: string;
};

/** 后端 ModulePmRiskCreateSchema */
export type RiskCreateParams = {
  /** 所属项目(module_pm_project.id) */
  project_id: number;
  /** 风险标题 */
  title: string;
  /** 风险描述 */
  description?: string | null;
  /** 分类(字典:module_pm_risk_category) */
  category_code: string;
  /** 概率 1-5 */
  probability: number;
  /** 影响 1-5 */
  impact: number;
  /** 分数(必填,由调用方按 probability × impact 计算,后端不算) */
  score: number;
  /** 状态(字典:module_pm_risk_status) */
  status_code: string;
  /** 风险负责人 ID(sys_user.id) */
  owner_id: number;
  /** 缓解措施 */
  mitigation_plan?: string | null;
  /** 应急计划 */
  contingency_plan?: string | null;
  /** 缓解措施截止日期 */
  due_date?: string | null;
  /** 升级触发时间(datetime) */
  trigger_date?: string | null;
  /** 创建方式(manual/ai_suggested) */
  created_via_code: string;
  /** AI原始建议(dict) */
  ai_suggestion?: Record<string, unknown> | null;
};

/** 更新要传整对象:后端 UpdateSchema 继承 CreateSchema,必填集相同 */
export type RiskUpdateParams = RiskCreateParams;

/** 风险列表 */
export async function listRisks(
  params: RiskListParams,
): Promise<ApiResponse<PageResult<RiskOut>>> {
  return request<ApiResponse<PageResult<RiskOut>>>('/pm_risk/list', {
    method: 'GET',
    params,
  });
}

/** 风险详情 */
export async function getRiskDetail(id: number): Promise<ApiResponse<RiskOut>> {
  return request<ApiResponse<RiskOut>>(`/pm_risk/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建风险(score 由调用方算好传入,后端不负责计算) */
export async function createRisk(
  params: RiskCreateParams,
): Promise<ApiResponse<RiskOut>> {
  return request<ApiResponse<RiskOut>>('/pm_risk/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新风险(整对象 PUT,后端没有 PATCH) */
export async function updateRisk(
  id: number,
  params: RiskUpdateParams,
): Promise<ApiResponse<RiskOut>> {
  return request<ApiResponse<RiskOut>>(`/pm_risk/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除风险(后端请求体是裸数组,不是 { ids }) */
export async function deleteRisks(ids: number[]): Promise<ApiResponse<null>> {
  return request<ApiResponse<null>>('/pm_risk/delete', {
    method: 'DELETE',
    data: ids,
  });
}
