/**
 * dsh 管理面的**反代**（我们的 Express ⇄ loopback 上的 dsh web）。
 *
 * ## 它解决什么
 *
 * dsh 自带一整套 Web UI（插件市场 / 技能 / MCP 管理）⇒ 我们**不造**管理界面，
 * 只在 admin 页里用一个 iframe 嵌它（口径见 `docs/pm/tasks/124-ai-管理面.md`）。
 * ⇒ 需要一条**反代**：浏览器打 `/dsh-admin/**` ⇒ 转发给 dsh web。
 *
 * ## 五个硬要求（都来自 dsh 官方的「公网部署」要求）
 *
 * | 要求 | 怎么做 |
 * | ---- | ------ |
 * | **只允许 admin** | 判定放在**进代理之前** ⇒ 普通用户 **403**（不是 404 ⇒ 不泄露存在性）|
 * | **剥前缀** | 用 `app.use('/dsh-admin', proxy)` ⇒ **Express 自己剥** ⇒ 代理里**不改路径** |
 * | **保留 Host** | `changeOrigin: false` ⇒ 不改写成 127.0.0.1（dsh 的栅栏会比对 authority）|
 * | **改 cookie 的 Path** | `cookiePathRewrite: '/dsh-admin/'`（dsh 发的是 `Path=/`）|
 * | **转发 WS 升级** | `ws: true` + 暴露 `upgrade`（接线时 `server.on('upgrade', …)`）|
 *
 * ## 免登录
 *
 * dsh 启动时会打印 `?token=…` ⇒ 拿它换一份**签名 cookie**（`dsh-auth-…`），
 * 缓存在内存里 ⇒ 每个转发请求都**追加**这份 cookie ⇒ 浏览器完全不用知道 token。
 *
 * ⚠️ token 与 cookie **只在内存里**（不落盘、不进日志）——同 `core/audit/audit-redact.ts` 的口径。
 *
 * ## ⚠️ admin 判定的口径（**不是**安全边界）
 *
 * 缺省口径 = **解 JWT 载荷**看 `access === 'admin'`
 * （与前端 `access.ts` / mock 的 `currentUser.access === 'admin'` 同一套）。
 * ⚠️ **不验签** ⇒ 它挡得住「普通用户」，挡不住「伪造载荷的人」。
 * ⇒ 要更严就注入 `isAdmin`（去 AiAdmin 问 currentUser）——本模块留了这个口子。
 */

import { Buffer } from "node:buffer";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Socket } from "node:net";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { extractBearerToken } from "../../http/auth.ts";
import { errorBody } from "../../http/respond.ts";

/** 管理面的挂载前缀（前端 iframe 的 `src` 就是它）。 */
export const DSH_ADMIN_MOUNT_PATH = "/dsh-admin";

/** 没有 token 时的说法（401）。 */
export const DSH_ADMIN_NO_TOKEN_MESSAGE = "缺少 Authorization: Bearer <token>（AI 管理面需要登录）";

/** 不是 admin 时的说法（403）。 */
export const DSH_ADMIN_FORBIDDEN_MESSAGE = "只有管理员能访问 AI 管理面";

/** dsh 签名 cookie 的名前缀（dsh 自己发的：`dsh-auth-…`）。 */
const DSH_AUTH_COOKIE_PREFIX = "dsh-auth-";

/** dsh web 挂了时的说法（502）。 */
const DSH_ADMIN_UNAVAILABLE_MESSAGE = "AI 管理面暂时不可用（dsh web 没起来？）";

/**
 * 造反代的选项。
 *
 * ⚠️ `port` 与 `authCookie` 是**必填/常用**的两项；其余都有合理缺省。
 */
export interface DshAdminProxyOptions {
	/**
	 * dsh web 监听的端口（**只绑 loopback** ⇒ 这里也只连 127.0.0.1）。
	 */
	port: number;
	/**
	 * dsh 的**签名 cookie**（免登录用；用启动 token 换来的那份）。
	 *
	 * ⚠️ 只在内存里 ⇒ 不落盘、不进日志。
	 * ⚠️ 可以给一个**取值的函数** ⇒ dsh 重启换了 cookie 时能立刻用上新的。
	 */
	authCookie?: string | (() => string | undefined);
	/**
	 * 挂载前缀（缺省 `/dsh-admin`）⇒ 决定 cookie 的 `Path` 改写成什么。
	 */
	mountPath?: string;
	/**
	 * admin 判定（缺省 = 解 JWT 载荷看 `access === 'admin'`）。
	 *
	 * ⚠️ 可以注入成「去 AiAdmin 问 currentUser」⇒ 那才是**权威**判定。
	 */
	isAdmin?: (token: string) => boolean | Promise<boolean>;
	/**
	 * 抓到**新的** dsh 签名 cookie 时的回调（给 `instance.ts` 换缓存用）。
	 */
	onAuthCookie?: (cookie: string) => void;
}

