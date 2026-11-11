/**
 * 路由层的小工具：取 token、回错误、把 query 变成 `URLSearchParams`。
 *
 * ⚠️ 这些是**Express 层**的东西（碰 `req`/`res`），不属于 agent 内核。
 */

import type { Request, Response } from "express";
import { extractBearerToken } from "../http/auth.ts";
import { toErrorEnvelope } from "../http/errors.ts";
import { MISSING_TOKEN_MESSAGE, errorBody } from "../http/respond.ts";

/**
 * 取调用方的 token；**没有就回 401 信封**并返回 `undefined`。
 *
 * 本服务不解析 token，只做透传（见 `src/http/auth.ts`）。
 */
export function requireToken(req: Request, res: Response): string | undefined {
	const token = extractBearerToken(req.get("authorization"));
	if (token === undefined) {
		res.status(401).json(errorBody(401, MISSING_TOKEN_MESSAGE));
		return undefined;
	}
	return token;
}

/** 把异常变成统一信封（状态码 + body 一次到位）。 */
export function sendError(res: Response, error: unknown): void {
	const { status, body } = toErrorEnvelope(error);
	res.status(status).json(body);
}

/**
 * Express 的 `req.query` ⇒ `URLSearchParams`。
 *
 * 查询层（`pending-query` / `audit-query`）的入参就是 `URLSearchParams`
 * ⇒ 这里只做形状转换，**不改它们的接口**。
 */
export function queryToSearchParams(query: Request["query"]): URLSearchParams {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (typeof value === "string") {
			params.append(key, value);
		} else if (Array.isArray(value)) {
			for (const item of value) {
				params.append(key, String(item));
			}
		}
	}
	return params;
}
