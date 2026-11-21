/**
 * `plugins/pm/adapter/aadmin/admin-judge.ts` 的单测。
 *
 * ## 钉住的三件事
 *
 * 1. **只认 `is_superuser === true`**（真后端的字段名）；
 * 2. **判不出来 = 不是 admin**（fail closed：字段缺失 / 别的值都不算）；
 * 3. **带缓存** ⇒ 同一个 token 的重复判定只问一次 AiAdmin
 *    （管理面是整页 iframe ⇒ 几十个资源 ⇒ 不缓存就是几十次问权威系统）。
 *
 * ⚠️ **最要紧的一条**：**伪造 `access=admin` 的载荷提不了权** ——
 *    判定器**根本不解析载荷**（载荷没验签 ⇒ 伪造即提权）。
 */

import { describe, expect, it } from "vitest";
import { AadminClient } from "./client.ts";
import { createAdminJudge } from "./admin-judge.ts";
import { AadminCurrentUserResolver } from "./current-user.ts";
import { CachedCurrentUserResolver } from "../../../../core/session/identity.ts";

/** 线上 base（含 `/api/v1`），与 env.AIADMIN_BASE_URL 同形。 */
const BASE_URL = "https://www.pmdict.cn/api/v1";

/** 假 token（只允许出现在请求头里）。 */
const TOKEN = "test-token-must-not-leak";

interface FetchCall {
	url: string;
	init: RequestInit;
}

/** 造一个按队列吐响应的假 fetch，并记录每一次调用。 */
function makeClient(responses: Array<Response | Error>): {
	client: AadminClient;
	calls: FetchCall[];
} {
	const calls: FetchCall[] = [];
	let index = 0;

	const fetchImpl: typeof fetch = async (input, init) => {
		calls.push({ url: String(input), init: init ?? {} });
		const next = responses[index];
		index += 1;
		if (next === undefined) {
			throw new Error("客户端多发了一次请求（响应队列已空）");
		}
		if (next instanceof Error) {
			throw next;
		}
		return next;
	};

	return { client: new AadminClient({ baseUrl: BASE_URL, fetchImpl }), calls };
}

/** 造一个 JSON 信封响应（`data` 是当前用户信息）。 */
function userResponse(data: unknown): Response {
	return new Response(JSON.stringify({ code: 0, msg: "成功", data }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * 造一个**带缓存**的判定器（**插件侧就是这么装的**）：
 * 内核的 `CachedCurrentUserResolver` 套在解析器外面。
 */
function cachedJudge(client: AadminClient) {
	return createAdminJudge(
		new CachedCurrentUserResolver(new AadminCurrentUserResolver(client)),
	);
}

describe("admin 判定（问 AiAdmin）", () => {
	it("`is_superuser: true` ⇒ 是 admin", async () => {
		const judge = createAdminJudge({
			resolve: async () => ({ id: 1, isSuperuser: true }),
		});
		expect(await judge(TOKEN)).toBe(true);
	});

	it("`is_superuser: false` ⇒ 不是 admin", async () => {
		const judge = createAdminJudge({
			resolve: async () => ({ id: 2, isSuperuser: false }),
		});
		expect(await judge(TOKEN)).toBe(false);
	});

	it("⚠️ **字段缺失 ⇒ 不是 admin**（fail closed：判不出来 = 不是）", async () => {
		const judge = createAdminJudge({
			resolve: async () => ({ id: 3 }),
		});
		expect(await judge(TOKEN)).toBe(false);
	});

	it("⚠️ **伪造 `access=admin` 的载荷提不了权**（判定器不解析载荷）", async () => {
		// 载荷长这样（伪造的人自己编的）⇒ 但判定器**只问权威系统**
		const forgedPayload = Buffer.from(JSON.stringify({ access: "admin" })).toString("base64url");
		const forgedToken = `header.${forgedPayload}.signature`;

		const { client, calls } = makeClient([
			// 权威系统的回答：这个 token 对应的是**普通用户**
			userResponse({ id: 4, username: "mallory", is_superuser: false }),
		]);
		const judge = cachedJudge(client);

		expect(await judge(forgedToken)).toBe(false);
		// ⚠️ **真的去问了 AiAdmin**（不是靠载荷判的）
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toContain("/system/user/current/info");
	});

	it("⚠️ **同一个 token 的重复判定只问一次 AiAdmin**（缓存 ⇒ iframe 不刷爆上游）", async () => {
		const { client, calls } = makeClient([userResponse({ id: 5, is_superuser: true })]);
		const judge = cachedJudge(client);

		expect(await judge(TOKEN)).toBe(true);
		expect(await judge(TOKEN)).toBe(true);
		expect(await judge(TOKEN)).toBe(true);

		// ⚠️ **只打了一次**（缓存生效）
		expect(calls).toHaveLength(1);
	});

	it("**不同的 token 各问一次**（缓存按 token 隔离 ⇒ 不会串号）", async () => {
		const { client, calls } = makeClient([
			userResponse({ id: 6, is_superuser: true }),
			userResponse({ id: 7, is_superuser: false }),
		]);
		const judge = cachedJudge(client);

		expect(await judge("token-a")).toBe(true);
		expect(await judge("token-b")).toBe(false);
		expect(calls).toHaveLength(2);
	});

	it("**权威系统说 token 过期 ⇒ 判定器抛错**（上层据此拒）", async () => {
		const { client } = makeClient([
			new Response(JSON.stringify({ code: 401, msg: "认证已失效", data: null }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			}),
		]);
		const judge = cachedJudge(client);
		await expect(judge(TOKEN)).rejects.toThrow();
	});
});

describe("admin 判定 · 后端字段映射", () => {
	it("**真后端的 `is_superuser` ⇒ `isSuperuser`**（字段名对得上）", async () => {
		const { client } = makeClient([userResponse({ id: 8, is_superuser: true })]);
		const resolver = new AadminCurrentUserResolver(client);
		const user = await resolver.resolve(TOKEN);
		expect(user.isSuperuser).toBe(true);
	});

	it("**`is_superuser: false` ⇒ 字段不带 `isSuperuser`**（缺省 = 不是 admin）", async () => {
		const { client } = makeClient([userResponse({ id: 9, is_superuser: false })]);
		const resolver = new AadminCurrentUserResolver(client);
		const user = await resolver.resolve(TOKEN);
		expect(user.isSuperuser).toBeUndefined();
	});

	it("**也认驼峰写法 `isSuperuser`**（AiAdmin 实际返回的字段名兼容）", async () => {
		const { client } = makeClient([userResponse({ id: 10, isSuperuser: true })]);
		const resolver = new AadminCurrentUserResolver(client);
		const user = await resolver.resolve(TOKEN);
		expect(user.isSuperuser).toBe(true);
	});
});
