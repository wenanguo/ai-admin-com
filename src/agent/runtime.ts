/**
 * Agent 运行时 —— 把「会话 / 命令 / 事件流」串起来。
 *
 * ```
 * 前端 ──POST /command──▶ 运行时 ──▶ 启动锁（同会话串行）──▶ pi 会话
 *   │                          │                                  │
 *   │                          ├──▶ ai_message（用户/助手的话）    │
 *   └──GET /events (SSE)◀──────┴──── 事件发布 ◀──────────────────┘
 * ```
 *
 * ## 关键约定
 *
 * - **同一会话的 prompt 串行**（启动锁）：pi 在流式输出期间再 `prompt()` 会抛
 *   `Agent is already processing` ⇒ 必须排队，不能报错。
 * - **命令立即返回**：HTTP 响应只说「收到了」，真正的结果走 SSE
 *   （`success: true` 的含义是「已受理并排队」）。
 * - **快照才是真相**：`GET /api/agent/:cid/state` 返回完整的会话与消息，
 *   客户端随时可以用它重建界面。
 */

import { AadminClient } from "../aadmin/client";
import { AadminDataSource } from "../adapter/datasource";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { PrismaAuditWriter, type AuditWriter } from "../audit";
import { redactAuditArgs } from "../audit-redact";
import { env } from "../env";
import { buildFrame } from "../http/sse";
import type { TaskCreator } from "../tools/create-task";
import { buildCommandTools } from "../tools";
import { setEnumWarningSink, standardEnumWarningSink } from "../adapter/enums";
import { SSE_EVENTS, type SseEventName, type SsePayload } from "./events";
import { AgentEventMapper, extractAssistantText, isAssistantMessage } from "./event-mapper";
import type { AiTaskContext } from "./context";
import { parseAiTaskContext, renderAiTaskContext, writeTargetId, WRITABLE_FIELDS } from "./context";
import { CurrentUserResolver, type CurrentUser } from "./identity";
import { createGateExtension } from "./gate";
import { createAiadminMcpExtension } from "./mcp";
import { pendingWaiters } from "./pending-waiters";
import { createPiSession, type PiSessionOptions } from "./pi-session";
import { PM_AGENT_PROMPT } from "./prompt";
import {
	SessionRegistry,
	type AgentSessionLike,
	type ChannelSubscriber,
	type ConversationChannel,
} from "./session-registry";
import { StartupLock } from "./startup-lock";
import { ConversationStore, type ConversationRecord, type MessageRecord } from "./store";

/** 运行时的错误种类。 */
export type AgentErrorKind = "NOT_FOUND" | "VALIDATION" | "AUTH_EXPIRED" | "UPSTREAM";

/** 运行时自己的错误（不是 AiAdmin 那边来的）。 */
export class AgentError extends Error {
	readonly kind: AgentErrorKind;

	constructor(kind: AgentErrorKind, message: string) {
		super(message);
		this.name = "AgentError";
		this.kind = kind;
	}
}

/** 命令的受理结果（前端拿它对 Idempotency-Key）。 */
export interface CommandAck {
	/** 回显请求里的命令 id。 */
	id: string;
	/** 固定 "response"。 */
	type: "response";
	/** 已受理并排队。 */
	success: boolean;
}

/**
 * 命令类型。
 *
 * | 类型 | 含义 |
 * | ---- | ---- |
 * | `prompt` | 说一句话（**默认**）。当前没有轮次在跑 ⇒ 立刻开始跑；在跑 ⇒ 当成 followUp（排队，不打断） |
 * | `prompt-followup` | 明确排队：当前轮干完活再处理这句 |
 * | `prompt-steer` | 打断：插到当前助手轮次（及其工具调用）之后 |
 *
 * ⚠️ 后两种是 pi 的**原生**排队语义（`session.followUp()` / `session.steer()`），
 * 见 SDK 文档的 Prompting 一节。自己造队列只能做到「等整轮跑完」。
 */
export type CommandType = "prompt" | "prompt-followup" | "prompt-steer";

/**
 * 每个会话最多记多少个命令 id（超出就淘汰最老的那个）。
 *
 * ⚠️ **有上限是必须的**：这是**进程内**的 Map，不淘汰就会被长跑进程吃满内存。
 */
const MAX_TRACKED_COMMANDS_PER_CONVERSATION = 64;

