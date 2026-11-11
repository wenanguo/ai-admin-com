/**
 * 后端 API 前缀。
 *
 * 后端 FastAPI 以 root_path='/api/v1' 暴露服务,nginx 与本地 dev 代理都不做 rewrite,
 * 因此前端统一以 /api/v1 作为 baseURL,service 层写路径时不再重复带上该前缀。
 */
export const API_BASE_URL = '/api/v1';

/**
 * 免鉴权的接口路径(登录、刷新 token、验证码)。
 *
 * 请求拦截器靠它决定要不要注入 Bearer token —— 这里是**唯一**的定义处。
 *
 * 与 `src/app.tsx` 里的 `authFreePaths` 是两回事:那边是**前端路由**
 * (哪些页面不需要登录态),这边是**接口路径**。
 */
export const AUTH_FREE_API_PATHS = [
  '/system/auth/login',
  '/system/auth/token/refresh',
  '/system/auth/captcha/get',
];
