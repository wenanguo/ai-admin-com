export const AUTH_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  REMEMBER_ME: 'remember_me',
} as const;

/**
 * 是否勾选「记住我」。
 * 勾选 → token 存 localStorage(关掉浏览器仍在);未勾选 → 存 sessionStorage。
 */
export function isRememberMe(): boolean {
  return localStorage.getItem(AUTH_KEYS.REMEMBER_ME) === 'true';
}

export function getAccessToken(): string {
  return isRememberMe()
    ? localStorage.getItem(AUTH_KEYS.ACCESS_TOKEN) || ''
    : sessionStorage.getItem(AUTH_KEYS.ACCESS_TOKEN) || '';
}

export function getRefreshToken(): string {
  return isRememberMe()
    ? localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN) || ''
    : sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN) || '';
}

export function setTokens(
  accessToken: string,
  refreshToken: string,
  rememberMe: boolean,
): void {
  localStorage.setItem(AUTH_KEYS.REMEMBER_ME, String(rememberMe));

  if (rememberMe) {
    localStorage.setItem(AUTH_KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem(AUTH_KEYS.REFRESH_TOKEN, refreshToken);
    sessionStorage.removeItem(AUTH_KEYS.ACCESS_TOKEN);
    sessionStorage.removeItem(AUTH_KEYS.REFRESH_TOKEN);
    return;
  }

  sessionStorage.setItem(AUTH_KEYS.ACCESS_TOKEN, accessToken);
  sessionStorage.setItem(AUTH_KEYS.REFRESH_TOKEN, refreshToken);
  localStorage.removeItem(AUTH_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(AUTH_KEYS.REFRESH_TOKEN);
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(AUTH_KEYS.REFRESH_TOKEN);
  sessionStorage.removeItem(AUTH_KEYS.ACCESS_TOKEN);
  sessionStorage.removeItem(AUTH_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(AUTH_KEYS.REMEMBER_ME);
}
