/**
 * AI 管理面「**浏览器这一层**」的运行时验收（issue #181）。
 *
 * ## 它补的是哪个缺口
 *
 * issue #124 已经有**运行时验收**（[`dsh-admin-runtime.ts`](./dsh-admin-runtime.ts)）：
 * 真起 dsh web + 真挂我们的反代 ⇒ 验「反代这一层」能不能把 dsh 的 UI 送出来。
 *
 * ⚠️ 但**浏览器这一层**没人验过：
 * 前端的 dev 代理（`frontend/config/proxy.ts`）与 nginx 模板
 * （`docker/web/templates/default.conf.template`）**都没有 `/dsh-admin/`**
 * ⇒ 页面与菜单都在、后端那条反代也在 ⇒ **iframe 就是打不通**（空白 / 落到 SPA fallback）。
 *
 * ⇒ 这里把「浏览器这一层」也变成**入库的脚本**：
 *
 * ```
 *   浏览器 ──▶ ① 前端 dev 代理（**真的那条规则**）──▶ ② AI 服务（**真的反代**）──▶ ③ dsh web（**真二进制**）
 * ```
 *
 * ## 验什么
 *
 * | # | 断言 | 为什么 |
 * | -- | ---- | ------ |
 * | ① | **静态**：nginx 模板有 `location /dsh-admin`（`proxy_pass` **不带 URI 部分** · 保留 Host · WS 头）| 生产环境那一道门 |
 * | ② | **静态**：nginx 主配置有 `map $http_upgrade $connection_upgrade` | WS 升级要它（否则实时通道不通）|
 * | ③ | **静态**：前端 dev 段有 `/dsh-admin` 规则（target 指向 AI 服务 · **不剥前缀** · **保留 Host** · 转 WS）| 浏览器这一层的第一道门 |
 * | ④ | **静态**：前端规则与 nginx 的前缀**一致**（都是 `/dsh-admin`）| 两边漂了就有一边打不通 |
 * | ⑤ | **静态**：`frontend/` 下**只**改了 `config/proxy.ts` | issue 的硬要求：前端除代理配置外 0 业务改动 |
 * | ⑥ | **运行时**：**冷启动**（浏览器第一次加载 iframe · **没有** dsh 的 cookie）也能拿到 **dsh 的 SPA HTML**（200）| 真起 dsh web ⇒ 不是假的服务；免登录靠服务启动时换好的签名 cookie |
 * | ⑦ | **运行时**：**Host 一路保留**到 dsh（cookie 载荷里的 authority 是我们给的那个）| dsh 的栅栏会比对 authority ⇒ 改写 ⇒ 每个 API 都 403 |
 * | ⑧ | **运行时**：cookie 的 `Path` 仍是 `/dsh-admin/` | iframe 的 cookie 作用域（免登录靠它）|
 * | ⑨ | **运行时**：**非管理员 ⇒ 403** | 普通用户进不去 |
 * | ⑩ | **运行时**：**没注入判定器 ⇒ 503**（fail closed）| 缺安全边界 ⇒ 宁可不可用 |
 *
 * ## ⚠️ 不连数据库、不连 AiAdmin
 *
 * 判定器是**假的**（认一个固定 token / 干脆没有）⇒ 不问权威系统 ⇒ 不连 AiAdmin。
 * ⇒ CI 里能跑。
 *
 * ## 前置
 *
 * - **Node ≥ 24.9**（dsh 的 engines 要求）；
 * - 依赖装好（`cd backend/ai && npm ci` ⇒ 才有 dsh 的二进制）。
 *
 * 用法（**在仓根跑**）：`node scripts/e2e/dsh-admin-proxy-chain.cjs`
 * （那个 .cjs 只是入口 ⇒ 真正的实现在本文件 ⇒ 走 tsx 跑我们的 TS 代码）。
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import {
	createDshAdminProxy,
	DSH_ADMIN_MOUNT_PATH,
} from "../../src/core/adapter/dsh-admin/proxy.ts";
import {
	exchangeTokenForCookie,
	parseStartupToken,
} from "../../src/core/adapter/dsh-admin/instance.ts";

/** 本文件所在目录（`backend/ai/scripts/e2e`）。 */
const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓根（`backend/ai/scripts/e2e` 往上四层）。 */
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
/** 临时目录（**在 `.scratch/` 下** ⇒ gitignore 掉了 ⇒ 不会进仓）。 */
const SCRATCH_ROOT = join(REPO_ROOT, ".scratch", "dsh-admin-proxy-chain");

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

