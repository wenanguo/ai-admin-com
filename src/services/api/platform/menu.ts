import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/types';
import type { BackendMenu } from './types';

/**
 * 查询菜单列表(平台侧菜单管理,需要 module_platform:menu:query 权限)。
 *
 * 注意:后端这个接口的 response_model 是 list[MenuOutSchema],**没有 children 字段**,
 * 拿到的是扁平列表,不是树。要树形结构请用 /system/user/current/info 返回的 menus。
 */
export async function getMenuTree(params?: {
  menu_client?: 'pc' | 'app';
  scope?: 'tenant';
  status?: number;
}) {
  return request<ApiResponse<BackendMenu[]>>('/platform/menu/tree', {
    method: 'GET',
    params,
  });
}
