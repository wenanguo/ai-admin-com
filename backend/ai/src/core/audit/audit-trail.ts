/**
 * 审计的**留痕带** —— 包一层的 writer：转发 + 记住「最近写过哪些命令」。
 *
 * ## 为什么需要它
 *
 * 「每一次工具调用都要留痕」与「写工具自己已经写了一条写审计」这两条会撞车：
 * 同一个写操作 ⇒ 两条同名审计行（审计页看起来像重复）。
 *
 * ⇒ 规则：**每个工具调用至少留一行** ——
 * - 写工具 ⇒ 留它自己那条**更全的**写审计（带写前 / 写后快照）；
 * - 只读工具 ⇒ 补一条**调用痕迹**。
 *
 * ⇒ 要判「这次调用有没有产生写审计」，就得**看得见所有的审计写入**
 *    ⇒ 这就是本文件：`AuditTrail` 包住真正的 writer，写之前先记一笔。
 *
 * ⚠️ **内核不许知道业务命令名** ⇒ 这里只记「命令字符串」，不做任何业务判断。
 *
 * ⚠️ **只留最近若干条**（进程内）⇒ 不是审计的真相源（真相源仍是 `ai_audit_log`）。
 */

import type { AuditEntry, AuditWriter } from "./audit.ts";

/** 记住最近多少条审计写入（**够判一轮工具调用即可** ⇒ 200 条足够）。 */
const MAX_REMEMBERED = 200;

/** 一条「最近写过的审计」的记号。 */
export interface AuditTrailMark {
	/** 审计的命令名。 */
	command: string;
	/** 写下去的时刻（毫秒时间戳）。 */
	at: number;
}

/** 包一层的审计 writer。 */
export class AuditTrail implements AuditWriter {
	readonly #inner: AuditWriter;
	readonly #marks: AuditTrailMark[] = [];

	constructor(inner: AuditWriter) {
		this.#inner = inner;
	}

	/** 写一条审计（**先记一笔再转发** ⇒ 转发失败也不影响「写过了」这个事实）。 */
	async write(entry: AuditEntry): Promise<void> {
		this.#marks.push({ command: entry.command, at: Date.now() });
		while (this.#marks.length > MAX_REMEMBERED) {
			this.#marks.shift();
		}
		await this.#inner.write(entry);
	}

	/**
	 * 从 `since`（毫秒时间戳）起，**有没有写过这个命令的审计**。
	 *
	 * @param command 命令名。
	 * @param since 起点（毫秒时间戳）。
	 */
	wroteSince(command: string, since: number): boolean {
		return this.#marks.some((mark) => mark.command === command && mark.at >= since);
	}
}
