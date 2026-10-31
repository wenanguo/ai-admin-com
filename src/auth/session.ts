import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  isRememberMe,
  setTokens,
} from '@/auth/token';
import {
  login as loginApi,
  logout as logoutApi,
  refreshToken as refreshTokenApi,
} from '@/services/api/system/auth';
import type {
  LoginForm,
  LoginResult,
  TokenPair,
  UserOut,
} from '@/services/api/system/types';
import { getCurrentUser } from '@/services/api/system/user';
import type { ApiResponse } from '@/services/types';

/** 未授权错误:登录态已失效,需要清理并跳登录 */
export function createUnauthorizedError(): Error {
  const error = new Error('登录状态已失效，请重新登录');
  error.name = 'UnauthorizedError';
  return error;
}

/**
 * 登录:调后端拿 token 并落盘。
 * rememberMe 决定 token 存 localStorage 还是 sessionStorage。
 */
export async function loginWithSession(
  form: LoginForm,
  rememberMe: boolean,
): Promise<ApiResponse<LoginResult>> {
  const res = await loginApi(form);
  const result = res?.data;

  if (!result?.access_token) {
    throw new Error('登录响应缺少 access_token');
  }

  setTokens(result.access_token, result.refresh_token, rememberMe);
  return res;
}

/** 取当前登录用户(含 menus 菜单树) */
export async function fetchCurrentUser(): Promise<UserOut> {
  const res = await getCurrentUser();

  if (!res?.data) {
    throw new Error('获取当前用户信息失败');
  }

  return res.data;
}

/** 退出登录:先通知后端,再清本地登录态(后端失败也要清) */
export async function logoutAndClear(): Promise<void> {
  const token = getAccessToken();

  try {
    if (token) {
      await logoutApi(token);
    }
  } catch {
    // 后端不可达时也要清掉本地登录态
    console.warn('退出登录接口调用失败,仅清理本地登录态');
  } finally {
    clearAuth();
  }
}

/** 刷新中的 promise,让并发调用共享同一次刷新 */
let refreshPromise: Promise<string> | null = null;

/** 用 refresh_token 换新的 access_token */
async function doRefresh(): Promise<string> {
  let res: ApiResponse<TokenPair>;

  try {
    res = await refreshTokenApi(getRefreshToken());
  } catch (error: any) {
    // 刷新接口自己回了 401 —— 已经是未授权错误,原样往上抛
    if (error?.name === 'UnauthorizedError') throw error;

    // 服务端给了响应(哪怕是 HTTP 500 + 业务信封)= 明确拒绝 = 登录态失效。
    // 注意:后端的业务异常是 HTTP 500,会被响应拦截器转成 BizError,
    // 而 BizError 上没有 response,所以判断依据是「有没有 response 或 info」。
    if (error?.response !== undefined || error?.info !== undefined) {
      throw createUnauthorizedError();
    }

    // 纯网络故障(压根没拿到响应):不登出,把错误抛给调用方
    throw error;
  }

  const pair = res?.data;

  if (!pair?.access_token) {
    // 刷新接口有响应但没给新 token = 服务端明确拒绝 = 登录态失效
    throw createUnauthorizedError();
  }

  setTokens(pair.access_token, pair.refresh_token ?? '', isRememberMe());
  return pair.access_token;
}

/** 刷新 token,成功返回新的 access_token(并发调用只发一次刷新请求) */
export function refreshSession(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
