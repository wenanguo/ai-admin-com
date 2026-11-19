/**
 * Agent 运行时 —— 把「会话 / 命令 / 事件流」串起来。
 *
 * ```
 * 前端 ──POST /command──▶ 运行时 ──▶ 启动锁（同会话串行）──▶ 会话（dsh 运行时）
 *   │                          │                                  │
 *   │                          ├──▶ ai_message（用户/助手的话）    │
 *   └──GET /events (SSE)◀──────┴──── 事件发布 ◀──────────────────┘
 * ```
 *
 * ## 关键约定
 *
 * - **同一会话的 prompt 串行**（启动锁）：会话在流式输出期间再 `prompt()` 会抛
 *   `Agent is already processing` ⇒ 必须排队，不能报错。
 * - **命令立即返回**：HTTP 响应只说「收到了」，真正的结果走 SSE
 *   （`success: true` 的含义是「已受理并排队」）。
 * - **快照才是真相**：`GET /api/agent/:cid/state` 返回完整的会话与消息，
 *   客户端随时可以用它重建界面。
 *
 * ## ⚠️ 只有**一个**执行层了（issue #123：拔掉 pi）
 *
 * 以前这里是「双跑可切」（`AI_RUNNER=pi|dsh`）⇒ 现在只剩 dsh
 * ⇒ **不留双份实现**（会话工厂、事件词汇、闸门口径都是一份）。
 */

import type { AgentEvent } from "./agent-event.ts";
import { PrismaAuditWriter, type AuditWriter } from "../audit/audit.ts";
import { AuditTrail } from "../audit/audit-trail.ts";
import { redactAuditArgs } from "../audit/audit-redact.ts";
import { env } from "../env/env.ts";
import { buildFrame } from "../http/sse.ts";
import { buildCommandTools } from "../tools/index.ts";
import type { CommandTool } from "../tools/types.ts";
import { pluginRegistry, type AiPlugin, type PluginRegistry } from "../plugins.ts";
import type { CurrentUser } from "./identity.ts";
import { SSE_EVENTS, type SseEventName, type SsePayload } from "./events.ts";
import { AgentEventMapper, extractAssistantText, isAssistantMessage } from "./event-mapper.ts";
import type { ContextAnchor, ContextProvider } from "../context/anchor.ts";
import { changedFields, writeTargetId } from "../context/anchor.ts";
import { DEFAULT_GATE_TIMEOUT_MS } from "../gate/gate.ts";
import { createPendingAction } from "../gate/pending-write.ts";
import type { McpServerSpec } from "../mcp/mcp.ts";
import { mcpToolPrefix, stripMcpToolPrefix } from "../mcp/tool-names.ts";
import { listSkillSummaries, type SkillSummary } from "../skills/skill-catalog.ts";
import { pendingWaiters } from "../gate/pending-waiters.ts";
import {
	createDshSession,
	type CreateDshSessionOptions,
} from "../adapter/dsh/runner.ts";
import { DshTracer } from "../adapter/dsh/persistence.ts";
import { buildDshSystemPrompt } from "../adapter/dsh/system-prompt.ts";
import { createLoadSkillTool } from "../skills/skill-tools.ts";
import { agentsRoot } from "../config/loader.ts";
import {
	agentIdOfConversation,
	conversationIdFor,
	createFileAgentProvider,
	type AgentProvider,
} from "../config/registry.ts";
import type { AgentConfig } from "../config/types.ts";
import {
	SessionRegistry,
	type AgentSessionLike,
	type ChannelSubscriber,
	type ConversationChannel,
} from "./session-registry.ts";
import { StartupLock } from "./startup-lock.ts";
import { ConversationStore, type ConversationRecord, type MessageRecord } from "../store/store.ts";
import {
	PrismaSessionEventStore,
	summarizeSessionEvent,
	type SessionEventStore,
	type SessionEventSummary,
} from "../store/session-events.ts";

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
 * ⚠️ 后两种是会话宿主的**原生**排队语义（`session.followUp()` / `session.steer()`）
 * ⇒ 自己造队列只能做到「等整轮跑完」⇒ 能用原生的就用原生的。
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
	/**
	 * 会话事件（**dsh 形状的追加式日志折叠出来的**）。
	 *
	 * ⚠️ **新增字段** ⇒ 前端零改动（它忽略不认识的字段）⇒ 契约表一个字都不用改。
	 */
	sessionEvents: SessionEventSummary[];
}

