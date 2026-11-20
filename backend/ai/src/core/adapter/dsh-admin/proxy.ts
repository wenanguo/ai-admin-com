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
 * ## admin 判定：**问权威系统**（不是解 token 载荷）
 *
 * ⚠️ **载荷没验签** ⇒ 任何人都能伪造 `{"access":"admin"}` ⇒
 *    拿它判权限 = **权限提升**（dsh 的插件市场能装包 ⇒ 等于拿到装包权）。
 *    ⇒ 这里**不再解载荷**，判定器是**注入的**（`isAdmin`）。
 *
 * 判定器做的事：**问权威系统「你是谁」** ⇒ 判它返回的「是不是超级管理员」
 * （插件侧的映射见 `plugins/pm/adapter/aadmin/current-user.ts`；
 *  缓存由内核的 `CachedCurrentUserResolver` 管 ⇒ **iframe 的每个资源不会各打一次**）。
 *
 * ⚠️ **默认一律 fail closed**：没注入判定器 ⇒ **拒绝**（不猜、不回退到解载荷）。
 *    判定器报错（权威系统挂了 / token 无效）⇒ **同样拒绝**（502，拒的是访问）。
 */

import { Buffer } from "node:buffer";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Socket } from "node:net";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { extractBearerToken } from "../../http/auth.ts";
import { toErrorEnvelope } from "../../http/errors.ts";
import { errorBody } from "../../http/respond.ts";

/** 管理面的挂载前缀（前端 iframe 的 `src` 就是它）。 */
export const DSH_ADMIN_MOUNT_PATH = "/dsh-admin";

/** 没有 token 时的说法（401）。 */
export const DSH_ADMIN_NO_TOKEN_MESSAGE = "缺少 Authorization: Bearer <token>（AI 管理面需要登录）";

/** 不是 admin 时的说法（403）。 */
export const DSH_ADMIN_FORBIDDEN_MESSAGE = "只有管理员能访问 AI 管理面";

/** dsh 签名 cookie 的名前缀（dsh 自己发的：`dsh-auth-…`）。 */
const DSH_AUTH_COOKIE_PREFIX = "dsh-auth-";

/** 管理面 token 的**查询参数名**（`/dsh-admin/?access_token=…`）。 */
const ADMIN_TOKEN_QUERY_KEY = "access_token";

/**
 * 管理面 token 的 **cookie 名**（`admin_access_token`）。
 *
 * ⚠️ **为什么需要它**：管理面是**整页 iframe** ⇒ 浏览器发的是**导航请求**
 *    ⇒ **带不了 `Authorization` 头** ⇒ 只能靠 cookie / 查询参数。
 *
 * ⚠️ 名字里**不许有产品代号**（内核不认业务 ⇒ 见 `scripts/check-core-purity.cjs`）。
 */
const ADMIN_TOKEN_COOKIE = "admin_access_token";

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
	 * admin 判定器（**问权威系统**：token 是不是有效、是不是超级管理员）。
	 *
	 * ⚠️ **不给就一律拒绝**（fail closed）—— 本模块**不再**解 JWT 载荷
	 *    （载荷没验签 ⇒ 伪造 `{"access":"admin"}` 就能提权）。
	 *
	 * ⚠️ 判定器**报错**（权威系统挂了 / token 无效）⇒ 也拒（502 / 403）。
	 *
	 * @param token `Bearer` 后面那串（**只在内存里** ⇒ 不落盘、不进日志）。
	 * @returns 是不是超级管理员。
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
 * 找调用方的 token（**三处都认**）。
 *
 * | 来源 | 谁用 |
 * | ---- | ---- |
 * | `Authorization: Bearer <token>` | 普通请求（前端 `fetch` / `request` 带的）|
 * | `?access_token=<token>` | 手工调试 / 分享链接 |
 * | cookie `admin_access_token` | **iframe 导航**（浏览器发不了自定义头 ⇒ 只能靠 cookie）|
 *
 * @param input 请求头与 URL。
 */
export function extractAdminToken(input: {
	authorization?: string | undefined;
	url?: string | undefined;
	cookie?: string | undefined;
}): string | undefined {
	const fromHeader = extractBearerToken(input.authorization);
	if (fromHeader !== undefined) {
		return fromHeader;
	}
	const fromQuery = queryValue(input.url, ADMIN_TOKEN_QUERY_KEY);
	if (fromQuery !== undefined && fromQuery.length > 0) {
		return fromQuery;
	}
	return cookieValue(input.cookie, ADMIN_TOKEN_COOKIE);
}

