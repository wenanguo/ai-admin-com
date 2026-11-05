import { message } from 'antd';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuth } from '@/auth/token';
import { AI_API_BASE_URL } from '@/services/api/ai/client';
import type { AppMessage } from '@/utils/appMessage';
import { setAppMessage } from '@/utils/appMessage';
import { errorConfig } from './requestErrorConfig';

const mockRequest = vi.fn();
const mockHistoryReplace = vi.fn();

vi.mock('antd', () => ({
  message: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  notification: {
    open: vi.fn(),
  },
}));

vi.mock('@umijs/max', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
  getIntl: vi.fn(() => ({
    formatMessage: vi.fn(
      ({ defaultMessage }: { defaultMessage: string }) => defaultMessage,
    ),
  })),
  history: {
    replace: (...args: unknown[]) => mockHistoryReplace(...args),
  },
  getRequestInstance: vi.fn(() => ({
    request: vi.fn().mockResolvedValue({ data: { code: 0, success: true } }),
  })),
}));

vi.mock('@/auth/token', () => ({
  AUTH_KEYS: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
    REMEMBER_ME: 'remember_me',
  },
  isRememberMe: vi.fn(() => true),
  getAccessToken: vi.fn(() => 'access-1'),
  getRefreshToken: vi.fn(() => 'refresh-1'),
  setTokens: vi.fn(),
  clearAuth: vi.fn(),
}));

type Interceptor = (arg: any) => Promise<any>;

/** 造一个 App.useApp() 的替身(桥组件发布出来的就是这种实例) */
function createAppMessageDouble(): AppMessage {
  return {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    open: vi.fn(),
    destroy: vi.fn(),
  };
}

/**
 * umi 注册响应拦截器的方式(见 src/.umi/plugin-request/request.ts):
 *
 *   interceptor instanceof Array
 *     ? requestInstance.interceptors.response.use(interceptor[0], interceptor[1])
 *     : requestInstance.interceptors.response.use(interceptor)
 *
 * 也就是说:只有 tuple 形式 `[onFulfilled, onRejected]` 的第二个元素
 * 才会被注册成 axios 的 **rejected** 钩子。写成两个平级函数的话,
 * 第二个函数会被当成 fulfilled 钩子 —— 成功响应也会走进它,
 * 而真正的 HTTP 错误反而永远走不到它。
 */
const getResponseInterceptors = (): [Interceptor, Interceptor] => {
  const first = errorConfig.responseInterceptors?.[0] as unknown;

  if (!Array.isArray(first)) {
    throw new Error(
      'responseInterceptors[0] 必须是 [onFulfilled, onRejected] tuple,否则 umi 会把 onRejected 注册成 fulfilled',
    );
  }

  return first as [Interceptor, Interceptor];
};

