/**
 * @name 代理配置
 * @description 本地开发时把 /api/ 转发到后端。
 *
 * 后端 FastAPI 以 root_path='/api/v1' 暴露服务,nginx 与此代理都不做 rewrite,
 * 因此这里不需要 pathRewrite —— 前端 baseURL 已经是 /api/v1。
 *
 * 换成本地后端:把 target 改成 http://127.0.0.1:8001
 */
export default {
  dev: {
    '/api/': {
      target: 'https://www.pmdict.cn',
      changeOrigin: true,
    },
  },
  test: {
    '/api/': {
      target: 'https://www.pmdict.cn',
      changeOrigin: true,
    },
  },
  pre: {
    '/api/': {
      target: 'https://www.pmdict.cn',
      changeOrigin: true,
    },
  },
};
