import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';
import type {
  RoleCreateParams,
  RoleOut,
  RolePermissionParams,
  RoleUpdateParams,
} from './types';

export type RoleListParams = Partial<PageQuery> & {
  name?: string;
  code?: string;
  status?: number;
};

/** 角色列表(下拉框用) */
export async function listRoles(params: RoleListParams) {
  return request<ApiResponse<PageResult<RoleOut>>>('/system/role/list', {
    method: 'GET',
    params,
  });
}

/** 角色详情 */
export async function getRoleDetail(id: number) {
  return request<ApiResponse<RoleOut>>(`/system/role/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建角色 */
export async function createRole(params: RoleCreateParams) {
  return request<ApiResponse<RoleOut>>('/system/role/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新角色 */
export async function updateRole(id: number, params: RoleUpdateParams) {
  return request<ApiResponse<RoleOut>>(`/system/role/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除角色(后端请求体是裸数组,不是 { ids }) */
export async function deleteRoles(ids: number[]) {
  return request<ApiResponse<null>>('/system/role/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 批量启用/禁用角色(请求体是 { ids, status } 两个平级字段) */
export async function batchSetRolesStatus(ids: number[], status: number) {
  return request<ApiResponse<null>>('/system/role/status/batch', {
    method: 'PATCH',
    data: { ids, status },
  });
}

/**
 * 角色授权。
 *
 * 入参是 data_scope / role_ids / menu_ids / dept_ids 四个**平级**字段
 * (后端 RolePermissionSettingSchema),不是嵌套对象。
 */
export async function setRolePermission(params: RolePermissionParams) {
  return request<ApiResponse<null>>('/system/role/permission', {
    method: 'PUT',
    data: params,
  });
}