describe('requestErrorConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requestInterceptors', () => {
    const interceptor = errorConfig.requestInterceptors?.[0] as (config: {
      url?: string;
      headers?: Record<string, unknown>;
    }) => { headers?: Record<string, unknown> };

    it('attaches the bearer token', () => {
      const result = interceptor({ url: '/system/user/list' });

      expect(result.headers?.Authorization).toBe('Bearer access-1');
    });

    it('does not attach a token to the login request', () => {
      const result = interceptor({ url: '/system/auth/login' });

      expect(result.headers?.Authorization).toBeUndefined();
    });

    it('does not attach a token to the refresh request', () => {
      const result = interceptor({ url: '/system/auth/token/refresh' });

      expect(result.headers?.Authorization).toBeUndefined();
    });

    it('does not attach a token to the captcha request', () => {
      const result = interceptor({ url: '/system/auth/captcha/get' });

      expect(result.headers?.Authorization).toBeUndefined();
    });
  });

  describe('responseInterceptors', () => {
    it('throws a BizError for a failed business code even on HTTP 200', async () => {
      const onFulfilled = getResponseInterceptors()[0];

      await expect(
        onFulfilled({
          data: {
            code: 400,
            msg: '订单状态异常',
            data: null,
            status_code: 200,
            success: true,
          },
          config: {},
        }),
      ).rejects.toMatchObject({ name: 'BizError', message: '订单状态异常' });
    });

    it('passes a successful envelope through untouched', async () => {
      const onFulfilled = getResponseInterceptors()[0];

      const response = {
        data: {
          code: 0,
          msg: 'ok',
          data: { id: 1 },
          status_code: 200,
          success: true,
        },
        config: {},
      };

      await expect(onFulfilled(response)).resolves.toBe(response);
    });

    it('passes a non-envelope payload through untouched', async () => {
      const onFulfilled = getResponseInterceptors()[0];

      const response = { data: 'plain text', config: {} };

      await expect(onFulfilled(response)).resolves.toBe(response);
    });

    it('turns an HTTP 500 envelope into a BizError', async () => {
      // 后端的业务异常一律是 CustomException ⇒ HTTP 500 + 信封,
      // axios 会 reject 成原始错误,调用方拿不到后端的中文 msg
      const onRejected = getResponseInterceptors()[1];

      await expect(
        onRejected({
          response: {
            status: 500,
            data: {
              code: -1,
              msg: '验证码不能为空',
              data: null,
              status_code: 500,
              success: false,
            },
          },
          config: {},
        }),
      ).rejects.toMatchObject({
        name: 'BizError',
        message: '验证码不能为空',
        info: { code: -1, msg: '验证码不能为空' },
      });
    });

    it('rethrows an HTTP error whose body is not an envelope', async () => {
      const onRejected = getResponseInterceptors()[1];
      const error: any = new Error('Request failed with status code 502');
      error.response = { status: 502, data: '<html>bad gateway</html>' };

      await expect(onRejected(error)).rejects.toBe(error);
    });
  });

  /**
   * 用真实的 axios 实例跑一遍 umi 的注册方式,
   * 保证「注册方式」本身不会把成功响应变成失败。
   */
  describe('umi runtime registration', () => {
    const createInstance = () => {
      const instance = axios.create();

      // 与 src/.umi/plugin-request/request.ts 里的注册逻辑完全一致
      errorConfig.responseInterceptors?.forEach((interceptor) => {
        Array.isArray(interceptor)
          ? instance.interceptors.response.use(interceptor[0], interceptor[1])
          : instance.interceptors.response.use(interceptor);
      });

      return instance;
    };

    it('resolves a successful envelope', async () => {
      const instance = createInstance();

      instance.defaults.adapter = async (config) => ({
        data: {
          code: 0,
          msg: 'ok',
          data: { id: 1 },
          status_code: 200,
          success: true,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });

      const response = await instance.get('/system/user/list');

      expect(response.status).toBe(200);
      expect(response.data.data).toEqual({ id: 1 });
    });

    it('rejects an HTTP 500 envelope with a BizError', async () => {
      const instance = createInstance();

      instance.defaults.adapter = async (config) => {
        const error: any = new Error('Request failed with status code 500');
        error.config = config;
        error.response = {
          status: 500,
          data: {
            code: -1,
            msg: '账号或密码错误',
            data: null,
            status_code: 500,
            success: false,
          },
        };
        throw error;
      };

      await expect(instance.post('/system/auth/login')).rejects.toMatchObject({
        name: 'BizError',
        message: '账号或密码错误',
        info: { code: -1, msg: '账号或密码错误' },
      });
    });

    it('still rejects the caller when skipErrorHandler is set', async () => {
      const instance = createInstance();

      instance.defaults.adapter = async (config) => {
        const error: any = new Error('Request failed with status code 500');
        error.config = config;
        error.response = {
          status: 500,
          data: {
            code: -1,
            msg: '账号或密码错误',
            data: null,
            status_code: 500,
            success: false,
          },
        };
        throw error;
      };

      const errorHandler = errorConfig.errorConfig?.errorHandler as (
        error: unknown,
        opts?: unknown,
      ) => void;

      // umi 的 request 包装:catch 里先调 errorHandler,
      // handler 抛错(errorHandler 见到 skipErrorHandler 会重抛)就把它 reject 给调用方
      const call = async () => {
        try {
          await instance.post('/system/auth/login');
        } catch (error) {
          errorHandler(error, { skipErrorHandler: true });
          throw error;
        }
      };

      await expect(call()).rejects.toMatchObject({
        name: 'BizError',
        info: { code: -1, msg: '账号或密码错误' },
      });
      // 页面内联提示是唯一出口,不能再弹一次全局 toast
      expect(message.error).not.toHaveBeenCalled();
    });
  });

  describe('errorHandler', () => {
    const errorHandler = errorConfig.errorConfig?.errorHandler as (
      error: unknown,
      opts?: unknown,
    ) => void;

    it('rethrows when skipErrorHandler is set', () => {
      expect(() =>
        errorHandler(new Error('boom'), { skipErrorHandler: true }),
      ).toThrow('boom');
    });

    it('shows the backend message for a BizError', () => {
      const error: any = new Error('验证码不能为空');
      error.name = 'BizError';
      error.info = { code: -1, msg: '验证码不能为空', data: null };

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('验证码不能为空');
    });

    it('shows a permission specific message for code 403', () => {
      const error: any = new Error('访问受限');
      error.name = 'BizError';
      error.info = { code: 403, msg: '访问受限', data: null };

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('无权限访问');
    });

    it('reads the envelope of an HTTP 500 business error', () => {
      const error: any = new Error('Request failed');
      error.response = {
        status: 500,
        data: {
          code: -1,
          msg: '验证码不能为空',
          data: null,
          status_code: 500,
          success: false,
        },
      };

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('验证码不能为空');
    });

    it('falls back to a status message when the error body has no envelope', () => {
      const error: any = new Error('Request failed');
      error.response = { status: 502, data: {} };

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('服务异常 (502)');
    });

    it('reports offline errors', () => {
      const error: any = new Error('Network error');
      error.request = {};

      const originalOnLine = navigator.onLine;
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });

      try {
        errorHandler(error, {});
        expect(message.error).toHaveBeenCalledWith(
          '网络不可用，请检查连接后重试。',
        );
      } finally {
        Object.defineProperty(navigator, 'onLine', {
          writable: true,
          value: originalOnLine,
        });
      }
    });

    it('reports generic network errors', () => {
      const error: any = new Error('Network error');
      error.request = {};

      errorHandler(error, {});

      expect(message.error).toHaveBeenCalledWith('网络连接异常，请稍后重试');
    });

    it('clears the session and redirects to login for an unauthorized error', () => {
      const error: any = new Error('登录状态已失效，请重新登录');
      error.name = 'UnauthorizedError';

      errorHandler(error, {});

      expect(clearAuth).toHaveBeenCalled();
      const { pathname, search, hash } = window.location;
      expect(mockHistoryReplace).toHaveBeenCalledWith(
        `/user/login?redirect=${encodeURIComponent(pathname + search + hash)}`,
      );

      // 闩锁已移除:再次强制登出仍要跳转,不能被一次性吞掉
      errorHandler(error, {});

      expect(mockHistoryReplace).toHaveBeenCalledTimes(2);
    });
  });

  describe('success toast', () => {
    const envelope = {
      code: 0,
      msg: '创建成功',
      data: { id: 1 },
      status_code: 200,
      success: true,
    };

    it('shows a success message for a non GET request', async () => {
      const onFulfilled = getResponseInterceptors()[0];

      await onFulfilled({
        data: envelope,
        config: { method: 'POST', url: '/system/user/create' },
      });

      expect(message.success).toHaveBeenCalledWith('创建成功');
    });

    it('does not show a success message for a GET request', async () => {
      const onFulfilled = getResponseInterceptors()[0];

      await onFulfilled({
        data: envelope,
        config: { method: 'GET', url: '/system/user/list' },
      });

      expect(message.success).not.toHaveBeenCalled();
    });

    it('does not show a success message for AI service requests', async () => {
      // AI 服务的每一条命令都会带一个 msg ⇒ 不豁免的话每发一句话就弹一次提示
      const onFulfilled = getResponseInterceptors()[0];

      await onFulfilled({
        data: envelope,
        config: {
          method: 'POST',
          url: `${AI_API_BASE_URL}/api/agent/c1/command`,
        },
      });

      expect(message.success).not.toHaveBeenCalled();
    });

    it('does not show a success message for login or logout', async () => {
      const onFulfilled = getResponseInterceptors()[0];

      await onFulfilled({
        data: envelope,
        config: { method: 'POST', url: '/system/auth/login' },
      });
      await onFulfilled({
        data: envelope,
        config: { method: 'POST', url: '/system/auth/logout' },
      });
      await onFulfilled({
        data: envelope,
        config: { method: 'POST', url: '/system/auth/token/refresh' },
      });

      expect(message.success).not.toHaveBeenCalled();
    });
  });
});

