/**
 * 插件 —— **业务能力的一包**（命令 / 身份 / 以后还有技能与数据源）。
 *
 * ## 为什么要有插件
 *
 * 内核（`core/**`）只该懂「对话 / 会话 / 命令 / 技能 / MCP / 审计 / 闸门」这些**通用**概念。
 * 「任务 / 项目 / 里程碑」是**业务**概念 ⇒ 归业务插件（`plugins/pm/**`）。
 *
 * ## 依赖方向（**硬规矩**）
 *
 * ```
 * core/**  ──（不许）──▶  plugins/**
 * plugins/** ──（可以）──▶ core/**
 * ```
 *
 * ⇒ 内核**永远不 import 插件**。内核怎么知道插件存在？**注册表 + 依赖注入**：
 * 入口侧（`src/plugins.ts`）注册插件 ⇒ 内核只看见 `AiPlugin` 这个形状。
 *
 * ## 现在注册表里只有一个插件
 *
 * 阶段 1 只有 PM 一个插件 ⇒ 「用哪个插件」还没得选（智能体配置里的 `plugin:` 字段是后面的阶段）。
 * 现在的口径：**注册表里所有插件的命令合起来**就是可用的命令目录。
 */

import type { ContextProvider } from "./context/anchor.ts";
import type { CurrentUserResolver } from "./session/identity.ts";
import type { CommandDefinition } from "./tools/types.ts";

/**
 * 一个插件。
 *
 * ⚠️ 形状里**只有内核概念**（命令 / 当前用户）⇒ 插件不能把自己的业务类型漏进内核。
 */
export interface AiPlugin {
	/** 插件 id（唯一；重复注册会覆盖）。 */
	id: string;
	/** 人读的标签。 */
	label?: string;
	/** 这个插件提供的命令（内核的命令目录 = 所有插件的命令合起来）。 */
	commands?: readonly CommandDefinition[];
	/** 这个插件怎么回答「当前用户是谁」（没有 ⇒ 内核不提供身份查询）。 */
	currentUser?: CurrentUserResolver;
	/**
	 * 这个插件的**讨论上下文**（解析 / 渲染 / 写规则）。
	 *
	 * ⚠️ 「用户正在跟 AI 讨论哪条东西」是**业务**概念 ⇒ 归插件；
	 *    内核只认**锚点**（作用域 + 键值 + 可写字段白名单）。
	 */
	context?: ContextProvider;
}

/** 插件注册表 —— **内核与插件之间唯一的接头**。 */
export class PluginRegistry {
	readonly #plugins = new Map<string, AiPlugin>();

	/** 注册一个插件（**同 id 覆盖** ⇒ 重新注册等于换掉）。 */
	register(plugin: AiPlugin): void {
		this.#plugins.set(plugin.id, plugin);
	}

	/** 取某个插件（没有 ⇒ undefined）。 */
	get(id: string): AiPlugin | undefined {
		return this.#plugins.get(id);
	}

	/** 已注册的插件（按注册顺序）。 */
	list(): readonly AiPlugin[] {
		return [...this.#plugins.values()];
	}

	/** 全部插件提供的命令（按注册顺序）—— 这就是**命令目录**。 */
	commands(): readonly CommandDefinition[] {
		return this.list().flatMap((plugin) => plugin.commands ?? []);
	}

	/**
	 * **默认插件**（配置里没写 `plugin:` 时用它）。
	 *
	 * ⚠️ 现在只有一个插件 ⇒ 「第一个注册的」就是它。
	 *    将来有第二个插件时 ⇒ 配置里写 `plugin:` 明确指定（见 agents/<id>/agent.yaml）。
	 */
	defaultPlugin(): AiPlugin | undefined {
		return this.list()[0];
	}

	/** 第一个能回答「当前用户是谁」的插件的解析器（没有 ⇒ undefined）。 */
	currentUserResolver(): CurrentUserResolver | undefined {
		return this.list().find((plugin) => plugin.currentUser !== undefined)?.currentUser;
	}

	/** 第一个能提供「讨论上下文」的插件的提供器（没有 ⇒ undefined）。 */
	contextProvider(): ContextProvider | undefined {
		return this.list().find((plugin) => plugin.context !== undefined)?.context;
	}
}

/**
 * 进程级的插件注册表。
 *
 * ⚠️ **只有入口侧（`src/plugins.ts`）往里注册** ⇒ 内核任何模块都不用 import 插件。
 *    运行时（`agent/runtime.ts`）读的是它 ⇒ 插件晚注册也没关系（**懒读**）。
 */
export const pluginRegistry = new PluginRegistry();
