/**
 * `core/adapter/dsh-admin/instance.ts` 的单测。
 *
 * ⚠️ **不真起 dsh** ⇒ 注入一个假的子进程（`spawn` 可注入）⇒
 *    断言「我们起的命令行对不对」「token 解析对不对」「崩了会不会重启」。
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	DshAdminInstance,
	exchangeTokenForCookie,
	parseStartupToken,
	type DshChildLike,
	type SpawnFn,
} from "./instance.ts";

/** 假子进程。 */
class FakeChild extends EventEmitter implements DshChildLike {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	killed: NodeJS.Signals | undefined;

	kill(signal?: NodeJS.Signals): boolean {
		this.killed = signal;
		this.emit("exit", 0);
		return true;
	}
}

/** 假的起进程（记下命令行，返回一个会打印启动 URL 的子进程）。 */
function fakeSpawn(records: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }>): {
	spawn: SpawnFn;
	children: FakeChild[];
} {
	const children: FakeChild[] = [];
	const spawn: SpawnFn = (command, args, options) => {
		records.push({ command, args, env: options.env });
		const child = new FakeChild();
		children.push(child);
		setImmediate(() => {
			child.stdout.write("dsh web: http://127.0.0.1:8399/?token=0123456789abcdef0123456789abcdef\n");
		});
		return child;
	};
	return { spawn, children };
}

/** 不吵的 logger。 */
const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

describe("parseStartupToken", () => {
	it("从启动输出里解析出 token", () => {
		const line = "dsh web: http://127.0.0.1:8399/?token=0123456789abcdef0123456789abcdef";
		expect(parseStartupToken(line)).toBe("0123456789abcdef0123456789abcdef");
	});

	it("没有 token ⇒ undefined", () => {
		expect(parseStartupToken("dsh web: http://127.0.0.1:8399/")).toBeUndefined();
	});
});

describe("DshAdminInstance", () => {
	it("起的是 dsh 的 web profile（官方 profile ⇒ 不裁剪界面）", async () => {
		const records: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
		const { spawn } = fakeSpawn(records);
		const instance = new DshAdminInstance({
			port: 8399,
			home: "/tmp/dsh-admin",
			trustedHost: "127.0.0.1:3100",
			spawn,
			exchangeCookie: async () => "dsh-auth-session=abc",
			logger: quietLogger,
		});

		await instance.start();

		expect(records).toHaveLength(1);
		const args = records[0]?.args ?? [];
		expect(args).toContain("--profile");
		expect(args[args.indexOf("--profile") + 1]).toBe("web");
		expect(args).toContain("--no-open");
		expect(args).toContain("--host");
		expect(args[args.indexOf("--host") + 1]).toBe("127.0.0.1");
		expect(args[args.indexOf("--port") + 1]).toBe("8399");
		expect(args[args.indexOf("--trusted-host") + 1]).toBe("127.0.0.1:3100");
		// ⚠️ **独立的 home** ⇒ 不与服务的 `sdk` profile 混
		expect(records[0]?.env["DSH_HOME"]).toBe("/tmp/dsh-admin");

		await instance.stop();
	});

	it("用启动 token 换签名 cookie（免登录）", async () => {
		const records: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
		const { spawn } = fakeSpawn(records);
		const exchanged: Array<{ port: number; token: string; host: string }> = [];
		const instance = new DshAdminInstance({
			port: 8399,
			home: "/tmp/dsh-admin",
			trustedHost: "127.0.0.1:3100",
			spawn,
			exchangeCookie: async (input) => {
				exchanged.push(input);
				return "dsh-auth-session=abc";
			},
			logger: quietLogger,
		});

		await instance.start();

		expect(exchanged).toHaveLength(1);
		expect(exchanged[0]?.token).toBe("0123456789abcdef0123456789abcdef");
		// ⚠️ **Host 写成浏览器可见的那个**（栅栏会比对）
		expect(exchanged[0]?.host).toBe("127.0.0.1:3100");
		expect(instance.authCookie).toBe("dsh-auth-session=abc");

		await instance.stop();
	});

	it("崩了 ⇒ 有限次数重启（且重新解析 token）", async () => {
		const records: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
		const { spawn, children } = fakeSpawn(records);
		const instance = new DshAdminInstance({
			port: 8399,
			home: "/tmp/dsh-admin",
			trustedHost: "127.0.0.1:3100",
			spawn,
			exchangeCookie: async () => "dsh-auth-session=abc",
			restartDelayMs: 1,
			logger: quietLogger,
		});

		await instance.start();
		children[0]?.emit("exit", 1);
		await new Promise((r) => setTimeout(r, 50));

		expect(records.length).toBeGreaterThanOrEqual(2);
		expect(instance.restarts).toBeGreaterThanOrEqual(1);

		await instance.stop();
	});

	it("停了就**不**重启", async () => {
		const records: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
		const { spawn, children } = fakeSpawn(records);
		const instance = new DshAdminInstance({
			port: 8399,
			home: "/tmp/dsh-admin",
			trustedHost: "127.0.0.1:3100",
			spawn,
			exchangeCookie: async () => "dsh-auth-session=abc",
			restartDelayMs: 1,
			logger: quietLogger,
		});

		await instance.start();
		await instance.stop();
		children[0]?.emit("exit", 1);
		await new Promise((r) => setTimeout(r, 50));

		expect(records).toHaveLength(1);
	});
});

describe("exchangeTokenForCookie", () => {
	it("从 303 的 set-cookie 里取出 dsh 的签名 cookie", async () => {
		const { createServer } = await import("node:http");
		const server = createServer((req, res) => {
			res.statusCode = 303;
			res.setHeader("set-cookie", ["dsh-auth-session=xyz; Path=/; HttpOnly; SameSite=Strict"]);
			res.setHeader("location", "./");
			res.end();
		});
		server.listen(0);
		await new Promise<void>((r) => server.once("listening", () => r()));
		const port = (server.address() as { port: number }).port;

		const cookie = await exchangeTokenForCookie({
			port,
			token: "token",
			host: "127.0.0.1:3100",
		});

		expect(cookie).toBe("dsh-auth-session=xyz");
		await new Promise<void>((r) => server.close(() => r()));
	});
});
