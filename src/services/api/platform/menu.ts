import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/types';
import type { BackendMenu } from './types';

/** 查询菜单树(平台侧菜单管理,需要 module_platform:menu:query 权限) */
export async function getMenuTree(params?: {
  menu_client?: 'pc' | 'app';
  scope?: 'platform' | 'tenant';
  status?: number;
}) {
  return request<ApiResponse<BackendMenu[]>>('/platform/menu/tree', {
    method: 'GET',
    params,
  });
}