/** 判定器认的那个 token（= 管理员）。 */
const ADMIN_TOKEN = "e2e-fake-admin-token";
/** 判定器不认的那个 token（= 普通用户）。 */
const USER_TOKEN = "e2e-fake-user-token";

/**
 * 「**没注入判定器**」那条挂载的前缀。
 *
 * ⚠️ **不能叫 `/dsh-admin-xxx`** ⇒ 代理是**前缀匹配** ⇒ `/dsh-admin` 那条会先命中
 *    ⇒ 永远测不到「没判定器」那一条 ⇒ 名字必须与 `/dsh-admin` **不成前缀关系**。
 */
const NO_JUDGE_MOUNT = "/dsh-nojudge";

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
 * 静态断言（配置形状）
 * ------------------------------------------------------------------ */

/** 前端那条代理规则（**只取我们关心的字段**）。 */
interface FrontendRule {
	target: string;
	changeOrigin: boolean;
	pathRewrite?: Record<string, string> | undefined;
	ws?: boolean | undefined;
}

/** 前端 dev 段的规则表。 */
type FrontendRules = Record<string, FrontendRule>;

/**
 * **动态** import 前端的代理配置（**真的那份** ⇒ 运行时验的就是它）。
 *
 * ⚠️ **为什么用动态 import**：前端那份文件在 `frontend/` 下 ⇒ 静态 import 会把
 *    后端的类型检查拖到前端目录（跨目录耦合）⇒ 动态 import（路径是变量）
 *    tsc 看不见 ⇒ 后端的 `npm run typecheck` 不受前端影响。
 *
 * ⚠️ **只能 import 一次**（ES 模块会被缓存 ⇒ 第二次拿到的还是第一次那份）
 *    ⇒ 所以 `target` 必须在 import **之前**就知道 ⇒ 调用方先起 AI 服务那一层。
 *
 * @param target AI 服务的地址（**先设进环境变量** ⇒ 前端那条规则就指向它）。
 */
async function loadFrontendRules(target: string): Promise<FrontendRules> {
	process.env.AI_SERVICE_TARGET = target;
	const file = join(REPO_ROOT, "frontend", "config", "proxy.ts");
	const loaded = (await import(pathToFileURL(file).href)) as {
		default?: { dev?: FrontendRules };
	};
	const dev = loaded.default?.dev;
	if (dev === undefined) {
		throw new Error(`前端代理配置里没有 dev 段：${file}`);
	}
	return dev;
}

/** nginx 模板里某个 location 的正文（按大括号配平取）。 */
function nginxLocationBody(template: string, prefix: string): string | undefined {
	const marker = `location ${prefix}`;
	const start = template.indexOf(marker);
	if (start === -1) {
		return undefined;
	}
	const open = template.indexOf("{", start);
	if (open === -1) {
		return undefined;
	}
	let depth = 0;
	for (let index = open; index < template.length; index += 1) {
		const char = template[index];
		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return template.slice(open + 1, index);
			}
		}
	}
	return undefined;
}

/**
 * 把**前端那条规则**翻成「浏览器这一层」的代理选项。
 *
 * ⚠️ **只换前缀**（`pathFilter`）⇒ 别的字段（target / changeOrigin / ws）一个字没改
 *    ⇒ 运行时验的**就是前端配置本身**。
 */
function browserProxyOptions(rule: FrontendRule, pathFilter: string) {
	return {
		target: rule.target,
		changeOrigin: rule.changeOrigin,
		ws: rule.ws,
		pathFilter,
		...(rule.pathRewrite === undefined ? {} : { pathRewrite: rule.pathRewrite }),
	};
}