/**
 * 反代中间件（Express 的 `RequestHandler` + 一个 `upgrade` 入口）。
 *
 * ⚠️ `upgrade` 是给 **WebSocket** 用的：`app.use()` **不拦**升级请求
 * ⇒ 接线时要 `server.on('upgrade', handler.upgrade)`。
 */
export interface DshAdminProxyHandler extends RequestHandler {
	upgrade: (req: IncomingMessage, socket: Socket, head: Buffer) => void;
}

/** admin 判定的结果。 */
type AdminVerdict = { ok: true } | { ok: false; status: number; message: string };

/**
 * 解 JWT 的**载荷**（不验签）。
 *
 * ⚠️ 只用于「是不是 admin」这个**提示性**判定 ⇒ 真正的边界应注入 `isAdmin`。
 *
 * @param token `Bearer` 后面那串。
 * @returns 载荷；不是 JWT / 解不开 ⇒ `undefined`。
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length < 2) {
		return undefined;
	}
	try {
		const json = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
		const claims: unknown = JSON.parse(json);
		if (typeof claims !== "object" || claims === null) {
			return undefined;
		}
		return claims as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/**
 * 缺省的 admin 判定：**载荷里**是不是 admin。
 *
 * 认两个口径（前端两处都在用）：
 *
 * - `access === 'admin'`（mock 的 `currentUser.access`）；
 * - `is_superuser === true`（真后端 `access.ts` 的 `canAdmin`）。
 *
 * @param token `Bearer` 后面那串。
 */
export function defaultIsAdmin(token: string): boolean {
	const claims = decodeJwtClaims(token);
	if (claims === undefined) {
		return false;
	}
	if (claims["access"] === "admin") {
		return true;
	}
	return claims["is_superuser"] === true;
}

/**
 * 判调用方是不是 admin。
 *
 * - 没有 token ⇒ **401**（连 dsh 都不用打）；
 * - 有 token 但不是 admin ⇒ **403**。
 */
async function judgeAdmin(
	authorization: string | undefined,
	options: DshAdminProxyOptions,
): Promise<AdminVerdict> {
	const token = extractBearerToken(authorization);
	if (token === undefined) {
		return { ok: false, status: 401, message: DSH_ADMIN_NO_TOKEN_MESSAGE };
	}
	const isAdmin = options.isAdmin ?? defaultIsAdmin;
	const allowed = await isAdmin(token);
	if (allowed) {
		return { ok: true };
	}
	return { ok: false, status: 403, message: DSH_ADMIN_FORBIDDEN_MESSAGE };
}

/** cookie 对里 `name=value` 的 name。 */
function cookieName(pair: string): string {
	const separator = pair.indexOf("=");
	return (separator === -1 ? pair : pair.slice(0, separator)).trim();
}

/**
 * 把 dsh 的签名 cookie **追加**到转发请求的 `Cookie` 头。
 *
 * ⚠️ 同名的先去掉 ⇒ 不会出现两个 `dsh-auth-…`（浏览器那份同名时以**我们这份**为准）。
 */
function injectAuthCookie(proxyReq: ClientRequest, authCookie: string): void {
	const cookie = authCookie.trim();
	if (cookie.length === 0) {
		return;
	}
	const existing = proxyReq.getHeader("cookie");
	const raw = Array.isArray(existing)
		? existing.join("; ")
		: typeof existing === "string"
			? existing
			: "";
	const name = cookieName(cookie);
	const kept = raw
		.split(";")
		.map((part) => part.trim())
		.filter((part) => part.length > 0 && cookieName(part) !== name);
	proxyReq.setHeader("cookie", [...kept, cookie].join("; "));
}

/**
 * 从 dsh 的响应里**抓**签名 cookie（`set-cookie: dsh-auth-…`）。
 *
 * ⚠️ 只留 `name=value`（属性丢掉）⇒ 追加到请求头时干净。
 */
