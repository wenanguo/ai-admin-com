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

/** 拉部门树时的可选项 */
export type GetDeptTreeOptions = {
  /**
   * 不走全局错误处理(失败由调用方自己处理)。
   *
   * 请求层的 errorHandler 会给**每一次**失败弹一次全局 toast ——
   * 没有部门查看权限的用户每开一次弹窗就会挨一次「无权限访问」,
   * 体验很差。打开这个开关后,失败以 reject 的形式交给调用方,
   * 调用方可以安静地降级(空下拉 + 行内提示)。
   */
  skipErrorHandler?: boolean;
};

/** 部门树(全量,不接受任何查询参数) */
export async function getDeptTree(options?: GetDeptTreeOptions) {
  return request<ApiResponse<DeptOut[]>>('/system/dept/tree', {
    method: 'GET',
    // 默认不传这个键,调用方不关心时请求参数保持原样
    ...(options?.skipErrorHandler ? { skipErrorHandler: true } : {}),
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
