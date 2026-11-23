/**
 * Express 骨架 —— 装配、中间件、404、优雅退出。
 *
 * ## 这一层只管「壳」
 *
 * - CORS 中间件：挂 CORS 头；预检直接 204；
 * - 404：JSON 404（不是 Express 默认的 HTML）；
 * - 错误中间件：把异常变成统一信封；
 * - `createApp()` 只装配、**不监听**（测试可以随便起停）。
 *
 * ⚠️ **装配本身在 `core/app.ts`**（issue #116：内核要能被**别的业务系统**复用
 * ⇒ 装配也得是内核的一部分、且与业务无关）⇒ 本文件只是
 * **AiAdmin 这一套的接线**：装 PM 插件 + 读本仓的 `agents/`。
 */

// ⚠️ **必须排在所有 import 之前**：运行时是**模块级单例**（import 时就构造）
//    ⇒ 插件必须**先注册**，否则构造时会认为「配置里的插件没注册」。
import { plugins } from "./plugins.ts";
import type { Express } from "express";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { agentsRoot, loadAgentConfigs } from "./core/config/loader.ts";
import { agentRuntime } from "./core/session/runtime.ts";
import {
	MISSING_TOKEN_MESSAGE,
	NOT_FOUND_MESSAGE,
	corsMiddleware,
	createCoreApp,
	errorHandler,
	notFoundHandler,
} from "./core/app.ts";
import { createDshBridgeRouter } from "./core/adapter/dsh/bridge.ts";
import { bridgeSecret } from "./core/adapter/dsh/runner.ts";
import { dshAdminConfig } from "./core/adapter/dsh-admin/config.ts";
import { DshAdminInstance } from "./core/adapter/dsh-admin/instance.ts";
import { createDshAdminProxy, type DshAdminProxyHandler } from "./core/adapter/dsh-admin/proxy.ts";
import { pluginRegistry } from "./core/plugins.ts";
import type { AdminJudge } from "./core/session/identity.ts";

export { MISSING_TOKEN_MESSAGE, NOT_FOUND_MESSAGE, corsMiddleware, errorHandler, notFoundHandler };

/**
 * 装配 app（**不监听**）。
 *
 * 中间件顺序：预检/CORS → 路由 → 404 → 错误处理。
 *
 * @param options 装配选项（`dshAdmin` = AI 管理面的反代；不给就没有那条路由）。
 */
export function createApp(options: { dshAdmin?: DshAdminProxyHandler } = {}): Express {
	return createCoreApp({
		plugins,
		agentsRoot: agentsRoot(),
		dshAdmin: options.dshAdmin,
		// ⚠️ **命令桥**（内部端点，**不在对外契约里**）：
		//    dsh 侧的插件回调我们执行命令 ⇒ 命令本体、审计、参数收窄都在我们这边。
		//    密钥是**进程内随机**的 ⇒ 别的进程调不动。
		configure: (app) => {
			app.use(
				"/internal/dsh",
				createDshBridgeRouter({
					secret: bridgeSecret(),
					execute: (input) => agentRuntime.executeDshCommand(input),
				}),
			);
		},
	});
}

/** AI 管理面的接线（dsh 的 Web UI ⇒ 反代 ⇒ admin 页的 iframe）。 */
interface DshAdminWiring {
	/** 反代中间件（挂到 `/dsh-admin`）。 */
	handler: DshAdminProxyHandler;
	/** 把 **WS 升级**也交给代理（`app.use` **不拦**升级请求）。 */
	attach: (server: Server) => void;
	/** 起 dsh web（**不阻塞** HTTP 服务 ⇒ dsh 慢也不拖慢我们）。 */
	start: () => void;
	/** 停 dsh web。 */
	stop: () => Promise<void>;
}

/**
 * 造 AI 管理面的接线（**缺省关** ⇒ `AI_DSH_ADMIN_ENABLED` 不是 1 就返回 `undefined`）。
 */