function captureAuthCookie(
	proxyRes: IncomingMessage,
	onCookie: (cookie: string) => void,
): void {
	const raw = proxyRes.headers["set-cookie"];
	const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
	for (const entry of list) {
		const pair = (entry.split(";", 1)[0] ?? "").trim();
		if (pair.length === 0) {
			continue;
		}
		if (cookieName(pair).startsWith(DSH_AUTH_COOKIE_PREFIX)) {
			onCookie(pair);
		}
	}
}

/**
 * 剥掉挂载前缀（**只给 WS 升级用**）。
 *
 * ⚠️ HTTP 请求由 Express 挂载时剥（`app.use('/dsh-admin', proxy)`）；
 * WS 升级**不走** Express 挂载 ⇒ 这里自己剥。
 */
function stripMountPath(url: string, mountPath: string): string {
	if (url === mountPath) {
		return "/";
	}
	if (url.startsWith(`${mountPath}/`)) {
		return url.slice(mountPath.length);
	}
	return url;
}

/**
 * 造 dsh 管理面的反代中间件。
 *
 * ⚠️ **自己不会剥前缀** ⇒ 挂载时要用 `app.use('/dsh-admin', proxy)`
 *    （Express 会先剥掉前缀 ⇒ 代理收到的路径已是 `/…`）。
 *
 * @param options 选项（见 `DshAdminProxyOptions`）。
 */
export function createDshAdminProxy(options: DshAdminProxyOptions): DshAdminProxyHandler {
	const mountPath = options.mountPath ?? DSH_ADMIN_MOUNT_PATH;
	// ⚠️ 缓存里的签名 cookie（只在内存里）⇒ 抓到新的就换掉
	let cachedCookie = typeof options.authCookie === "string" ? options.authCookie : "";
	/** 取当前的签名 cookie（给了函数就**每次问它** ⇒ 上层换了立刻生效）。 */
	const readCookie = (): string => {
		if (typeof options.authCookie === "function") {
			return options.authCookie() ?? "";
		}
		return cachedCookie;
	};

	const proxy = createProxyMiddleware<IncomingMessage, Response>({
		target: `http://127.0.0.1:${options.port}`,
		// ⚠️ **保留 Host**（缺省就是 false）⇒ 改写成 127.0.0.1 会被 dsh 的栅栏拒
		changeOrigin: false,
		// dsh 的实时通道
		ws: true,
		// dsh 发的 `Path=/` ⇒ 改成挂载前缀（浏览器才会把它发回来）
		cookiePathRewrite: `${mountPath}/`,
		on: {
			// ⚠️ 免登录：把 dsh 的签名 cookie 追加进去
			proxyReq: (proxyReq) => {
				injectAuthCookie(proxyReq, readCookie());
			},
			proxyReqWs: (proxyReq) => {
				injectAuthCookie(proxyReq, readCookie());
			},
			// 抓 dsh 发的签名 cookie ⇒ 存起来（给下一批请求用）
			proxyRes: (proxyRes) => {
				captureAuthCookie(proxyRes, (cookie) => {
					cachedCookie = cookie;
					options.onAuthCookie?.(cookie);
				});
			},
			error: (_error, _req, res) => {
				if (res instanceof Socket) {
					res.destroy();
					return;
				}
				if (!res.headersSent) {
					res.status(502).json(errorBody(502, DSH_ADMIN_UNAVAILABLE_MESSAGE));
				}
			},
		},
	});

	const handler = Object.assign(
		function dshAdminProxy(req: Request, res: Response, next: NextFunction): void {
			void (async () => {
				// ⚠️ **判定在进代理之前** ⇒ 普通用户根本不会打到 dsh
				const verdict = await judgeAdmin(req.get("authorization"), options);
				if (!verdict.ok) {
					res.status(verdict.status).json(errorBody(verdict.status, verdict.message));
					return;
				}
				await proxy(req, res, next);
			})().catch((error: unknown) => {
				next(error);
			});
		},
		{
			upgrade: (req: IncomingMessage, socket: Socket, head: Buffer): void => {
				void (async () => {
					const verdict = await judgeAdmin(req.headers.authorization, options);
					if (!verdict.ok) {
						const reason = verdict.status === 401 ? "Unauthorized" : "Forbidden";
						socket.write(`HTTP/1.1 ${verdict.status} ${reason}\r\n\r\n`);
						socket.destroy();
						return;
					}
					// ⚠️ WS 升级不走 Express 挂载 ⇒ 前缀不会被剥 ⇒ 这里自己剥
					req.url = stripMountPath(req.url ?? "/", mountPath);
					proxy.upgrade(req, socket, head);
				})().catch(() => {
					socket.destroy();
				});
			},
		},
	);

	return handler;
}
