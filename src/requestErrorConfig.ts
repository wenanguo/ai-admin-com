import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { getIntl, getRequestInstance, history } from '@umijs/max';
import { message } from 'antd';
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  isRememberMe,
  setTokens,
} from '@/auth/token';
import { refreshToken } from '@/services/api/system/auth';
import {
  createBizError,
  isApiResponse,
  isSuccess,
  isUnauthorized,
} from '@/services/response';
import type { ApiResponse } from '@/services/types';

/** 不需要注入 token 的接口 */
const AUTH_FREE_PATHS = [
  '/system/auth/login',
  '/system/auth/token/refresh',
  '/system/auth/captcha/get',
];

/** 重放标记:防止刷新后仍然 401 时无限递归 */
const RETRIED_FLAG = '__aiadminRetried';

/** 刷新中的 promise,让并发 401 共享同一次刷新 */
let refreshPromise: Promise<string> | null = null;

let redirecting = false;

function redirectToLogin() {
  if (redirecting) return;
  redirecting = true;

  const { pathname, search, hash } = window.location;
  history.replace(
    `/user/login?redirect=${encodeURIComponent(pathname + search + hash)}`,
  );
}

function createUnauthorizedError() {
  const error = new Error('登录状态已失效，请重新登录') as Error & {
    name: string;
  };
  error.name = 'UnauthorizedError';
  return error;
}

/** 用 refresh_token 换新的 access_token */
async function doRefresh(): Promise<string> {
  const res = await refreshToken(getRefreshToken());
  const pair = res?.data;

  if (!pair?.access_token) {
    throw new Error('刷新令牌失败');
  }

  setTokens(pair.access_token, pair.refresh_token, isRememberMe());
  return pair.access_token;
}

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * 未授权的统一处理:刷新 token → 重放原请求。
 * 刷新失败则清理登录态并跳转登录页。
 */
async function handleUnauthorized(config: any): Promise<any> {
  const url = String(config?.url ?? '');

  if (config?.[RETRIED_FLAG]) throw createUnauthorizedError();
  if (url.includes('/system/auth/token/refresh'))
    throw createUnauthorizedError();

  const token = await refreshAccessToken();

  return getRequestInstance().request({
    ...config,
    [RETRIED_FLAG]: true,
    headers: {
      ...(config?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

export const errorConfig: RequestConfig = {
  errorConfig: {
    /**
     * 错误接收及处理。
     *
     * 注意:业务码判定放在 responseInterceptors 的 fulfilled 分支,
     * 因为后端存在 success=true 但 code 是错误值(如 SuccessResponse(code=400))的响应,
     * umi 内置的 errorThrower 只在 success === false 时触发,会漏判。
     */
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error;

      // 刷新失败导致的未授权
      if (error?.name === 'UnauthorizedError') {
        clearAuth();
        redirectToLogin();
        return;
      }

      // 业务错误
      if (error?.name === 'BizError') {
        const info = error.info;
        if (info?.code === 403) {
          message.error('无权限访问');
          return;
        }
        message.error(info?.msg || '请求失败');
        return;
      }

      // axios 错误:可能有业务信封(后端业务错误常返回 HTTP 500)
      if (error?.response) {
        const body = error.response.data;
        if (isApiResponse(body)) {
          message.error(body.msg || '请求失败');
          return;
        }
        message.error(`服务异常 (${error.response.status})`);
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        message.error(
          getIntl().formatMessage({
            id: 'app.request.offline',
            defaultMessage: '网络不可用，请检查连接后重试。',
          }),
        );
        return;
      }

      message.error('网络连接异常，请稍后重试');
    },
  },

  // 请求拦截器:注入 Bearer token
  requestInterceptors: [
    (config: RequestOptions) => {
      const url = String(config.url ?? '');

      if (!AUTH_FREE_PATHS.some((path) => url.includes(path))) {
        const token = getAccessToken();
        if (token) {
          config.headers = {
            ...(config.headers as Record<string, unknown> | undefined),
            Authorization: `Bearer ${token}`,
          } as RequestOptions['headers'];
        }
      }

      return config;
    },
  ],

  // 响应拦截器:业务码校验 + 401 静默刷新重放
  responseInterceptors: [
    async (response: any) => {
      const body = response?.data;

      if (isApiResponse(body) && !isSuccess(body)) {
        if (isUnauthorized(body)) {
          return handleUnauthorized(response.config);
        }
        throw createBizError(body as ApiResponse);
      }

      return response;
    },
    async (error: any) => {
      if (error?.response?.status === 401) {
        return handleUnauthorized(error.config);
      }
      throw error;
    },
  ],
};