function createDshAdmin(): DshAdminWiring | undefined {
	const config = dshAdminConfig();
	if (!config.enabled) {
		return undefined;
	}
	const instance = new DshAdminInstance({
		port: config.port,
		home: config.home,
		trustedHost: config.trustedHost,
	});
	const handler = createDshAdminProxy({
		port: config.port,
		// ⚠️ **每次问实例要 cookie** ⇒ dsh 重启换了 cookie 立刻生效
		authCookie: () => instance.authCookie,
		onAuthCookie: (cookie) => instance.setAuthCookie(cookie),
		// ⚠️ **admin 判定 = 问权威系统**（插件给的判定器 ⇒ 内核不认识 AiAdmin）
		//    ⇒ 伪造 token 载荷提不了权；没判定器 ⇒ **默认拒绝**（fail closed）。
		isAdmin: adminJudgeOfPlugins(),
	});
	return {
		handler,
		attach: (server) => {
			// ⚠️ **WS 升级不走 Express 挂载** ⇒ 得自己接（socket 的类型按 node 的说法是 Duplex）
			server.on("upgrade", (req, socket, head) => {
				handler.upgrade(req, socket as unknown as Socket, head);
			});
		},
		start: () => {
			void instance.start().catch((error: unknown) => {
				console.error(
					`[dsh-admin] dsh web 起不来：${error instanceof Error ? error.message : String(error)}`,
				);
			});
		},
		stop: () => instance.stop(),
	};
}

/**
 * 从**插件注册表**里取 admin 判定器（**没有 ⇒ undefined** ⇒ 反代一律拒绝）。
 *
 * ⚠️ **插件 → 内核**的依赖方向 ⇒ 内核不 import 插件；
 *    这里在**入口侧**（`src/server.ts`）取 ⇒ 装配点仍在外面。
 * ⚠️ 注册表是**内核与插件之间唯一的接头**（`core/plugins.ts`）⇒ 走它 ⇒ 口径只有一份。
 */
function adminJudgeOfPlugins(): AdminJudge | undefined {
	return pluginRegistry.adminJudge();
}

/** 启动服务（监听 `PORT`，缺省 3100）。 */
export function start(): void {
	// ⚠️ **启动即校验智能体配置**：配置坏了就别跑起来（否则用户看到的是「少了个智能体」，
	//    却查不到原因）⇒ 这里直接退出，让人看到是哪个字段坏了。
	try {
		loadAgentConfigs(agentsRoot());
	} catch (error) {
		console.error(
			`[ai-service] 智能体配置不合法，已退出：${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}

	// ⚠️ **配置里写的插件必须已注册** ⇒ 拼错名字**服务起不来**（不等到建会话才发现）。
	try {
		agentRuntime.validatePlugins();
	} catch (error) {
		console.error(
			`[ai-service] 插件配置不合法，已退出：${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}

	const port = Number(process.env.PORT ?? 3100);
	// ⚠️ **AI 管理面**（缺省关 ⇒ 不起 dsh web、不挂 `/dsh-admin`）
	const dshAdmin = createDshAdmin();
	const app = createApp({ dshAdmin: dshAdmin?.handler });
	const server = app.listen(port, () => {
		console.log(`[ai-service] 已启动：http://localhost:${port}`);
	});
	dshAdmin?.attach(server);
	dshAdmin?.start();

	// 优雅退出：先停止接新连接，再退出
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, () => {
			console.log(`[ai-service] 收到 ${signal}，正在关闭…`);
			// ⚠️ **dsh web 也得停**（别留一个孤儿进程占着端口）
			void dshAdmin?.stop().catch(() => {});
			server.close(() => process.exit(0));
			// 兜底：SSE 长连接可能挂着 ⇒ 最多等 5 秒
			setTimeout(() => process.exit(0), 5000).unref();
		});
	}
}
