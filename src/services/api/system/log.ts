import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/**
 * 日志管理的 service。
 *
 * 字段名以**后端 schema** 为准
 * (backend/app/api/v1/module_system/log/schema.py):
 * - LoginLogOutSchema: username / status / login_ip / login_location /
 *   request_browser / request_os / msg + BaseSchema 的审计字段
 * - OperationLogOutSchema: request_path / request_method / response_code /
 *   process_time / status / description + 审计字段
 *
 * 权限码是**两套**,命名不一致是后端现状:
 * 登录日志 module_system:login_log:*,操作日志 module_system:log:*。
 */

/** 后端 CommonSchema:创建人 / 更新人等嵌套对象 */
export interface LogUserRef {
  id: number;
  name: string;
}

/** 后端 LoginLogOutSchema */
export interface LoginLogOut {
  id?: number | null;
  uuid?: string | null;
  username?: string | null;
  /** 登录状态(1 成功 2 失败) */
  status?: number | null;
  /** 登录 IP */
  login_ip?: string | null;
  /** 登录地点 */
  login_location?: string | null;
  /** 浏览器 */
  request_browser?: string | null;
  /** 操作系统 */
  request_os?: string | null;
  /** 提示消息 */
  msg?: string | null;
  created_time?: string | null;
  updated_time?: string | null;
  created_by?: LogUserRef | null;
}

/** 后端 OperationLogOutSchema */
export interface OperationLogOut {
  id?: number | null;
  uuid?: string | null;
  /** 请求路径 */
  request_path?: string | null;
  /** 请求方式 */
  request_method?: string | null;
  /** 响应状态码 */
  response_code?: number | null;
  /** 处理耗时 */
  process_time?: string | null;
  /** 状态(0 成功 1 失败) */
  status?: number | null;
  /** 描述 / 备注 */
  description?: string | null;
  created_time?: string | null;
  updated_time?: string | null;
  created_by?: LogUserRef | null;
}

/**
 * 后端 OperationLogDetailOutSchema。
 *
 * 比列表多两个大文本字段(请求体 / 响应体)—— 列表接口不返回它们,
 * 所以详情抽屉必须走详情接口。
 */
export interface OperationLogDetailOut extends OperationLogOut {
  /** 请求体 */
  request_payload?: string | null;
  /** 响应体 */
  response_json?: string | null;
}

export type LoginLogListParams = Partial<PageQuery> & {
  username?: string;
  status?: number;
};

export type OperationLogListParams = Partial<PageQuery> & {
  /**
   * ⚠️ **刻意没有** `username`:后端 OperationLogQueryParam 有这个查询参数,
   * 但操作日志表**没有** username 列 —— 后端 __build_conditions 会对不存在的列取属性并抛错
   * (HTTP 500)。不声明它,调用方在编译期就传不进来。
   */
  status?: number;
  request_path?: string;
  request_method?: string;
};

/** 登录日志列表 */
export async function listLoginLogs(params: LoginLogListParams) {
  return request<ApiResponse<PageResult<LoginLogOut>>>(
    '/system/log/login/list',
    {
      method: 'GET',
      params,
    },
  );
}

/** 登录日志详情 */
export async function getLoginLogDetail(id: number) {
  return request<ApiResponse<LoginLogOut>>(`/system/log/login/detail/${id}`, {
    method: 'GET',
  });
}

/** 删除登录日志(后端请求体是裸数组,不是 { ids }) */
export async function deleteLoginLogs(ids: number[]) {
  return request<ApiResponse<null>>('/system/log/login/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 操作日志列表 */
export async function listOperationLogs(params: OperationLogListParams) {
  return request<ApiResponse<PageResult<OperationLogOut>>>(
    '/system/log/operation/list',
    {
      method: 'GET',
      params,
    },
  );
}

/** 操作日志详情(比列表多请求体 / 响应体两个大文本字段) */
export async function getOperationLogDetail(id: number) {
  return request<ApiResponse<OperationLogDetailOut>>(
    `/system/log/operation/detail/${id}`,
    { method: 'GET' },
  );
}

/**
 * 删除操作日志。
 *
 * ⚠️ 这个接口的请求体是 `{ ids }`(后端 BatchDelete),
 * **不是**其他模块那种裸数组 —— 后端 controller 里是
 * `async def delete(*, data: BatchDelete, ...)`。
 */
export async function deleteOperationLogs(ids: number[]) {
  return request<ApiResponse<null>>('/system/log/operation/delete', {
    method: 'DELETE',
    data: { ids },
  });
}
