/**
 * 当前用户 —— 用**调用方的 token**去 AiAdmin 问「你是谁」。
 *
 * ## 为什么需要它
 *
 * 后端 `module_pm_task.reporter_id` 是 NOT NULL，而 `create_service`
 * **不做任何回填**（schema 注释里承诺的「为 None 时 service 用当前登录用户填充」没实现）
 * ⇒ 建任务时必须自己带上报告人 id。
 *
 * ## 怎么做
 *
 * 问 AiAdmin 的 `GET /system/user/current/info`（它返回当前登录用户）。
 * 本服务**不解析 token** —— token 是不是有效、对应谁，都由 AiAdmin 说了算。
 *
 * 结果**按 token 指纹缓存**一小会儿（默认 5 分钟）：
 * - 缓存 key 用 token 的 sha256 指纹 ⇒ 明文凭据不留内存；
 * - 按身份隔离 ⇒ 换个人登录不会串号。
 */

import { createHash } from "node:crypto";
import type { AadminClient } from "../aadmin/client.ts";
import { AdapterErrorException } from "../aadmin/errors.ts";

/** 当前用户信息的路径（AiAdmin 系统管理模块）。 */
export const CURRENT_USER_PATH = "/system/user/current/info";

/** 当前用户（只要用得上的几个字段）。 */
export interface CurrentUser {
	/** 后端的 `sys_user.id`。 */
	id: number;
	/** 用户名。 */
	username?: string;
	/** 姓名。 */
	name?: string;
}

/** 缓存存活时间（毫秒）。 */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** 缓存里最多留多少条。 */
const MAX_ENTRIES = 256;

interface CacheEntry {
	user: CurrentUser;
	at: number;
}

/** token 的指纹（不可逆；缓存 key 用它，不用明文 token）。 */
function fingerprint(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** 后端返回的用户 → 我们的形状。 */
function toCurrentUser(payload: unknown): CurrentUser {
	if (typeof payload !== "object" || payload === null) {
		throw new AdapterErrorException("UPSTREAM", "AiAdmin 返回的当前用户信息不是对象");
	}
	const record = payload as Record<string, unknown>;
	const id = record["id"];
	if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
		throw new AdapterErrorException("UPSTREAM", "AiAdmin 返回的当前用户信息里没有有效的 id");
	}
	const user: CurrentUser = { id };
	const username = record["username"];
	if (typeof username === "string") {
		user.username = username;
	}
	const name = record["name"];
	if (typeof name === "string") {
		user.name = name;
	}
	return user;
}

/**
 * 当前用户的解析器（带短缓存）。
 */
export class CurrentUserResolver {
	readonly #client: AadminClient;
	readonly #ttlMs: number;
	readonly #cache = new Map<string, CacheEntry>();

	constructor(client: AadminClient, options: { ttlMs?: number } = {}) {
		this.#client = client;
		this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	}

	/**
	 * 解析 token 对应的当前用户。
	 *
	 * @throws {AdapterErrorException} token 无效时是 `AUTH_EXPIRED`；AiAdmin 挂了是 `UPSTREAM`。
	 */
	async resolve(token: string): Promise<CurrentUser> {
		const key = fingerprint(token);
		const hit = this.#cache.get(key);
		if (hit !== undefined && Date.now() - hit.at <= this.#ttlMs) {
			// 命中就刷新一下位置（顺手淘汰最老的）
			this.#cache.delete(key);
			this.#cache.set(key, hit);
			return hit.user;
		}
		const payload = await this.#client.get<unknown>(CURRENT_USER_PATH, token);
		const user = toCurrentUser(payload);
		this.#cache.set(key, { user, at: Date.now() });
		while (this.#cache.size > MAX_ENTRIES) {
			const oldest = this.#cache.keys().next();
			if (oldest.done) {
				break;
			}
			this.#cache.delete(oldest.value);
		}
		return user;
	}

	/** 清缓存（token 失效时调用）。 */
	clear(): void {
		this.#cache.clear();
	}
}
