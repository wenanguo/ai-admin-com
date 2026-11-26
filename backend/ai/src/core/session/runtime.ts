/**
 * Agent 运行时 —— 把「会话 / 命令 / 事件流」串起来。
 *
 * ```
 * 前端 ──POST /command──▶ 运行时 ──▶ 启动锁（同会话串行）──▶ dsh 会话（子进程）
 *   │                          │                                  │
 *   │                          ├──▶ ai_message（用户/助手的话）    │
 *   └──GET /events (SSE)◀──────┴──── 事件桥（翻译成 SSE 词汇）◀────┘
 * ```
 *
 * - **同一会话的 prompt 串行**（启动锁）：会话在流式输出期间再 `prompt()` 会抛
 *   `Agent is already processing` ⇒ 必须排队，不能报错；
 * - **命令立即返回**：HTTP 响应只说「收到了」，真正的结果走 SSE；
 * - **快照才是真相**：`GET /api/agent/:cid/state` 返回完整的会话与消息。
 *
 * ## ⚠️ 边界（issue #175 · S4：把 dsh 已经有的退给 dsh）
 *
 * | 归 dsh | 归我们 |
 * | ------ | ------ |
 * | **会话的生命周期**（`core/adapter/dsh/`） | 身份 / 插件 / 讨论上下文 |
 * | **事件流**（dsh 出事件） | **SSE 词汇的翻译**（`core/session/event-bridge.ts`） |
 * | **会话日志**（dsh 的 session 持久化） | **产品事实**（`ai_conversation` / `ai_message` / `ai_session_event` / `ai_command_ack`） |
 *
 * ⇒ 运行时只剩「**业务适配 + 编排**」⇒ 前端与 9 个端点的契约一个字不动。
 *
 * ## 📌 哪条事件写哪张表（**别重复写、别漏写**）
 *
 * | 事实 | 落哪张表 | 谁写 |
 * | ---- | -------- | ---- |
 * | 用户说的话 | `ai_message`（role=USER） | 运行时（`submitCommand`） |
 * | 助手说的话 | `ai_message`（role=ASSISTANT） | 事件桥（`message_end`） |
 * | dsh 的模型 / 工具 / 闸门事件 | `ai_session_event` | 留痕层（`DshTracer`） |
 * | 模型调用 | `ai_audit_log`（`model_call`） | 留痕层 |
 * | MCP 写成功 | `ai_audit_log`（工具名 + 写前 / 写后快照） | 事件桥（`writeAudit`） |
 * | 人批准 / 拒绝 | `ai_audit_log` + `ai_session_event`（`gate/decided`） | 留痕层 |
 * | 挂起等确认的写操作 | `ai_pending_action` | 闸门（`createPendingAction`） |
 * | 命令回执（幂等） | `ai_command_ack` | 运行时（`#rememberAck`） |
 *
 * ⚠️ **工具调用只补一条审计**（写工具自己写的那条更全 ⇒ 不重复记同一件事）。
 */

import { PrismaAuditWriter, type AuditWriter } from "../audit/audit.ts";
import { AuditTrail } from "../audit/audit-trail.ts";
import { redactAuditArgs, summarizeAuditResult } from "../audit/audit-redact.ts";
import { env } from "../env/env.ts";
import { buildFrame } from "../http/sse.ts";
import { stripMcpToolPrefix } from "../mcp/tool-names.ts";
import type { McpToolContext } from "../mcp/tool.ts";
import { pluginRegistry, type PluginRegistry } from "../plugins.ts";
import {
	conversationIdFor,
	createFileAgentProvider,
	type AgentProvider,
} from "../config/registry.ts";
import { agentsRoot } from "../config/loader.ts";
import {
	PrismaSessionEventStore,
	summarizeSessionEvent,
	type SessionEventStore,
	type SessionEventSummary,
} from "../store/session-events.ts";
import {
	PrismaCommandAckStore,
	type CommandAck,
	type CommandAckStore,
} from "../store/command-acks.ts";
import { ConversationStore, type ConversationRecord, type MessageRecord } from "../store/store.ts";
import { listSkillSummaries, type SkillSummary } from "../adapter/dsh/skills.ts";
import { openDshSession } from "../adapter/dsh/session-factory.ts";
import type { AgentSessionLike } from "../adapter/dsh/session.ts";
import { createDshSession, type CreateDshSessionOptions } from "../adapter/dsh/runner.ts";
import { SSE_EVENTS, type SseEventName, type SsePayload } from "./events.ts";
import { bridgeEvent, type EventBridgeHooks } from "./event-bridge.ts";
import type { CurrentUser } from "./identity.ts";
import { AgentError } from "./agent-error.ts";
import { AgentResolver } from "./agent-resolver.ts";
import { dispatchTurn, type CommandType } from "./turn-queue.ts";
import {
	SessionRegistry,
	type ChannelSubscriber,
	type ConversationChannel,
} from "./session-registry.ts";
import { StartupLock } from "./startup-lock.ts";