/** URL 里的查询参数值。 */
function queryValue(url: string | undefined, key: string): string | undefined {
	if (url === undefined || url.length === 0) {
		return undefined;
	}
	try {
		return new URL(url, "http://localhost").searchParams.get(key) ?? undefined;
	} catch {
		return undefined;
	}
}

/** Cookie 头里某个 cookie 的值。 */
function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
	if (cookieHeader === undefined || cookieHeader.length === 0) {
		return undefined;
	}
	for (const part of cookieHeader.split(";")) {
		const trimmed = part.trim();
		if (trimmed.length === 0) {
			continue;
		}
		if (cookieName(trimmed) === name) {
			const separator = trimmed.indexOf("=");
			return separator === -1 ? "" : trimmed.slice(separator + 1).trim();
		}
	}
	return undefined;
}

/** 没注入判定器时的说法（503）。 */
export const DSH_ADMIN_NO_JUDGE_MESSAGE =
	"AI 管理面没配好（缺 admin 判定器 ⇒ 默认拒绝访问）";

/** 判定器问权威系统失败时的说法（502）。 */
export const DSH_ADMIN_JUDGE_FAILED_MESSAGE = "AI 管理面暂时不可用（问不动权威系统）";

/** 判定器说「这个 token 过期了」时的说法（401）。 */
export const DSH_ADMIN_INVALID_TOKEN_MESSAGE = "登录状态已失效（请重新登录后再试）";

/**
 * 判调用方是不是 admin。
 *
 * - 没有 token ⇒ **401**（连 dsh 都不用打）；
 * - **没注入判定器** ⇒ **503**（fail closed：宁可管理面不可用，也不放行）；
 * - 有 token 但不是 admin ⇒ **403**；
 * - 判定器**报错** ⇒ **401**（token 过期）或 **502**（权威系统挂了）⇒ **同样不放行**。
 */
async function judgeAdmin(
	token: string | undefined,
	options: DshAdminProxyOptions,
): Promise<AdminVerdict> {
	if (token === undefined || token.length === 0) {
		return { ok: false, status: 401, message: DSH_ADMIN_NO_TOKEN_MESSAGE };
	}
	// ⚠️ **fail closed**：没判定器 ⇒ 拒绝（**不许**回退到「解 token 载荷」）
	const judge = options.isAdmin;
	if (judge === undefined) {
		return { ok: false, status: 503, message: DSH_ADMIN_NO_JUDGE_MESSAGE };
	}
	let allowed: boolean;
	try {
		allowed = await judge(token);
	} catch (error) {
		// ⚠️ 判定器报错 ⇒ **拒**（不回退、不猜）
		return judgeFailure(error);
	}
	if (allowed) {
		return { ok: true };
	}
	return { ok: false, status: 403, message: DSH_ADMIN_FORBIDDEN_MESSAGE };
}

/**
 * 判定器报错 ⇒ 翻译成「拒绝」。
 *
 * ⚠️ **401** = 权威系统说这个 token 过期了；**其余**（权威系统挂了等）⇒ **502**。
 *    ⚠️ 两种都**不放行** ⇒ 判定器挂了 = 管理面不可用（不是「谁都能进」）。
 */
function judgeFailure(error: unknown): AdminVerdict {
	const { status } = toErrorEnvelope(error);
	if (status === 401) {
		return { ok: false, status: 401, message: DSH_ADMIN_INVALID_TOKEN_MESSAGE };
	}
	return { ok: false, status: 502, message: DSH_ADMIN_JUDGE_FAILED_MESSAGE };
}

/** WS 升级被拒时的 reason 短语（按状态码挑一个像样的）。 */
function wsReasonOf(status: number): string {
	switch (status) {
		case 401:
			return "Unauthorized";
		case 403:
			return "Forbidden";
		case 503:
			return "Service Unavailable";
		default:
			return "Bad Gateway";
	}
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
				const token = extractAdminToken({
					authorization: req.get("authorization"),
					url: req.originalUrl ?? req.url,
					cookie: req.headers.cookie,
				});
				const verdict = await judgeAdmin(token, options);
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
					const token = extractAdminToken({
						authorization: req.headers.authorization,
						url: req.url,
						cookie: req.headers.cookie,
					});
					const verdict = await judgeAdmin(token, options);
					if (!verdict.ok) {
						const reason = wsReasonOf(verdict.status);
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
