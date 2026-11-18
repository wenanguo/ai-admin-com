/**
 * 智能体清单 —— 「现在有哪些智能体可用」。
 *
 * ## 为什么读真文件、不缓存
 *
 * 配置是**文件**（由人编辑）⇒ 与技能清单同一个口径：改完重启就能看到。
 * ⚠️ 非法配置会在**启动时**就报错（见 `loader.ts`）⇒ 这里读到的都是合法的。
 */

import { env } from "../env/env.ts";
import { pluginRegistry } from "../plugins.ts";
import { loadAgentConfigs } from "./loader.ts";
import type { AgentConfig, AgentSummary } from "./types.ts";

/**
 * 列出可用智能体（`GET /api/agents` 的数据源）。
 *
 * @param rootDir 智能体配置根目录（通常是 `<cwd>/agents`）。
 */
export function listAgentSummaries(rootDir: string): AgentSummary[] {
	// ⚠️ **不能直接 `.map(toAgentSummary)`** —— map 会把**下标**当第二个参数传进来
	//    ⇒ 那个参数是「默认插件 id」⇒ 摘要里会出现 "0" / "1" 这种鬼东西。
	return loadAgentConfigs(rootDir).map((config) => toAgentSummary(config));
}

/**
 * 配置 ⇒ 清单项（能力摘要：模型 + 插件 + 技能数 + MCP 数 + 工具数）。
 *
 * @param config 装载好的配置。
 * @param defaultPluginId **默认插件**的 id（没写 `plugin:` 的智能体用它）。
 *   缺省 ⇒ 从**插件注册表**取默认插件（与 `runtime.ts` 的 `#pluginOf` 同一个口径）。
 */
export function toAgentSummary(
	config: AgentConfig,
	defaultPluginId: string | undefined = pluginRegistry.defaultPlugin()?.id,
): AgentSummary {
	return {
		id: config.id,
		name: config.name,
		description: config.description,
		capabilities: {
			// ⚠️ 配置里没写模型 ⇒ 用全局默认（与 `runtime.ts` 的口径一致）
			model: config.model ?? env.AI_MODEL,
			// ⚠️ **插件也要报出来**（界面据此知道这个智能体有哪些业务能力）
			plugins: pluginsOf(config, defaultPluginId),
			skillCount: config.skills.length,
			mcpServerCount: config.mcpServers.length,
			toolCount: config.tools.length,
		},
	};
}

/**
 * 这个智能体挂了哪些插件（**没写 `plugin:` ⇒ 默认插件**）。
 *
 * ⚠️ 口径必须与运行时一致（`session/runtime.ts` 的 `#pluginOf`）：
 *    配置里写了就按写的算，没写才回落默认插件 ⇒ 否则「清单说挂了 pm、
 *    实际会话用的是别的插件」⇒ 界面会骗人。
 *
 * @param config 装载好的配置。
 * @param defaultPluginId 默认插件 id（没有 ⇒ 空数组）。
 */
function pluginsOf(config: AgentConfig, defaultPluginId: string | undefined): string[] {
	const id = config.plugin ?? defaultPluginId;
	return id === undefined ? [] : [id];
}