/** 运行时的错误种类（**从 `agent-error.ts` 来** ⇒ 别的模块不用反向依赖本文件）。 */
export type { AgentErrorKind } from "./agent-error.ts";
/** 运行时自己的错误（**从 `agent-error.ts` 来**）。 */
export { AgentError } from "./agent-error.ts";
/** 命令类型（**从 `turn-queue.ts` 来**）。 */
export type { CommandType } from "./turn-queue.ts";

/** 会话状态（`GET /api/agent/:cid/state` 的 data）。 */
export interface ConversationState {
	conversationId: string;
	messages: MessageRecord[];
	isStreaming: boolean;
	model: string;
	/** 会话事件（**dsh 形状的追加式日志折叠出来的**）。 ·  */
	sessionEvents: SessionEventSummary[];
}

/** 运行时可注入的依赖（测试用假实现，生产用默认）。 */
export interface AgentRuntimeOptions {
	/** 造 dsh 会话（**唯一的执行层**；⚠️ 测试可注入 ⇒ 单测不起 dsh 进程）。 */
	createDshSession?: (options: CreateDshSessionOptions) => Promise<AgentSessionLike>;
	/** 插件注册表（**命令目录与身份查询都从这儿来**；缺省用进程级注册表）。 */
	plugins?: PluginRegistry;
	/** 解析当前用户（不给 ⇒ 问插件）。 */
	resolveUser?: (token: string) => Promise<CurrentUser>;
	/** 存取。 */
	store?: ConversationStore;
	/** 对外显示的模型标识。 */
	model?: string;
	/** 审计去处（生产用 `PrismaAuditWriter`，测试用假实现）。 */
	audit?: AuditWriter;
	/** 会话事件日志（**dsh 形状**；生产用 Prisma，测试用假实现）。 */
	sessionEvents?: SessionEventStore;
	/** 命令回执（**幂等的事实源**；生产用 `ai_command_ack` 表，测试用假实现）。 ·  */
	commandAcks?: CommandAckStore;
	/** AiAdmin 的 MCP 地址：`undefined` ⇒ 用**插件给的**默认地址；`null` ⇒ **显式不接**。 ·  */
	mcpUrl?: string | null;
	/** 要不要**恢复 dsh 侧的历史**（`session/resume` ⇒ dsh 的会话持久化）。 ·  */
	resumeDshSession?: boolean;
	/** 智能体来源（**默认读 `agents/` 目录**；测试可以注入假的）。 */
	agents?: AgentProvider;
}

export class AgentRuntime {
	readonly #registry = new SessionRegistry();
	readonly #lock = new StartupLock();
	readonly #store: ConversationStore;
	/** 造 dsh 会话（测试可注入假的）。 */
	readonly #createDshSession: NonNullable<AgentRuntimeOptions["createDshSession"]>;
	readonly #plugins: PluginRegistry;
	readonly #resolveUser: (token: string) => Promise<CurrentUser>;
	readonly #model: string;
	/** 审计去处（每次写操作都留一条 `ai_audit_log`）。 */
	readonly #audit: AuditTrail;
	/** 会话事件日志（**dsh 形状的追加式日志**）。 */
	readonly #sessionEvents: SessionEventStore;
	/** 命令回执（**幂等的事实源**）。 */
	readonly #commandAcks: CommandAckStore;
	/** MCP 的默认地址（`null` = **显式不接**；`undefined` = 用插件给的）。 */
	readonly #mcpUrl: string | null | undefined;
	/** 要不要恢复 dsh 侧的历史（**默认关**）。 */
	readonly #resumeDshSession: boolean;
	/** 智能体来源（提示词 / 模型 / 技能 / MCP / 工具都从这里来）。 */
	readonly #agents: AgentProvider;
	/** 会话装配的解析器（**哪个智能体 / 插件 / 上下文 / MCP 计划**）。 */
	readonly #resolver: AgentResolver;

