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
	/**
	 * UPSTREAM：这类错误重试是否安全。
	 *
	 * 规则（客户端保证，`isRetryable` 也只认这一个来源）：
	 * - **读**操作的上游故障（5xx、网络层）→ `true`；
	 * - **写**操作一律 `false` —— 写请求可能已经在后端生效了（提交了、响应没回来），
	 *   这时重放就变成「建了两条任务」，所以写路径绝不重试。
	 */
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
	/** 归一时附带的原始细节（`fields` / `retryAfterMs` / `capability` / `retryable`）。 */
	readonly details: AdapterErrorDetails;
	/** VALIDATION 的字段级错误。 */
	readonly fields?: Record<string, string>;
	/** RATE_LIMIT 的建议等待毫秒数。 */
	readonly retryAfterMs?: number;
	/** UNSUPPORTED 的能力名。 */
	readonly capability?: string;
	/** 这类错误重试是否安全（= `details.retryable`，缺省 false）。 */
	readonly retryable: boolean;

	constructor(kind: AdapterErrorKind, message?: string, details: AdapterErrorDetails = {}) {
		super(message ?? DEFAULT_MESSAGES[kind]);
		this.name = "AdapterErrorException";
		this.kind = kind;
		this.details = details;
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
 * 这个错误是不是**适配层归一过的**。
 *
 * ## 为什么不能只看 `instanceof`
 *
 * Next 的打包器可能把**同一个模块**在不同的 chunk 里**各实例化一次**
 * ⇒ 跨 chunk 的 `instanceof` 就是 false。
 *
 * ⚠️ 实测踩过：命令路由里 AiAdmin 的「凭证已失效」（本该是 **401**）
 *    被降级成了 **500** —— 路由那一侧认不出另一个 chunk 里造出来的实例。
 * ⇒ 判定改成**结构化**的：看 `name`。
 *
 * @param error 任意错误值。
 */
export function isAdapterErrorException(error: unknown): error is AdapterErrorException {
	return (
		error instanceof AdapterErrorException ||
		(typeof error === "object" &&
			error !== null &&
			(error as { name?: unknown }).name === "AdapterErrorException")
	);
}

/**
 * 这个错误值不值得再试一次。
 *
 * 判定**只有一个来源**：错误自带的 `details.retryable`。
 * `kind` 只是「这一类允许重试」的前提条件，绝不会把 `details` 说 `false` 的错误
 * 判成可重试 —— 两者必须一致，否则调用方会重放一个可能已经提交的写请求。
 *
 * 只有「上游抖动」类的 `UPSTREAM` 才算：网络层故障与 5xx（且发生在**读**操作上）。
 * 限流（RATE_LIMIT）**不算** —— 它带的是 `retryAfterMs`，要不要退避由调用方决定，
 * 客户端不替调用方 sleep。
 */
export function isRetryable(error: AdapterErrorException): boolean {
	if (error.kind !== "UPSTREAM") {
		return false;
	}
	return error.details.retryable === true;
}
