/**
 * HTTP 通用件：信封、CORS。
 *
 * ## 信封
 *
 * 本服务与 AiAdmin 用**同一套**信封 `{code, msg, data}`（见 `src/types/api.ts`）：
 * 成功 `code === 0`，失败 `code` 是 HTTP 语义码（401 / 404 / 400 / 500）。
 * 前端只要认一种形状。
 */

import { env } from "../env";
import type { ApiResponse } from "../types/api";
import { buildCorsHeaders } from "./cors";

/** 成功的业务码。 */
export const SUCCESS_CODE = 0;

/**
 * 允许的源（来自 `env.ALLOWED_ORIGINS`，启动时已校验非空）。
 *
 * 留一个替换口给单元测试 —— 生产代码里它就是 `env.ALLOWED_ORIGINS`。
 */
let originsOverride: readonly string[] | undefined;

/** 测试用：替换允许的源（传 `undefined` 恢复默认）。 */
export function setAllowedOriginsForTest(origins: readonly string[] | undefined): void {
	originsOverride = origins;
}

/** 当前允许的源。 */
export function allowedOrigins(): readonly string[] {
	return originsOverride ?? env.ALLOWED_ORIGINS;
}

/**
 * 造一个带 CORS 头的 JSON 响应。
 *
 * @param request 原请求（用来判断 Origin 白名单）。
 * @param body 响应体。
 * @param status HTTP 状态码。
 */
export function jsonResponse(request: Request, body: unknown, status = 200): Response {
	const headers: Record<string, string> = {
		"Content-Type": "application/json; charset=utf-8",
		...buildCorsHeaders(request, allowedOrigins()),
	};
	return new Response(JSON.stringify(body), { status, headers });
}

/** 成功信封。 */
export function okEnvelope<T>(request: Request, data: T, msg = "成功"): Response {
	const body: ApiResponse<T> = { code: SUCCESS_CODE, msg, data };
	return jsonResponse(request, body, 200);
}

/** 失败信封。 */
export function errorEnvelope(
	request: Request,
	code: number,
	msg: string,
	status: number,
): Response {
	const body: ApiResponse<null> = { code, msg, data: null };
	return jsonResponse(request, body, status);
}

/** 预检响应（204，带 CORS 头）。 */
export function preflightResponse(request: Request): Response {
	const headers = new Headers(buildCorsHeaders(request, allowedOrigins()));
	return new Response(null, { status: 204, headers });
}
