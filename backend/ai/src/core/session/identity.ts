/**
 * 当前用户 —— **内核概念**（会话主人）。
 *
 * ## 为什么它在内核
 *
 * 建任务要记「谁干的」（报告人），审计也要记「谁干的」⇒ **每个会话都得有个用户 id**。
 * 这个概念与业务无关 ⇒ 属于内核。
 *
 * ## 但「怎么问」不属于内核
 *
 * ⚠️ **内核不解析 token** —— token 有效吗、对应谁，由**权威系统**（AiAdmin）说了算。
 * ⇒ 内核只定义**形状**（`CurrentUser`）与**契约**（`CurrentUserResolver`），
 *    「怎么问出来」由**插件**实现（见 `plugins/pm/adapter/aadmin/current-user.ts`）。
 *
 * ## 缓存（内核通用）
 *
 * 结果**按 token 指纹缓存**一小会儿（默认 5 分钟）：
 * - 缓存 key 用 token 的 sha256 指纹 ⇒ 明文凭据不留内存；
 * - 按身份隔离 ⇒ 换个人登录不会串号。
 */

import { createHash } from "node:crypto";

/** 当前用户（只要用得上的几个字段）。 */
export interface CurrentUser {
	/** 权威系统里的用户 id（AiAdmin 那边是 `sys_user.id`）。 */
	id: number;
	/** 用户名。 */
	username?: string;
	/** 姓名。 */
	name?: string;
	// 是不是**超级管理员**（**权威系统说了算** ⇒ 没有这个字段就当「不是」）。
	// ⚠️ **它不是「解 token 载荷」来的** —— 载荷没验签 ⇒ 谁都能伪造。
	//    ⇒ 它必须是**问权威系统**得到的（插件侧把后端字段映射过来）。
	// ⚠️ **没有这个字段 ⇒ 不是管理员**（fail closed）——
	//    「判不出来」和「不是」在授权上是一回事。
	isSuperuser?: boolean;
}

// 「当前用户是谁」的解析器（**由插件实现**）。
// 内核只认这个契约 ⇒ 换权威系统（换插件）时内核不用改。
export interface CurrentUserResolver {
	// 解析 token 对应的当前用户。
	// @throws token 无效 / 权威系统挂了 ⇒ 由实现方决定抛什么（路由层负责翻译成 401 / 502）。
	resolve(token: string): Promise<CurrentUser>;
}

// admin 判定器（**问权威系统**：这个 token 是不是超级管理员）。
// ## ⚠️ 为什么是「问」而不是「解载荷」
// token 的**载荷没验签** ⇒ 任何人都能伪造 `{"access":"admin"}`
// ⇒ 用载荷判权限 = **权限提升**（能装插件 / 能开终端 ⇒ 等于拿到装包权）。
// ⇒ 判定器只信**权威系统的回答**（插件侧去问 AiAdmin）。
// ## 口径
// - **判不出来 = 不是 admin**（fail closed）；
// - 判定器**报错**（权威系统挂了 / token 过期）⇒ 由调用方决定怎么拒（**一律拒**）。
export type AdminJudge = (token: string) => Promise<boolean>;

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

// 带短缓存的当前用户解析器（**内核通用**）。
// ⚠️ 它只管缓存 ⇒ 「怎么问」交给里头的那个解析器（插件给的）。
export class CachedCurrentUserResolver implements CurrentUserResolver {
	readonly #inner: CurrentUserResolver;
	readonly #ttlMs: number;
	readonly #cache = new Map<string, CacheEntry>();

	constructor(inner: CurrentUserResolver, options: { ttlMs?: number } = {}) {
		this.#inner = inner;
		this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	}

	/** 解析 token 对应的当前用户（命中缓存就不问权威系统）。 */
	async resolve(token: string): Promise<CurrentUser> {
		const key = fingerprint(token);
		const hit = this.#cache.get(key);
		if (hit !== undefined && Date.now() - hit.at <= this.#ttlMs) {
			// 命中就刷新一下位置（顺手淘汰最老的）
			this.#cache.delete(key);
			this.#cache.set(key, hit);
			return hit.user;
		}
		const user = await this.#inner.resolve(token);
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
