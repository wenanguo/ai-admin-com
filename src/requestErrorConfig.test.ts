import { message } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  });
});

describe('401 silent refresh and replay', () => {
  it('refreshes the token and replays the original request on HTTP 401', async () => {
    const { getRequestInstance } = await import('@umijs/max');
    const instanceRequest = vi
      .fn()
      .mockResolvedValue({ data: { code: 0, success: true } });
    vi.mocked(getRequestInstance).mockReturnValue({
      request: instanceRequest,
    } as any);

    mockRequest.mockResolvedValue({
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
    });

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
  });
});
