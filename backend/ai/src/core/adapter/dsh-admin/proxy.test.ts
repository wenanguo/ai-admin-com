/**
 * `core/adapter/dsh-admin/proxy.ts` 的单测。
 *
 * ⚠️ 这里**起一个假的 dsh**（node:http）⇒ 断言「我们转发出去的东西」长什么样：
 * 剥前缀 / Host 保留 / cookie 的 Path 改写 / 注入签名 cookie / 普通用户被拒。
 *
 * ## ⚠️ admin 判定：**问权威系统**（不是解 token 载荷）
 *
 * 载荷没验签 ⇒ 谁都能伪造 `{"access":"admin"}` ⇒ 用它判权限 = **权限提升**。
 * ⇒ 这里钉死三件事：
 *
 * 1. **伪造 `access=admin` 的载荷必须被拒**（判定器说不 ⇒ 拒）；
 * 2. **没注入判定器 ⇒ 一律拒**（fail closed；**不回退**到解载荷）；
 * 3. 判定器**报错** ⇒ 也拒（权威系统挂了 ≠ 谁都能进）。
 */

import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdapterErrorException } from "../../errors.ts";
import {
	DSH_ADMIN_MOUNT_PATH,
	DSH_ADMIN_NO_JUDGE_MESSAGE,
	createDshAdminProxy,
} from "./proxy.ts";

/** 假 dsh 收到的请求。 */
interface SeenRequest {
	/** 路径（**应当已被剥掉前缀**）。 */
	url: string;
	/** Host 头（**应当是浏览器看到的那个**）。 */
	host: string | undefined;
	/** Cookie 头。 */
	cookie: string | undefined;
}

/** dsh 的签名 cookie（用启动 token 换来的那份）。 */
const AUTH_COOKIE = "dsh-auth-session=abc123";

let seen: SeenRequest[] = [];
let dshServer: Server;
let dshPort: number;
let appServer: Server;
/** 我们的服务的 Host 头（`127.0.0.1:<端口>`，**不带 scheme**）。 */
let appHost: string;
/** 我们的服务的基址（带 scheme ⇒ 能直接喂给 `fetch`）。 */
let base: string;

