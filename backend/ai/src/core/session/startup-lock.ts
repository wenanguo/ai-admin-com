/**
 * 启动锁 —— 让**同一个 key** 的任务串行执行，不同 key 互不干扰。
 *
 * 为什么必须有（尖峰实测）：pi 的会话在流式输出期间再调 `prompt()` 会抛
 * `Agent is already processing`。前端可能在上一轮还没跑完时就发下一条命令 ——
 * 直接透传就会 500，用户看到「第一条命令莫名其妙失败」。
 * ⇒ 同一会话的 prompt 进队列，**串行**跑完，而不是报错。
 *
 * 语义：
 * - 同 key：后一个等前一个**跑完**（无论前一个成功还是失败）才开始；
 * - 不同 key：完全并行（不同会话互不阻塞）；
 * - 前一个失败**不**卡住队列（失败也要放行下一个）；
 * - 队列跑完后不留尾巴（不漏内存）。
 */
export class StartupLock {
	/** 每个 key 的「当前尾巴」—— 排在这个 promise 后面的人都要等它。 */
	readonly #tails = new Map<string, Promise<void>>();

	/**
	 * 排队执行一个任务。
	 *
	 * @param key 串行化的分组键（用 conversationId）。
	 * @param task 要跑的任务。
	 * @returns 任务的返回值；任务抛错就原样抛给调用方。
	 */
	async run<T>(key: string, task: () => Promise<T>): Promise<T> {
		const previous = this.#tails.get(key) ?? Promise.resolve();
		// 尾巴 promise 永远不会 reject（下面吞掉了），所以只用 then 的成功分支；
		// 仍写上失败分支是为了防御 —— 万一有人改了尾巴的实现，这里也不会卡死。
		const result = previous.then(task, task);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.#tails.set(key, tail);
		try {
			return await result;
		} finally {
			// 只有自己还是当前尾巴时才清（后面排队的那个已经把尾巴换掉了）
			if (this.#tails.get(key) === tail) {
				this.#tails.delete(key);
			}
		}
	}

	/** 当前还排着队的 key 数量（自检用：跑完后应为 0）。 */
	get pendingKeys(): number {
		return this.#tails.size;
	}
}
