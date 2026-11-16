/**
 * 智能体配置的类型 —— 一份 YAML 描述一个智能体。
 *
 * ## 为什么要有「配置」
 *
 * 现在内核里的定位是**写死**的（`runtime.ts` 里 `systemPrompt: PM_AGENT_PROMPT`、
 * 模型取 `env.AI_MODEL`、MCP 取 `env.AIADMIN_MCP_URL`）⇒ 只能当「PM 助手」用。
 *
 * ⇒ 把「用哪个模型 / 扮演什么角色 / 有哪些技能与工具」抽成**文件**，
 * 同一个内核就能起多种定位的智能体 ⇒ **换智能体只改配置、不改代码**。
 *
 * ## 文件位置
 *
 * `backend/ai/agents/<agentId>/agent.yaml`（**cwd 相对** ⇒ 与 `.pi/skills` 一个规矩：
 * AI 服务必须在 `backend/ai/` 下启动）。
 */

/**
 * 一台 MCP 服务器的配置。
 *
 * ⚠️ **名字是工具名的前缀**（`mcp__<name>__<tool>`）⇒ 名字只能是小写字母 / 数字 /
 *    连字符（pi 会把非法字符换成 `_` ⇒ 名字里有 `_` 会让前缀认不准）。
 */
export interface AgentMcpServer {
	/** 服务器名（工具名前缀：`mcp__<name>__`）。 */
	name: string;
	/** 地址（可省 ⇒ 用全局默认 `env.AIADMIN_MCP_URL`；可写 `${ENV_VAR}`）。 */
	url?: string;
	/** 传输类型（缺省 `http`；`sse` 也走 HTTP 传输）。 */
	type: "http" | "sse";
	/** 暴露方式（缺省 `direct`）。 */
	exposure: "direct" | "deferred" | "codemode" | "hidden";
}

/**
 * 装载好的智能体配置（**校验过**的）。
 *
 * ⚠️ 这里的路径都是**绝对路径** ⇒ 装配会话那一步不用再猜「相对谁」。
 */
export interface AgentConfig {
	/** 智能体 id（= 目录名）。 */
	id: string;
	/** 显示名。 */
	name: string;
	/** 一句话说明（清单里给界面看）。 */
	description: string;
	/** 模型（可省 ⇒ 用全局默认 `env.AI_MODEL`）。 */
	model?: string;
	/** 系统提示词（**已解析**：来自 `systemPrompt` 或 `systemPromptFile`）。 */
	systemPrompt: string;
	/** 技能目录（**绝对路径**，相对配置目录）。 */
	skills: string[];
	/** MCP 服务器清单。 */
	mcpServers: AgentMcpServer[];
	/** 工具白名单（工具名）。 */
	tools: string[];
	/** 配置所在目录（绝对路径）。 */
	dir: string;
	/** 配置文件本身（绝对路径）—— 报错时指给用户看。 */
	configPath: string;
}

/** 能力摘要（清单里给界面看：模型 + 技能数 + MCP 数 + 工具数）。 */
export interface AgentCapabilities {
	/** 实际用的模型（配置里的，或全局默认）。 */
	model: string;
	/** 技能目录数。 */
	skillCount: number;
	/** MCP 服务器数。 */
	mcpServerCount: number;
	/** 工具白名单长度。 */
	toolCount: number;
}

/** 智能体清单里的一项（`GET /api/agents` 的 `data` 元素）。 */
export interface AgentSummary {
	/** 智能体 id。 */
	id: string;
	/** 显示名。 */
	name: string;
	/** 一句话说明。 */
	description: string;
	/** 能力摘要。 */
	capabilities: AgentCapabilities;
}