/**
 * 本次改动里 `frontend/` 下改了哪些文件（**相对基线分支**）。
 *
 * ⚠️ 拿不到基线（浅克隆 / 没有 origin/main）⇒ 返回 `undefined`
 *    ⇒ 调用方**跳过**这条断言（不误报），并说明为什么跳过。
 */
function changedFrontendFiles(): string[] | undefined {
	try {
		const output = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && line.startsWith("frontend/"));
	} catch {
		return undefined;
	}
}

/**
 * 本 PR 改了哪些**文件**（相对 `origin/main`）。
 *
 * ⚠️ 拿不到基线（浅克隆 / 没有 origin/main）⇒ 返回 undefined（调用方**跳过**，不误报）。
 *
 * @returns {string[] | undefined} 改动过的文件清单（拿不到 ⇒ undefined）。
 */
function changedFiles(): string[] | undefined {
	try {
		const output = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	} catch {
		return undefined;
	}
}

/**
 * 「这条断言管的是**哪一类 PR**」—— 管理面这条链路的**相关文件**。
 *
 * ⚠️ **为什么要有它**（issue #193 撞出来的）：
 * 这条断言说的是「#181 那条 PR 的前端改动只能是代理配置」（= 它的硬要求
 * 「前端 0 业务改动」）⇒ **它是 PR 级的要求**，却写在了一个
 * **每个 PR 都会跑**的验收脚本里 ⇒ 于是**任何改前端业务/测试的 PR 都在这里红**
 * （#193 是第一个踩到的）。
 *
 * ⇒ 正确的口径：**只有当本 PR 真的动了管理面这条链路时**，才断言
 * 「前端部分只改了代理配置」；**跟管理面无关的 PR 一律跳过**（并说明为什么跳过）。
 *
 * ⚠️ 与 #182 修 #180 守卫（断言 8）是**同一类问题、同一种修法**。
 */
const ADMIN_CHAIN_FILES = [
	"frontend/config/proxy.ts",
	"docker/web/nginx.conf",
	"docker/web/templates/default.conf.template",
	"docker/docker-compose.yaml",
	"backend/ai/src/core/adapter/dsh-admin/",
	"backend/ai/scripts/e2e/dsh-admin-proxy-chain.",
];

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
/** AI 服务那一层（收尾要关）。 */
let aiService: ReturnType<express.Express["listen"]> | undefined;
/** 浏览器那一层（收尾要关）。 */
let browser: ReturnType<express.Express["listen"]> | undefined;

