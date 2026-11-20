/**
 * dsh web 的**实例**（起一个子进程 ⇒ 管理面有个 UI 可嵌）。
 *
 * ## 为什么自己起进程（不用 SDK 客户端）
 *
 * `adapter/dsh/client.ts` 那个 SDK 客户端走的是 **stdio JSON-RPC**（会话那条线）。
 * 管理面要的是 **dsh 自带的 Web UI** ⇒ 那是**另一样东西**：`dsh --profile web`
 * 起一个 HTTP/WS 服务 ⇒ 我们只需要它的「进程 + 地址 + 签名 cookie」。
 *
 * ## 关键口径
 *
 * - **独立的 `DSH_HOME`**（⚠️ 别跟服务的 `sdk` profile 混 ⇒ 配置文件、会话、
 *   插件安装目录都要分开）；
 * - **只用官方 `web` profile**（不裁剪界面 ⇒ 不需要自己拼 profile）；
 * - **启动 token 只在内存里**：从 stdout 抓 `?token=…` ⇒ 换一份签名 cookie ⇒
 *   之后浏览器完全不用知道 token（token / cookie 都不落盘、不进日志）；
 * - **健康检查**：探 `/`（拿到 401 也算「活着」⇒ 401 说明服务在、只是没带凭据）；
 * - **崩溃重启**：有限次数 + 退避；重启后**重新解析 token**。
 */

