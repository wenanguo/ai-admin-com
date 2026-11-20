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

import type { AdminJudge, CurrentUserResolver } from "../../../../core/session/identity.ts";

/**
 * 造一个 admin 判定器（**问 AiAdmin**）。
 *
 * ⚠️ **缓存不在这里** —— 要带缓存就把内核的 `CachedCurrentUserResolver` 套在外面
 *    （插件侧 `index.ts` 就是这么装的 ⇒ 「当前用户」与「admin 判定」**共用一份缓存**）
 *    ⇒ 同一个 token 只问一次 AiAdmin（管理面是整页 iframe ⇒ 几十个资源）。
 *
 * @param resolver 问当前用户的解析器。
 * @returns 判定器：token 对应的是超级管理员就 `true`。
 */
export function createAdminJudge(resolver: CurrentUserResolver): AdminJudge {
	return async (token: string): Promise<boolean> => {
		const user = await resolver.resolve(token);
		// ⚠️ **fail closed**：字段缺失 / 不是 true ⇒ 不是 admin
		return user.isSuperuser === true;
	};
}
