/**
 * 读 JSON 请求体 —— **手工读原始字节**，不用 `express.json()`。
 *
 * ## 为什么不用 `express.json()`
 *
 * 今天的语义（Next 的 `request.json()`）：
 * - 没有 body ⇒ 抛 ⇒ 「请求体不是合法的 JSON」（400）；
 * - body 坏了 ⇒ 同样 400；
 * - 某些路由（新建会话）**故意忽略** body 解析失败。
 *
 * `express.json()` 一挂上，解析失败就变成**中间件级**错误（统一 500 或 413），
 * 而且「没有 body」与「body 坏了」会混在一起 ⇒ **对不上今天的文案**。
 *
 * ⇒ 自己读：语义一字不差，且「哪个路由要不要解析 body」由路由自己决定。
 */

import type { IncomingHttpHeaders } from "node:http";
import type { Readable } from "node:stream";

/** body 上限：1MB（与原来一致）。 */
export const MAX_BODY_BYTES = 1024 * 1024;

/** 读 body 的最小接口（Express 的 Request 就是它 ⇒ 可直接传）。 */
export interface BodySource extends Readable {
	headers?: IncomingHttpHeaders;
}

/** 读 body 的结果。 */
export type JsonBodyResult =
	| { ok: true; value: unknown }
	| { ok: false; reason: "empty" | "invalid" | "too-large" };

/**
 * 读原始 body 并解析成 JSON。
 *
 * ⚠️ **不看 content-type**：今天用的是 Web 的 `request.json()`，它也不看。
 */
export async function readJsonBody(req: BodySource): Promise<JsonBodyResult> {
	const chunks: Buffer[] = [];
	let size = 0;
	let aborted = false;

	try {
		await new Promise<void>((resolve, reject) => {
			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					aborted = true;
					resolve();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => resolve());
			req.on("error", reject);
		});
	} catch {
		return { ok: false, reason: "invalid" };
	}

	if (aborted) {
		return { ok: false, reason: "too-large" };
	}

	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim().length === 0) {
		return { ok: false, reason: "empty" };
	}
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false, reason: "invalid" };
	}
}