import { spawn as nodeSpawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";

/** ESM 里的 `require.resolve`（用来找 SDK 自带的 dsh 运行时）。 */
const requireFromHere = createRequire(import.meta.url);

/** dsh 签名 cookie 的名前缀（dsh 自己发的：`dsh-auth-…`）。 */
const DSH_AUTH_COOKIE_PREFIX = "dsh-auth-";

/** 启动 URL 里的 token（32 位十六进制）。 */
const STARTUP_TOKEN_PATTERN = /\?token=([A-Za-z0-9_-]{16,})/;

/** 换 cookie 时的超时（毫秒）。 */
const COOKIE_TIMEOUT_MS = 10_000;

/** 停进程时等 SIGTERM 的时间（毫秒）⇒ 超了就 SIGKILL。 */
const STOP_GRACE_MS = 3_000;

/** 子进程的**最小形状**（测试塞个假的 ⇒ 不用真起 dsh）。 */
export interface DshChildLike {
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	on(event: "exit", listener: (code: number | null) => void): this;
	on(event: "error", listener: (error: Error) => void): this;
	off(event: "exit", listener: (code: number | null) => void): this;
	off(event: "error", listener: (error: Error) => void): this;
	kill(signal?: NodeJS.Signals): boolean;
}

/** 起进程（测试可注入）。 */
export type SpawnFn = (
	command: string,
	args: readonly string[],
	options: { env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
) => DshChildLike;

/** 换签名 cookie（测试可注入）。 */
export type ExchangeCookieFn = (input: {
	port: number;
	token: string;
	host: string;
}) => Promise<string | undefined>;

/** dsh web 实例的选项。 */
export interface DshAdminInstanceOptions {
	/** dsh web 监听端口（**只绑 loopback**）。 */
	port: number;
	/** dsh 的 home（**独立目录**）。 */
	home: string;
	/** 浏览器可见的 authority（`--trusted-host` 的值）。 */
	trustedHost: string;
	/** dsh 可执行文件（不给 ⇒ 用 SDK 自带的那份同版本运行时）。 */
	dshBin?: string | undefined;
	/** 崩溃重启次数上限（缺省 3）。 */
	maxRestarts?: number;
	/** 重启退避基数（毫秒；第 n 次等 n×基数）。 */
	restartDelayMs?: number;
	/** 启动 token 的等待上限（毫秒；缺省 30 秒）。 */
	startupTimeoutMs?: number;
	/** 起进程（测试注入）。 */
	spawn?: SpawnFn;
	/** 换签名 cookie（测试注入）。 */
	exchangeCookie?: ExchangeCookieFn;
	/** 日志（缺省 ⇒ `console`）。 */
	logger?: Pick<Console, "log" | "warn" | "error">;
}

/**
 * 从启动输出里**解析 token**。
 *
 * dsh 启动时会打印一行 `dsh web: http://127.0.0.1:8399/?token=<32 位 token>`。
 *
 * @param text 启动输出（可以是一大段 ⇒ 里面扫一遍）。
 */
export function parseStartupToken(text: string): string | undefined {
	const match = STARTUP_TOKEN_PATTERN.exec(text);
	return match?.[1];
}

/**
 * 用启动 token 换一份 **dsh 的签名 cookie**。
 *
 * ⚠️ 请求的 `Host` 头**写成浏览器可见的那个 authority**（`--trusted-host` 的值）
 *    ⇒ 与反代那条链路的栅栏口径一致（否则会被判 403）。
 *
 * @param input 端口、token、要冒充的 Host。
 * @returns `dsh-auth-…`（只留 `name=value`）；没拿到 ⇒ `undefined`。
 */
export function exchangeTokenForCookie(input: {
	port: number;
	token: string;
	host: string;
}): Promise<string | undefined> {
	return new Promise((resolvePromise, rejectPromise) => {
		const request = httpRequest(
			{
				host: "127.0.0.1",
				port: input.port,
				path: `/?token=${encodeURIComponent(input.token)}`,
				method: "GET",
				headers: { host: input.host, accept: "*/*" },
				timeout: COOKIE_TIMEOUT_MS,
			},
			(response) => {
				response.resume();
				response.on("end", () => {
					const cookies = response.headers["set-cookie"] ?? [];
					for (const raw of cookies) {
						const pair = (raw.split(";", 1)[0] ?? "").trim();
						if (pair.startsWith(DSH_AUTH_COOKIE_PREFIX)) {
							resolvePromise(pair);
							return;
						}
					}
					resolvePromise(undefined);
				});
			},
		);
		request.on("timeout", () => {
			request.destroy(new Error("换 dsh 签名 cookie 超时"));
		});
		request.on("error", rejectPromise);
		request.end();
	});
}

/**
 * 探 dsh web 是不是活着。
 *
 * ⚠️ **`401` 也算活着**（服务在，只是没带凭据）⇒ 只有连不上才算死。
 *
 * @param port dsh web 的端口。
 */
export function probeDshWeb(port: number): Promise<boolean> {
	return new Promise((resolvePromise) => {
		const request = httpRequest(
			{ host: "127.0.0.1", port, path: "/", method: "GET", timeout: COOKIE_TIMEOUT_MS },
			(response) => {
				response.resume();
				resolvePromise(true);
			},
		);
		request.on("timeout", () => {
			request.destroy();
			resolvePromise(false);
		});
		request.on("error", () => {
			resolvePromise(false);
		});
		request.end();
	});
}

/**
 * dsh web 的**实例**（一个进程 ⇒ 一份签名 cookie）。
 *
 * ⚠️ **共享一个实例**（不做多实例 / 多用户）⇒ 「谁改的」记我们自己的审计。
 */
export class DshAdminInstance {
	readonly #options: DshAdminInstanceOptions;
	readonly #spawn: SpawnFn;
	readonly #exchange: ExchangeCookieFn;
	readonly #logger: Pick<Console, "log" | "warn" | "error">;
	#child: DshChildLike | undefined;
	#cookie: string | undefined;
	#restarts = 0;
	#stopped = true;

	constructor(options: DshAdminInstanceOptions) {
		this.#options = options;
		this.#spawn = options.spawn ?? defaultSpawn;
		this.#exchange = options.exchangeCookie ?? exchangeTokenForCookie;
		this.#logger = options.logger ?? console;
	}

	/** 当前的签名 cookie（**只在内存里** ⇒ 不落盘、不进日志）。 */
	get authCookie(): string | undefined {
		return this.#cookie;
	}

	/**
	 * 换掉签名 cookie（dsh 发了新的 ⇒ 用新的）。
	 *
	 * ⚠️ 只在内存里。
	 */
	setAuthCookie(cookie: string): void {
		this.#cookie = cookie.length > 0 ? cookie : undefined;
	}

	/** 崩溃重启了几次（诊断用）。 */
	get restarts(): number {
		return this.#restarts;
	}

	/**
	 * 起 dsh web（等启动 token ⇒ 换签名 cookie）。
	 *
	 * ⚠️ **失败会抛错**（起不来就起不来 ⇒ 别装成「起来了」）。
	 */
	async start(): Promise<void> {
		this.#stopped = false;
		this.#restarts = 0;
		await this.#launch();
	}

	/**
	 * 停 dsh web（`SIGTERM` ⇒ 等一会儿 ⇒ `SIGKILL`）。
	 *
	 * ⚠️ 停了**不重启**（这是「停」，不是「崩」）。
	 */
	async stop(): Promise<void> {
		this.#stopped = true;
		const child = this.#child;
		this.#child = undefined;
		this.#cookie = undefined;
		if (child === undefined) {
			return;
		}
		await new Promise<void>((resolvePromise) => {
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				resolvePromise();
			}, STOP_GRACE_MS);
			timer.unref?.();
			child.on("exit", () => {
				clearTimeout(timer);
				resolvePromise();
			});
			child.kill("SIGTERM");
		});
	}

	/** dsh web 是不是活着（探 `/`）。 */
	async alive(): Promise<boolean> {
		return await probeDshWeb(this.#options.port);
	}

	/** 起一个进程 ⇒ 等 token ⇒ 换 cookie。 */
	async #launch(): Promise<void> {
		const bin = this.#options.dshBin ?? resolveDshBin();
		const args = [
			"--profile",
			"web",
			"--no-open",
			"--host",
			"127.0.0.1",
			"--port",
			String(this.#options.port),
			"--trusted-host",
			this.#options.trustedHost,
		];
		const child = this.#spawn(process.execPath, [bin, ...args], {
			// ⚠️ **独立的 home** ⇒ 配置文件 / 会话 / 插件目录都不与服务的混
			env: { ...process.env, DSH_HOME: this.#options.home },
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.#child = child;
		child.on("exit", () => {
			void this.#onCrash();
		});
		child.on("error", (error) => {
			this.#logger.warn(`[dsh-admin] dsh web 进程出错：${error.message}`);
		});

		const token = await this.#readStartupToken(child);
		const cookie = await this.#exchange({
			port: this.#options.port,
			token,
			host: this.#options.trustedHost,
		});
		if (cookie === undefined) {
			this.#logger.warn("[dsh-admin] 没换到 dsh 的签名 cookie（免登录会退化成要登录）");
		}
		this.#cookie = cookie;
		this.#logger.log(`[dsh-admin] dsh web 已起（端口 ${this.#options.port}）`);
	}

	/** 从 stdout/stderr 里等启动 token。 */
	#readStartupToken(child: DshChildLike): Promise<string> {
		const timeoutMs = this.#options.startupTimeoutMs ?? 30_000;
		return new Promise<string>((resolvePromise, rejectPromise) => {
			let buffer = "";
			const cleanup = (): void => {
				clearTimeout(timer);
				child.stdout?.off("data", onData);
				child.stderr?.off("data", onData);
				child.off("exit", onExit);
			};
			const onData = (chunk: Buffer | string): void => {
				buffer += chunk.toString();
				const token = parseStartupToken(buffer);
				if (token !== undefined) {
					cleanup();
					resolvePromise(token);
				}
			};
			const onExit = (code: number | null): void => {
				cleanup();
				rejectPromise(new Error(`dsh web 进程退出了（code=${code}）`));
			};
			const timer = setTimeout(() => {
				cleanup();
				rejectPromise(new Error("dsh web 启动超时（没打印启动 URL）"));
			}, timeoutMs);
			timer.unref?.();
			child.stdout?.on("data", onData);
			child.stderr?.on("data", onData);
			child.on("exit", onExit);
		});
	}

	/** 崩了 ⇒ 有限次数 + 退避地重启（重启后**重新解析 token**）。 */
	async #onCrash(): Promise<void> {
		if (this.#stopped) {
			return;
		}
		this.#child = undefined;
		this.#cookie = undefined;
		const max = this.#options.maxRestarts ?? 3;
		if (this.#restarts >= max) {
			this.#logger.error(`[dsh-admin] dsh web 崩了且重启次数用完（${max} 次）`);
			return;
		}
		this.#restarts += 1;
		const delay = (this.#options.restartDelayMs ?? 1000) * this.#restarts;
		this.#logger.warn(`[dsh-admin] dsh web 崩了 ⇒ ${delay}ms 后重启（第 ${this.#restarts} 次）`);
		await sleep(delay);
		if (this.#stopped) {
			return;
		}
		try {
			await this.#launch();
		} catch (error) {
			this.#logger.error(
				`[dsh-admin] dsh web 重启失败：${error instanceof Error ? error.message : String(error)}`,
			);
			await this.#onCrash();
		}
	}
}

/** 睡一会儿（毫秒）。 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => {
		const timer = setTimeout(resolvePromise, ms);
		timer.unref?.();
	});
}

/** 缺省的起进程方式（node 的 `spawn`）。 */
const defaultSpawn: SpawnFn = (command, args, options) =>
	nodeSpawn(command, [...args], options) as unknown as DshChildLike;

/**
 * 找 dsh 的可执行文件（**SDK 自带的那份同版本运行时**）。
 *
 * ⚠️ 找不到就报错（**不猜 PATH** ⇒ 免得起错版本）。
 */
function resolveDshBin(): string {
	try {
		return requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
	} catch {
		return resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../../../node_modules/@deepseek-ai/dsh/lib/bin.js",
		);
	}
}
