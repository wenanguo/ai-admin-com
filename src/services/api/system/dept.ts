import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/types';

/**
 * 后端 DeptOutSchema(树形接口额外带 children)。
 *
 * 注意:后端**没有** `/system/dept/list`,只有 `/system/dept/tree` ——
 * 部门是一棵树,不是分页列表。
 */
export interface DeptOut {
  id?: number | null;
  name?: string | null;
  code?: string | null;
  order?: number | null;
  leader?: string | null;
  phone?: string | null;
  email?: string | null;
  parent_id?: number | null;
  parent_name?: string | null;
  status?: number | null;
  description?: string | null;
  created_time?: string | null;
  /** 子部门(只有 /tree 会返回) */
  children?: DeptOut[] | null;
}

export type DeptCreateParams = {
  name: string;
  code: string;
  order?: number;
  leader?: string | null;
  phone?: string | null;
  email?: string | null;
  parent_id?: number | null;
  status?: number;
  description?: string | null;
};

export type DeptUpdateParams = DeptCreateParams;

/** 部门树(全量,不接受任何查询参数) */
export async function getDeptTree() {
  return request<ApiResponse<DeptOut[]>>('/system/dept/tree', {
    method: 'GET',
  });
}

/** 部门详情 */
export async function getDeptDetail(id: number) {
  return request<ApiResponse<DeptOut>>(`/system/dept/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建部门 */
export async function createDept(params: DeptCreateParams) {
  return request<ApiResponse<DeptOut>>('/system/dept/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新部门 */
export async function updateDept(id: number, params: DeptUpdateParams) {
  return request<ApiResponse<DeptOut>>(`/system/dept/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除部门(后端请求体是裸数组,不是 { ids }) */
export async function deleteDepts(ids: number[]) {
  return request<ApiResponse<null>>('/system/dept/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 批量启用/禁用部门(请求体是 { ids, status } 两个平级字段) */
export async function batchSetDeptsStatus(ids: number[], status: number) {
  return request<ApiResponse<null>>('/system/dept/status/batch', {
    method: 'PATCH',
    data: { ids, status },
  });
}
