import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCurrentUser,
  loginWithSession,
  logoutAndClear,
  refreshSession,
} from './session';

const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockRefreshToken = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockSetTokens = vi.fn();
const mockClearAuth = vi.fn();

vi.mock('@/services/api/system/auth', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
  refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
}));

vi.mock('@/services/api/system/user', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
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
  setTokens: (...args: unknown[]) => mockSetTokens(...args),
  clearAuth: (...args: unknown[]) => mockClearAuth(...args),
}));

describe('session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loginWithSession', () => {
    it('stores the tokens with the rememberMe flag', async () => {
      mockLogin.mockResolvedValue({
        code: 0,
        msg: 'ok',
        data: {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 43200,
          tenants: [],
          user_info: {},
        },
        status_code: 200,
        success: true,
      });

      await loginWithSession({ username: 'admin', password: 'pw' }, true);

      expect(mockSetTokens).toHaveBeenCalledWith('access-1', 'refresh-1', true);
    });

    it('throws when the backend returns no access token', async () => {
      mockLogin.mockResolvedValue({
        code: 0,
        msg: 'ok',
        data: null,
        status_code: 200,
        success: true,
      });

      await expect(
        loginWithSession({ username: 'admin', password: 'pw' }, false),
      ).rejects.toThrow('登录响应缺少 access_token');
    });
  });

  describe('fetchCurrentUser', () => {
    it('returns the current user payload', async () => {
      mockGetCurrentUser.mockResolvedValue({
        code: 0,
        msg: 'ok',
        data: { id: 1, username: 'admin', menus: [] },
        status_code: 200,
        success: true,
      });

      const user = await fetchCurrentUser();

      expect(user).toEqual({ id: 1, username: 'admin', menus: [] });
    });
  });

  describe('logoutAndClear', () => {
    it('calls the backend and clears local auth', async () => {
      mockLogout.mockResolvedValue({
        code: 0,
        msg: 'ok',
        data: null,
        status_code: 200,
        success: true,
      });

      await logoutAndClear();

      expect(mockLogout).toHaveBeenCalledWith('access-1');
      expect(mockClearAuth).toHaveBeenCalled();
    });

    it('clears local auth even when the backend call fails', async () => {
      mockLogout.mockRejectedValue(new Error('network down'));

      await logoutAndClear();

      expect(mockClearAuth).toHaveBeenCalled();
    });
  });

  describe('refreshSession', () => {
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

    it('stores the new tokens and returns the access token', async () => {
      mockRefreshToken.mockResolvedValue(tokenEnvelope);

      const token = await refreshSession();

      expect(token).toBe('new-access');
      expect(mockRefreshToken).toHaveBeenCalledWith('refresh-1');
      expect(mockSetTokens).toHaveBeenCalledWith(
        'new-access',
        'new-refresh',
        true,
      );
    });

    it('sends a single refresh request for concurrent calls', async () => {
      mockRefreshToken.mockResolvedValue(tokenEnvelope);

      const [first, second] = await Promise.all([
        refreshSession(),
        refreshSession(),
      ]);

      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
      expect(first).toBe('new-access');
      expect(second).toBe('new-access');
    });

    it('throws when the backend returns no access token', async () => {
      mockRefreshToken.mockResolvedValue({
        code: 0,
        msg: 'ok',
        data: null,
        status_code: 200,
        success: true,
      });

      await expect(refreshSession()).rejects.toThrow('刷新令牌失败');
    });
  });
});