/** 最多给多少个会话记命令 id（会话多了也不能把内存吃满）。 */
const MAX_TRACKED_CONVERSATIONS = 128;

/** 会话状态（`GET /api/agent/:cid/state` 的 data）。 */
export interface ConversationState {
	conversationId: string;
	messages: MessageRecord[];
	isStreaming: boolean;
	model: string;
}

/** 运行时可注入的依赖（测试用假实现，生产用默认）。 */
export interface AgentRuntimeOptions {
	/** 造 pi 会话（带会话 id 与历史 —— 上下文就靠这个还原）。 */
	createSession?: (options: PiSessionOptions) => Promise<AgentSessionLike>;
	/** 数据源工厂。 */
	createDataSource?: (token: string) => TaskCreator;
	/** 解析当前用户。 */
	resolveUser?: (token: string) => Promise<CurrentUser>;
	/** 存取。 */
	store?: ConversationStore;
	/** 对外显示的模型标识。 */
	model?: string;
	/** 审计去处（生产用 `PrismaAuditWriter`，测试用假实现）。 */
	audit?: AuditWriter;
	/**
	 * AiAdmin 的 MCP 地址。
	 *
	 * - `undefined`（不给）⇒ 取环境变量 `AIADMIN_MCP_URL`；
	 * - `null` ⇒ **显式不接 MCP**（测试用；否则会被环境变量带偏）。
	 *
	 * ⚠️ **缺省不接**：后端的 MCP 还没上线 ⇒ 接了只会每次建会话都连接失败
	 * （噪音 + 延迟）⇒ 显式配上才接。
	 */
	mcpUrl?: string | null;
	/** 每个会话最多记多少个命令 id（测试用；生产用默认上限）。 */
	maxTrackedCommands?: number;
}

export class AgentRuntime {
	readonly #registry = new SessionRegistry();
	readonly #lock = new StartupLock();
	readonly #store: ConversationStore;
	readonly #createSession: NonNullable<AgentRuntimeOptions["createSession"]>;
	readonly #createDataSource: (token: string) => TaskCreator;
	readonly #resolveUser: (token: string) => Promise<CurrentUser>;
	readonly #model: string;
	readonly #userResolver: CurrentUserResolver;
	/** 每个会话的事件映射器。 */
	readonly #mappers = new Map<string, AgentEventMapper>();
	/** 审计去处（每次写操作都留一条 `ai_audit_log`）。 */
	readonly #audit: AuditWriter;
	/** AiAdmin 的 MCP 地址（**没配就不接 MCP**）。 */
	readonly #mcpUrl: string | undefined;
	/** 命令 id ⇒ 上次的 ack（**幂等**：同一个 id 不跑两遍）。 */
	readonly #acks = new Map<string, Map<string, CommandAck>>();
	/** 每个会话最多记多少个命令 id。 */
	readonly #maxTrackedCommands: number;

