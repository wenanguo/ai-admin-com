/**
 * admin 判定 —— **问 AiAdmin「你是不是超级管理员」**（插件侧）。
 *
 * ## 为什么在插件侧
 *
 * 「谁说了算」是**业务/部署**的事（AiAdmin 才是权威）⇒ 归插件。
 * 内核只认「判定器」这个**契约**（`core/adapter/dsh-admin/proxy.ts` 的 `isAdmin`）。
 *
 * ## ⚠️ 为什么**不**解 token 载荷
 *
 * 载荷**没验签** ⇒ 任何人都能伪造 `{"access":"admin"}` ⇒
 * 用它判权限 = **权限提升**（dsh 的插件市场能装包 ⇒ 等于拿到装包权）。
 * ⇒ 这里**只信 AiAdmin 的回答**（`GET /system/user/current/info` ⇒ `is_superuser`）。
 *
 * ## 缓存
 *
 * ⚠️ **带缓存**（内核的 `CachedCurrentUserResolver`）⇒ iframe 的每个资源
 *    不会各打一次 AiAdmin（dsh 的页面几十个静态资源 ⇒ 不缓存就是几十次）。
 *
 * ## 口径
 *
 * - **只有 `is_superuser === true` 才算 admin**；
 * - 别的字段（`access` / 角色 / 菜单）**一概不认**；
 * - **判不出来 = 不是 admin**（fail closed）。
 */

import { CachedCurrentUserResolver } from "../../../../core/session/identity.ts";
import type { AdminJudge, CurrentUserResolver } from "../../../../core/session/identity.ts";
import { AadminCurrentUserResolver } from "./current-user.ts";
import type { AadminClient } from "./client.ts";

/**
 * 造一个 admin 判定器（**问 AiAdmin** + **内核那层短缓存**）。
 *
 * @param resolver 问当前用户的解析器（**带缓存**的那层）。
 * @returns 判定器：token 对应的是超级管理员就 `true`。
 */
export function createAdminJudge(resolver: CurrentUserResolver): AdminJudge {
	return async (token: string): Promise<boolean> => {
		const user = await resolver.resolve(token);
		// ⚠️ **fail closed**：字段缺失 / 不是 true ⇒ 不是 admin
		return user.isSuperuser === true;
	};
}

/**
 * 造一个 admin 判定器（**自带缓存**的版本 —— 直接问 AiAdmin）。
 *
 * ⚠️ 缓存由内核的 `CachedCurrentUserResolver` 管（按 token 指纹 · 默认 5 分钟）
 *    ⇒ 同一个 token 的重复请求只打一次 AiAdmin。
 *
 * @param client AiAdmin 的 HTTP 客户端。
 */
export function createCachedAdminJudge(client: AadminClient): AdminJudge {
	return createAdminJudge(
		new CachedCurrentUserResolver(new AadminCurrentUserResolver(client)),
	);
}
