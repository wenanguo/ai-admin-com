/**
 * 待确认的**等待者**（进程内存）。
 *
 * ## 为什么在内存
 *
 * 挂起的是**一个 await** ⇒ 它本来就只能活在进程里（与 token 同规矩）。
 * DB 里那条 `ai_pending_action` 是**给人看的记录**（谁提的、什么时候、批没批），
 * 不是用来恢复挂起的 ⇒ 进程重启后那条记录会停在 PENDING（靠 `expiresAt` 兜底）。
 *
 * ## ⚠️ 决定**先到**怎么办（issue #122 发现的坑）
 *
 * 挂起流程是「**先通知外面**（`onPending`）⇒ **再等**（`wait`）」⇒
 * 如果人在通知的那一刻就点了「同意」⇒ `decide` 会**先于** `wait` 到达
 * ⇒ 当时**还没有等待者**⇒ 决定**被丢掉**⇒ 等的人只能等到超时（按拒绝处理）。
 *
 * ⇒ 所以这里**记住提前到的决定**（`#decided`）⇒ 等的人一注册就拿到它。
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
	/** **先到的决定**（等的人还没注册时就到了）。 */
	readonly #decided = new Map<string, PendingDecision>();

	/** 提前到达的决定，最多留这么多条（防内存吃满）。 */
	static readonly MAX_EARLY_DECISIONS = 128;

	/**
	 * 注册一个等待者。
	 *
	 * @param id pending 行的 id。
	 * @param timeoutMs 超时（毫秒）⇒ 超时按「拒绝」处理（宁可不做）。
	 */
	wait(id: string, timeoutMs: number): Promise<PendingDecision> {
		// ⚠️ **决定先到了** ⇒ 直接用它（不用等）。
		const early = this.#decided.get(id);
		if (early !== undefined) {
			this.#decided.delete(id);
			return Promise.resolve(early);
		}
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
			// ⚠️ **等待者还没注册**（决定先到）⇒ **记下来** ⇒ 等的人一注册就拿到。
			//    ⚠️ **返回值不变**（还是 false：“这个 id 没人在等”）
			//    ⇒ 批准 / 拒绝端点的语义**不变**（已处理过 ⇒ 409）。
			this.#decided.set(id, decision);
			// ⚠️ **上限**（防内存吃满 ⇒ 淘汰最老的那个）。
			if (this.#decided.size > PendingWaiterRegistry.MAX_EARLY_DECISIONS) {
				const oldest = this.#decided.keys().next();
				if (!oldest.done) {
					this.#decided.delete(oldest.value);
				}
			}
			return false;
		}
		// ⚠️ **被消费了** ⇒ 删掉先前记着的那个（不拿到旧决定）。
		this.#decided.delete(id);
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

/**
 * 进程级的等待者注册表。
 *
 * ⚠️ **运行时与批准/拒绝端点必须共用同一份** ⇒ 否则端点叫不醒 hook。
 * （与 `agentRuntime` 一样挂在 globalThis 上 ⇒ dev 热重载不丢。）
 */
const globalForPending = globalThis as unknown as {
	pendingWaiters?: PendingWaiterRegistry;
};

export const pendingWaiters: PendingWaiterRegistry =
	globalForPending.pendingWaiters ?? new PendingWaiterRegistry();

if (process.env.NODE_ENV !== "production") {
	globalForPending.pendingWaiters = pendingWaiters;
}
