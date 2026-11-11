/**
 * CORS —— 回**具体的**已登记源，绝不用 `*`。
 *
 * 为什么不能用 `*`：请求带 `Authorization` 头，而带凭证的请求在
 * `Access-Control-Allow-Origin: *` 下会被浏览器直接拒绝（就算加了
 * `Allow-Credentials` 也不行 —— 规范不允许 `*` 与凭证同用）。
 * ⇒ 回白名单里的**原值**，让浏览器认得出是哪个源。
 *
 * 白名单来自 `env.ALLOWED_ORIGINS`（启动时校验过，非空）。
 *
 * ⚠️ 本模块**不接收 Web `Request`/`Response`**，只接收原始头值 ⇒ 与框架无关。
 */

/** 允许的请求头（前端要带 `Authorization` 与 JSON 体）。 */
export const ALLOWED_REQUEST_HEADERS = "authorization, content-type";

/** 允许的方法。 */
export const ALLOWED_METHODS = "GET, POST, OPTIONS";

/**
 * 预检结果的缓存秒数。
 *
 * ⚠️ **不要调大**：预检缓存期内换了源（或换了 token）会开始失败。
 * 300 秒是够用又不至于太长的一条线。
 */
export const PREFLIGHT_MAX_AGE_SECONDS = 300;

/**
 * 请求头里的 Origin（没有就 undefined）。
 *
 * @param headerValue `Origin` 头的原始值。
 */
export function originOf(headerValue: string | undefined | null): string | undefined {
	if (headerValue === undefined || headerValue === null) {
		return undefined;
	}
	const trimmed = headerValue.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * 是不是 CORS 预检请求（OPTIONS + 带 Origin）。
 *
 * @param method 请求方法。
 * @param headerValue `Origin` 头的原始值。
 */
export function isPreflightRequest(
	method: string | undefined,
	headerValue: string | undefined,
): boolean {
	return method === "OPTIONS" && originOf(headerValue) !== undefined;
}

/**
 * 生成 CORS 响应头。
 *
 * - 源在白名单里 ⇒ `Access-Control-Allow-Origin` 回**那个源**；
 * - 源不在白名单里 ⇒ **不回**这个头（浏览器自己会拦掉，我们只是别添乱）；
 * - 预检 ⇒ 额外回 `Allow-Methods` / `Allow-Headers` / `Max-Age`。
 *
 * @param origin `Origin` 头的原始值（没有就 `undefined`）。
 * @param allowedOrigins 允许的源。
 * @param preflight 是不是预检请求。
 */
export function buildCorsHeaders(
	origin: string | undefined,
	allowedOrigins: readonly string[],
	preflight = false,
): Record<string, string> {
	const headers: Record<string, string> = {};

	// 不管回不回 Allow-Origin，都要声明 Vary —— 否则代理/缓存会把一个源的
	// 响应喂给另一个源。
	headers["Vary"] = "Origin";

	if (origin !== undefined && allowedOrigins.includes(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
		// 带凭证的请求必须回具体的源 + Allow-Credentials
		headers["Access-Control-Allow-Credentials"] = "true";
	}

	if (preflight) {
		headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS;
		headers["Access-Control-Allow-Headers"] = ALLOWED_REQUEST_HEADERS;
		headers["Access-Control-Max-Age"] = String(PREFLIGHT_MAX_AGE_SECONDS);
	}

	return headers;
}
