import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_KEYS,
  clearAuth,
  getAccessToken,
  getRefreshToken,
  isRememberMe,
  setTokens,
} from './token';

describe('AUTH_KEYS', () => {
  it('pins the storage key literals', () => {
    // 键名是全局契约:Task 7/8 的测试用 vi.mock('@/auth/token') 时硬编码了这些字面量
    expect(AUTH_KEYS.ACCESS_TOKEN).toBe('access_token');
    expect(AUTH_KEYS.REFRESH_TOKEN).toBe('refresh_token');
    expect(AUTH_KEYS.REMEMBER_ME).toBe('remember_me');
  });
});

describe('token storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('stores tokens in localStorage when rememberMe is true', () => {
    setTokens('access-1', 'refresh-1', true);

    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBe('access-1');
    expect(localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBe('refresh-1');
    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REMEMBER_ME)).toBe('true');
    expect(sessionStorage.getItem(AUTH_KEYS.REMEMBER_ME)).toBeNull();
    expect(isRememberMe()).toBe(true);
  });

  it('stores tokens in sessionStorage when rememberMe is false', () => {
    setTokens('access-2', 'refresh-2', false);

    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBe('access-2');
    expect(sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBe('refresh-2');
    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REMEMBER_ME)).toBe('false');
    expect(sessionStorage.getItem(AUTH_KEYS.REMEMBER_ME)).toBeNull();
    expect(isRememberMe()).toBe(false);
  });

  it('clears the other storage when switching rememberMe', () => {
    // 先在 sessionStorage 留下一份旧 token
    setTokens('old-access', 'old-refresh', false);

    // 切到 localStorage:sessionStorage 的旧 token(含 refresh)应被清掉
    setTokens('a', 'r', true);
    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBeNull();

    // 再切回 sessionStorage:localStorage 的旧 token(含 refresh)应被清掉
    setTokens('b', 'r2', false);
    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBe('b');
    expect(sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBe('r2');
  });

  it('reads the token from the storage matching rememberMe', () => {
    setTokens('a', 'r', true);
    expect(getAccessToken()).toBe('a');
    expect(getRefreshToken()).toBe('r');

    setTokens('b', 'r2', false);
    expect(getAccessToken()).toBe('b');
    expect(getRefreshToken()).toBe('r2');
  });

  it('returns empty string when no token is stored', () => {
    expect(getAccessToken()).toBe('');
    expect(getRefreshToken()).toBe('');
  });

  it('clearAuth removes tokens from both storages', () => {
    // 第一阶段:token 落在 localStorage
    setTokens('a', 'r', true);
    clearAuth();

    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REMEMBER_ME)).toBeNull();

    // 第二阶段:token 落在 sessionStorage
    setTokens('b', 'r2', false);
    clearAuth();

    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REMEMBER_ME)).toBeNull();
  });
});