	constructor(options: AgentRuntimeOptions = {}) {
		this.#store = options.store ?? new ConversationStore();
		this.#createSession = options.createSession ?? createPiSession;
		this.#model = options.model ?? env.AI_MODEL;
		this.#audit = options.audit ?? new PrismaAuditWriter();
		this.#mcpUrl =
			options.mcpUrl === null ? undefined : (options.mcpUrl ?? env.AIADMIN_MCP_URL);
		this.#maxTrackedCommands = options.maxTrackedCommands ?? MAX_TRACKED_COMMANDS_PER_CONVERSATION;

		const client = new AadminClient({ baseUrl: env.AIADMIN_BASE_URL });
		this.#userResolver = new CurrentUserResolver(client);
		this.#resolveUser =
			options.resolveUser ?? ((token: string) => this.#userResolver.resolve(token));
		this.#createDataSource =
			options.createDataSource ??
			((token: string) =>
				new AadminDataSource({
					client: new AadminClient({ baseUrl: env.AIADMIN_BASE_URL }),
					token,
					// ⚠️ 告警不许被悄悄丢掉 ⇒ 注入一个会打日志的去处
					onWarning: standardEnumWarningSink,
				}));

		// 进程级的告警去处也装上（不只数据源这一条路径）
		setEnumWarningSink(standardEnumWarningSink);
	}

	/** 建一个会话。 */
	async createConversation(userId: string, title?: string): Promise<ConversationRecord> {
		const conversation = await this.#store.create(userId, title ?? null);
		this.#registry.ensure(conversation.conversationId);
		return conversation;
	}

	/** 列某个用户的会话。 */
	async listConversations(userId: string): Promise<ConversationRecord[]> {
		return this.#store.list(userId);
	}

	/**
	 * 提交一条命令（`type: "prompt"`）。
	 *
	 * 立即返回「已受理」；真正的执行在后台排队跑，结果走 SSE。
	 *
	 * ## 幂等（Idempotency-Key）
	 *
	 * **同一个会话 + 同一个 `commandId` 再来一次 ⇒ 回上次那个 ack，不再跑一遍。**
	 * 本切片唯一的命令是**写** ⇒ 重跑一次就是多建一个任务，而且前端只看到「成功」。
	 * 客户端重试、双击、代理重发都会撞上这个窗口 ⇒ 去重做在运行时这一层。
	 *
	 * @param request.userId 当前用户 id（用来确认这个会话是他的）。
	 */
	async submitCommand(request: {
		conversationId: string;
		token: string;
		message: string;
		commandId: string;
		userId: string;
		/** 命令类型（缺省 `prompt`）。 */
		type?: CommandType;
		/** 当前讨论的上下文（前端点「与 AI 讨论」时带上）。 */
		context?: unknown;
	}): Promise<CommandAck> {
		const message = request.message.trim();
		if (message.length === 0) {
			throw new AgentError("VALIDATION", "消息不能为空");
		}
		const conversation = await this.#store.get(request.conversationId);
		if (conversation === undefined || conversation.userId !== request.userId) {
			// ⚠️ 「不属于你」与「不存在」回**同一个**说法 —— 不泄露会话是否存在
			throw new AgentError("NOT_FOUND", `会话 ${request.conversationId} 不存在`);
		}

		// ⚠️ 幂等：同一个 commandId 再来一次 ⇒ 回上次那个 ack（**不再跑一遍**）
		const known = this.#ackOf(request.conversationId, request.commandId);
		if (known !== undefined) {
			return known;
		}

		// ⚠️ **token 变了 ⇒ 重建会话**：老会话的 MCP 连接带着**旧 token**
		//    ⇒ 模型调 MCP 时用的还是上一个人的身份（越权）。
		//    ⇒ 直接把老通道关掉（连带 dispose 掉 pi 会话与 MCP 连接）。
		const previous = this.#registry.get(request.conversationId);
		if (
			previous !== undefined &&
			previous.token !== undefined &&
			previous.token !== request.token
		) {
			this.#registry.close(request.conversationId);
		}

		const channel = this.#registry.ensure(request.conversationId);
		// ⚠️ **当前用户**：写审计要记「谁干的」。
		channel.userId = request.userId;
		// ⚠️ **上下文是「此刻」的**：每条带上下文的消息都会覆盖它 ⇒
		//    用户换一条任务继续聊 ⇒ 上下文跟着换。
		//    没有上下文（普通聊天）⇒ 清掉 ⇒ 闸门不再收窄字段。
		const taskContext = parseAiTaskContext(request.context);
		channel.taskContext = taskContext ?? undefined;
		// token 只在内存里；每次命令都刷新（token 轮换后能用新的那个）
		channel.token = request.token;

		// 用户说的这句话先落库（state 里立刻能看到）
		const seq = channel.allocateSeq(await this.#store.maxSeq(request.conversationId));
		const userMessage = await this.#store.appendMessage(
			request.conversationId,
			"USER",
			message,
			seq,
		);

		// 发起这一轮（排队语义见 `CommandType`）
		// ⚠️ **给模型的话** = 上下文块 + 用户的话；**库里存的是用户原话**
		//    （界面里显示的必须是用户自己打的那句，不能混进系统生成的上下文）。
		const modelMessage =
			taskContext == null
				? message
				: `${renderAiTaskContext(taskContext)}

${message}`;
		void this.#dispatchTurn(
			channel,
			modelMessage,
			request.type ?? "prompt",
			userMessage.id,
			request.userId,
		).catch((error: unknown) => {
			this.#publishTurnError(channel, error);
		});

		const ack: CommandAck = { id: request.commandId, type: "response", success: true };
		this.#rememberAck(request.conversationId, request.commandId, ack);
		return ack;
	}

	/** 订阅某个会话的事件流；返回退订函数。 */
	subscribe(conversationId: string, subscriber: ChannelSubscriber): () => void {
		return this.#registry.subscribe(conversationId, subscriber);
	}