/** 造一个 JWT 形状的 token（**签名是假的** ⇒ 只能当「伪造载荷」的样本）。 */
function fakeJwt(claims: Record<string, unknown>): string {
	const encode = (value: object): string =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

/** 真的 admin（判定器认它）。 */
const ADMIN_TOKEN = "token-of-a-real-admin";
/** 普通用户（判定器不认它）。 */
const USER_TOKEN = "token-of-a-normal-user";
/** ⚠️ **伪造载荷**（`access: 'admin'`）—— **必须被拒**。 */
const FORGED_ADMIN_TOKEN = fakeJwt({ access: "admin" });

/**
 * 判定器（**假权威系统**）：只有 `ADMIN_TOKEN` 是 admin。
 *
 * ⚠️ 它**只看 token 本身**（不解析载荷）⇒ 这正是真实判定器的形状
 *    （问权威系统 ⇒ 由权威系统说这个人是不是管理员）。
 */
function fakeJudge(token: string): boolean {
	return token === ADMIN_TOKEN;
}

beforeAll(async () => {
	// 假 dsh：把收到的请求记下来，并回一个 `Path=/` 的签名 cookie
	dshServer = createServer((req, res) => {
		seen.push({
			url: req.url ?? "",
			host: req.headers.host,
			cookie: req.headers.cookie,
		});
		res.setHeader("set-cookie", [
			"dsh-auth-session=abc123; Path=/; HttpOnly; SameSite=Strict",
		]);
		res.setHeader("content-type", "application/json");
		res.statusCode = 200;
		res.end(JSON.stringify({ ok: true, path: req.url ?? "" }));
	});
	dshServer.listen(0);
	await new Promise<void>((resolve) => dshServer.once("listening", () => resolve()));
	dshPort = (dshServer.address() as AddressInfo).port;

	// 我们的服务：⚠️ **Express 自己剥前缀**（`app.use('/dsh-admin', proxy)`）
	const app = express();
	app.use(
		DSH_ADMIN_MOUNT_PATH,
		createDshAdminProxy({
			port: dshPort,
			authCookie: AUTH_COOKIE,
			isAdmin: async (token) => fakeJudge(token),
		}),
	);
	appServer = app.listen(0);
	await new Promise<void>((resolve) => appServer.once("listening", () => resolve()));
	appHost = `127.0.0.1:${(appServer.address() as AddressInfo).port}`;
	base = `http://${appHost}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => appServer.close(() => resolve()));
	await new Promise<void>((resolve) => dshServer.close(() => resolve()));
});

beforeEach(() => {
	seen = [];
});

describe("dsh 管理面的反代", () => {
	it("剥前缀：/dsh-admin/foo ⇒ 转发出去是 /foo", async () => {
		const response = await fetch(`${base}/dsh-admin/foo?a=1`, {
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(200);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.url).toBe("/foo?a=1");
	});

	it("Host 保留：转发出去的 Host 是浏览器看到的那个（不是 127.0.0.1:dsh 端口）", async () => {
		await fetch(`${base}/dsh-admin/`, {
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(seen[0]?.host).toBe(appHost);
		expect(seen[0]?.host).not.toBe(`127.0.0.1:${dshPort}`);
	});

	it("cookie 的 Path 改写成挂载前缀（Path=/ ⇒ Path=/dsh-admin/）", async () => {
		const response = await fetch(`${base}/dsh-admin/`, {
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		const setCookie = response.headers.getSetCookie().join(" | ");
		expect(setCookie).toContain("Path=/dsh-admin/");
		expect(setCookie).not.toContain("Path=/;");
	});

	it("免登录：转发请求带上了 dsh 的签名 cookie", async () => {
		await fetch(`${base}/dsh-admin/`, {
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(seen[0]?.cookie).toContain(AUTH_COOKIE);
	});

	it("普通用户 ⇒ 403（而且根本没转发出去）", async () => {
		const response = await fetch(`${base}/dsh-admin/`, {
			headers: { authorization: `Bearer ${USER_TOKEN}` },
		});
		expect(response.status).toBe(403);
		expect(seen).toHaveLength(0);
	});

	it("没有 token ⇒ 401", async () => {
		const response = await fetch(`${base}/dsh-admin/`);
		expect(response.status).toBe(401);
		expect(seen).toHaveLength(0);
	});

	it("**iframe 导航**（带不了 Authorization 头）⇒ 认 cookie 里的 token", async () => {
		const response = await fetch(`${base}/dsh-admin/`, {
			headers: { cookie: `admin_access_token=${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(200);
		expect(seen).toHaveLength(1);
	});

	it("认查询参数里的 token（`?access_token=…`）", async () => {
		const response = await fetch(
			`${base}/dsh-admin/?access_token=${encodeURIComponent(ADMIN_TOKEN)}`,
		);
		expect(response.status).toBe(200);
		expect(seen).toHaveLength(1);
	});

	it("admin ⇒ 放行（响应体原样透传）", async () => {
		const response = await fetch(`${base}/dsh-admin/`, {
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as { ok?: boolean; path?: string };
		expect(payload.ok).toBe(true);
		expect(payload.path).toBe("/");
	});

	it("抓到 dsh 发的签名 cookie ⇒ 回调给上层（换缓存用）", async () => {
		const grabbed: string[] = [];
		const app = express();
		app.use(
			DSH_ADMIN_MOUNT_PATH,
			createDshAdminProxy({
				port: dshPort,
				authCookie: AUTH_COOKIE,
				isAdmin: async (token) => fakeJudge(token),
				onAuthCookie: (cookie) => grabbed.push(cookie),
			}),
		);
		const server = app.listen(0);
		await new Promise<void>((resolve) => server.once("listening", () => resolve()));
		const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

		await fetch(`${host}/dsh-admin/`, {
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		});

		expect(grabbed).toContain(AUTH_COOKIE);
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
});

describe("⚠️ admin 判定：**伪造载荷提不了权**", () => {
	it("**伪造 `access: 'admin'` 的载荷 ⇒ 403**（判不出来就不是 admin）", async () => {
		const response = await fetch(`${base}/dsh-admin/`, {
			headers: { authorization: `Bearer ${FORGED_ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(403);
		// ⚠️ **根本没转发出去**（连 dsh 都没碰到）
		expect(seen).toHaveLength(0);
	});

	it("**伪造 `is_superuser: true` 的载荷 ⇒ 403**（同上）", async () => {
		const forged = fakeJwt({ is_superuser: true, id: 1 });
		const response = await fetch(`${base}/dsh-admin/`, {
			headers: { authorization: `Bearer ${forged}` },
		});
		expect(response.status).toBe(403);
		expect(seen).toHaveLength(0);
	});

	it("**伪造载荷放在 cookie 里也一样被拒**（iframe 那条路也不能绕）", async () => {
		const response = await fetch(`${base}/dsh-admin/`, {
			headers: { cookie: `admin_access_token=${FORGED_ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(403);
		expect(seen).toHaveLength(0);
	});

	it("**伪造载荷放在查询参数里也一样被拒**", async () => {
		const response = await fetch(
			`${base}/dsh-admin/?access_token=${encodeURIComponent(FORGED_ADMIN_TOKEN)}`,
		);
		expect(response.status).toBe(403);
		expect(seen).toHaveLength(0);
	});
});

describe("⚠️ admin 判定：**默认 fail closed**", () => {
	/** 造一个**没注入判定器**的服务。 */
	async function startWithoutJudge(): Promise<string> {
		const app = express();
		app.use(
			DSH_ADMIN_MOUNT_PATH,
			createDshAdminProxy({ port: dshPort, authCookie: AUTH_COOKIE }),
		);
		const server = app.listen(0);
		await new Promise<void>((resolve) => server.once("listening", () => resolve()));
		const address = server.address() as AddressInfo;
		// ⚠️ 用完就关（不留端口）
		server.unref();
		return `http://127.0.0.1:${address.port}`;
	}

	it("**没注入判定器 ⇒ 拒**（不是 200；缺省就是关着）", async () => {
		const host = await startWithoutJudge();
		const response = await fetch(`${host}/dsh-admin/`, {
			headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(503);
		const body = (await response.json()) as { msg?: string };
		expect(body.msg).toBe(DSH_ADMIN_NO_JUDGE_MESSAGE);
	});

	it("**没注入判定器 ⇒ 连伪造载荷也进不去**（fail closed 没有例外）", async () => {
		const host = await startWithoutJudge();
		const response = await fetch(`${host}/dsh-admin/`, {
			headers: { authorization: `Bearer ${FORGED_ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(503);
	});
});

describe("⚠️ 判定器报错 ⇒ 拒（权威系统挂了 ≠ 谁都能进）", () => {
	it("判定器抛错 ⇒ 502（不放行）", async () => {
		const app = express();
		app.use(
			DSH_ADMIN_MOUNT_PATH,
			createDshAdminProxy({
				port: dshPort,
				authCookie: AUTH_COOKIE,
				isAdmin: async () => {
					throw new Error("权威系统挂了");
				},
			}),
		);
		const server = app.listen(0);
		await new Promise<void>((resolve) => server.once("listening", () => resolve()));
		const address = server.address() as AddressInfo;
		try {
			const response = await fetch(`http://127.0.0.1:${address.port}/dsh-admin/`, {
				headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
			});
			expect(response.status).toBe(502);
			expect(seen).toHaveLength(0);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("判定器说「token 过期了」（AUTH_EXPIRED）⇒ 401", async () => {
		const app = express();
		app.use(
			DSH_ADMIN_MOUNT_PATH,
			createDshAdminProxy({
				port: dshPort,
				authCookie: AUTH_COOKIE,
				isAdmin: async () => {
					throw new AdapterErrorException("AUTH_EXPIRED", "凭证已失效");
				},
			}),
		);
		const server = app.listen(0);
		await new Promise<void>((resolve) => server.once("listening", () => resolve()));
		const address = server.address() as AddressInfo;
		try {
			const response = await fetch(`http://127.0.0.1:${address.port}/dsh-admin/`, {
				headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
			});
			expect(response.status).toBe(401);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
