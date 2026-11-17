/**
 * 智能体清单 —— 「现在有哪些智能体可用」。
 *
 * ## 为什么读真文件、不缓存
 *
 * 配置是**文件**（由人编辑）⇒ 与技能清单同一个口径：改完重启就能看到。
 * ⚠️ 非法配置会在**启动时**就报错（见 `loader.ts`）⇒ 这里读到的都是合法的。
 */

import { env } from "../env/env.ts";
import { loadAgentConfigs } from "./loader.ts";
import type { AgentConfig, AgentSummary } from "./types.ts";

/**
 * 列出可用智能体（`GET /api/agents` 的数据源）。
 *
 * @param rootDir 智能体配置根目录（通常是 `<cwd>/agents`）。
 */
export function listAgentSummaries(rootDir: string): AgentSummary[] {
	return loadAgentConfigs(rootDir).map(toAgentSummary);
}

/**
 * 配置 ⇒ 清单项（能力摘要：模型 + 技能数 + MCP 数 + 工具数）。
 *
 * @param config 装载好的配置。
 */
export function toAgentSummary(config: AgentConfig): AgentSummary {
	return {
		id: config.id,
		name: config.name,
		description: config.description,
		capabilities: {
			// ⚠️ 配置里没写模型 ⇒ 用全局默认（与 `runtime.ts` 的口径一致）
			model: config.model ?? env.AI_MODEL,
			skillCount: config.skills.length,
			mcpServerCount: config.mcpServers.length,
			toolCount: config.tools.length,
		},
	};
}
