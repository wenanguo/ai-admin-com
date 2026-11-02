import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { getIntl, getRequestInstance, history } from '@umijs/max';
import { createUnauthorizedError, refreshSession } from '@/auth/session';
import { clearAuth, getAccessToken } from '@/auth/token';
import { AUTH_FREE_API_PATHS } from '@/services/http';
import {
  createBizError,
  isApiResponse,
  isSuccess,
  isUnauthorized,
} from '@/services/response';
import { getMessage } from '@/utils/appMessage';

/**
 * 提示走 `App.useApp()` 的实例(见 `@/utils/appMessage`):
 * 静态 message API 不吃 ConfigProvider 的上下文,提示会与页面主题不一致。
 * 桥组件还没挂上时 `getMessage()` 会退回静态 API,不会崩。
 */

/** 重放标记:防止刷新后仍然 401 时无限递归 */
const RETRIED_FLAG = '__aiadminRetried';

function redirectToLogin() {
  const { pathname, search, hash } = window.location;

  // 已经在登录页就不再跳,避免叠加 redirect 参数
  if (pathname === '/user/login') return;

  history.replace(
    `/user/login?redirect=${encodeURIComponent(pathname + search + hash)}`,
  );
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

  // 刷新失败的两类结局在 doRefresh 里就分好了:
  //   服务端明确拒绝 → UnauthorizedError(errorHandler 会清登录态 + 跳登录页)
  //   纯网络故障     → 原样抛出,不登出
  const token = await refreshSession();

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
          getMessage().error('无权限访问');
          return;
        }
        getMessage().error(info?.msg || '请求失败');
        return;
      }

      // axios 错误:可能有业务信封(后端业务错误常返回 HTTP 500)
      if (error?.response) {
        const body = error.response.data;
        if (isApiResponse(body)) {
          getMessage().error(body.msg || '请求失败');
          return;
        }
        getMessage().error(`服务异常 (${error.response.status})`);
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        getMessage().error(
          getIntl().formatMessage({
            id: 'app.request.offline',
            defaultMessage: '网络不可用，请检查连接后重试。',
          }),
        );
        return;
      }

      getMessage().error('网络连接异常，请稍后重试');
    },
  },

  // 请求拦截器:注入 Bearer token
  requestInterceptors: [
    (config: RequestOptions) => {
      const url = String(config.url ?? '');

      if (!AUTH_FREE_API_PATHS.some((path) => url.includes(path))) {
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
  //
  // 注意:必须写成 tuple 形式 [onFulfilled, onRejected]。
  // umi 的注册逻辑是 `interceptor instanceof Array ? use(interceptor[0], interceptor[1]) : use(interceptor)`,
  // 写成两个平级函数的话,第二个函数会被注册成 **fulfilled** 钩子 ——
  // 成功响应也会被它抛掉,而真正的 HTTP 错误反而永远走不到它。
  responseInterceptors: [
    [
      async (response: any) => {
        const body = response?.data;

        if (isApiResponse(body) && !isSuccess(body)) {
          if (isUnauthorized(body)) {
            return handleUnauthorized(response.config);
          }
          throw createBizError(body);
        }

        // 成功提示:非 GET 且不是登录/登出/刷新这类机制性接口
        const method = String(response?.config?.method ?? 'GET').toUpperCase();
        const url = String(response?.config?.url ?? '');
        if (
          isApiResponse(body) &&
          body.msg &&
          method !== 'GET' &&
          !url.includes('login') &&
          !url.includes('logout') &&
          !url.includes('token/refresh')
        ) {
          getMessage().success(body.msg);
        }

        return response;
      },
      async (error: any) => {
        // 未授权判定与 HTTP 状态码无关:后端可能用 500 携带 401/10401 业务码
        if (
          error?.response?.status === 401 ||
          isUnauthorized(error?.response?.data)
        ) {
          return handleUnauthorized(error.config);
        }

        // 后端的业务异常走 HTTP 500 + 信封,axios 会 reject 成原始错误。
        // 这里统一转成 BizError,调用方只需要认一种错误形态(error.info.msg)。
        const body = error?.response?.data;
        if (isApiResponse(body) && !isSuccess(body)) {
          throw createBizError(body);
        }

        throw error;
      },
    ],
  ],
};
