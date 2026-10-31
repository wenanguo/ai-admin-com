import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';
import type { RoleOut } from './types';

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
