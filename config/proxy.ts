/**
 * @name 代理配置
 * @description 本地开发时把 /api/ 转发到后端。
 *
 * 后端 FastAPI 以 root_path='/api/v1' 暴露服务,nginx 与此代理都不做 rewrite,
 * 因此这里不需要 pathRewrite —— 前端 baseURL 已经是 /api/v1。
 *
 * 换成本地后端:设环境变量 PROXY_TARGET=http://127.0.0.1:8001
 *
 * ⚠️ 为什么 target 可以用环境变量覆盖:
 * 线上后端的 TLS 证书过期过一次(2026-11-04 到期),证书校验失败会让**所有**
 * 本地请求 502。证书续签后不需要任何改动;续签前,本地可以把
 * PROXY_TARGET 设成 http://www.pmdict.cn(同一台机器的 80 端口)临时绕开。
 * 仓库里的默认值保持 https —— 那是正确的目标,不该因为一次证书故障就降级。
 */
const AIADMIN_TARGET = process.env.PROXY_TARGET || 'https://www.pmdict.cn';

export default {
  dev: {
    '/api/': {
      target: AIADMIN_TARGET,
      changeOrigin: true,
    },
  },
  test: {
    '/api/': {
      target: AIADMIN_TARGET,
      changeOrigin: true,
    },
  },
  pre: {
    '/api/': {
      target: AIADMIN_TARGET,
      changeOrigin: true,
    },
  },
};
