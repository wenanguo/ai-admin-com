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

export { MISSING_TOKEN_MESSAGE, NOT_FOUND_MESSAGE, corsMiddleware, errorHandler, notFoundHandler };

/**
 * 装配 app（**不监听**）。
 *
 * 中间件顺序：预检/CORS → 路由 → 404 → 错误处理。
 */
export function createApp(): Express {
	return createCoreApp({
		plugins,
		agentsRoot: agentsRoot(),
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
	const app = createApp();
	const server = app.listen(port, () => {
		console.log(`[ai-service] 已启动：http://localhost:${port}`);
	});

	// 优雅退出：先停止接新连接，再退出
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, () => {
			console.log(`[ai-service] 收到 ${signal}，正在关闭…`);
			server.close(() => process.exit(0));
			// 兜底：SSE 长连接可能挂着 ⇒ 最多等 5 秒
			setTimeout(() => process.exit(0), 5000).unref();
		});
	}
}
