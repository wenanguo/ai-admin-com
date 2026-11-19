/**
 * dsh 运行时客户端 —— **子进程 + stdio JSON-RPC**（D1=A）。
 *
 * ## 为什么用官方 SDK 客户端
 *
 * spec §7 的「类型边界」说：适配层**可以**用官方 `@deepseek-ai/dsh-sdk-client`
 * （它就住在适配层里 ⇒ 升级影响面 = 适配层目录）。
 * 它替我们做了四件难事：
 *
 * ① 起子进程（`dsh --profile sdk`）与**关停阶梯**（stdin EOF → SIGTERM → SIGKILL）；
 * ② 收发换行分隔的 JSON-RPC；
 * ③ 把服务端通知扇出给订阅者（`session.event` ⇒ 我们的会话事件）；
 * ④ 处理运行时的**反向请求**（`approval/request` ⇒ 我们的闸门）。
 *
 * ⚠️ **协议里没有 cancel**（D2）⇒ 「停止生成」只能**停掉并重建**这个会话的
 *    dsh 进程（见 `session.ts` 的 `abort`）。
 */

import { HarnessClient } from "@deepseek-ai/dsh-sdk-client";
import {
	asRecord,
	asString,
	type DshApprovalOutcome,
	type DshApprovalRequest,
	type DshSessionEvent,
} from "./protocol.ts";

/** 起一个 dsh 运行时需要的参数。 */
export interface DshClientOptions {
	/** dsh 的**具名 profile**（默认 `sdk`）。 */
	profile: string;
	/** dsh 的 home（**它自己的一套目录**：profile / 日志 / 会话）。 */
	dshHome: string;
	/** dsh 可执行文件（不给 ⇒ 用 SDK 自带的那份同版本运行时）。 */
	dshBin?: string | undefined;
	/** 每次启动都套的 profile 补丁（**我们的**：模型路由 + 我们的插件）。 */
	patches?: readonly string[];
	/** 模型路由名（我们的 provider 插件注册的那个）。 */
	provider: string;
	/** 模型 id。 */
	model: string;
	/** 工作目录（dsh 记在会话头里）。 */
	cwd: string;
	/** 子进程的环境变量（**凭据只走环境变量 ⇒ 不落盘**）。 */
	env: NodeJS.ProcessEnv;
	/** 要不要开审批缝（`approval/request` ⇒ 我们的闸门）。 */
	approvalRequests?: boolean;
}

/** 事件订阅者。 */
export type DshEventHandler = (event: DshSessionEvent) => void;

/** 审批应答者。 */
export type DshApprovalHandler = (
	request: DshApprovalRequest,
) => Promise<DshApprovalOutcome>;

/**
 * dsh 运行时客户端（**一个会话一个** —— 每个会话有自己的运行时进程）。
 *
 * ⚠️ **为什么一个会话一个进程**：
 * - **鉴权**：MCP 与命令桥都按**用户**鉴权 ⇒ 一个进程一个用户 ⇒ 不串味；
 * - **中止**（D2=A）：协议没有 cancel ⇒ 「停止生成」= 停掉**这个**进程 ⇒
 *   不影响别的会话；
 * - **隔离**：dsh 是 RC ⇒ 崩了只崩一个会话。
 */
export class DshClient {
	readonly #client: HarnessClient;
	readonly #options: DshClientOptions;
	#approvalHandler: DshApprovalHandler | undefined;
	#closed = false;

	constructor(options: DshClientOptions) {
		this.#options = options;
		this.#client = new HarnessClient({
			profile: options.profile,
			dshHome: options.dshHome,
			dshBin: options.dshBin,
			patches: options.patches === undefined ? undefined : [...options.patches],
			env: options.env,
			initializeTimeoutMs: 30_000,
		});
	}

	/**
	 * 起运行时并握手（`initialize`）。
	 *
	 * ⚠️ **握手失败 ⇒ 进程直接抛错**（不留半死不活的进程）。
	 */
	async start(): Promise<void> {
		this.#client.start();
		this.#client.onRequest(async (method, params) => {
			if (method !== "approval/request") {
				throw new Error(`dsh 运行时发来了不认识的问题：${method}`);
			}
			return this.#answerApproval(params);
		});
		await this.#client.initialize({
			cwd: this.#options.cwd,
			provider: this.#options.provider,
			model: this.#options.model,
			...(this.#options.approvalRequests === true ? { approvalRequests: true } : {}),
		});
	}

	/** 订阅会话事件（`session.event` ⇒ 我们的形状）。 */
	onEvent(handler: DshEventHandler): () => void {
		const subscription = this.#client.subscribe(
			(notification) => notification.method === "session.event",
		);
		void (async () => {
			for await (const notification of subscription) {
				const event = asRecord(notification.params?.["event"]);
				if (event === undefined) {
					continue;
				}
				const type = asString(event["type"]);
				if (type === undefined) {
					continue;
				}
				handler({ type, data: event["data"] });
			}
		})().catch(() => {
			// 运行时死了 ⇒ 订阅结束（会话层负责重建）
		});
		return () => subscription.close();
	}

	/** 装审批应答者（**必须在 `start` 之后**）。 */
	onApproval(handler: DshApprovalHandler): void {
		this.#approvalHandler = handler;
	}

	/** 发一句话（`session/prompt`）。 */
	async prompt(sessionId: string, text: string): Promise<void> {
		await this.#client.prompt(sessionId, [{ type: "text", text }]);
	}

	/** 关掉运行时（协议 `shutdown` + 关停阶梯）。 */
	async close(): Promise<void> {
		if (this.#closed) {
			return;
		}
		this.#closed = true;
		await this.#client.close();
	}

	/** 运行时是不是已经关掉了。 */
	get closed(): boolean {
		return this.#closed;
	}

	/** 应答一次审批（没有应答者 ⇒ 不放行 ⇒ fail closed）。 */
	async #answerApproval(params: Record<string, unknown>): Promise<unknown> {
		const handler = this.#approvalHandler;
		if (handler === undefined) {
			// ⚠️ **没有回答者 ⇒ fail closed**（与今天的口径一致）
			return { outcome: "rejected" };
		}
		const request: DshApprovalRequest = {
			sessionId: asString(params["sessionId"]) ?? "",
			toolName: asString(params["toolName"]) ?? "",
			...(asString(params["callId"]) === undefined
				? {}
				: { callId: asString(params["callId"]) as string }),
			...(asString(params["reason"]) === undefined
				? {}
				: { reason: asString(params["reason"]) as string }),
		};
		const outcome = await handler(request);
		return { outcome };
	}
}