describe('401 silent refresh and replay', () => {
  const tokenEnvelope = {
    code: 0,
    msg: 'ok',
    data: {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 43200,
    },
    status_code: 200,
    success: true,
  };

  const refreshCalls = () =>
    mockRequest.mock.calls.filter(
      (call: unknown[]) => call[0] === '/system/auth/token/refresh',
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the token and replays the original request on HTTP 401', async () => {
    const { getRequestInstance } = await import('@umijs/max');
    const instanceRequest = vi
      .fn()
      .mockResolvedValue({ data: { code: 0, success: true } });
    vi.mocked(getRequestInstance).mockReturnValue({
      request: instanceRequest,
    } as any);

    mockRequest.mockResolvedValue(tokenEnvelope);

    const onRejected = getResponseInterceptors()[1];

    await onRejected({
      response: { status: 401 },
      config: { url: '/system/user/list', headers: {} },
    });

    expect(mockRequest).toHaveBeenCalledWith(
      '/system/auth/token/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    // 重放时的新 token 必须落在 headers 里 —— axios 只读 config.headers.Authorization
    expect(instanceRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/system/user/list',
        headers: expect.objectContaining({
          Authorization: 'Bearer new-access',
        }),
      }),
    );
  });

  it('refreshes and replays when the envelope carries an unauthorized business code', async () => {
    const { getRequestInstance } = await import('@umijs/max');
    const instanceRequest = vi
      .fn()
      .mockResolvedValue({ data: { code: 0, success: true } });
    vi.mocked(getRequestInstance).mockReturnValue({
      request: instanceRequest,
    } as any);

    mockRequest.mockResolvedValue(tokenEnvelope);

    const onFulfilled = getResponseInterceptors()[0];

    await onFulfilled({
      data: {
        code: 401,
        msg: '未授权',
        data: null,
        status_code: 401,
        success: false,
      },
      config: { url: '/system/user/list', headers: {} },
    });

    expect(refreshCalls()).toHaveLength(1);
    expect(instanceRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/system/user/list',
        headers: expect.objectContaining({
          Authorization: 'Bearer new-access',
        }),
      }),
    );
  });

  it('treats a non 401 status carrying an unauthorized code as unauthorized', async () => {
    const { getRequestInstance } = await import('@umijs/max');
    const instanceRequest = vi
      .fn()
      .mockResolvedValue({ data: { code: 0, success: true } });
    vi.mocked(getRequestInstance).mockReturnValue({
      request: instanceRequest,
    } as any);

    mockRequest.mockResolvedValue(tokenEnvelope);

    const onRejected = getResponseInterceptors()[1];

    // 后端可能用 HTTP 500 携带 10401 业务码,不能只看状态码
    await onRejected({
      response: {
        status: 500,
        data: {
          code: 10401,
          msg: '无效认证，请重新登录',
          data: null,
          status_code: 500,
          success: false,
        },
      },
      config: { url: '/system/user/list', headers: {} },
    });

    expect(refreshCalls()).toHaveLength(1);
    expect(instanceRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/system/user/list',
        headers: expect.objectContaining({
          Authorization: 'Bearer new-access',
        }),
      }),
    );
  });

  it('sends a single refresh request for concurrent unauthorized responses', async () => {
    const { getRequestInstance } = await import('@umijs/max');
    const instanceRequest = vi
      .fn()
      .mockResolvedValue({ data: { code: 0, success: true } });
    vi.mocked(getRequestInstance).mockReturnValue({
      request: instanceRequest,
    } as any);

    mockRequest.mockResolvedValue(tokenEnvelope);

    const onRejected = getResponseInterceptors()[1];

    const unauthorized = {
      response: { status: 401 },
      config: { url: '/system/user/list', headers: {} },
    };

    await Promise.all([onRejected(unauthorized), onRejected(unauthorized)]);

    expect(refreshCalls()).toHaveLength(1);
  });

  it('does not replay twice when the retried request is still unauthorized', async () => {
    const onRejected = getResponseInterceptors()[1];

    await expect(
      onRejected({
        response: { status: 401 },
        config: { url: '/system/user/list', __aiadminRetried: true },
      }),
    ).rejects.toMatchObject({ name: 'UnauthorizedError' });

    // 已重放过就不该再发刷新请求,否则会无限递归
    expect(refreshCalls()).toHaveLength(0);
  });

  it('clears the session and redirects to login when the refresh fails', async () => {
    const refreshError: any = new Error('Request failed');
    refreshError.response = {
      status: 500,
      data: {
        code: -1,
        msg: '会话已过期，请重新登录',
        data: null,
        status_code: 500,
        success: false,
      },
    };
    mockRequest.mockRejectedValue(refreshError);

    const onRejected = getResponseInterceptors()[1];
    const errorHandler = errorConfig.errorConfig?.errorHandler as (
      error: unknown,
      opts?: unknown,
    ) => void;

    const error = await onRejected({
      response: { status: 401 },
      config: { url: '/system/user/list', headers: {} },
    }).catch((e: unknown) => e);

    // 刷新接口有响应 = 服务端明确拒绝 = 登录态失效
    expect(error).toMatchObject({ name: 'UnauthorizedError' });

    errorHandler(error, {});

    expect(clearAuth).toHaveBeenCalled();
    const { pathname, search, hash } = window.location;
    expect(mockHistoryReplace).toHaveBeenCalledWith(
      `/user/login?redirect=${encodeURIComponent(pathname + search + hash)}`,
    );
  });

  it('treats a refresh failure that arrives as a BizError as an expired session', async () => {
    // 真实链路:刷新接口返回 HTTP 500 + 业务信封 → 响应拦截器转成 BizError。
    // BizError 上只有 info、没有 response —— 靠 error.response 判断的写法
    // 在这条真实路径上永远是 undefined,于是永远登不了出。
    const bizError: any = new Error('会话已过期，请重新登录');
    bizError.name = 'BizError';
    bizError.info = { code: -1, msg: '会话已过期，请重新登录', data: null };
    mockRequest.mockRejectedValue(bizError);

    const onRejected = getResponseInterceptors()[1];
    const errorHandler = errorConfig.errorConfig?.errorHandler as (
      error: unknown,
      opts?: unknown,
    ) => void;

    const error = await onRejected({
      response: { status: 401 },
      config: { url: '/system/user/list', headers: {} },
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ name: 'UnauthorizedError' });

    errorHandler(error, {});

    expect(clearAuth).toHaveBeenCalled();
    const { pathname, search, hash } = window.location;
    expect(mockHistoryReplace).toHaveBeenCalledWith(
      `/user/login?redirect=${encodeURIComponent(pathname + search + hash)}`,
    );
  });

  it('does not clear the session when the refresh fails without a response', async () => {
    // 纯网络故障(既没有 response 也没有 info):不能当成登录态失效
    const netError: any = new Error('Network Error');
    mockRequest.mockRejectedValue(netError);

    const onRejected = getResponseInterceptors()[1];
    const errorHandler = errorConfig.errorConfig?.errorHandler as (
      error: unknown,
      opts?: unknown,
    ) => void;

    const error = await onRejected({
      response: { status: 401 },
      config: { url: '/system/user/list', headers: {} },
    }).catch((e: unknown) => e);

    expect(error).not.toMatchObject({ name: 'UnauthorizedError' });

    errorHandler(error, {});

    expect(clearAuth).not.toHaveBeenCalled();
    expect(mockHistoryReplace).not.toHaveBeenCalled();
  });
});

describe('message instance', () => {
  const errorHandler = errorConfig.errorConfig?.errorHandler as (
    error: unknown,
    opts?: unknown,
  ) => void;

  const bizError = () => {
    const error: any = new Error('验证码不能为空');
    error.name = 'BizError';
    error.info = { code: -1, msg: '验证码不能为空', data: null };
    return error;
  };

  afterEach(() => {
    setAppMessage(null);
  });

  it('prefers the App.useApp() instance over the static message API', () => {
    // 静态 message 不吃 ConfigProvider 的上下文,提示与页面主题不一致;
    // 桥组件发布出实例之后,请求层必须走实例。
    const appMessage = createAppMessageDouble();
    setAppMessage(appMessage);

    errorHandler(bizError(), {});

    expect(appMessage.error).toHaveBeenCalledWith('验证码不能为空');
    expect(message.error).not.toHaveBeenCalled();
  });

  it('falls back to the static message API when no instance is published', () => {
    // 桥组件还没挂上(首屏渲染之前)也不能崩:退回静态 API 照样弹提示。
    setAppMessage(null);

    errorHandler(bizError(), {});

    expect(message.error).toHaveBeenCalledWith('验证码不能为空');
  });
});
