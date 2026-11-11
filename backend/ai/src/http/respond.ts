/**
 * HTTP 通用件：信封、CORS。
 *
 * ## 信封
 *
 * 本服务与 AiAdmin 用**同一套**信封 `{code, msg, data}`（见 `src/types/api.ts`）：
 * 成功 `code === 0`，失败 `code` 是 HTTP 语义码（401 / 404 / 400 / 500）。
 * 前端只要认一种形状。
 *
 * ⚠️ 本模块**框架无关**：只造信封体，不碰任何 HTTP 对象
 *   ⇒ 换框架（Next ⇒ Express）时它一行都不用改。
 */

import { env } from "../env.ts";
import type { ApiResponse } from "../types/api.ts";

/** 成功的业务码。 */
export const SUCCESS_CODE = 0;

/**
 * 缺 token 时的统一说法（10 个端点共用）。
 *
 * ⚠️ 一字不改：前端会把它直接显示给用户。
 */
export const MISSING_TOKEN_MESSAGE =
	"缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/**
 * 允许的源（来自 `env.ALLOWED_ORIGINS`，启动时已校验非空）。
 */
export function allowedOrigins(): readonly string[] {
	return env.ALLOWED_ORIGINS;
}

/**
 * 成功信封**体**（框架无关）。
 *
 * @param data 业务数据。
 * @param msg 提示语。
 */
export function okBody<T>(data: T, msg = "成功"): ApiResponse<T> {
	return { code: SUCCESS_CODE, msg, data };
}

/**
 * 失败信封**体**（框架无关）。
 *
 * @param code 业务码（= HTTP 语义码）。
 * @param msg 错误说明（**不能带 token**）。
 */
export function errorBody(code: number, msg: string): ApiResponse<null> {
	return { code, msg, data: null };
}