/** 运行时可注入的依赖（测试用假实现，生产用默认）。 */
export interface AgentRuntimeOptions {
	/**
	 * 造 **dsh 会话**（**唯一的执行层** —— issue #123 拔掉 pi 之后只剩它）。
	 *
	 * ⚠️ **测试可注入**（单测不起 dsh 进程）。
	 */
	createDshSession?: (options: CreateDshSessionOptions) => Promise<AgentSessionLike>;
	/**
	 * 插件注册表（**命令目录与身份查询都从这儿来**）。
	 *
	 * ⚠️ 缺省用**进程级**注册表 ⇒ 生产由入口（`src/plugins.ts`）注册插件；
	 *    测试可以塞一个只装假插件的注册表 ⇒ 单测不打 AiAdmin。
	 */
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
	/**
	 * 智能体来源（**默认读 `agents/` 目录**）。
	 *
	 * ⚠️ 测试可以注入假的 ⇒ 单测不必依赖仓里的真配置。
	 */
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
	/** 每个会话的事件映射器。 */
	readonly #mappers = new Map<string, AgentEventMapper>();
	/** 审计去处（每次写操作都留一条 `ai_audit_log`）。 */
	readonly #audit: AuditTrail;
	/** 会话事件日志（**dsh 形状的追加式日志**）。 */
	readonly #sessionEvents: SessionEventStore;
	/** AiAdmin 的 MCP 地址（**没配就不接 MCP**）。 */
	/** MCP 的默认地址（`null` = **显式不接**；`undefined` = 用插件给的）。 */
	readonly #mcpUrl: string | null | undefined;
	/** 命令 id ⇒ 上次的 ack（**幂等**：同一个 id 不跑两遍）。 */
	readonly #acks = new Map<string, Map<string, CommandAck>>();
	/** 每个会话最多记多少个命令 id。 */
	readonly #maxTrackedCommands: number;
	/** 智能体来源（提示词 / 模型 / 技能 / MCP / 工具都从这里来）。 */
	readonly #agents: AgentProvider;

	constructor(options: AgentRuntimeOptions = {}) {
		this.#store = options.store ?? new ConversationStore();
		this.#createDshSession = options.createDshSession ?? createDshSession;
		this.#model = options.model ?? env.AI_MODEL;
		this.#audit = new AuditTrail(options.audit ?? new PrismaAuditWriter());
		this.#sessionEvents = options.sessionEvents ?? new PrismaSessionEventStore();
		// ⚠️ **默认地址归插件**（内核不认识业务系统的地址）：
		//    `undefined` ⇒ 用插件给的；`null` ⇒ **显式不接 MCP**。
		this.#mcpUrl = options.mcpUrl === null ? null : options.mcpUrl;
		this.#maxTrackedCommands = options.maxTrackedCommands ?? MAX_TRACKED_COMMANDS_PER_CONVERSATION;
		// ⚠️ **默认的智能体来源读真文件**（`agents/<id>/agent.yaml`）
		//    ⇒ 非法配置在**构造时**就报错（启动即失败）。
		this.#agents =
			options.agents ?? createFileAgentProvider(agentsRoot(), env.AI_DEFAULT_AGENT);

		// ⚠️ **命令与身份都来自插件**（内核不认识业务）⇒ 运行时只读注册表。
		this.#plugins = options.plugins ?? pluginRegistry;

		this.#resolveUser =
			options.resolveUser ?? ((token: string) => this.#resolveUserByPlugin(token));
	}

	/**
	 * 建一个会话（**绑定一个智能体**）。
	 *
	 * @param userId 会话主人。
	 * @param title 标题（可省）。
	 * @param agentId 智能体 id（可省 ⇒ 默认智能体）。
	 */
	async createConversation(
		userId: string,
		title?: string,
		agentId?: string,
	): Promise<ConversationRecord> {
		// ⚠️ **先把智能体定下来**（认不出来的智能体 ⇒ 直接报错，
		//    别建一个“不知道该用什么提示词”的会话）。
		const agent = this.#requireAgent(agentId ?? this.#agents.defaultAgentId);
		// ⚠️ **会话 id 里带着智能体 id** ⇒ 绑定跟着会话走（进程重启也还在）
		//    ⇒ 同一会话重建后仍是同一个智能体（不会串味）。
		const conversation = await this.#store.create(
			userId,
			title ?? null,
			conversationIdFor(agent.id),
			// ⚠️ **智能体维度入库**（`ai_conversation.agent_id`）
			//    ⇒ 「这个会话是哪个智能体的」有地方可查（不靠猜会话 id）。
			agent.id,
		);
		this.#registry.ensure(conversation.conversationId);
		return conversation;
	}

