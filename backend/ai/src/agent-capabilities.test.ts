/**
 * 两个智能体的**能力差异** —— 「换智能体真的换能力」。
 *
 * ## 为什么钉这个
 *
 * 智能体是**配置**（`agents/<id>/agent.yaml`）⇒ 配置写歪了 ⇒ 两个智能体
 * 变得一模一样 ⇒ 用户换智能体等于没换 ⇒ 而这种退化**没有任何报错**。
 *
 * ⇒ 这里把「阶段 4 的验收」固化成测试：
 *   - `qa`（通用问答）：**命令集为空**（没有工具 ⇒ 模型动不了业务数据）；
 *   - `pm`（PM 助手）：命令集**恰含 `pm_create_task`**（不多不少）。
 *
 * ⚠️ 这个测试放在 `src/`（**不在 `core/`**）⇒ 因为它要同时看**内核的机制**
 *    （插件注册表 + 命令白名单）与**插件的命令目录** ⇒ 而内核不许 import 插件
 *    （见 `scripts/check-core-purity.cjs`）。
 */

import { describe, expect, it } from "vitest";
import { listAgentSummaries } from "./core/config/catalog.ts";
import { loadAgentConfigs } from "./core/config/loader.ts";
import { pluginRegistry } from "./core/plugins.ts";
// ⚠️ **import 即注册**（模块副作用）⇒ 注册表里才有 PM 插件
import "./plugins.ts";

/** 仓里的智能体配置目录（**cwd 相对** ⇒ 测试要在这个包里跑）。 */
const AGENTS_DIR = "agents";

/**
 * 这个智能体**实际能用的命令**（工具名）。
 *
 * ⚠️ 口径与运行时一致（`core/session/runtime.ts` 的 `#ensureSession`）：
 *    命令目录来自**插件**，再按配置里的 `tools` 白名单过滤。
 */
function commandNames(agentId: string): string[] {
	const config = loadAgentConfigs(AGENTS_DIR).find((item) => item.id === agentId);
	if (config === undefined) {
		throw new Error(`没有这个智能体：${agentId}`);
	}
	const plugin =
		config.plugin === undefined
			? pluginRegistry.defaultPlugin()
			: pluginRegistry.get(config.plugin);
	return (plugin?.commands ?? [])
		.filter((command) => config.tools.includes(command.name))
		.map((command) => command.name);
}

describe("两个智能体的能力差异", () => {
	it("通用问答（qa）：命令集**为空**（模型动不了业务数据）", () => {
		expect(commandNames("qa")).toEqual([]);
	});

	it("PM 助手（pm）：命令集**恰含 pm_create_task**（不多不少）", () => {
		expect(commandNames("pm")).toEqual(["pm_create_task"]);
	});

	it("两者不同 ⇒ 换智能体真的换能力（否则换等于没换）", () => {
		expect(commandNames("pm")).not.toEqual(commandNames("qa"));
	});
});

describe("能力摘要里的插件", () => {
	it("pm 显式挂了 pm 插件", () => {
		const pm = listAgentSummaries(AGENTS_DIR).find((item) => item.id === "pm");
		expect(pm?.capabilities.plugins).toEqual(["pm"]);
	});

	it("qa 没写 plugin: ⇒ 按**默认插件**算（与运行时同一口径）", () => {
		const qa = listAgentSummaries(AGENTS_DIR).find((item) => item.id === "qa");
		expect(qa?.capabilities.plugins).toEqual(["pm"]);
	});
});
