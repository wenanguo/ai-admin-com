import type { ApiResponse } from './types';

/** 后端成功业务码:RET.OK = 0,RET.SUCCESS = 200 */
const SUCCESS_CODES = [0, 200];

/** 后端未授权业务码:RET.UNAUTHORIZED = 401,认证失败 = 10401 */
const UNAUTHORIZED_CODES = [401, 10401];

export function isApiResponse(value: unknown): value is ApiResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    'code' in value &&
    typeof (value as { code?: unknown }).code === 'number'
  );
}

export function isSuccess(value: unknown): boolean {
  if (!isApiResponse(value)) return false;
  return SUCCESS_CODES.includes(value.code);
}

export function isUnauthorized(value: unknown): boolean {
  if (!isApiResponse(value)) return false;
  return UNAUTHORIZED_CODES.includes(value.code);
}

export type BizError = Error & {
  name: 'BizError';
  info: { code: number; msg: string; data: unknown };
};

export function createBizError(res: ApiResponse): BizError {
  const error = new Error(res.msg || '请求失败') as BizError;
  error.name = 'BizError';
  error.info = { code: res.code, msg: res.msg || '请求失败', data: res.data };
  return error;
}
