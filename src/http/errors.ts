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

import { AdapterErrorException } from "../aadmin/errors";
import { AgentError } from "../agent/runtime";
import { errorEnvelope } from "./respond";

/** 把异常变成一个带 CORS 头的错误信封。 */
export function errorResponse(request: Request, error: unknown): Response {
	if (error instanceof AgentError) {
		return errorEnvelope(request, statusOf(error.kind), error.message, statusOf(error.kind));
	}
	if (error instanceof AdapterErrorException) {
		const status = statusOf(error.kind);
		return errorEnvelope(request, status, error.message, status);
	}
	const message = error instanceof Error ? error.message : String(error);
	return errorEnvelope(request, 500, `服务内部错误：${message}`, 500);
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
