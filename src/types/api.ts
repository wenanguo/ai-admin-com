/**
 * AiAdmin 后端的统一响应信封
 * （后端 `app/common/response.py` 里的 `ResponseSchema`）。
 */
export interface ApiResponse<T = unknown> {
	code: number;
	msg: string;
	data: T;
}

/**
 * 后端 `RET` 里代表成功的业务码：`0` = 成功，`200` = 操作成功。
 * 其余 `400~600` 是 HTTP 语义码，`4000+` 是自定义业务错误码。
 */
export const SUCCESS_CODES = [0, 200] as const;

/** 判断一个响应体是不是「成功」的业务信封。 */
export function isSuccess(body: unknown): boolean {
	if (typeof body !== "object" || body === null) {
		return false;
	}
	const { code } = body as { code?: unknown };
	return typeof code === "number" && (SUCCESS_CODES as readonly number[]).includes(code);
}