	constructor(options: AgentRuntimeOptions = {}) {
		this.#store = options.store ?? new ConversationStore();
		this.#createDshSession = options.createDshSession ?? createDshSession;
		this.#model = options.model ?? env.AI_MODEL;
		this.#audit = new AuditTrail(options.audit ?? new PrismaAuditWriter());
		this.#sessionEvents = options.sessionEvents ?? new PrismaSessionEventStore();
		this.#commandAcks = options.commandAcks ?? new PrismaCommandAckStore();
		// ⚠️ **默认地址归插件**（内核不认识业务系统的地址）：
		//    `undefined` ⇒ 用插件给的；`null` ⇒ **显式不接 MCP**。
		this.#mcpUrl = options.mcpUrl === null ? null : options.mcpUrl;
		this.#resumeDshSession = options.resumeDshSession ?? env.AI_DSH_RESUME;
		// ⚠️ **默认的智能体来源读真文件**（`agents/<id>/agent.yaml`）
		//    ⇒ 非法配置在**构造时**就报错（启动即失败）。
		this.#agents =
			options.agents ?? createFileAgentProvider(agentsRoot(), env.AI_DEFAULT_AGENT);
		// ⚠️ **命令与身份都来自插件**（内核不认识业务）⇒ 运行时只读注册表。
		this.#plugins = options.plugins ?? pluginRegistry;
		this.#resolveUser =
			options.resolveUser ?? ((token: string) => this.#resolveUserByPlugin(token));
		// ⚠️ **装配的解析规则单独放一处**（`agent-resolver.ts`）⇒ 运行时只管编排。
		this.#resolver = new AgentResolver({
			agents: this.#agents,
			plugins: this.#plugins,
			store: this.#store,
			mcpUrl: this.#mcpUrl,
		});
	}

	/* ------------------------------------------------------------ 公开动作 */

	/** 建一个会话（**绑定一个智能体**；认不出来的智能体 ⇒ 直接报错）。 */
	async createConversation(
		userId: string,
		title?: string,
		agentId?: string,
	): Promise<ConversationRecord> {
		const agent = this.#resolver.requireAgent(agentId ?? this.#agents.defaultAgentId);
		// ⚠️ **会话 id 里带着智能体 id** ⇒ 绑定跟着会话走（进程重启也还在）
		//    ⇒ 同一会话重建后仍是同一个智能体（不会串味）。
		const conversation = await this.#store.create(
			userId,
			title ?? null,
			conversationIdFor(agent.id),
			// ⚠️ **智能体维度入库**（`ai_conversation.agent_id`）⇒ 「这个会话是哪个智能体的」查得到。
			agent.id,
		);
		this.#registry.ensure(conversation.conversationId);
		return conversation;
	}

	/** 列某个用户的会话。 */
	async listConversations(userId: string): Promise<ConversationRecord[]> {
		return this.#store.list(userId);
	}

	/** 列某个智能体的技能（**按它的配置目录**；没配置技能 ⇒ 空列表，不是异常）。 */
	async listAgentSkills(agentId?: string): Promise<SkillSummary[]> {
		const agent = this.#resolver.requireAgent(agentId ?? this.#agents.defaultAgentId);
		return listSkillSummaries(agent.skills);
	}

	// 提交一条命令（`type: "prompt"`）。
	// 立即返回「已受理」；真正的执行在后台排队跑，结果走 SSE。
	// ## 幂等（Idempotency-Key）
	// **同一个会话 + 同一个 `commandId` 再来一次 ⇒ 回上次那个 ack，不再跑一遍。**
	// 本仓唯一的命令是**写** ⇒ 重跑一次就是多建一个任务，而且前端只看到「成功」。
	// 客户端重试、双击、代理重发都会撞上这个窗口 ⇒ 去重做在运行时这一层。
	// ⚠️ **事实源是产品事实表**（`ai_command_ack`）⇒ **进程重启后仍然去重**。
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
		const known = await this.#recallAck(request.conversationId, request.commandId);
		if (known !== undefined) {
			return known;
		}

		// ⚠️ **token 变了 ⇒ 重建会话**：老会话的 MCP 连接带着**旧 token**
		//    ⇒ 模型调 MCP 时用的还是上一个人的身份（越权）⇒ 关掉老通道。
		const previous = this.#registry.get(request.conversationId);
		if (
			previous !== undefined &&
			previous.context.token !== undefined &&
			previous.context.token !== request.token
		) {
			this.#registry.close(request.conversationId);
		}

		const channel = this.#registry.ensure(request.conversationId);
		// ⚠️ **当前用户**：写审计要记「谁干的」。
		channel.context.userId = request.userId;
		// ⚠️ **上下文是「此刻」的**：每条带上下文的消息都会覆盖它 ⇒ 用户换一条任务
		//    继续聊 ⇒ 上下文跟着换；没有上下文 ⇒ 清掉 ⇒ 闸门不再收窄字段。
		// ⚠️ **这个会话的智能体**（拿不到就退回默认插件 ⇒ 这里**不抛错**
		//    ⇒ 与之前的行为一致：智能体认不出来是在**建会话时**才报。
		const agentId = this.#resolver.agentIdOf(conversation.conversationId, conversation.agentId);
		const provider = this.#resolver.contextProvider(this.#agents.get(agentId));
		const anchor = provider?.parse(request.context) ?? null;
		channel.context.anchor = anchor ?? undefined;
		// token 只在内存里；每次命令都刷新（token 轮换后能用新的那个）
		channel.context.token = request.token;

		// 用户说的这句话先落库（state 里立刻能看到）
		const seq = channel.allocateSeq(await this.#store.maxSeq(request.conversationId));
		await this.#store.appendMessage(request.conversationId, "USER", message, seq);

		// 发起这一轮（排队语义见 `turn-queue.ts`）
		// ⚠️ **给模型的话** = 上下文块 + 用户的话；**库里存的是用户原话**
		//    （界面里显示的必须是用户自己打的那句，不能混进系统生成的上下文）。
		const modelMessage =
			anchor == null || provider === undefined
				? message
				: `${provider.render(anchor)}

${message}`;
		void this.#dispatchTurn(channel, modelMessage, request.type ?? "prompt").catch(
			(error: unknown) => {
				this.#publishTurnError(channel, error);
			},
		);

		const ack: CommandAck = { id: request.commandId, type: "response", success: true };
		await this.#rememberAck(request.conversationId, request.commandId, ack);
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

	// 解析 token 对应的当前用户。
	// ⚠️ **本服务不自己校验 token** —— 问权威系统（AiAdmin，它是权威）。
	// token 无效时抛 `AdapterErrorException("AUTH_EXPIRED")`，由路由转成 401 信封。
	async resolveCurrentUser(token: string): Promise<CurrentUser> {
		return this.#resolveUser(token);
	}

	/** 配置里写的插件都注册了吗（**没有 ⇒ 启动即失败**）。 ·  */
	validatePlugins(): void {
		for (const agent of this.#agents.list()) {
			if (agent.plugin === undefined) {
				continue;
			}
			if (this.#plugins.get(agent.plugin) === undefined) {
				throw new AgentError(
					"NOT_FOUND",
					`智能体 ${agent.id} 指定的插件「${agent.plugin}」没注册` +
						`（已注册：${this.#plugins.list().map((p) => p.id).join("、") || "无"}）`,
				);
			}
		}
	}

	/** 会话状态（快照）；**别人的会话不给看**。 */
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
			// ⚠️ **会话事件**（dsh 形状的日志折叠）⇒ 工具调用 / 闸门记录查得到。
			//    **读不到不许报错**（老库还没迁移 ⇒ 表都不存在）⇒ 空列表。
			sessionEvents: await this.#readSessionEvents(conversationId),
		};
	}

	/** 关掉一个会话（释放会话资源）。 */
	close(conversationId: string): void {
		this.#registry.close(conversationId);
	}

	/** 关掉全部会话（进程退出时）。 */
	closeAll(): void {
		this.#registry.closeAll();
	}

	// 停掉当前正在跑的那一轮（用户点「停止生成」）。
	// ⚠️ SDK 的 `session.abort()`：停掉当前操作并等到会话空闲。
	//    会话自己会发 `agent_settled` ⇒ 前端的输入框会解禁。
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

	/** **命令桥**：dsh 侧插件回调我们执行一条命令（**只有 dsh 会话认这个**）。 */
	async executeDshCommand(input: {
		conversationId: string;
		tool: string;
		args: Record<string, unknown>;
	}): Promise<{ ok: boolean; summary: string; details?: unknown }> {
		const channel = this.#registry.get(input.conversationId);
		const session = channel?.session as unknown as
			| {
					executeCommand?: (
						tool: string,
						args: Record<string, unknown>,
					) => Promise<{ ok: boolean; summary: string; details?: unknown }>;
			  }
			| undefined;
		if (session?.executeCommand === undefined) {
			return { ok: false, summary: "这个会话没有可执行的命令（不是 dsh runner？）" };
		}
		return session.executeCommand(input.tool, input.args);
	}

	/* ------------------------------------------------------------ 内部 */

	/** 读会话事件（**折叠成一行一条的摘要**）。 ·  */
	async #readSessionEvents(conversationId: string): Promise<SessionEventSummary[]> {
		try {
			const rows = await this.#sessionEvents.list(conversationId);
			return rows.map(summarizeSessionEvent);
		} catch (error) {
			console.error("[agent] 读会话事件失败（不影响快照）", error);
			return [];
		}
	}

	/** **MCP 写成功 ⇒ 落一条审计**（`ai_audit_log`）。 ·  */
	#writeAudit(
		channel: ConversationChannel,
		write: { toolName: string; args: Record<string, unknown> },
		event: { result?: unknown },
	): void {
		const userId = channel.context.userId;
		if (userId === undefined) {
			return;
		}
		void this.#audit
			.write({
				actorType: "AI",
				command: stripMcpToolPrefix(write.toolName, channel.bridge.mcpPrefixes),
				args: redactAuditArgs(write.args),
				// 写前快照：讨论上下文里的基线（没有上下文就没有写前）
				before: channel.context.anchor?.baseline ?? null,
				// 写后快照：工具回执（截断，别把整份响应塞进审计表）
				after: summarizeAuditResult(event.result),
				userId,
				model: this.#model,
			})
			.catch((error: unknown) => {
				console.error("[audit] 写 ai_audit_log 失败（数据已写入，不要重试）", error);
			});
	}

	/** 取上次这个命令 id 的 ack（没有 ⇒ undefined）。 */
	async #recallAck(conversationId: string, commandId: string): Promise<CommandAck | undefined> {
		try {
			return await this.#commandAcks.recall(conversationId, commandId);
		} catch (error) {
			// ⚠️ **读不到不许把命令搞挂**（老库还没迁移 ⇒ 表都不存在）
			//    ⇒ 按「没受理过」处理（宁可重跑，也别让对话进不来）。
			console.error("[agent] 读命令回执失败（按没受理过处理）", error);
			return undefined;
		}
	}

	/** 记下「这个命令 id 已经受理过」（**事实源 = `ai_command_ack` 表**）。 */
	async #rememberAck(
		conversationId: string,
		commandId: string,
		ack: CommandAck,
	): Promise<void> {
		try {
			await this.#commandAcks.remember(conversationId, commandId, ack);
		} catch (error) {
			// ⚠️ **记不上不许把命令搞挂**（数据已经写下去了）⇒ 只记一条日志。
			console.error("[agent] 记命令回执失败（进程重启后可能重复执行）", error);
		}
	}

	/** 发起这一轮（**排队语义见 `turn-queue.ts`**）。 */
	async #dispatchTurn(
		channel: ConversationChannel,
		message: string,
		type: CommandType,
	): Promise<void> {
		await dispatchTurn({
			channel,
			message,
			type,
			ensureSession: () => this.#ensureSession(channel),
			lock: this.#lock,
		});
	}

	// 懒创建 dsh 会话（**会话生命周期归 dsh** ⇒ 这里只负责「把业务装配成 dsh 的会话」）。
	// ⚠️ **会话 id = dsh 的 session id**（`ai_conversation.dsh_session_id`）
	//    ⇒ dsh 侧能按同一个 id 认领这个会话（`session/resume`）。
	async #ensureSession(channel: ConversationChannel): Promise<AgentSessionLike> {
		const existing = channel.session;
		if (existing !== undefined) {
			return existing;
		}
		// ⚠️ **这个会话的智能体**（提示词 / 模型 / 技能 / MCP / 工具全按它来）
		//    ⇒ 换智能体只改配置文件，不改代码。
		const agent = await this.#resolver.agentOf(channel.conversationId);
		// ⚠️ **这个智能体挂了哪个插件**（配置里的 `plugin:`；没写 ⇒ 默认插件）
		const plugin = this.#resolver.pluginOf(agent);
		// ⚠️ **写规则也来自同一个插件**（与锚点一致 ⇒ 收窄的是同一套语义）
		channel.context.writeRules = plugin?.context?.writeRules ?? [];
		// ⚠️ **命令目录来自插件**（内核不带业务命令）⇒ **MCP 工具形状**；
		//    **工具白名单**：配置里没列的工具**不注册**（模型看不到）。
		const tools = (plugin?.commands ?? []).filter((command) =>
			agent.tools.includes(command.name),
		);
		// ⚠️ **上下文在调用时给**（token / 审计 / 闸门 ⇒ 每个会话一份）
		//    ⇒ 工具定义本身是**纯静态**的（一份定义复用到所有会话）。
		const toolContext: McpToolContext = {
			currentToken: () => channel.context.token,
			currentUserId: async (token: string) => (await this.#resolveUser(token)).id,
			audit: this.#audit,
			model: this.#model,
		};
		// ⚠️ **MCP 工具名前缀**（事件里要靠它认出「这是哪台服务器的 MCP 工具」）
		const mcp = this.#resolver.mcpPlanOf(agent, channel.context.token ?? "");
		channel.bridge.mcpPrefixes = mcp.prefixes;
		// ⚠️ **会话 ↔ dsh session 的映射**（`ai_conversation.dsh_session_id`）
		//    ⚠️ **写失败不许影响对话**（老库还没迁移 ⇒ 列都不存在）。
		await this.#store.setDshSessionId(channel.conversationId, channel.dshSessionId).catch(
			(error: unknown) => {
				console.error("[agent] 写 dsh 会话映射失败（不影响对话）", error);
			},
		);
		// ⚠️ **只有一个执行层**（issue #123 拔掉 pi）⇒ 会话一律走 dsh 适配层。
		const session = await openDshSession({
			conversationId: channel.conversationId,
			dshSessionId: channel.dshSessionId,
			// ⚠️ **系统提示词就是智能体配置里那份**（技能段由 dsh 自己给）
			systemPrompt: agent.systemPrompt,
			// ⚠️ **模型来自配置**（没写 ⇒ 用全局默认）
			model: agent.model ?? this.#model,
			// ⚠️ **技能目录**（issue #153：技能退给 dsh ⇒ 我们只给目录，不自己扫）
			skillDirs: agent.skills,
			tools,
			toolContext,
			// ⚠️ **MCP 服务器**（同一份配置 ⇒ 语义不变；只是换成 dsh 管理面的形状）
			mcpServers: mcp.servers,
			mcpPrefixes: mcp.prefixes,
			events: this.#sessionEvents,
			audit: this.#audit,
			trail: this.#audit,
			// ⚠️ **闸门**：修改已有数据要等人点头（**唯一一套**口径 ⇒ `core/gate/decision.ts`）
			gate: {
				userId: () => channel.context.userId,
				anchor: () => channel.context.anchor,
				writeRules: () => channel.context.writeRules,
				onPending: (row) => {
					this.#publish(channel, SSE_EVENTS.PENDING, {
						conversationId: channel.conversationId,
						id: row.id,
						command: row.command,
						args: row.args,
					});
				},
			},
			resume: this.#resumeDshSession,
			// ⚠️ **测试注入点**（单测不起 dsh 进程）。
			createSession: this.#createDshSession,
		});
		channel.session = session;
		const hooks = this.#bridgeHooks(channel);
		channel.unsubscribe = session.subscribe((event) => {
			bridgeEvent(channel, event, hooks);
		});
		return session;
	}

	/** 事件桥要的配合（**发布 / 审计 / 落库**）。 */
	#bridgeHooks(channel: ConversationChannel): EventBridgeHooks {
		return {
			publish: (event, payload) => {
				this.#publish(channel, event, payload);
			},
			writeAudit: (write, event) => {
				this.#writeAudit(channel, write, event);
			},
			appendAssistantMessage: (text) => {
				void this.#appendAssistantMessage(channel, text);
			},
		};
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

	/** 问**插件**要当前用户（没注入 `resolveUser` 时的默认路径）。 ·  */
	async #resolveUserByPlugin(token: string): Promise<CurrentUser> {
		const resolver = this.#plugins.currentUserResolver();
		if (resolver === undefined) {
			throw new AgentError("UPSTREAM", "没有插件能解析当前用户（插件没注册？）");
		}
		return resolver.resolve(token);
	}
}

/* ------------------------------------------------------------ 进程级单例 */

const globalForAgent = globalThis as unknown as { agentRuntime?: AgentRuntime };

/** 进程级的运行时（dev 热重载复用同一个，别每次都重建）。 */
export const agentRuntime: AgentRuntime = globalForAgent.agentRuntime ?? new AgentRuntime();

if (process.env.NODE_ENV !== "production") {
	globalForAgent.agentRuntime = agentRuntime;
}
