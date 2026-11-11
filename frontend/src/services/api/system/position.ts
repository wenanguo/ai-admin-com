import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/** 后端 PositionOutSchema */
export interface PositionOut {
  id?: number | null;
  name?: string | null;
  code?: string | null;
  order?: number | null;
  status?: number | null;
  description?: string | null;
  created_time?: string | null;
  updated_time?: string | null;
}

export type PositionListParams = Partial<PageQuery> & {
  name?: string;
  status?: number;
};

export type PositionCreateParams = {
  name: string;
  code: string;
  order?: number;
  status?: number;
  description?: string | null;
};

export type PositionUpdateParams = PositionCreateParams;

/** 岗位列表 */
export async function listPositions(params: PositionListParams) {
  return request<ApiResponse<PageResult<PositionOut>>>(
    '/system/position/list',
    {
      method: 'GET',
      params,
    },
  );
}

/** 岗位详情 */
export async function getPositionDetail(id: number) {
  return request<ApiResponse<PositionOut>>(`/system/position/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建岗位 */
export async function createPosition(params: PositionCreateParams) {
  return request<ApiResponse<PositionOut>>('/system/position/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新岗位 */
export async function updatePosition(id: number, params: PositionUpdateParams) {
  return request<ApiResponse<PositionOut>>(`/system/position/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除岗位(后端请求体是裸数组,不是 { ids }) */
export async function deletePositions(ids: number[]) {
  return request<ApiResponse<null>>('/system/position/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 批量启用/禁用岗位(请求体是 { ids, status } 两个平级字段) */
export async function batchSetPositionsStatus(ids: number[], status: number) {
  return request<ApiResponse<null>>('/system/position/status/batch', {
    method: 'PATCH',
    data: { ids, status },
  });
}