	/** 取某个会话的通道（没有就 undefined）—— SSE 端点用它读回放窗口。 */
	getChannel(conversationId: string): ConversationChannel | undefined {
		return this.#registry.get(conversationId);
	}

	/**
	 * 解析 token 对应的当前用户。
	 *
	 * ⚠️ **本服务不自己校验 token** —— 问 AiAdmin（它是权威）。
	 * token 无效时抛 `AdapterErrorException("AUTH_EXPIRED")`，由路由转成 401 信封。
	 */
	async resolveCurrentUser(token: string): Promise<CurrentUser> {
		return this.#resolveUser(token);
	}

	/**
	 * 会话状态（快照）。
	 *
	 * @param userId 当前用户 id（别人的会话不给看）。
	 */
	async readState(conversationId: string, userId: string): Promise<ConversationState> {
		const conversation = await this.#store.get(conversationId);
		if (conversation === undefined || conversation.userId !== userId) {
			throw new AgentError("NOT_FOUND", `会话 ${conversationId} 不存在`);
		}
		const messages = await this.#store.listMessages(conversationId);
		const channel = this.#registry.get(conversationId);
		return {
			conversationId,
			messages,
			isStreaming: channel?.isStreaming ?? false,
			model: this.#model,
		};
	}

	/** 关掉一个会话（释放 pi 会话）。 */
	close(conversationId: string): void {
		this.#registry.close(conversationId);
	}

	/** 关掉全部会话（进程退出时）。 */
	closeAll(): void {
		this.#registry.closeAll();
	}

	/**
	 * 停掉当前正在跑的那一轮（用户点「停止生成」）。
	 *
	 * ⚠️ SDK 的 `session.abort()`：停掉当前操作并等到会话空闲。
	 *    pi 自己会发 `agent_settled` ⇒ 前端的输入框会解禁。
	 *
	 * @param conversationId 会话 id。
	 * @param userId 当前用户 id（不是他的会话就不给停）。
	 */
	async abort(conversationId: string, userId: string): Promise<void> {
		const conversation = await this.#store.get(conversationId);
		if (conversation === undefined || conversation.userId !== userId) {
			throw new AgentError("NOT_FOUND", `会话 ${conversationId} 不存在`);
		}
		const channel = this.#registry.get(conversationId);
		if (channel === undefined) {
			return;
		}
		const session = channel.session;
		if (session === undefined) {
			// 根本没有在跑的会话 ⇒ 告诉前端「这一轮已经结束了」（输入框解禁）
			this.#publish(channel, SSE_EVENTS.AGENT_SETTLED, { conversationId });
			return;
		}
		if (session.abort === undefined) {
			return;
		}
		await session.abort();
	}

	/* ------------------------------------------------------------ 内部 */

