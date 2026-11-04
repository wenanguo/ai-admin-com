/**
 * 适配层统一的错误种类。
 *
 * 客户端只做「传输 + 错误归一」：把 HTTP 层与业务层的异常全部收敛到这七种，
 * 上层（适配层 / Agent）按 `kind` 决定重试、提示还是放弃，不必再去分辨
 * 「HTTP 状态码」与「业务码」两套语义。
 */
export type AdapterErrorKind =
	| "NOT_FOUND"
	| "CONFLICT"
	| "VALIDATION"
	| "RATE_LIMIT"
	| "AUTH_EXPIRED"
	| "UNSUPPORTED"
	| "UPSTREAM";

/** 归一后的结构化错误（不含堆栈，便于直接序列化给前端 / 模型）。 */
export type AdapterError =
	| { kind: "NOT_FOUND" }
	| { kind: "CONFLICT"; message?: string }
	| { kind: "VALIDATION"; fields?: Record<string, string> }
	| { kind: "RATE_LIMIT"; retryAfterMs?: number }
	| { kind: "AUTH_EXPIRED" }
	| { kind: "UNSUPPORTED"; capability: string }
	| { kind: "UPSTREAM"; message: string; retryable: boolean };

/** 归一时能附带的额外信息。 */
export interface AdapterErrorDetails {
	/** VALIDATION 的字段级错误：字段名 → 错误说明。 */
	fields?: Record<string, string>;
	/** RATE_LIMIT 的建议等待毫秒数（后端给了 `Retry-After` 才有）。 */
	retryAfterMs?: number;
	/** UNSUPPORTED 的能力名。 */
	capability?: string;
	/** UPSTREAM：这类错误重试是否安全（写操作一律 false）。 */
	retryable?: boolean;
}

/** 没有更具体的说明时，各 kinds 的兜底文案。 */
const DEFAULT_MESSAGES: Record<AdapterErrorKind, string> = {
	NOT_FOUND: "AiAdmin 里找不到该资源",
	CONFLICT: "AiAdmin 里该资源与现有数据冲突",
	VALIDATION: "AiAdmin 拒绝了这次请求（参数或业务校验未通过）",
	RATE_LIMIT: "AiAdmin 触发了限流",
	AUTH_EXPIRED: "AiAdmin 凭证已失效",
	UNSUPPORTED: "AiAdmin 不支持该能力",
	UPSTREAM: "AiAdmin 服务异常",
};

/**
 * 客户端抛出的统一异常。
 *
 * 消息里只放「方法 · 路径 · HTTP 状态 · 业务码 · 后端给的说明」，
 * **永远不放 token**（见 `client.ts` 里的脱敏处理）。
 */
export class AdapterErrorException extends Error {
	/** 归一后的错误种类。 */
	readonly kind: AdapterErrorKind;
	/** VALIDATION 的字段级错误。 */
	readonly fields?: Record<string, string>;
	/** RATE_LIMIT 的建议等待毫秒数。 */
	readonly retryAfterMs?: number;
	/** UNSUPPORTED 的能力名。 */
	readonly capability?: string;
	/** 这类错误重试是否安全。 */
	readonly retryable: boolean;

	constructor(kind: AdapterErrorKind, message?: string, details: AdapterErrorDetails = {}) {
		super(message ?? DEFAULT_MESSAGES[kind]);
		this.name = "AdapterErrorException";
		this.kind = kind;
		this.fields = details.fields;
		this.retryAfterMs = details.retryAfterMs;
		this.capability = details.capability;
		this.retryable = details.retryable ?? false;
	}

	/** 转成结构化的 `AdapterError`（给上层做分支判断用）。 */
	toAdapterError(): AdapterError {
		switch (this.kind) {
			case "NOT_FOUND":
				return { kind: "NOT_FOUND" };
			case "CONFLICT":
				return { kind: "CONFLICT", message: this.message };
			case "VALIDATION":
				return this.fields === undefined
					? { kind: "VALIDATION" }
					: { kind: "VALIDATION", fields: this.fields };
			case "RATE_LIMIT":
				return this.retryAfterMs === undefined
					? { kind: "RATE_LIMIT" }
					: { kind: "RATE_LIMIT", retryAfterMs: this.retryAfterMs };
			case "AUTH_EXPIRED":
				return { kind: "AUTH_EXPIRED" };
			case "UNSUPPORTED":
				return { kind: "UNSUPPORTED", capability: this.capability ?? "" };
			case "UPSTREAM":
				return { kind: "UPSTREAM", message: this.message, retryable: this.retryable };
		}
	}
}

/**
 * 这个错误值不值得再试一次。
 *
 * 只有「上游抖动」类的 `UPSTREAM` 才算：网络层故障与 5xx。
 * 限流（RATE_LIMIT）**不算** —— 它带的是 `retryAfterMs`，要不要退避由调用方决定，
 * 客户端不替调用方 sleep。
 */
export function isRetryable(error: AdapterErrorException): boolean {
	return error.kind === "UPSTREAM" && error.retryable;
}
