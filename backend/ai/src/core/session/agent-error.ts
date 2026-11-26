/**
 * 运行时的错误（**不是 AiAdmin 那边来的**）。
 *
 * ⚠️ **单独一个文件** ⇒ `agent-resolver.ts` / `turn-queue.ts` 都能用它
 *    ⇒ 那些模块**不用反向 import `runtime.ts`** ⇒ 没有循环依赖。
 */

/** 运行时的错误种类。 */
export type AgentErrorKind = "NOT_FOUND" | "VALIDATION" | "AUTH_EXPIRED" | "UPSTREAM";

/** 运行时自己的错误（不是 AiAdmin 那边来的）。 */
export class AgentError extends Error {
	readonly kind: AgentErrorKind;

	constructor(kind: AgentErrorKind, message: string) {
		super(message);
		this.name = "AgentError";
		this.kind = kind;
	}
}
