/**
 * `core/adapter/dsh-admin/proxy.ts` 的单测。
 *
 * ⚠️ 这里**起一个假的 dsh**（node:http）⇒ 断言「我们转发出去的东西」长什么样：
 * 剥前缀 / Host 保留 / cookie 的 Path 改写 / 注入签名 cookie / 普通用户被拒。
 */

import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DSH_ADMIN_MOUNT_PATH, createDshAdminProxy } from "./proxy.ts";

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

/** 造一个 JWT 形状的 token（**只验载荷**，签名是假的 ⇒ 测试够用）。 */
function fakeJwt(claims: Record<string, unknown>): string {
	const encode = (value: object): string =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

const ADMIN_TOKEN = fakeJwt({ access: "admin" });
const USER_TOKEN = fakeJwt({ access: "user" });

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
		createDshAdminProxy({ port: dshPort, authCookie: AUTH_COOKIE }),
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
			headers: { cookie: `aipm_admin=${ADMIN_TOKEN}` },
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
