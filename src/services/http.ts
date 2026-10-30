/**
 * 后端 API 前缀。
 *
 * 后端 FastAPI 以 root_path='/api/v1' 暴露服务,nginx 与本地 dev 代理都不做 rewrite,
 * 因此前端统一以 /api/v1 作为 baseURL,service 层写路径时不再重复带上该前缀。
 */
export const API_BASE_URL = '/api/v1';
