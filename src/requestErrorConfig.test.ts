import { message } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuth } from '@/auth/token';
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
      const onFulfilled = errorConfig.responseInterceptors?.[0] as (
        response: unknown,
      ) => Promise<unknown>;

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
      const onFulfilled = errorConfig.responseInterceptors?.[0] as (
        response: unknown,
      ) => Promise<unknown>;

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
      const onFulfilled = errorConfig.responseInterceptors?.[0] as (
        response: unknown,
      ) => Promise<unknown>;

      const response = { data: 'plain text', config: {} };

      await expect(onFulfilled(response)).resolves.toBe(response);
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
    const onFulfilled = errorConfig.responseInterceptors?.[0] as (
      response: unknown,
    ) => Promise<unknown>;

    const envelope = {
      code: 0,
      msg: '创建成功',
      data: { id: 1 },
      status_code: 200,
      success: true,
    };

    it('shows a success message for a non GET request', async () => {
      await onFulfilled({
        data: envelope,
        config: { method: 'POST', url: '/system/user/create' },
      });

      expect(message.success).toHaveBeenCalledWith('创建成功');
    });

    it('does not show a success message for a GET request', async () => {
      await onFulfilled({
        data: envelope,
        config: { method: 'GET', url: '/system/user/list' },
      });

      expect(message.success).not.toHaveBeenCalled();
    });

    it('does not show a success message for login or logout', async () => {
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

    const onRejected = errorConfig.responseInterceptors?.[1] as (
      error: unknown,
    ) => Promise<unknown>;

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

    const onFulfilled = errorConfig.responseInterceptors?.[0] as (
      response: unknown,
    ) => Promise<unknown>;

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

    const onRejected = errorConfig.responseInterceptors?.[1] as (
      error: unknown,
    ) => Promise<unknown>;

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

    const onRejected = errorConfig.responseInterceptors?.[1] as (
      error: unknown,
    ) => Promise<unknown>;

    const unauthorized = {
      response: { status: 401 },
      config: { url: '/system/user/list', headers: {} },
    };

    await Promise.all([onRejected(unauthorized), onRejected(unauthorized)]);

    expect(refreshCalls()).toHaveLength(1);
  });

  it('does not replay twice when the retried request is still unauthorized', async () => {
    const onRejected = errorConfig.responseInterceptors?.[1] as (
      error: unknown,
    ) => Promise<unknown>;

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

    const onRejected = errorConfig.responseInterceptors?.[1] as (
      error: unknown,
    ) => Promise<unknown>;
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
});
