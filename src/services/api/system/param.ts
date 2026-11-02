import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/** 后端 ParamsOutSchema */
export interface ParamOut {
  id?: number | null;
  config_name?: string | null;
  config_key?: string | null;
  config_value?: string | null;
  config_type?: boolean | null;
  status?: number | null;
  description?: string | null;
  created_time?: string | null;
  updated_time?: string | null;
}

export type ParamListParams = Partial<PageQuery> & {
  config_name?: string;
  config_key?: string;
  config_type?: boolean;
  status?: number;
};

export type ParamCreateParams = {
  config_name: string;
  config_key: string;
  config_value?: string | null;
  config_type?: boolean;
  status?: number;
  description?: string | null;
};

export type ParamUpdateParams = ParamCreateParams;

/** 参数列表 */
export async function listParams(params: ParamListParams) {
  return request<ApiResponse<PageResult<ParamOut>>>('/system/param/list', {
    method: 'GET',
    params,
  });
}

/** 参数详情 */
export async function getParamDetail(id: number) {
  return request<ApiResponse<ParamOut>>(`/system/param/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建参数 */
export async function createParam(params: ParamCreateParams) {
  return request<ApiResponse<ParamOut>>('/system/param/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新参数 */
export async function updateParam(id: number, params: ParamUpdateParams) {
  return request<ApiResponse<ParamOut>>(`/system/param/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除参数(后端请求体是裸数组,不是 { ids }) */
export async function deleteParams(ids: number[]) {
  return request<ApiResponse<null>>('/system/param/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 批量启用/禁用参数(请求体是 { ids, status } 两个平级字段) */
export async function batchSetParamsStatus(ids: number[], status: number) {
  return request<ApiResponse<null>>('/system/param/status/batch', {
    method: 'PATCH',
    data: { ids, status },
  });
}
