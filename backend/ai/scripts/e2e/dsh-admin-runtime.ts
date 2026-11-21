/**
 * AI 管理面（issue #124 阶段二）的**运行时验收**。
 *
 * ## 为什么要有它（阶段一留下的缺口）
 *
 * 阶段一的静态验收（`scripts/e2e/dsh-admin.static.cjs`）只能证明「**代码形状**」对：
 * 9 个既有端点没动、没有自造路由、判定器是注入的……
 *
 * ⚠️ 但它**管不了「dsh 的真实 UI 能不能穿过我们的反代」** ⇒ 阶段一只能靠人看。
 *    ⇒ 这里把「人工验」变成**入库的脚本**：
 *
 * 1. **真起一个 dsh web**（`@deepseek-ai/dsh` 的**真实二进制** ⇒ 不是假的服务）；
 * 2. **真挂我们的反代**（`core/adapter/dsh-admin/proxy.ts` 的**真实实现**）；
 * 3. 断言六件事（见下面的「验什么」）。
 *
 * ## 验什么
 *
 * | # | 断言 | 为什么 |
 * | -- | ---- | ------ |
 * | ① | **转发成功**：`/dsh-admin/` 拿到 **dsh 的 SPA HTML**（200） | 反代真能拿到 dsh 的页面（不是 404 / 502）|
 * | ② | **Host 被保留** | dsh 的栅栏会比对 authority ⇒ 改写成 127.0.0.1 ⇒ **每个 API 都 403** |
 * | ③ | **cookie 的 Path 被改写成 `/dsh-admin/`** | dsh 发的是 `Path=/` ⇒ 浏览器不会把它发回来 ⇒ 免登录失效 |
 * | ④ | **没注入判定器 ⇒ 503** | fail closed：缺安全边界 ⇒ 宁可不可用 |
 * | ⑤ | **判定器说 false ⇒ 403** | 普通用户进不去 |
 * | ⑥ | **判定器说 true ⇒ 200** | admin 进得去 |
 *
 * ## ⚠️ 怎么证明「Host 被保留」（不是嘴上说说）
 *
 * dsh 的签名 cookie 载荷里**写着它看到的 authority** ⇒ 反代把 Host 改写成
 * `127.0.0.1:<dsh 端口>` 的话，那份 cookie 里的 authority 就不是我们要的。
 *
 * ⇒ 所以这里用**一个假的 authority**（`dsh-admin.e2e.test`，**故意不是 127.0.0.1**）
 *    ① 交给 dsh 的 `--trusted-host`；② 写进我们发出的请求的 `Host` 头。
 * ⇒ dsh 认了这个 authority ⇒ **证明 Host 是一路保留到 dsh 的**。
 *
 * ⚠️ **载荷只是拿来观测的**（不参与任何权限判定）—— 判定仍然是注入的判定器说了算。
 *
 * ## 不连数据库、不连 AiAdmin
 *
 * 判定器是**假的**（恒为 true / 恒为 false / 没有）⇒ 不问权威系统 ⇒ 不连 AiAdmin。
 * 也不 import 任何连库的东西 ⇒ **不需要数据库**。
 *
 * ## 前置
 *
 * - **Node ≥ 24.9**（dsh 的 engines 要求）；
 * - 依赖装好（`cd backend/ai && npm ci` ⇒ 才有 dsh 的二进制）。
 *
 * 用法（**在仓根跑**）：`node scripts/e2e/dsh-admin-runtime.cjs`
 * （那个 .cjs 只是入口 ⇒ 真正的实现在本文件 ⇒ 走 tsx 跑我们的 TS 代码）。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
	createDshAdminProxy,
	DSH_ADMIN_MOUNT_PATH,
} from "../../src/core/adapter/dsh-admin/proxy.ts";
import { parseStartupToken } from "../../src/core/adapter/dsh-admin/instance.ts";

/** 本文件所在目录（`backend/ai/scripts/e2e`）。 */
const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓根。 */
const REPO_ROOT = resolve(HERE, "..", "..", "..");
/** 临时目录（**在 `.scratch/` 下** ⇒ gitignore 掉了 ⇒ 不会进仓）。 */
const SCRATCH_ROOT = join(REPO_ROOT, ".scratch", "dsh-admin-runtime");

