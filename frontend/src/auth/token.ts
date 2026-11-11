export const AUTH_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  REMEMBER_ME: 'remember_me',
} as const;

/** 存储的种类:localStorage(记住我)/ sessionStorage(本次会话) */
type StorageKind = 'local' | 'session';

/**
 * 拿到存储对象本身。
 *
 * 隐私模式 / 禁用 cookie 时,访问 `localStorage` 这个**属性**本身就可能抛
 * SecurityError(不只是 getItem 抛),所以连取值都要包起来。
 */
function getStorage(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    // 存储被浏览器禁用
    return null;
  }
}

/** 读一项:读不到(被禁用 / 抛错)就当没有 —— 等价于「未登录」 */
function readItem(kind: StorageKind, key: string): string | null {
  const storage = getStorage(kind);
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** 写一项:写不进去就静默忽略(不能因此让整个登录流程炸掉) */
function writeItem(kind: StorageKind, key: string, value: string): void {
  const storage = getStorage(kind);
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // 配额满 / 存储被禁用:token 没存上,但流程要继续走下去
  }
}

/** 删一项:删不掉就静默忽略 */
function removeItem(kind: StorageKind, key: string): void {
  const storage = getStorage(kind);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // 同上
  }
}

/**
 * 是否勾选「记住我」。
 * 勾选 → token 存 localStorage(关掉浏览器仍在);未勾选 → 存 sessionStorage。
 */
export function isRememberMe(): boolean {
  return readItem('local', AUTH_KEYS.REMEMBER_ME) === 'true';
}

export function getAccessToken(): string {
  return isRememberMe()
    ? readItem('local', AUTH_KEYS.ACCESS_TOKEN) || ''
    : readItem('session', AUTH_KEYS.ACCESS_TOKEN) || '';
}

export function getRefreshToken(): string {
  return isRememberMe()
    ? readItem('local', AUTH_KEYS.REFRESH_TOKEN) || ''
    : readItem('session', AUTH_KEYS.REFRESH_TOKEN) || '';
}

export function setTokens(
  accessToken: string,
  refreshToken: string,
  rememberMe: boolean,
): void {
  writeItem('local', AUTH_KEYS.REMEMBER_ME, String(rememberMe));

  if (rememberMe) {
    writeItem('local', AUTH_KEYS.ACCESS_TOKEN, accessToken);
    writeItem('local', AUTH_KEYS.REFRESH_TOKEN, refreshToken);
    removeItem('session', AUTH_KEYS.ACCESS_TOKEN);
    removeItem('session', AUTH_KEYS.REFRESH_TOKEN);
    return;
  }

  writeItem('session', AUTH_KEYS.ACCESS_TOKEN, accessToken);
  writeItem('session', AUTH_KEYS.REFRESH_TOKEN, refreshToken);
  removeItem('local', AUTH_KEYS.ACCESS_TOKEN);
  removeItem('local', AUTH_KEYS.REFRESH_TOKEN);
}

export function clearAuth(): void {
  removeItem('local', AUTH_KEYS.ACCESS_TOKEN);
  removeItem('local', AUTH_KEYS.REFRESH_TOKEN);
  removeItem('session', AUTH_KEYS.ACCESS_TOKEN);
  removeItem('session', AUTH_KEYS.REFRESH_TOKEN);
  removeItem('local', AUTH_KEYS.REMEMBER_ME);
}
