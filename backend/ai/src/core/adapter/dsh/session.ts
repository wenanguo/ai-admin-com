/**
 * dsh 会话 —— 运行时眼里的「一个会话」（实现 `AgentSessionLike`）。
 *
 * ## 它是什么
 *
 * 一个 **dsh 运行时子进程** + 一个**事件翻译器** + 一个**闸门接线**。
 * ⇒ 运行时（`core/session/runtime.ts`）**一个字不改**就能用 dsh 跑。
 *
 * ## 中止（D2=A）：协议没有 cancel ⇒ 停掉并重建
 *
 * dsh 的 SDK 协议**没有 `session/cancel`**（spec §9 D2）
 * ⇒ 「停止生成」只能**把这个会话的 dsh 进程停掉**（下次说话时重建）。
 * ⇒ 影响面 = **这个会话**（每个会话一个进程 ⇒ 不影响别人）。
 *
 * ⚠️ 已知的取舍：停掉进程会丢掉这一轮 dsh 侧的上下文
 *    （我们的消息历史在 `ai_message` 表里 ⇒ 下一次重建时会把历史还原回去）。
 */

import type { AgentEvent } from "../../session/agent-event.ts";
import { DshClient } from "./client.ts";
import { DshEventTranslator } from "./events.ts";
import { decideApproval, type DshGateContext } from "./approvals.ts";
import type { DshApprovalOutcome, DshSessionEvent } from "./protocol.ts";
import type { DshTracer } from "./persistence.ts";
import type { CommandTool } from "../../tools/types.ts";
import type { AgentSessionLike } from "../../session/session-registry.ts";
import { narrowWriteArgs, type ContextAnchor, type WriteToolRule } from "../../context/anchor.ts";

/** 造 dsh 会话需要的参数。 */
export interface DshSessionOptions {
	/** 会话 id（**同时是 dsh 的 session id** ⇒ 重建后还是同一个会话）。 */
	conversationId: string;
	/** 我们的命令工具（**已按智能体配置的白名单过滤**）。 */
	tools: readonly CommandTool[];
	/** 系统提示词（**含技能段**）。 */
	systemPrompt: string;
	/** 模型路由名（我们的 provider 插件注册的那个）。 */
	provider: string;
	/** 模型 id。 */
	model: string;
	/** 工作目录。 */
	cwd: string;
	/** dsh 的 home。 */
	dshHome: string;
	/** dsh 的具名 profile。 */
	profile: string;
	/** profile 补丁（把我们的插件插进 profile）。 */
	patches: readonly string[];
	/** dsh 可执行文件（不给 ⇒ SDK 自带的）。 */
	dshBin?: string | undefined;
	/** 子进程的环境变量（**凭据只走这里 ⇒ 不落盘**）。 */
	env: NodeJS.ProcessEnv;
	/** 闸门上下文（**每次调用时取** ⇒ 锚点变了也能用）。 */
	gate: () => Omit<DshGateContext, "argsOf">;
	/** 命令桥的地址（dsh 侧插件回调我们执行命令；**走环境变量传给插件**）。 */
	bridgeUrl?: string | undefined;
	/** 命令桥的密钥（**进程内随机 ⇒ 不落盘**；走环境变量传给插件）。 */
	bridgeSecret?: string | undefined;
	/** 留痕层（**dsh 事件 / 闸门决策 ⇒ 事件日志 + 审计**；不给 ⇒ 不留痕）。 */
	tracer?: DshTracer | undefined;
	/**
	 * 握手的超时（毫秒；不给 ⇒ 缺省 30 秒）。
	 *
	 * ⚠️ **冷启动**：profile 是冷的 ⇒ dsh 要先把它装好才应答 ⇒ 第一次会慢
	 *    ⇒ 撞上限 ⇒ 会话直接起不来（见 `client.ts` 的同名字段）。
	 */
	initializeTimeoutMs?: number | undefined;
}

/** 命令桥的执行结果。 */
export interface DshCommandResult {
	/** 成功与否。 */
	ok: boolean;
	/** 一句话结论（给模型看，也给 SSE 用）。 */
	summary: string;
	/** 结构化详情。 */
	details?: unknown;
}

/**
 * dsh 会话（实现运行时需要的**最小接口**）。
 */
export class DshSession implements AgentSessionLike {
	readonly #options: DshSessionOptions;
	readonly #translator = new DshEventTranslator();
	readonly #listeners = new Set<(event: AgentEvent) => void>();
	#client: DshClient | undefined;
	#unsubscribe: (() => void) | undefined;
	#streaming = false;
	#disposed = false;

	constructor(options: DshSessionOptions) {
		this.#options = options;
	}

