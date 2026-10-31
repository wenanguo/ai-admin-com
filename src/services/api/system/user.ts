import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';
import type {
  UserCreateParams,
  UserOut,
  UserRegisterParams,
  UserUpdateParams,
} from './types';

export type UserListParams = Partial<PageQuery> & {
  username?: string;
  name?: string;
  mobile?: string;
  email?: string;
  dept_id?: number;
  status?: number;
};

/** 查询当前登录用户信息(含 menus 菜单树) */
export async function getCurrentUser() {
  return request<ApiResponse<UserOut>>('/system/user/current/info', {
    method: 'GET',
  });
}

/** 用户列表 */
export async function listUsers(params: UserListParams) {
  return request<ApiResponse<PageResult<UserOut>>>('/system/user/list', {
    method: 'GET',
    params,
  });
}

/** 用户详情 */
export async function getUserDetail(id: number) {
  return request<ApiResponse<UserOut>>(`/system/user/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建用户 */
export async function createUser(params: UserCreateParams) {
  return request<ApiResponse<UserOut>>('/system/user/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新用户 */
export async function updateUser(id: number, params: UserUpdateParams) {
  return request<ApiResponse<UserOut>>(`/system/user/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除用户(后端请求体是裸数组,不是 { ids }) */
export async function deleteUsers(ids: number[]) {
  return request<ApiResponse<null>>('/system/user/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 注册用户 */
export async function registerUser(params: UserRegisterParams) {
  return request<ApiResponse<UserOut>>('/system/user/register', {
    method: 'POST',
    data: params,
  });
}
