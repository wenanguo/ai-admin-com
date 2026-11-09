/**
 * 待确认的**等待者**（进程内存）。
 *
 * ## 为什么在内存
 *
 * 挂起的是**一个 await** ⇒ 它本来就只能活在进程里（与 token 同规矩）。
 * DB 里那条 `ai_pending_action` 是**给人看的记录**（谁提的、什么时候、批没批），
 * 不是用来恢复挂起的 ⇒ 进程重启后那条记录会停在 PENDING（靠 `expiresAt` 兜底）。
 */

/** 批准的结果。 */
export type PendingDecision = "approved" | "rejected" | "timeout";

/** 一个等待中的批准。 */
interface Waiter {
	/** 唤醒它（只第一次有效）。 */
	resolve: (decision: PendingDecision) => void;
	/** 超时计时器。 */
	timer: ReturnType<typeof setTimeout>;
}

/** 等待者注册表。 */
export class PendingWaiterRegistry {
	readonly #waiters = new Map<string, Waiter>();

	/**
	 * 注册一个等待者。
	 *
	 * @param id pending 行的 id。
	 * @param timeoutMs 超时（毫秒）⇒ 超时按「拒绝」处理（宁可不做）。
	 */
	wait(id: string, timeoutMs: number): Promise<PendingDecision> {
		// 同一个 id 只允许一个等待者（重复注册 ⇒ 旧的直接判超时）
		this.#waiters.get(id)?.resolve("timeout");
		return new Promise<PendingDecision>((resolve) => {
			const timer = setTimeout(() => {
				this.#waiters.delete(id);
				resolve("timeout");
			}, timeoutMs);
			this.#waiters.set(id, {
				resolve: (decision) => {
					clearTimeout(timer);
					this.#waiters.delete(id);
					resolve(decision);
				},
				timer,
			});
		});
	}

	/**
	 * 决定（approve / reject 端点调用）。
	 *
	 * @returns 唤醒了一个等待者 ⇒ true；没有 ⇒ false（重复决定、已过期、id 不对）。
	 */
	decide(id: string, decision: PendingDecision): boolean {
		const waiter = this.#waiters.get(id);
		if (waiter === undefined) {
			return false;
		}
		waiter.resolve(decision);
		return true;
	}

	/** 当前有几个在等。 */
	size(): number {
		return this.#waiters.size;
	}

	/** 在等的 id 列表（诊断用）。 */
	ids(): string[] {
		return [...this.#waiters.keys()];
	}
}
