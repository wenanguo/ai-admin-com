/**
 * 错误 → HTTP 信封。
 *
 * 两类错误统一处理：
 * - **运行时自己的**（`AgentError`）：会话不存在、参数不对；
 * - **适配层归一过的**（`AdapterErrorException`）：AiAdmin 那边的问题
 *   （凭证失效、找不到、冲突、限流、参数不合法、上游挂了）。
 *
 * ⚠️ **错误消息里绝不能出现 token** —— `AadminClient` 已经在出口处脱敏过了，
 * 这里只做「原样转出去」，不再加工。
 */

import { AdapterErrorException, isAdapterErrorException } from "../aadmin/errors.ts";
import { AgentError } from "../agent/runtime.ts";
import { errorBody } from "./respond.ts";
import type { ApiResponse } from "../types/api.ts";

/**
 * 这个错误是不是**运行时自己的**（会话不存在、参数不对……）。
 *
 * ⚠️ 不能只看 `instanceof`：打包器可能把同一个模块在不同的 chunk 里
 *    **各实例化一次** ⇒ 跨 chunk 的 `instanceof` 就是 false
 *    （适配层那边的同类问题见 `aadmin/errors.ts` 的 `isAdapterErrorException`）。
 *
 * ⇒ 用 `name` 做结构化判定（`AgentError` 与 `AdapterErrorException` 互不相同）。
 */
function isAgentError(error: unknown): error is AgentError {
	return (
		error instanceof AgentError ||
		(typeof error === "object" &&
			error !== null &&
			(error as { name?: unknown }).name === "AgentError")
	);
}

/**
 * 把异常变成「状态码 + 信封体」（**框架无关**）。
 *
 * @param error 任意异常。
 */
export function toErrorEnvelope(error: unknown): { status: number; body: ApiResponse<null> } {
	if (isAgentError(error)) {
		const status = statusOf(error.kind);
		return { status, body: errorBody(status, error.message) };
	}
	if (isAdapterErrorException(error)) {
		const status = statusOf(error.kind);
		return { status, body: errorBody(status, error.message) };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { status: 500, body: errorBody(500, `服务内部错误：${message}`) };
}

/** 错误种类 → HTTP 状态码（也用作信封里的业务码）。 */
function statusOf(kind: AgentError["kind"] | AdapterErrorException["kind"]): number {
	switch (kind) {
		case "NOT_FOUND":
			return 404;
		case "VALIDATION":
			return 400;
		case "AUTH_EXPIRED":
			return 401;
		case "CONFLICT":
			return 409;
		case "RATE_LIMIT":
			return 429;
		case "UNSUPPORTED":
			return 400;
		case "UPSTREAM":
			return 502;
		default:
			return 500;
	}
}