try {
	// ---------------------------------------------------------------- *
	// ① 静态：nginx 那一道门
	// ---------------------------------------------------------------- *
	console.log("① 静态：nginx 模板有 location /dsh-admin（生产环境那一道门）");
	const template = readFileSync(
		join(REPO_ROOT, "docker", "web", "templates", "default.conf.template"),
		"utf8",
	);
	const location = nginxLocationBody(template, DSH_ADMIN_MOUNT_PATH);
	check(`nginx 模板里有 'location ${DSH_ADMIN_MOUNT_PATH}'`, location !== undefined);
	if (location !== undefined) {
		check(
			"proxy_pass **不带 URI 部分**（前缀原样透传 ⇒ AI 服务那条路由才命中）",
			/proxy_pass\s+http:\/\/\$\{AI_UPSTREAM\};/.test(location),
			location.replace(/\s+/g, " ").slice(0, 160),
		);
		check("保留 Host（$host）", /proxy_set_header\s+Host\s+\$host;/.test(location));
		check(
			"WS 升级头（Upgrade / Connection）",
			/proxy_set_header\s+Upgrade\s+\$http_upgrade;/.test(location) &&
				/proxy_set_header\s+Connection\s+\$connection_upgrade;/.test(location),
		);
	}

	console.log("② 静态：nginx 主配置有 WS 升级的 map");
	const mainConf = readFileSync(join(REPO_ROOT, "docker", "web", "nginx.conf"), "utf8");
	check(
		"map $http_upgrade $connection_upgrade 在（http 层）",
		/map\s+\$http_upgrade\s+\$connection_upgrade\s*\{/.test(mainConf),
	);
	console.log();

	// ---------------------------------------------------------------- *
	// ② 起 dsh web
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
	// ③ AI 服务那一层（**真的反代** · 判定器是假的 ⇒ 不连 AiAdmin）
	// ---------------------------------------------------------------- *
	// ⚠️ **和服务启动时做的一样**：dsh web 起来 ⇒ 用启动 token 换一份签名 cookie
	//    （`exchangeTokenForCookie` ⇒ **真代码**）⇒ 反代把它注入每个请求。
	//    ⇒ 浏览器**不需要**自己有 dsh 的 cookie（**免登录**）⇒ 冷启动就能出 UI。
	const dshCookie = await exchangeTokenForCookie({
		port: dsh.port,
		token: dsh.token,
		host: FAKE_AUTHORITY,
	});
	check("服务启动时能换到 dsh 的签名 cookie（免登录的前提）", dshCookie !== undefined);

	const aiApp = express();
	aiApp.use(
		DSH_ADMIN_MOUNT_PATH,
		createDshAdminProxy({
			port: dsh.port,
			// ⚠️ **与服务一样**：把签名 cookie 注进去（浏览器那份不用带）
			authCookie: dshCookie,
			// ⚠️ **只认一个固定 token** ⇒ 管理员 / 普通用户两种口径都能穿到浏览器层
			isAdmin: async (token: string) => token === ADMIN_TOKEN,
		}),
	);
	aiApp.use(
		NO_JUDGE_MOUNT,
		createDshAdminProxy({ port: dsh.port, mountPath: NO_JUDGE_MOUNT }),
	);
	aiService = aiApp.listen(0, "127.0.0.1");
	await new Promise<void>((resolvePromise) => {
		aiService?.once("listening", () => {
			resolvePromise();
		});
	});
	const aiAddress = aiService.address();
	const aiPort = typeof aiAddress === "object" && aiAddress !== null ? aiAddress.port : 0;
	console.log(`  AI 服务层已起（端口 ${aiPort}）\n`);

	// ---------------------------------------------------------------- *
	// ④ 浏览器那一层（**前端那条真的规则** ⇒ 运行时验的就是它）
	// ---------------------------------------------------------------- *
	const aiTarget = `http://127.0.0.1:${aiPort}`;
	// ⚠️ **只能 import 一次**（模块会被缓存）⇒ target 必须在这之前就知道
	const frontendRules = await loadFrontendRules(aiTarget);
	const frontendRule = frontendRules[DSH_ADMIN_MOUNT_PATH];
	console.log("③ 静态：前端 dev 代理有 /dsh-admin（浏览器这一层的第一道门）");
	check(`前端 dev 段有 '${DSH_ADMIN_MOUNT_PATH}' 这条规则`, frontendRule !== undefined);
	if (frontendRule !== undefined) {
		check(
			"target 指向 AI 服务（http://…）",
			/^https?:\/\//.test(frontendRule.target),
			frontendRule.target,
		);
		check(
			"**不剥前缀**（没有把 /dsh-admin 去掉的 pathRewrite）",
			frontendRule.pathRewrite === undefined ||
				!Object.keys(frontendRule.pathRewrite).some((key) => key.includes("dsh-admin")),
			JSON.stringify(frontendRule.pathRewrite),
		);
		check(
			"**保留 Host**（changeOrigin: false ⇒ dsh 的栅栏才认得浏览器看到的 authority）",
			frontendRule.changeOrigin === false,
			`changeOrigin=${String(frontendRule.changeOrigin)}`,
		);
		check("转 WS（dsh 的实时通道）", frontendRule.ws === true, `ws=${String(frontendRule.ws)}`);
	}
	if (frontendRule === undefined) {
		throw new Error("前端代理配置里没有 /dsh-admin 那条规则");
	}

	console.log("④ 静态：两边的前缀一致（不许漂）");
	check(
		`前端规则的 key 与 nginx 的 location 都是 '${DSH_ADMIN_MOUNT_PATH}'`,
		location !== undefined,
	);

	console.log("⑤ 静态：frontend/ 下只改了代理配置");
	const changed = changedFrontendFiles();
	const allChanged = changedFiles();
	if (changed === undefined || allChanged === undefined) {
		console.log("  … 拿不到基线分支（origin/main）⇒ 跳过这条（不误报）");
	} else {
		// ⚠️ **这条断言是「PR 级」的** ⇒ 只在**本 PR 动了管理面这条链路**时才断言
		//    （否则每个改前端业务/测试的 PR 都会在这里红 —— issue #193 撞出来的）
		const touchesAdminChain = allChanged.some((file) =>
			ADMIN_CHAIN_FILES.some((pattern) => file.startsWith(pattern)),
		);
		if (!touchesAdminChain) {
			console.log(
				"  ! 本 PR 没动管理面这条链路 ⇒ 「frontend/ 下只改了代理配置」这条断言**不适用**（它只管那条链路的 PR）⇒ 已跳过",
			);
		} else {
			const offenders = changed.filter((file) => file !== "frontend/config/proxy.ts");
			check(
				"frontend/ 下只有 config/proxy.ts 变了（管理面那条链路的硬要求）",
				offenders.length === 0,
				offenders.join(", "),
			);
		}
	}
	console.log();

	const browserApp = express();
	// ⚠️ **用的就是前端那条规则**（target / changeOrigin / ws 一个字没改）
	//    ⚠️ umi 用的是 http-proxy-middleware **v3** 的 `context`（**前缀匹配**）
	//       ⇒ 与 v4 的 `pathFilter` 语义一样 ⇒ 这里用 v4 的写法（同一个包，v4 在 backend/ai 里）。
	//    ⚠️ **不按路径挂**（`app.use(fn)` 而不是 `app.use('/dsh-admin', fn)`）：
	//       Express 挂载时会把 `req.url` 的前缀**剥掉** ⇒ 代理看到的就只剩 `/`
	//       ⇒ 前缀匹配就永远不成立。umi 也是 `app.use(fn)`（见 @umijs/bundler-utils 的 createProxy）。
	const adminProxy = createProxyMiddleware(
		browserProxyOptions(frontendRule, DSH_ADMIN_MOUNT_PATH),
	);
	const noJudgeProxy = createProxyMiddleware(browserProxyOptions(frontendRule, NO_JUDGE_MOUNT));
	browserApp.use((req, res, next) => {
		void adminProxy(req, res, next);
	});
	// 「没注入判定器」那条（**同样的选项** ⇒ 只换前缀 ⇒ 不与上面那条构成前缀关系）
	browserApp.use((req, res, next) => {
		void noJudgeProxy(req, res, next);
	});
	browser = browserApp.listen(0, "127.0.0.1");
	await new Promise<void>((resolvePromise) => {
		browser?.once("listening", () => {
			resolvePromise();
		});
	});
	const browserAddress = browser.address();
	const browserPort =
		typeof browserAddress === "object" && browserAddress !== null ? browserAddress.port : 0;
	console.log(`  浏览器层（前端 dev 代理）已起（端口 ${browserPort}）\n`);

	// ---------------------------------------------------------------- *
	// ⑤ 断言（运行时）
	// ---------------------------------------------------------------- *
	console.log("⑥ ⚠️ 冷启动：浏览器第一次加载 iframe（**没有** dsh 的 cookie）⇒ 也要出 UI");
	// ⚠️ 这就是「浏览器打开 /ai/admin」时**第一个**请求的形状：
	//    浏览器只有 AiAdmin 的 token（我们放在 cookie 里）⇒ 没有 dsh 的签名 cookie
	//    ⇒ 靠**服务启动时换好的那份**（免登录）⇒ 必须直接拿到 dsh 的 SPA。
	const coldStart = await httpGet({
		port: browserPort,
		path: `${DSH_ADMIN_MOUNT_PATH}/`,
		host: FAKE_AUTHORITY,
		authorization: `Bearer ${ADMIN_TOKEN}`,
	});
	check("状态是 200（不是 dsh 的 401）", coldStart.status === 200, brief(coldStart));
	check("body 是 dsh 的 SPA HTML", /<!doctype html>/i.test(coldStart.body), brief(coldStart));
	check(
		"SPA 的 base 是相对的（./）⇒ iframe 里的资源会走 /dsh-admin/（不会白屏）",
		/<base href="\.\/"/i.test(coldStart.body),
		brief(coldStart),
	);

	console.log("⑦ 转发成功：拿启动 token 换 cookie（⇒ 浏览器也能自己换）");
	const exchange = await httpGet({
		port: browserPort,
		path: `${DSH_ADMIN_MOUNT_PATH}/?token=${encodeURIComponent(dsh.token)}`,
		host: FAKE_AUTHORITY,
		authorization: `Bearer ${ADMIN_TOKEN}`,
	});
	check("状态是 303（拿 token 换 cookie 那一步）", exchange.status === 303, brief(exchange));
	const authCookie = dshAuthCookie(exchange.headers);
	check("响应里有 dsh 的签名 cookie（dsh-auth-…）", authCookie !== undefined, brief(exchange));

	console.log("⑧ Host 一路保留到 dsh（没被改写成 127.0.0.1）");
	const authority = authCookie === undefined ? undefined : cookieAuthority(authCookie);
	check(
		`dsh 看到的 authority 是「${FAKE_AUTHORITY}」（不是 127.0.0.1）`,
		authority === FAKE_AUTHORITY,
		`实际=${authority ?? "拿不到"}`,
	);

	console.log("⑨ cookie 的 Path 仍是挂载前缀（iframe 的 cookie 作用域）");
	const path = authCookie === undefined ? undefined : cookiePath(authCookie);
	check(
		`Path=${DSH_ADMIN_MOUNT_PATH}/（不是 Path=/）`,
		path === `${DSH_ADMIN_MOUNT_PATH}/`,
		`实际 Path=${path ?? "拿不到"}`,
	);

	console.log("⑩ 非管理员 ⇒ 403");
	const denied = await httpGet({
		port: browserPort,
		path: `${DSH_ADMIN_MOUNT_PATH}/`,
		host: FAKE_AUTHORITY,
		authorization: `Bearer ${USER_TOKEN}`,
	});
	check("状态是 403", denied.status === 403, brief(denied));

	console.log("⑪ ⚠️ fail closed：没注入判定器 ⇒ 503");
	const noJudge = await httpGet({
		port: browserPort,
		path: `${NO_JUDGE_MOUNT}/`,
		host: FAKE_AUTHORITY,
		authorization: `Bearer ${ADMIN_TOKEN}`,
	});
	check("状态是 503", noJudge.status === 503, brief(noJudge));
} catch (error) {
	failures.push(`脚本跑挂了 —— ${describe(error)}`);
	console.error(`\n❌ 脚本跑挂了：${describe(error)}`);
	if (dsh !== undefined) {
		console.error("\n--- dsh web 的输出（诊断用）---");
		console.error(dsh.log().split("\n").slice(-40).join("\n"));
	}
} finally {
	// ⚠️ **收尾**：杀掉 dsh web（别留孤儿进程）+ 关掉两层 + 清临时目录
	if (dsh !== undefined) {
		await stopDshWeb(dsh.child);
		console.log("\n（dsh web 已停）");
	}
	for (const server of [browser, aiService]) {
		if (server === undefined) {
			continue;
		}
		await new Promise<void>((resolvePromise) => {
			server.close(() => {
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
	console.log("\n✅ AI 管理面「浏览器这一层」的运行时验收全过");
	process.exit(0);
}
console.error(`\n❌ 运行时验收失败 ${failures.length} 条：`);
for (const failure of failures) {
	console.error(`   · ${failure}`);
}
process.exit(1);

/** 异常 ⇒ 人话。 */
function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
