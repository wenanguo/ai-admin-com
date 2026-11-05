/**
 * 审计参数的脱敏 —— **写侧与读侧共用同一份**。
 *
 * ## 为什么抽出来
 *
 * `src/tools/create-task.ts` 里原来有一份私有的脱敏（写审计时用）。
 * 读审计（`GET /api/audit`）也**必须**脱敏 ——
 * 两边各写一份 ⇒ 迟早有一边漏 ⇒ 凭据从响应里漏出去。
 * ⇒ 抽成共享模块，两边都从这里取。
 *
 * ## 规则
 *
 * 脱敏不能靠「参数里不会出现 token」—— 参数是模型给的、运行时来的，
 * 谁也不能保证它不夹带私货 ⇒ 按**键名**一票否决。
 */

/** 审计里**绝不能**出现的字段名（凭据类）。 */
export const SENSITIVE_ARG_KEYS = new Set([
	"token",
	"access_token",
	"refresh_token",
	"authorization",
	"password",
	"passwd",
	"pwd",
	"secret",
	"api_key",
	"apikey",
]);

/** 脱敏后替换成的样子（形状不变，只换值）。 */
export const REDACTED_VALUE = "[已脱敏]";

/**
 * 脱敏：凭据类字段的值换成「[已脱敏]」（键保留，形状不变）。
 *
 * @param args 原始参数（不是对象时当作空参数处理）。
 * @returns 脱敏后的参数（一定是对象）。
 */
export function redactAuditArgs(args: unknown): Record<string, unknown> {
	if (typeof args !== "object" || args === null || Array.isArray(args)) {
		// 不是对象 ⇒ 没有「键名」可言 ⇒ 返回空参数（总比原样吐出去好）
		return {};
	}
	const record = args as Record<string, unknown>;
	const redacted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		redacted[key] = SENSITIVE_ARG_KEYS.has(key.trim().toLowerCase()) ? REDACTED_VALUE : value;
	}
	return redacted;
}
