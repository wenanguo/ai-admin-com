/**
 * 鉴权 —— 本服务**不解析 token**，只把调用方的 token **透传**给 AiAdmin。
 *
 * ## 为什么不在这里校验
 *
 * AiAdmin 才是权威：它的 token 可能过期、可能被撤销、可能换了签发方式。
 * 本服务自己解一遍 JWT，只会产生「两边规则不一致」的窗口
 * （本地说有效、后端说无效 ⇒ 用户看到莫名其妙的失败）。
 * ⇒ 本服务只做一件事：**把 `Authorization: Bearer <token>` 里的 token 取出来转手**。
 *
 * ## 缺 token 的处理
 *
 * 没有 token ⇒ 直接回 401 信封（连 AiAdmin 都不用打）。
 * token 有但无效 ⇒ AiAdmin 会回 401，本服务把那个失败**如实**转成 401 信封。
 *
 * ⚠️ token **绝不**进日志、进错误消息、进数据库。它只在内存里待着。
 *
 * ⚠️ 本模块**不接收 Web `Request`**，只接收原始头值 ⇒ 与框架无关。
 */

/**
 * 从 `Authorization` 头值里取 token。
 *
 * @param headerValue `Authorization` 头的原始值（没有就 `undefined`）。
 * @returns token；没有头、不是 `Bearer` 方案、或者是空串 ⇒ `undefined`。
 */
export function extractBearerToken(headerValue: string | undefined | null): string | undefined {
	if (headerValue === undefined || headerValue === null) {
		return undefined;
	}
	const trimmed = headerValue.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	// 方案名大小写不敏感（RFC 7235：auth-scheme 不区分大小写）
	const separator = trimmed.indexOf(" ");
	if (separator <= 0) {
		return undefined;
	}
	const scheme = trimmed.slice(0, separator);
	if (scheme.toLowerCase() !== "bearer") {
		return undefined;
	}
	const token = trimmed.slice(separator + 1).trim();
	return token.length === 0 ? undefined : token;
}
