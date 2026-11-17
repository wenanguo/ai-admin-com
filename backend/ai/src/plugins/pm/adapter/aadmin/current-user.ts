/**
 * 当前用户 —— **问 AiAdmin「你是谁」**（插件侧的实现）。
 *
 * ## 为什么在插件侧
 *
 * 内核只定义「当前用户」这个**形状**与**契约**（`core/session/identity.ts`），
 * 「到哪儿去问」是**业务/部署**的事 ⇒ 归插件。
 * ⇒ 换权威系统（换插件）时内核不用改。
 *
 * ## 怎么做
 *
 * 问 AiAdmin 的 `GET /system/user/current/info`（它返回当前登录用户）。
 * 本服务**不解析 token** —— token 是不是有效、对应谁，都由 AiAdmin 说了算。
 *
 * ⚠️ 缓存不在这里（内核的 `CachedCurrentUserResolver` 管缓存）⇒ 这里只管「问」。
 */

import type { CurrentUser, CurrentUserResolver } from "../../../../core/session/identity.ts";
import type { AadminClient } from "./client.ts";
import { AdapterErrorException } from "./errors.ts";

/** 当前用户信息的路径（AiAdmin 系统管理模块）。 */
export const CURRENT_USER_PATH = "/system/user/current/info";

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

/** 问 AiAdmin 要当前用户（**不带缓存** —— 缓存由内核那层管）。 */
export class AadminCurrentUserResolver implements CurrentUserResolver {
	readonly #client: AadminClient;

	constructor(client: AadminClient) {
		this.#client = client;
	}

	/**
	 * 解析 token 对应的当前用户。
	 *
	 * @throws {AdapterErrorException} token 无效时是 `AUTH_EXPIRED`；AiAdmin 挂了是 `UPSTREAM`。
	 */
	async resolve(token: string): Promise<CurrentUser> {
		const payload = await this.#client.get<unknown>(CURRENT_USER_PATH, token);
		return toCurrentUser(payload);
	}
}