const requireFromHere = createRequire(import.meta.url);

/**
 * dsh 的可执行文件（**用 SDK 自带的那份** ⇒ 版本与服务一致）。
 *
 * ⚠️ 用 `resolve()` 而不是 `require()` ⇒ dsh 边界守卫（`scripts/check-dsh-boundary.cjs`）
 *    只拦「import dsh 的包」⇒ 这里是**跑二进制**，不是把它引进服务代码。
 */
const dshBin = requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");

/**
 * **假 authority**（故意不是 127.0.0.1 ⇒ 能证明 Host 没被改写；见文件头）。
 */
const FAKE_AUTHORITY = "dsh-admin.e2e.test";

/** 判定器用的假 token（判定器是假的 ⇒ 什么值都行）。 */
const FAKE_ADMIN_TOKEN = "e2e-fake-admin-token";

/** 挂载前缀（**判定器说 false** 的那个反代）。 */
const DENY_MOUNT = "/e2e-deny";
/** 挂载前缀（**没有判定器** 的那个反代）。 */
const NO_JUDGE_MOUNT = "/e2e-nojudge";

/** dsh web 启动的上限（毫秒）。 */
const DSH_START_TIMEOUT_MS = 60_000;
/** 停 dsh web 时等 SIGTERM 的时间（毫秒）⇒ 超了就 SIGKILL。 */
const DSH_STOP_GRACE_MS = 3_000;
/** 端口冲突时重试几次（每次换一个端口）。 */
const PORT_ATTEMPTS = 3;

/** 失败信息（收集起来 ⇒ 一次性报）。 */
const failures: string[] = [];

