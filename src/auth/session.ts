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
  UserOut,
} from '@/services/api/system/types';
import { getCurrentUser } from '@/services/api/system/user';
import type { ApiResponse } from '@/services/types';

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
  return res.data as UserOut;
}

/** 退出登录:先通知后端,再清本地登录态(后端失败也要清) */
export async function logoutAndClear(): Promise<void> {
  try {
    await logoutApi(getAccessToken());
  } catch {
    // 后端不可达时也要清掉本地登录态
  } finally {
    clearAuth();
  }
}

/** 刷新中的 promise,让并发调用共享同一次刷新 */
let refreshPromise: Promise<string> | null = null;

/** 用 refresh_token 换新的 access_token */
async function doRefresh(): Promise<string> {
  const res = await refreshTokenApi(getRefreshToken());
  const pair = res?.data;

  if (!pair?.access_token) {
    throw new Error('刷新令牌失败');
  }

  setTokens(pair.access_token, pair.refresh_token, isRememberMe());
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
