/**
 * 会话装配的解析器 —— **「这个会话用哪个智能体 / 插件 / 上下文 / MCP 计划」**。
 *
 * 这几件事都是**纯查表 + 纯计算**（不碰会话、不碰 SSE、不碰 dsh）
 * ⇒ 单独放一处 ⇒ 运行时只管**编排**。
 */

import { planMcpServers, type McpPlan } from "../adapter/dsh/session-factory.ts";
import { agentIdOfConversation, type AgentProvider } from "../config/registry.ts";
import type { AgentConfig } from "../config/types.ts";
import type { ContextProvider } from "../context/anchor.ts";
import type { AiPlugin, PluginRegistry } from "../plugins.ts";
import type { ConversationStore } from "../store/store.ts";
import { AgentError } from "./agent-error.ts";

/** 解析器需要的依赖。 */
export interface AgentResolverDeps {
	/** 智能体来源（提示词 / 模型 / 技能 / MCP / 工具都从这里来）。 */
	agents: AgentProvider;
	/** 插件注册表（命令目录与身份查询都从这儿来）。 */
	plugins: PluginRegistry;
	/** 存取（**读会话的 `agent_id`**）。 */
	store: ConversationStore;
	/** MCP 的默认地址（`null` = **显式不接**；`undefined` = 用插件给的）。 */
	mcpUrl: string | null | undefined;
}

/** 会话装配的解析器。 */
export class AgentResolver {
	readonly #agents: AgentProvider;
	readonly #plugins: PluginRegistry;
	readonly #store: ConversationStore;
	readonly #mcpUrl: string | null | undefined;

	constructor(deps: AgentResolverDeps) {
		this.#agents = deps.agents;
		this.#plugins = deps.plugins;
		this.#store = deps.store;
		this.#mcpUrl = deps.mcpUrl;
	}

	/** 取智能体配置；认不出来 ⇒ 报错（说清有哪些可用）。 */
	requireAgent(agentId: string): AgentConfig {
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

	// 这个会话的智能体 **id**。
	// ⚠️ **老会话**（迁移前建的 ⇒ `agent_id` 是空的）⇒ 看会话 id 的前缀
	//    ⇒ 再没有就回落**默认智能体**（行为不变）。
	agentIdOf(conversationId: string, storedAgentId: string | null): string {
		return storedAgentId ?? agentIdOfConversation(conversationId) ?? this.#agents.defaultAgentId;
	}

	/** 这个会话用的是哪个智能体。 ·  */
	async agentOf(conversationId: string): Promise<AgentConfig> {
		const record = await this.#store.get(conversationId);
		return this.requireAgent(this.agentIdOf(conversationId, record?.agentId ?? null));
	}

	/** 这个智能体用哪个插件（**按配置里的名字**取；没写 ⇒ 默认插件）。 ·  */
	pluginOf(agent: AgentConfig): AiPlugin | undefined {
		const id = agent.plugin;
		if (id === undefined) {
			return this.#plugins.defaultPlugin();
		}
		return this.#plugins.get(id);
	}

	/** 「讨论上下文」的提供器（**插件给**）。 ·  */
	contextProvider(agent?: AgentConfig): ContextProvider | undefined {
		if (agent === undefined) {
			return this.#plugins.contextProvider();
		}
		return this.pluginOf(agent)?.context;
	}

	/** 这个智能体要挂哪些 MCP 服务器（**0 / 1 / N 个**）⇒ 计划交给适配层算。 ·  */
	mcpPlanOf(agent: AgentConfig, token: string): McpPlan {
		return planMcpServers({
			servers: agent.mcpServers,
			url: this.#mcpUrl,
			fallbackUrl: this.pluginOf(agent)?.mcpDefaultUrl,
			token,
		});
	}
}