/** 断言。 */
function check(label: string, ok: boolean, detail?: string): void {
	console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` —— ${detail}`}`);
	if (!ok) {
		failures.push(detail === undefined ? label : `${label} —— ${detail}`);
	}
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 一个 HTTP 响应（我们要看的东西）。 */
interface Probe {
	/** 状态码。 */
	status: number;
	/** 响应头。 */
	headers: IncomingHttpHeaders;
	/** 响应体（文本）。 */
	body: string;
}

/**
 * 发一个 GET。
 *
 * ⚠️ **`Host` 头自己写** ⇒ 我们要的是「浏览器看到的那个 authority」
 *    （不是 `127.0.0.1:<端口>`）—— 这正是「Host 被保留」要验的东西。
 */
function httpGet(input: {
	port: number;
	path: string;
	host: string;
	authorization?: string;
}): Promise<Probe> {
	return new Promise((resolvePromise, rejectPromise) => {
		const request = httpRequest(
			{
				host: "127.0.0.1",
				port: input.port,
				path: input.path,
				method: "GET",
				headers: {
					host: input.host,
					...(input.authorization === undefined
						? {}
						: { authorization: input.authorization }),
				},
				timeout: 30_000,
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					body += chunk;
				});
				response.on("end", () => {
					resolvePromise({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body,
					});
				});
			},
		);
		request.on("timeout", () => {
			request.destroy(new Error("请求超时"));
		});
		request.on("error", rejectPromise);
		request.end();
	});
}

/** 把一个响应压成一行（诊断用）。 */
function brief(probe: Probe): string {
	const body = probe.body.replace(/\s+/g, " ").slice(0, 160);
	return `状态 ${probe.status} · body=${body}`;
}

/**
 * 从 `set-cookie` 头里找 **dsh 的签名 cookie**（`dsh-auth-…`）。
 *
 * ⚠️ **返回整条**（带 `Path` / `HttpOnly` 等属性）⇒ 属性才是断言的对象。
 */
function dshAuthCookie(headers: IncomingHttpHeaders): string | undefined {
	const raw = headers["set-cookie"];
	const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
	for (const entry of list) {
		const pair = (entry.split(";", 1)[0] ?? "").trim();
		if (pair.startsWith("dsh-auth-")) {
			return entry.trim();
		}
	}
	return undefined;
}

/** cookie 的 `Path` 属性（没有 ⇒ `undefined`）。 */
function cookiePath(cookie: string): string | undefined {
	for (const part of cookie.split(";").slice(1)) {
		const [name, ...rest] = part.split("=");
		if (name?.trim().toLowerCase() === "path") {
			return rest.join("=").trim();
		}
	}
	return undefined;
}

/**
 * dsh 签名 cookie 载荷里的 **authority**（= dsh 看到的那个 Host）。
 *
 * ⚠️ **只是观测用的**（用来证明 Host 没被改写）⇒ **不参与任何权限判定**。
 */
function cookieAuthority(cookie: string): string | undefined {
	const value = (cookie.split(";", 1)[0] ?? "").trim();
	const payload = value.split(".")[1];
	if (payload === undefined) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
			authority?: unknown;
		};
		return typeof parsed.authority === "string" ? parsed.authority : undefined;
	} catch {
		return undefined;
	}
}

/** 找一个空闲端口（**用完就放掉** ⇒ 有点竞态 ⇒ 下面有重试）。 */
function freePort(): Promise<number> {
	return new Promise((resolvePromise, rejectPromise) => {
		const probe = createServer();
		probe.unref();
		probe.on("error", rejectPromise);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			probe.close(() => {
				resolvePromise(port);
			});
		});
	});
}

/** 一个跑着的 dsh web。 */
interface DshWeb {
	/** 子进程（收尾时要杀掉 ⇒ 别留孤儿）。 */
	child: ChildProcess;
	/** 启动 token（dsh 打印在启动 URL 里）。 */
	token: string;
	/** 监听端口。 */
	port: number;
	/** 它的输出（诊断用）。 */
	log: () => string;
}

/**
 * 起一个 dsh web（**真二进制** ⇒ 官方 `web` profile ⇒ 不需要 pnpm、不需要我们的插件）。
 *
 * @param port 监听端口（只绑 loopback）。
 * @param home 独立的 `DSH_HOME`（**别与服务的那份混**）。
 */
async function startDshWeb(port: number, home: string): Promise<DshWeb> {
	const child = spawn(
		process.execPath,
		[
			dshBin,
			"--profile",
			"web",
			"--no-open",
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--trusted-host",
			FAKE_AUTHORITY,
		],
		{
			// ⚠️ **独立的 home** ⇒ 配置文件 / 会话 / 插件目录都不与服务的混
			env: { ...process.env, DSH_HOME: home },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});

	const token = await new Promise<string>((resolvePromise, rejectPromise) => {
		const timer = setTimeout(() => {
			rejectPromise(new Error(`dsh web 启动超时（没打印启动 URL）\n${output}`));
		}, DSH_START_TIMEOUT_MS);
		const poll = setInterval(() => {
			const found = parseStartupToken(output);
			if (found !== undefined) {
				clearInterval(poll);
				clearTimeout(timer);
				resolvePromise(found);
			}
		}, 200);
		child.on("exit", (code: number | null) => {
			clearInterval(poll);
			clearTimeout(timer);
			rejectPromise(new Error(`dsh web 进程退出了（code=${code}）\n${output}`));
		});
	});

	return { child, token, port, log: () => output };
}

/** 杀掉 dsh web（SIGTERM ⇒ 等一会儿 ⇒ SIGKILL）⇒ **不留孤儿进程**。 */
async function stopDshWeb(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	await new Promise<void>((resolvePromise) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolvePromise();
		}, DSH_STOP_GRACE_MS);
		timer.unref?.();
		child.on("exit", () => {
			clearTimeout(timer);
			resolvePromise();
		});
		child.kill("SIGTERM");
	});
}

/* ------------------------------------------------------------------ *
 * 正戏
 * ------------------------------------------------------------------ */

console.log(`  dsh 二进制：${dshBin}`);
console.log(`  假 authority：${FAKE_AUTHORITY}（故意不是 127.0.0.1 ⇒ 能证明 Host 没被改写）\n`);

/** 本次的临时 home（每次跑都是新的 ⇒ 可重复跑）。 */
const dshHome = join(SCRATCH_ROOT, `home-${Date.now()}-${process.pid}`);
mkdirSync(dshHome, { recursive: true });

/** dsh web（收尾要杀）。 */
let dsh: DshWeb | undefined;
/** 我们的 Express（收尾要关）。 */
let server: ReturnType<express.Express["listen"]> | undefined;

try {
	// ---------------------------------------------------------------- *
	// ① 起 dsh web（端口冲突 ⇒ 换端口重试）
	// ---------------------------------------------------------------- *
	let lastError: unknown;
	for (let attempt = 1; attempt <= PORT_ATTEMPTS; attempt += 1) {
		const port = await freePort();
		try {
			dsh = await startDshWeb(port, dshHome);
			break;
		} catch (error) {
			lastError = error;
			console.log(`  … 第 ${attempt} 次起 dsh web 失败（换端口重试）：${describe(error)}`);
		}
	}
	if (dsh === undefined) {
		throw new Error(`起 dsh web 失败（试了 ${PORT_ATTEMPTS} 次）：${describe(lastError)}`);
	}
	console.log(`  dsh web 已起（端口 ${dsh.port}）\n`);

	// ---------------------------------------------------------------- *
	// ② 起一个最小 Express（挂**真的**反代 ⇒ 判定器是假的）
	// ---------------------------------------------------------------- *
	const app = express();
	// ⚠️ 三个挂载 ⇒ 三种判定器口径（**都不连 AiAdmin**）：
	//    · 没有判定器 ⇒ 503（fail closed）
	//    · 判定器说 false ⇒ 403
	//    · 判定器说 true ⇒ 放行（**真的那条挂载前缀**）
	app.use(
		NO_JUDGE_MOUNT,
		createDshAdminProxy({ port: dsh.port, mountPath: NO_JUDGE_MOUNT }),
	);
	app.use(
		DENY_MOUNT,
		createDshAdminProxy({
			port: dsh.port,
			mountPath: DENY_MOUNT,
			isAdmin: async () => false,
		}),
	);
	app.use(
		DSH_ADMIN_MOUNT_PATH,
		createDshAdminProxy({ port: dsh.port, isAdmin: async () => true }),
	);
	server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolvePromise) => {
		server?.once("listening", () => {
			resolvePromise();
		});
	});
	const address = server.address();
	const appPort = typeof address === "object" && address !== null ? address.port : 0;
	console.log(`  我们的反代已起（端口 ${appPort}）\n`);

	// ---------------------------------------------------------------- *
	// ③ 断言
	// ---------------------------------------------------------------- *
	console.log("① 转发成功 + 免登录（走**真的** dsh）");
	// ⚠️ 第一步：**拿启动 token 换 cookie**（走反代 ⇒ Host 一路保留到 dsh）
	//    ⇒ dsh 会回 303 + `set-cookie: dsh-auth-…; Path=/`（**Path 要被改写**）
	const exchange = await httpGet({
		port: appPort,
		path: `${DSH_ADMIN_MOUNT_PATH}/?token=${encodeURIComponent(dsh.token)}`,
		host: FAKE_AUTHORITY,
		authorization: `Bearer ${FAKE_ADMIN_TOKEN}`,
	});
	check(
		"dsh 认了我们的 authority ⇒ 303（拿 token 换 cookie 那一步）",
		exchange.status === 303,
		brief(exchange),
	);
	const authCookie = dshAuthCookie(exchange.headers);
	check("响应里有 dsh 的签名 cookie（dsh-auth-…）", authCookie !== undefined, brief(exchange));

	console.log("② Host 被保留（没被改写成 127.0.0.1）");
	const authority = authCookie === undefined ? undefined : cookieAuthority(authCookie);
	check(
		`dsh 看到的 authority 是「${FAKE_AUTHORITY}」（不是 127.0.0.1）`,
		authority === FAKE_AUTHORITY,
		`实际=${authority ?? "拿不到"}`,
	);

	console.log("③ set-cookie 的 Path 被改写成挂载前缀");
	const path = authCookie === undefined ? undefined : cookiePath(authCookie);
	check(
		`Path=${DSH_ADMIN_MOUNT_PATH}/（不是 Path=/）`,
		path === `${DSH_ADMIN_MOUNT_PATH}/`,
		`实际 Path=${path ?? "拿不到"}`,
	);

	console.log("④ 转发成功：/dsh-admin/ 拿到 dsh 的 SPA HTML");
	// ⚠️ 这一步**不带 token** ⇒ 反代用自己缓存的那份 dsh 签名 cookie（**免登录**）
	const page = await httpGet({
		port: appPort,
		path: `${DSH_ADMIN_MOUNT_PATH}/`,
		host: FAKE_AUTHORITY,
		authorization: `Bearer ${FAKE_ADMIN_TOKEN}`,
	});
	check("状态是 200", page.status === 200, brief(page));
	check("body 是 dsh 的 SPA HTML", /<!doctype html>/i.test(page.body), brief(page));
	check(
		"SPA 的 base 是相对的（./）⇒ iframe 里的资源会走 /dsh-admin/（不会白屏）",
		/<base href="\.\/"/i.test(page.body),
		brief(page),
	);

	console.log("⑤ ⚠️ fail closed：没注入判定器 ⇒ 503");
	const noJudge = await httpGet({
		port: appPort,
		path: `${NO_JUDGE_MOUNT}/`,
		host: FAKE_AUTHORITY,
		authorization: `Bearer ${FAKE_ADMIN_TOKEN}`,
	});
	check("状态是 503", noJudge.status === 503, brief(noJudge));

	console.log("⑥ 判定器说 false ⇒ 403");
	const denied = await httpGet({
		port: appPort,
		path: `${DENY_MOUNT}/`,
		host: FAKE_AUTHORITY,
		authorization: `Bearer ${FAKE_ADMIN_TOKEN}`,
	});
	check("状态是 403", denied.status === 403, brief(denied));

	console.log("⑦ 判定器说 true ⇒ 200（= ④ 那条挂载）");
	check(
		`${DSH_ADMIN_MOUNT_PATH}/ 是 200（判定器说 true ⇒ 放行）`,
		page.status === 200,
		brief(page),
	);
} catch (error) {
	failures.push(`脚本跑挂了 —— ${describe(error)}`);
	console.error(`\n❌ 脚本跑挂了：${describe(error)}`);
	if (dsh !== undefined) {
		console.error("\n--- dsh web 的输出（诊断用）---");
		console.error(dsh.log().split("\n").slice(-40).join("\n"));
	}
} finally {
	// ⚠️ **收尾**：杀掉 dsh web（别留孤儿进程）+ 关掉 Express + 清临时目录
	if (dsh !== undefined) {
		await stopDshWeb(dsh.child);
		console.log("\n（dsh web 已停）");
	}
	if (server !== undefined) {
		await new Promise<void>((resolvePromise) => {
			server?.close(() => {
				resolvePromise();
			});
		});
	}
	rmSync(dshHome, { recursive: true, force: true });
	if (existsSync(dshHome)) {
		console.warn(`⚠️ 临时目录没清掉：${dshHome}`);
	}
}

if (failures.length === 0) {
	console.log("\n✅ AI 管理面的运行时验收全过");
	process.exit(0);
}
console.error(`\n❌ AI 管理面的运行时验收失败 ${failures.length} 条：`);
for (const failure of failures) {
	console.error(`   · ${failure}`);
}
process.exit(1);

/** 异常 ⇒ 人话。 */
function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