	/**
	 * MCP 写成功 ⇒ 落一条审计（`ai_audit_log`）。
	 *
	 * ⚠️ **写审计失败不许把已经写下去的东西弄丢** ⇒ 失败只记一条日志。
	 */
	#writeAudit(
		channel: ConversationChannel,
		write: { toolName: string; args: Record<string, unknown> },
		event: { result?: unknown },
	): void {
		const userId = channel.userId;
		if (userId === undefined) {
			return;
		}
		void this.#audit
			.write({
				actorType: "AI",
				command: write.toolName.replace(/^mcp__[^_]+__/, ""),
				args: redactAuditArgs(write.args),
				// 写前快照：讨论上下文里的基线（没有上下文就没有写前）
				before: channel.taskContext?.task ?? null,
				// 写后快照：工具回执（截断，别把整份响应塞进审计表）
				after: summarizeResult(event.result),
				userId,
				model: this.#model,
			})
			.catch((error: unknown) => {
				console.error("[audit] 写 ai_audit_log 失败（数据已写入，不要重试）", error);
			});
	}

	/** 取上次这个命令 id 的 ack（没有 ⇒ undefined）。 */
	#ackOf(conversationId: string, commandId: string): CommandAck | undefined {
		const acks = this.#acks.get(conversationId);
		if (acks === undefined) {
			return undefined;
		}
		const ack = acks.get(commandId);
		if (ack !== undefined) {
			// 刷新一下位置（最近用过的会话最后被淘汰）
			acks.delete(commandId);
			acks.set(commandId, ack);
		}
		return ack;
	}

	/** 记下「这个命令 id 已经受理过」（满了就淘汰最老的）。 */
	#rememberAck(conversationId: string, commandId: string, ack: CommandAck): void {
		let acks = this.#acks.get(conversationId);
		if (acks === undefined) {
			acks = new Map<string, CommandAck>();
		}
		// 先删后插 ⇒ 这条变成「最新的一条」，淘汰时最后被淘汰
		acks.delete(commandId);
		acks.set(commandId, ack);
		while (acks.size > this.#maxTrackedCommands) {
			const oldest = acks.keys().next();
			if (oldest.done) {
				break;
			}
			acks.delete(oldest.value);
		}
		// 外层也有上限（会话多了不能把内存吃满）
		this.#acks.delete(conversationId);
		this.#acks.set(conversationId, acks);
		while (this.#acks.size > MAX_TRACKED_CONVERSATIONS) {
			const oldest = this.#acks.keys().next();
			if (oldest.done) {
				break;
			}
			this.#acks.delete(oldest.value);
		}
	}

	/**
	 * 发起一轮对话。
	 *
	 * ## 排队语义（用 pi 的原生能力）
	 *
	 * - 当前**没有**轮次在跑 ⇒ 直接 `prompt()`；
	 * - 当前**有**轮次在跑 ⇒
	 *   - `prompt-steer` ⇒ `session.steer()`：插到当前助手轮次（及其工具调用）之后；
	 *   - 其它 ⇒ `session.followUp()`：当前轮干完活再处理这句（**不打断**）。
	 *
	 * ⚠️ 自己造队列（`StartupLock`）只能做到「等整轮跑完」⇒ 能用 SDK 原生
	 *    语义的地方就用原生的（SDK 文档 · Prompting 一节）。
	 *
	 * @param channel 会话通道。
	 * @param message 用户说的那句话。
	 * @param type 命令类型。
	 * @param currentMessageId **当前这句**消息的 id（要排除在历史之外，见下）。
	 */
	async #dispatchTurn(
		channel: ConversationChannel,
		message: string,
		type: CommandType,
		currentMessageId: string,
		userId: string,
	): Promise<void> {
		const session = await this.#ensureSession(channel, currentMessageId, userId);

		// 已经有轮次在跑 ⇒ 走 pi 的排队语义
		if (session.isStreaming && (await this.#queueInto(channel, session, message, type))) {
			return;
		}

		await this.#lock.run(channel.conversationId, async () => {
			// 拿到锁后再看一眼（可能刚被别人起了一轮）
			if (session.isStreaming && (await this.#queueInto(channel, session, message, type))) {
				return;
			}
			await session.prompt(message, { expandPromptTemplates: false });
		});
	}

	/**
	 * 把这句话排进当前正在跑的那一轮。
	 *
	 * @returns 排进去了 ⇒ true；pi 不接受 ⇒ false（落回普通排队）。
	 */
	async #queueInto(
		channel: ConversationChannel,
		session: AgentSessionLike,
		message: string,
		type: CommandType,
	): Promise<boolean> {
		try {
			if (type === "prompt-steer" && session.steer !== undefined) {
				await session.steer(message);
				return true;
			}
			if (type !== "prompt-steer" && session.followUp !== undefined) {
				await session.followUp(message);
				return true;
			}
		} catch (error) {
			// ⚠️ pi 不接受这句话（比如它被当成了扩展命令）⇒ 落回普通排队。
			//    不当错误报出去：那句话本身没毛病，只是排队的路子走不通。
			console.warn("[agent] 排队进当前轮没成，改成正常排队", error);
		}
		return false;
	}

	/** 懒创建 pi 会话（同一个会话复用同一个）。 */
	async #ensureSession(
		channel: ConversationChannel,
		currentMessageId?: string,
		userId?: string,
	): Promise<AgentSessionLike> {
		if (channel.session !== undefined) {
			return channel.session;
		}
		const tools = buildCommandTools({
			currentToken: () => channel.token,
			createDataSource: this.#createDataSource,
			resolveReporterId: async (token: string) => (await this.#resolveUser(token)).id,
			audit: this.#audit,
			model: this.#model,
		});
		// ★ 把这个会话的历史交给 pi ⇒ **模型记得之前聊过什么**。
		//    pi 会话是内存态、懒创建的 ⇒ 不还原历史的话，进程重启或通道被回收后
		//    新建的会话是空白的（前端看得见历史，模型看不见）。
		//
		// ⚠️ **当前这句要从历史里排除**：它随后会被 `session.prompt(message)`
		//    加进 pi 的消息列表 ⇒ 两边都放 ⇒ 模型看到同一句话两遍。
		const messages = await this.#store.listMessages(channel.conversationId);
		const history =
			currentMessageId === undefined
				? messages
				: messages.filter((row) => row.id !== currentMessageId);
		const session = await this.#createSession({
			tools,
			systemPrompt: PM_AGENT_PROMPT,
			conversationId: channel.conversationId,
			history,
			model: this.#model,
			// ⚠️ MCP 的身份 = **当次调用方的 token**（每个会话一份）
			mcp:
				this.#mcpUrl === undefined
					? undefined
					: { url: this.#mcpUrl, token: channel.token ?? "" },
			// ⚠️ **闸门**：修改已有数据要等人点头（用户 2026-11-06 定的口径）。
			//    挂起时推一个 `pending` 事件 ⇒ 前端「待确认」页签能看到。
			gate:
				userId === undefined
					? undefined
					: createGateExtension({
							waiters: pendingWaiters,
							context: () => ({
								conversationId: channel.conversationId,
								userId: userId as string,
								// ⚠️ 有上下文 ⇒ 闸门把写操作**收窄**到允许回填的字段
								taskContext: channel.taskContext,
								onPending: (row) => {
									this.#publish(channel, SSE_EVENTS.PENDING, {
										conversationId: channel.conversationId,
										id: row.id,
										command: row.command,
										args: row.args,
									});
								},
							}),
						}),
		});
		channel.session = session;
		channel.unsubscribe = session.subscribe((event) => {
			this.#handleEvent(channel, event);
		});
		return session;
	}

	/** pi 事件 → 发布 SSE 帧。 */
	#handleEvent(channel: ConversationChannel, event: AgentSessionEvent): void {
		// ⚠️ **写回成功 ⇒ 告诉前端「哪条任务变了」**
		//    （前端据此刷新左边的列表/看板/甘特，并把那一行高亮）。
		//    ⚠️ 参数在闸门里被**就地改写过**（收窄成允许回填的字段）⇒
		//    这里读到的就是**真正写下去的那份**。
		if (event.type === "tool_execution_start") {
			const args = (event.args ?? {}) as Record<string, unknown>;
			// ⚠️ **MCP 的写也要留审计**（我们自己的工具自己写审计）
			//    ⇒ 这里记一份参数，等执行成功后再落 `ai_audit_log`。
			if (isMcpWriteTool(event.toolName)) {
				channel.lastMcpWrite = { toolName: event.toolName, args };
			}
			const entityId = writeTargetId(event.toolName, args, channel.taskContext ?? null);
			if (entityId !== undefined) {
				channel.lastWrite = {
					toolName: event.toolName,
					entityId,
					fields: changedFields(args, channel.taskContext?.task ?? {}),
				};
			}
		}
		if (event.type === "tool_execution_end" && event.isError !== true) {
			const write = channel.lastWrite;
			// ⚠️ **MCP 写成功 ⇒ 落一条审计**（写前快照用讨论上下文里的基线）
			const mcpWrite = channel.lastMcpWrite;
			if (mcpWrite !== undefined && mcpWrite.toolName === event.toolName) {
				channel.lastMcpWrite = undefined;
				this.#writeAudit(channel, mcpWrite, event);
			}
			if (write !== undefined && write.toolName === event.toolName) {
				channel.lastWrite = undefined;
				this.#publish(channel, SSE_EVENTS.ENTITY_UPDATED, {
					conversationId: channel.conversationId,
					entityType: "task",
					entityId: write.entityId,
					fields: write.fields,
				});
			}
		}
		if (event.type === "agent_start") {
			channel.isStreaming = true;
		}
		if (event.type === "agent_settled") {
			channel.isStreaming = false;
		}
		const mapper = this.#mapperOf(channel.conversationId);
		for (const mapped of mapper.map(channel.conversationId, event)) {
			this.#publish(channel, mapped.event, mapped.payload);
		}
		if (event.type === "message_end" && isAssistantMessage(event.message)) {
			// ⚠️ **只存助手的话**：用户那句话是运行时自己存的（角色 USER），
			// 工具结果消息（role=toolResult）也不是对话内容 —— 存进来会把界面弄乱。
			const text = extractAssistantText(event.message);
			if (text.trim().length > 0) {
				void this.#appendAssistantMessage(channel, text);
			}
		}
	}

	/** 每个会话一个事件映射器（它要记住「这一轮助手消息开过头没有」）。 */
	#mapperOf(conversationId: string): AgentEventMapper {
		const existing = this.#mappers.get(conversationId);
		if (existing !== undefined) {
			return existing;
		}
		const mapper = new AgentEventMapper();
		this.#mappers.set(conversationId, mapper);
		return mapper;
	}

	/** 助手说的话落库。 */
	async #appendAssistantMessage(channel: ConversationChannel, text: string): Promise<void> {
		try {
			const seq = channel.allocateSeq(await this.#store.maxSeq(channel.conversationId));
			await this.#store.appendMessage(channel.conversationId, "ASSISTANT", text, seq);
			await this.#store.touch(channel.conversationId);
		} catch (error) {
			// 落库失败不该影响正在进行的对话（前端还能从 SSE 看到内容）
			console.error("[agent] 助手消息落库失败", error);
		}
	}

	/** 发布一帧。 */
	#publish(channel: ConversationChannel, event: SseEventName, payload: SsePayload): void {
		this.#registry.publish(channel, buildFrame(event, payload));
	}

	/** 一轮出错（模型挂了、上游 500……）：把原因告诉前端。 */
	#publishTurnError(channel: ConversationChannel, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[agent] 这一轮没能完成", error);
		this.#publish(channel, SSE_EVENTS.MESSAGE_END, {
			conversationId: channel.conversationId,
			text: `这一轮没能完成：${message}`,
			error: message,
		});
		this.#publish(channel, SSE_EVENTS.AGENT_SETTLED, { conversationId: channel.conversationId });
		channel.isStreaming = false;
	}
}

