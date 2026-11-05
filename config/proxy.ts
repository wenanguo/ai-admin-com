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
 * ⚠️ 还有一个 `PROXY_INSECURE_TLS` 开关(证书续签前本地用):
 * http-proxy 会**显式**把 `rejectUnauthorized` 设成 true(除非传 `secure`),
 * 于是 `NODE_TLS_REJECT_UNAUTHORIZED=0` 对它**无效** ⇒ 只能靠这个开关。
 *
 * ## 这个开关为什么叫「INSECURE」
 *
 * 它关掉的是 **TLS 证书校验** —— 名字里必须带 "INSECURE",
 * 这样任何看到它的人(哪怕只是扫一眼 `.env.local`)都知道自己正跑在一个
 * **不校验证书**的通道上。默认是**关**的(= 校验证书),
 * 打开时启动日志里会打一条响亮的警告。
 *
 * ⚠️ 只用于本地临时绕过证书过期;证书续签后把 `.env.local` 里那一行删掉即可。
 */
const AIADMIN_TARGET = process.env.PROXY_TARGET || 'https://www.pmdict.cn';

/**
 * 是否**跳过**后端证书校验(默认不跳过 = 校验证书)。
 *
 * ⚠️ 只有显式写成 `true` 才跳过;写别的值(`1`、`yes`、空)都当「不跳过」。
 */
const AIADMIN_INSECURE_TLS = process.env.PROXY_INSECURE_TLS === 'true';

// 开关打开时必须**自己喊出来** —— 这是一条不安全的通道,不能悄悄生效。
if (AIADMIN_INSECURE_TLS) {
  console.warn(
    [
      '',
      '  ⚠️⚠️⚠️ 已关闭后端的 TLS 证书校验（PROXY_INSECURE_TLS=true）⚠️⚠️⚠️',
      '',
      '  线上后端的 TLS 证书已于 2026-11-04 过期，证书校验失败会让所有本地请求 502。',
      '  这个开关是**本地临时绕行**用的：它让流量不校验证书，等于把通道降级成明文级别的信任。',
      '',
      '  · 只在本地用，不要带到别的环境；',
      '  · 证书续签之后，把 .env.local 里的 PROXY_INSECURE_TLS 这一行删掉即可',
      '    （默认值就是校验证书，不需要改 config/proxy.ts）。',
      '',
    ].join('\n'),
  );
}

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
    // 默认 true = 校验证书;只有显式打开 PROXY_INSECURE_TLS 才变成 false。
    secure: !AIADMIN_INSECURE_TLS,
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
