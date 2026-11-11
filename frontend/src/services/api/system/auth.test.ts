import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCaptcha, login, logout, refreshToken } from './auth';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

/**
 * umi 的 request 是重载签名,TS 只能从最后一个重载推出元组 `[url]`,
 * 这里显式还原调用形状,才能断言 method / headers / data。
 */
type RequestCall = [
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    skipErrorHandler?: boolean;
  },
];

describe('system auth service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(request).mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: null,
      status_code: 200,
      success: true,
    });
  });

  it('fetches the captcha from /system/auth/captcha/get', async () => {
    await getCaptcha();

    expect(request).toHaveBeenCalledWith('/system/auth/captcha/get', {
      method: 'GET',
    });
  });

  it('posts the login form as urlencoded body', async () => {
    await login({
      username: 'admin',
      password: 'pw',
      captcha_key: 'k',
      captcha: '1234',
    });

    const [url, options] = vi.mocked(request).mock
      .calls[0] as unknown as RequestCall;
    expect(url).toBe('/system/auth/login');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(String(options?.data)).toContain('username=admin');
    expect(String(options?.data)).toContain('password=pw');
    expect(String(options?.data)).toContain('captcha_key=k');
    expect(String(options?.data)).toContain('captcha=1234');
    // form-urlencoded 按规范对非 ASCII 做百分号编码:PC端 → PC%E7%AB%AF
    expect(String(options?.data)).toContain('login_type=PC%E7%AB%AF');
  });

  it('skips the global error handler so the login page can show the error inline', async () => {
    // 请求层会弹一次 toast,登录页还会内联渲染一次 LoginMessage —— 两边重复
    await login({ username: 'admin', password: 'pw' });

    const [, options] = vi.mocked(request).mock
      .calls[0] as unknown as RequestCall;
    expect(options?.skipErrorHandler).toBe(true);
  });

  it('refreshes the token with the refresh token in the body', async () => {
    await refreshToken('refresh-1');

    expect(request).toHaveBeenCalledWith('/system/auth/token/refresh', {
      method: 'POST',
      data: { refresh_token: 'refresh-1' },
      // 刷新失败的后果由 session.doRefresh 判断(登出还是重试),
      // 请求层不再弹一次全局 toast,免得同一个错误弹两遍
      skipErrorHandler: true,
    });
  });

  it('logs out with the token in the body', async () => {
    await logout('access-1');

    expect(request).toHaveBeenCalledWith('/system/auth/logout', {
      method: 'POST',
      data: { token: 'access-1' },
    });
  });
});