/**
 * 这个工具是不是「**MCP 的写**」（会改数据的那种）。
 *
 * ⚠️ 只管 **MCP** 的工具（带 `mcp__<server>__` 前缀）：
 *    我们自己的工具（create_task 等）**自己写审计** ⇒ 别写两遍。
 */
function isMcpWriteTool(toolName: string): boolean {
	if (!toolName.startsWith("mcp__")) {
		return false;
	}
	const bare = toolName.replace(/^mcp__[^_]+__/, "");
	return bare.startsWith("create_") || bare.startsWith("update_") || bare.startsWith("patch_");
}

/** 工具回执 → 一个**短**的写后快照（别把整份响应塞进审计表）。 */
function summarizeResult(result: unknown): unknown {
	if (result === undefined || result === null) {
		return null;
	}
	const record = result as { content?: unknown; details?: unknown };
	const content = record.content;
	if (Array.isArray(content)) {
		const text = content
			.map((part) =>
				typeof part === "object" && part !== null
					? String((part as { text?: unknown }).text ?? "")
					: String(part),
			)
			.join("")
			.trim();
		if (text.length > 0) {
			return text.slice(0, 4000);
		}
	}
	if (record.details !== undefined) {
		return record.details;
	}
	return result;
}

/* ------------------------------------------------------------ 进程级单例 */

const globalForAgent = globalThis as unknown as { agentRuntime?: AgentRuntime };

/** 进程级的运行时（dev 热重载复用同一个，别每次都重建）。 */
export const agentRuntime: AgentRuntime = globalForAgent.agentRuntime ?? new AgentRuntime();

if (process.env.NODE_ENV !== "production") {
	globalForAgent.agentRuntime = agentRuntime;
}

/**
 * 这一轮**实际改了哪几个字段**（与基线比出来的）。
 *
 * ⚠️ 不能直接看「参数里有哪些可写字段」—— 整对象 PUT 的参数里**每个**可写字段都在
 *    （基线带的）⇒ 那样报出来会显得「全都改了」。
 * ⇒ 与基线逐个比：**值不同**才算改了。
 */
function changedFields(args: Record<string, unknown>, baseline: Record<string, unknown>): string[] {
	const fields: string[] = [];
	for (const key of WRITABLE_FIELDS) {
		if (!(key in args)) {
			continue;
		}
		const before = baseline[key];
		const after = args[key];
		if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
			fields.push(key);
		}
	}
	return fields;
}