	/** 发起一轮对话。 */
	async prompt(text: string): Promise<void> {
		if (this.#disposed) {
			throw new Error("这个 dsh 会话已经关掉了");
		}
		const client = await this.#ensureClient();
		this.#streaming = true;
		try {
			await client.prompt(this.#options.conversationId, text);
		} catch (error) {
			this.#streaming = false;
			throw error;
		}
	}

	/** 订阅事件；返回退订函数。 */
	subscribe(listener: (event: AgentEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** 释放会话（关掉 dsh 进程）。 */
	dispose(): void {
		this.#disposed = true;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		const client = this.#client;
		this.#client = undefined;
		void client?.close();
		this.#listeners.clear();
	}

	/** 正在流式输出？ */
	get isStreaming(): boolean {
		return this.#streaming;
	}

	/**
	 * 停掉当前这一轮（D2=A：协议没有 cancel ⇒ **停掉并重建**这个会话的 dsh 进程）。
	 *
	 * ⚠️ 重建发生在**下一次说话**时（`ensureClient`）。
	 */
	async abort(): Promise<void> {
		const client = this.#client;
		this.#client = undefined;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		this.#streaming = false;
		if (client !== undefined) {
			await client.close();
		}
	}

	/**
	 * 执行我们的命令（**命令桥回调**）。
	 *
	 * ⚠️ **参数在这里收窄**（讨论上下文的写规则）⇒ dsh 侧模型就算想顺手改别的字段，
	 *    也写不进去（与 pi 路径同一套 `narrowWriteArgs`）。
	 */
	async executeCommand(toolName: string, args: Record<string, unknown>): Promise<DshCommandResult> {
		const tool = this.#options.tools.find((item) => item.name === toolName);
		if (tool === undefined) {
			return { ok: false, summary: `工具 ${toolName} 不存在` };
		}
		const context = this.#options.gate();
		const narrowed = narrowArgs(toolName, args, context.anchor, context.writeRules);
		if (narrowed === undefined) {
			return { ok: false, summary: `这次修改超出了允许回填的字段，没有执行。` };
		}
		const result = await tool.execute("dsh", narrowed as never);
		const details = (result as { details?: unknown }).details;
		const summary = summaryOf(result, toolName);
		return { ok: (result as { isError?: boolean }).isError !== true, summary, details };
	}

	/** 拿（或起）dsh 运行时。 */
	async #ensureClient(): Promise<DshClient> {
		const existing = this.#client;
		if (existing !== undefined && !existing.closed) {
			return existing;
		}
		const client = new DshClient({
			profile: this.#options.profile,
			dshHome: this.#options.dshHome,
			dshBin: this.#options.dshBin,
			patches: this.#options.patches,
			provider: this.#options.provider,
			model: this.#options.model,
			cwd: this.#options.cwd,
			env: this.#options.env,
			approvalRequests: true,
			initializeTimeoutMs: this.#options.initializeTimeoutMs,
		});
		await client.start();
		client.onEvent((event) => this.#handleEvent(event));
		client.onApproval((request) => this.#handleApproval(request));
		this.#client = client;
		this.#unsubscribe = () => undefined;
		return client;
	}

	/** dsh 事件 ⇒ 运行时的事件。 */
	#handleEvent(event: DshSessionEvent): void {
		for (const frame of this.#translator.translate(event)) {
			if (frame.type === "agent_settled") {
				this.#streaming = false;
			}
			for (const listener of this.#listeners) {
				try {
					listener(frame);
				} catch {
					// 某个订阅者炸了 ⇒ 不拖累别人
				}
			}
		}
		// ⚠️ **留痕放在订阅者之后** ⇒ 运行时的写审计（`tool/result` ⇒ 写工具自己写过审计）
		//    已经落在留痕带上了 ⇒ 留痕层才不会把同一件事记两遍。
		void this.#options.tracer?.handleEvent(event);
	}

	/** dsh 的审批请求 ⇒ 我们的闸门。 */
	async #handleApproval(request: {
		sessionId: string;
		toolName: string;
		callId?: string;
		reason?: string;
	}): Promise<DshApprovalOutcome> {
		const context = this.#options.gate();
		return decideApproval(request, {
			...context,
			argsOf: (callId) => this.#translator.argsOf(callId),
		});
	}
}

/**
 * 工具结果 → 一句话结论（模型看、界面也看）。
 *
 * ⚠️ 与 pi 路径同一个口径（`event-mapper.ts` 的 `summarizeToolResult`）：
 *    先看 `details.summary`，再看内容里的第一段文本。
 */
function summaryOf(result: unknown, toolName: string): string {
	const record = result as { content?: unknown; details?: unknown };
	const details = record?.details as { summary?: unknown } | undefined;
	if (typeof details?.summary === "string" && details.summary.length > 0) {
		return details.summary;
	}
	const content = record?.content;
	if (Array.isArray(content)) {
		const text = content
			.map((part) => {
				const item = part as { type?: string; text?: unknown };
				return item?.type === "text" && typeof item.text === "string" ? item.text : "";
			})
			.join("")
			.trim();
		if (text.length > 0) {
			return text;
		}
	}
	return `工具 ${toolName} 执行完成`;
}

/**
 * 收窄参数（**收窄不了就返回 undefined** ⇒ 调用方当「没执行」）。
 *
 * ⚠️ 与 pi 路径同一套规则（`narrowWriteArgs`）⇒ 两个 runner 的口径一致。
 */
function narrowArgs(
	toolName: string,
	args: Record<string, unknown>,
	anchor: ContextAnchor | undefined,
	writeRules: readonly WriteToolRule[] | undefined,
): Record<string, unknown> | undefined {
	try {
		return narrowWriteArgs(toolName, args, anchor ?? null, writeRules ?? []).args;
	} catch {
		return undefined;
	}
}
