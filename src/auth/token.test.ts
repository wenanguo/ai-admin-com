import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_KEYS,
  clearAuth,
  getAccessToken,
  getRefreshToken,
  isRememberMe,
  setTokens,
} from './token';

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
    expect(isRememberMe()).toBe(true);
  });

  it('stores tokens in sessionStorage when rememberMe is false', () => {
    setTokens('access-2', 'refresh-2', false);

    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBe('access-2');
    expect(sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBe('refresh-2');
    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(isRememberMe()).toBe(false);
  });

  it('clears the other storage when switching rememberMe', () => {
    setTokens('a', 'r', true);
    setTokens('b', 'r2', false);

    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBe('b');
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
    setTokens('a', 'r', true);
    clearAuth();

    expect(localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_KEYS.REMEMBER_ME)).toBeNull();
    expect(sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN)).toBeNull();
  });
});