	/** 取智能体配置；认不出来 ⇒ 报错（说清有哪些可用）。 */
	#requireAgent(agentId: string): AgentConfig {
		const agent = this.#agents.get(agentId);
		if (agent === undefined) {
			const available = this.#agents
				.list()
				.map((item) => item.id)
				.join("、");
			throw new AgentError(
				"NOT_FOUND",
				`智能体 ${agentId} 不存在${available === "" ? "" : `（可用：${available}）`}`,
			);
		}
		return agent;
	}

	/**
	 * 这个智能体要挂哪些 MCP 服务器（**0 / 1 / N 个**）。
	 *
	 * ⚠️ 配置里没写 `url` ⇒ 用**插件给的默认地址**（内核不认识业务系统的地址 ⇒ 由插件给）；
	 *    插件也没给 ⇒ **这台不挂**（保持老行为：后端没上线时不连）。
	 * ⚠️ 名字来自配置 ⇒ 工具名前缀按服务器名生成 ⇒ 多服务器的工具不互相盖名。
	 *
	 * @param agent 智能体配置。
	 * @param token 调用方的 token（每个会话一份 ⇒ MCP 靠它做权限校验）。
	 */
	#mcpServersOf(agent: AgentConfig, token: string): McpServerSpec[] {
		const servers: McpServerSpec[] = [];
		for (const server of agent.mcpServers) {
			const url =
				server.url ??
				(this.#mcpUrl === null ? undefined : (this.#mcpUrl ?? this.#pluginOf(agent)?.mcpDefaultUrl));
			if (url === undefined) {
				continue;
			}
			servers.push({
				name: server.name,
				url,
				type: server.type,
				exposure: server.exposure,
				token,
			});
		}
		return servers;
	}

	/**
	 * 这个智能体的 MCP 工具名前缀（用来认工具、剥前缀）。
	 *
	 * ⚠️ **按已知的服务器名算**（不是正则猜）⇒ 多服务器 / 名字带连字符都不会认错。
	 */
	#mcpPrefixesOf(agent: AgentConfig): string[] {
		return agent.mcpServers.map((server) => mcpToolPrefix(server.name));
	}

	/**
	 * 这个会话用的是哪个智能体。
	 *
	 * ⚠️ **从会话 id 里读**（不是从内存映射里读）⇒ 进程重启后重建会话仍是同一个。
	 * ⚠️ **老会话**（id 里没有智能体）⇒ 用默认智能体（行为不变）。
	 */
	async #agentOf(conversationId: string): Promise<AgentConfig> {
		// ⚠️ **事实源 = 库里的 `agent_id` 列**（会话 id 里那个前缀只是同义反复）
		const record = await this.#store.get(conversationId);
		const stored = record?.agentId;
		// ⚠️ **老会话**（迁移前建的 ⇒ `agent_id` 是空的）⇒ 看会话 id 的前缀
		//    ⇒ 再没有就回落**默认智能体**（行为不变）。
		const agentId =
			stored ?? agentIdOfConversation(conversationId) ?? this.#agents.defaultAgentId;
		return this.#requireAgent(agentId);
	}

	/** 列某个用户的会话。 */
	async listConversations(userId: string): Promise<ConversationRecord[]> {
		return this.#store.list(userId);
	}

	/**
	 * 列某个智能体的技能（**按它的配置目录**）。
	 *
	 * ⚠️ 智能体 A 看不到智能体 B 的技能 ⇒ 清单按智能体返回。
	 * ⚠️ 没配置技能 ⇒ 空列表（**不是异常**：技能是可选的）。
	 *
	 * @param agentId 智能体 id（可省 ⇒ 默认智能体）。
	 */
	async listAgentSkills(agentId?: string): Promise<SkillSummary[]> {
		const agent = this.#requireAgent(agentId ?? this.#agents.defaultAgentId);
		return listSkillSummaries(agent.skills);
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
		//    ⇒ 直接把老通道关掉（连带 dispose 掉会话与 MCP 连接）。
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
		// ⚠️ **这个会话的智能体**（拿不到就退回默认插件 ⇒ 这里**不抛错**
		//    ⇒ 与之前的行为一致：智能体认不出来是在**建会话时**才报。
		const agentId =
			conversation.agentId ??
			agentIdOfConversation(conversation.conversationId) ??
			this.#agents.defaultAgentId;
		const provider = this.#contextProvider(this.#agents.get(agentId));
		const anchor = provider?.parse(request.context) ?? null;
		channel.anchor = anchor ?? undefined;
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
			anchor == null || provider === undefined
				? message
				: `${provider.render(anchor)}

${message}`;
		void this.#dispatchTurn(
			channel,
			modelMessage,
			request.type ?? "prompt",
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
	 * ⚠️ **本服务不自己校验 token** —— 问权威系统（AiAdmin，它是权威）。
	 * token 无效时抛 `AdapterErrorException("AUTH_EXPIRED")`，由路由转成 401 信封。
	 */
	async resolveCurrentUser(token: string): Promise<CurrentUser> {
		return this.#resolveUser(token);
	}

	/**
	 * 问**插件**要当前用户（没注入 `resolveUser` 时的默认路径）。
	 *
	 * ⚠️ 没有插件能回答 ⇒ 直接报错（**别静默返回假用户** —— 那会让人以为鉴权过了）。
	 */
	async #resolveUserByPlugin(token: string): Promise<CurrentUser> {
		const resolver = this.#plugins.currentUserResolver();
		if (resolver === undefined) {
			throw new AgentError("UPSTREAM", "没有插件能解析当前用户（插件没注册？）");
		}
		return resolver.resolve(token);
	}

	/**
	 * 这个智能体用哪个插件（**按配置里的名字**取；没写 ⇒ 默认插件）。
	 *
	 * ⚠️ **拿不到就返回 undefined**（不抛错）⇒ 调用方自己决定怎么办
	 *    （「插件没注册」在**构造时**就报过了 ⇒ 运行期只可能是「没挂插件的智能体」）。
	 */
	#pluginOf(agent: AgentConfig): AiPlugin | undefined {
		const id = agent.plugin;
		if (id === undefined) {
			return this.#plugins.defaultPlugin();
		}
		return this.#plugins.get(id);
	}

	/**
	 * 配置里写的插件都注册了吗（**没有 ⇒ 启动即失败**）。
	 *
	 * ⚠️ **由入口调用**（server.ts 的 createApp）⇒ 拼错插件名**服务起不来**
	 *    （不等到有人建会话才发现）。
	 */
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

	/**
	 * 「讨论上下文」的提供器（**插件给**）。
	 *
	 * ⚠️ 内核不认识「任务 / 项目」⇒ 解析、渲染、可写字段白名单**全在插件里**。
	 *    没有插件 ⇒ 没有讨论上下文（普通聊天照旧）。
	 *
	 * @param agent 这个会话的智能体（**没写插件 ⇒ 用默认插件**）。
	 */
	#contextProvider(agent?: AgentConfig): ContextProvider | undefined {
		if (agent === undefined) {
			return this.#plugins.contextProvider();
		}
		return this.#pluginOf(agent)?.context;
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
			// ⚠️ **会话事件**（dsh 形状的日志折叠）⇒ 工具调用 / 闸门记录查得到。
			//    **读不到不许报错**（老库还没迁移 ⇒ 表都不存在）⇒ 空列表。
			sessionEvents: await this.#readSessionEvents(conversationId),
		};
	}

	/**
	 * 读会话事件（**折叠成一行一条的摘要**）。
	 *
	 * ⚠️ **失败当没有**（表还没迁移 / 库连不上）⇒ 快照端点照常回。
	 */
	async #readSessionEvents(conversationId: string): Promise<SessionEventSummary[]> {
		try {
			const rows = await this.#sessionEvents.list(conversationId);
			return rows.map(summarizeSessionEvent);
		} catch (error) {
			console.error("[agent] 读会话事件失败（不影响快照）", error);
			return [];
		}
	}

	/** 关掉一个会话（释放会话资源）。 */
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
	 *    会话自己会发 `agent_settled` ⇒ 前端的输入框会解禁。
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
				command: stripMcpToolPrefix(write.toolName, channel.mcpPrefixes),
				args: redactAuditArgs(write.args),
				// 写前快照：讨论上下文里的基线（没有上下文就没有写前）
				before: channel.anchor?.baseline ?? null,
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
	 * ## 排队语义（用会话宿主的原生能力）
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
	 */
	async #dispatchTurn(
		channel: ConversationChannel,
		message: string,
		type: CommandType,
		userId: string,
	): Promise<void> {
		const session = await this.#ensureSession(channel, userId);

		// 已经有轮次在跑 ⇒ 走会话原生的排队语义
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
	 * @returns 排进去了 ⇒ true；会话不接受 ⇒ false（落回普通排队）。
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
			// ⚠️ 会话不接受这句话（比如它被当成了扩展命令）⇒ 落回普通排队。
			//    不当错误报出去：那句话本身没毛病，只是排队的路子走不通。
			console.warn("[agent] 排队进当前轮没成，改成正常排队", error);
		}
		return false;
	}

	/** 懒创建会话（同一个会话复用同一个）。 */
	async #ensureSession(
		channel: ConversationChannel,
		userId?: string,
	): Promise<AgentSessionLike> {
		if (channel.session !== undefined) {
			return channel.session;
		}
		// ⚠️ **这个会话的智能体**（提示词 / 模型 / 技能 / MCP / 工具全按它来）
		//    ⇒ 换智能体只改配置文件，不改代码。
		const agent = await this.#agentOf(channel.conversationId);
		// ⚠️ **这个智能体挂了哪个插件**（配置里的 `plugin:`；没写 ⇒ 默认插件）
		const plugin = this.#pluginOf(agent);
		// ⚠️ **写规则也来自同一个插件**（与锚点一致 ⇒ 收窄的是同一套语义）
		channel.writeRules = plugin?.context?.writeRules ?? [];
		const tools = buildCommandTools(
			// ⚠️ **命令目录来自插件**（内核不带业务命令）
			plugin?.commands ?? [],
			{
				currentToken: () => channel.token,
				currentUserId: async (token: string) => (await this.#resolveUser(token)).id,
				audit: this.#audit,
				model: this.#model,
			},
			// ⚠️ **工具白名单**：配置里没列的工具**不注册**（模型看不到）
			{ only: agent.tools },
		);
		// ⚠️ **MCP 服务器来自配置**（可以 0 / 1 / N 个；名字决定工具名前缀）。
		const mcpServers = this.#mcpServersOf(agent, channel.token ?? "");
		// ⚠️ **记住这些前缀**（事件里要靠它认出「这是哪台服务器的 MCP 工具」）
		channel.mcpPrefixes = this.#mcpPrefixesOf(agent);
		// ⚠️ **只有一个执行层**（issue #123 拔掉 pi）⇒ 会话一律走 dsh 适配层。
		const session = await this.#buildDshSession(channel, agent, tools, mcpServers, userId);
		channel.session = session;
		channel.unsubscribe = session.subscribe((event) => {
			this.#handleEvent(channel, event);
		});
		return session;
	}

	/**
	 * 造一个 **dsh 会话**（双跑的另一半）。
	 *
	 * ⚠️ **对外契约一模一样**：提示词、技能段、工具白名单、闸门口径
	 *    都与智能体配置同源 ⇒ 前端零改动。
	 *
	 * @param channel 会话通道。
	 * @param agent 这个会话的智能体（提示词 / 模型 / 技能都按它来）。
	 * @param tools 业务命令工具（**已按白名单过滤**）。
	 * @param userId 当前用户 id（闸门要记「谁干的」）。
	 */
	async #buildDshSession(
		channel: ConversationChannel,
		agent: AgentConfig,
		tools: readonly CommandTool[],
		mcpServers: readonly McpServerSpec[],
		userId?: string,
	): Promise<AgentSessionLike> {
		// ⚠️ **技能段照旧进模型上下文**（同一套技能表 ⇒ 语义保住）
		const { systemPrompt, skills } = await buildDshSystemPrompt(
			agent.systemPrompt,
			agent.skills,
		);
		// ⚠️ **没有技能时就不注册 `load_skill`**（别给模型一个必然失败的工具）
		const allTools = skills.length > 0 ? [...tools, createLoadSkillTool(skills)] : tools;
		// ⚠️ **会话 ↔ dsh session 的映射**（`ai_conversation.dsh_session_id`）
		//    今天 dsh 的 session id 就是我们指定的会话 id ⇒ 等值映射；
		//    列先留好 ⇒ dsh 哪天自己分配 id 时直接用。
		//    ⚠️ **写失败不许影响对话**（老库还没迁移 ⇒ 列都不存在）。
		await this.#store.setDshSessionId(channel.conversationId, channel.conversationId).catch(
			(error: unknown) => {
				console.error("[agent] 写 dsh 会话映射失败（不影响对话）", error);
			},
		);
		// ⚠️ **留痕层**：dsh 事件 / 闸门决策 ⇒ 事件日志 + 审计。
		const tracer = new DshTracer({
			conversationId: channel.conversationId,
			dshSessionId: channel.conversationId,
			userId,
			model: agent.model ?? this.#model,
			events: this.#sessionEvents,
			audit: this.#audit,
			trail: this.#audit,
			mcpPrefixes: channel.mcpPrefixes,
		});
		return this.#createDshSession({
			conversationId: channel.conversationId,
			tools: allTools,
			systemPrompt,
			// ⚠️ **模型来自配置**（没写 ⇒ 用全局默认）
			model: agent.model ?? this.#model,
			mcpPrefixes: channel.mcpPrefixes,
			// ⚠️ **MCP 服务器**（同一份配置 ⇒ 语义不变；只是换成 dsh 的形状）
			mcpServers,
			tracer,
			// ⚠️ **闸门**：修改已有数据要等人点头（**唯一一套**口径 ⇒ `core/gate/decision.ts`）
			gate: () => ({
				conversationId: channel.conversationId,
				userId: userId ?? "",
				anchor: channel.anchor,
				writeRules: channel.writeRules ?? [],
				onPending: (row) => {
					this.#publish(channel, SSE_EVENTS.PENDING, {
						conversationId: channel.conversationId,
						id: row.id,
						command: row.command,
						args: row.args,
					});
				},
				waiters: pendingWaiters,
				createPending: createPendingAction,
				timeoutMs: DEFAULT_GATE_TIMEOUT_MS,
				// ⚠️ **闸门决策要留痕**（人做的决定 ⇒ 审计 + 事件日志）
				onDecision: (decision) => {
					void tracer.handleGateDecision(decision);
				},
			}),
		});
	}

	/**
	 * **命令桥**：dsh 侧插件回调我们执行一条命令。
	 *
	 * ⚠️ **只有 dsh 会话认这个**（别的会话没有 `executeCommand`）。
	 *
	 * @param input 会话 id、工具名、参数。
	 */
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

	/** 运行时事件 → 发布 SSE 帧。 */
	#handleEvent(channel: ConversationChannel, event: AgentEvent): void {
		// ⚠️ **写回成功 ⇒ 告诉前端「哪条任务变了」**
		//    （前端据此刷新左边的列表/看板/甘特，并把那一行高亮）。
		//    ⚠️ 参数在闸门里被**就地改写过**（收窄成允许回填的字段）⇒
		//    这里读到的就是**真正写下去的那份**。
		if (event.type === "tool_execution_start") {
			const args = (event.args ?? {}) as Record<string, unknown>;
			// ⚠️ **MCP 的写也要留审计**（我们自己的工具自己写审计）
			//    ⇒ 这里记一份参数，等执行成功后再落 `ai_audit_log`。
			if (isMcpWriteTool(event.toolName, channel.mcpPrefixes)) {
				channel.lastMcpWrite = { toolName: event.toolName, args };
			}
			const entityId = writeTargetId(
				event.toolName,
				channel.anchor ?? null,
				channel.writeRules ?? [],
			);
			if (entityId !== undefined) {
				channel.lastWrite = {
					toolName: event.toolName,
					entityId,
					fields: changedFields(
						args,
						channel.anchor?.baseline ?? {},
						channel.anchor?.writableFields ?? [],
					),
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
		// ⚠️ **工具名一律归一化**（spec §5.3）：
		//    MCP 的工具在模型侧叫 `mcp__<server>__<tool>` ⇒ 界面上要显示
		//    **我们自己的命令名**（`create_task`）。
		//    ⚠️ **模型侧看到的名字不变** ⇒ 技能正文里写的工具名依然对得上。
		const mapper = new AgentEventMapper({
			normalizeToolName: (toolName) => {
				const channel = this.#registry.get(conversationId);
				return stripMcpToolPrefix(toolName, channel?.mcpPrefixes ?? []);
			},
		});
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
function isMcpWriteTool(toolName: string, prefixes: readonly string[]): boolean {
	if (!toolName.startsWith("mcp__")) {
		return false;
	}
	const bare = stripMcpToolPrefix(toolName, prefixes);
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
