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
 * 本地请求 502。证书续签后不需要任何改动。
 * 仓库里的默认值保持 https —— 那是正确的目标,不该因为一次证书故障就降级。
 *
 * ⚠️ 还有一个 `PROXY_SECURE` 开关(证书续签前本地用):
 * http-proxy 会**显式**把 `rejectUnauthorized` 设成 true(除非传 `secure`),
 * 于是 `NODE_TLS_REJECT_UNAUTHORIZED=0` 对它**无效** ⇒ 只能靠这个开关。
 * 默认仍然是 true(校验证书);本地在 `.env.local` 里设 `PROXY_SECURE=false` 绕开。
 */
const AIADMIN_TARGET = process.env.PROXY_TARGET || 'https://www.pmdict.cn';

/** 是否校验目标机的证书(默认校验;证书过期期间本地可关掉)。 */
const AIADMIN_SECURE = process.env.PROXY_SECURE !== 'false';

/**
 * AI 服务（`D:/project/ai-admin-ai`）的地址。
 *
 * 它是**本地独立进程**（3100 端口），跟 AiAdmin 的线上后端不是一回事。
 */
const AI_SERVICE_TARGET = 'http://localhost:3100';

/**
 * AI 服务的代理规则。
 *
 * ⚠️ **必须用独立前缀**：AI 服务的路径也是 `/api/agent/...`，
 * 而代理的键是**前缀匹配** ⇒ 若浏览器直接打 `/api/agent/...`，
 * 请求会被下面那条 `'/api/'`（归 AiAdmin）接走。
 *
 * 于是浏览器侧用 `/ai-api/`：`/ai-api/api/agent/x` 经 `pathRewrite`
 * 去掉前缀后变成 `http://localhost:3100/api/agent/x`。
 * 前缀由 `config/config.ts` 的 `define` 注入（`AI_API_BASE_URL`）。
 */
const aiServiceProxy = {
  '/ai-api/': {
    target: AI_SERVICE_TARGET,
    changeOrigin: true,
    pathRewrite: { '^/ai-api': '' },
  },
};

/** AiAdmin 的代理规则（三个环境段一样）。 */
const aiadminProxy = {
  '/api/': {
    target: AIADMIN_TARGET,
    changeOrigin: true,
    secure: AIADMIN_SECURE,
  },
};

export default {
  dev: {
    ...aiadminProxy,
    ...aiServiceProxy,
  },
  test: {
    ...aiadminProxy,
    ...aiServiceProxy,
  },
  pre: {
    ...aiadminProxy,
    ...aiServiceProxy,
  },
};
