/**
 * pi 会话 —— **SDK 的真实用法**（尖峰实测，详见 `spike/FINDINGS.md`）。
 *
 * 四条容易踩的坑，这里都按实测来：
 * 1. `model` 必须是**对象**（`modelRuntime.getModel(...)`），不能写 "provider/model" 字符串；
 * 2. `tools: []` 是**白名单**，会把自定义工具一起关掉 ⇒ 要「只要我们自己的」得用 `noTools: "builtin"`；
 * 3. `systemPrompt` **不在** `createAgentSession` 的选项里 ⇒ 放 `new DefaultResourceLoader({ systemPrompt })`；
 * 4. **上下文只在 `SessionManager` 里** ⇒ 想让模型记得之前聊过什么，
 *    必须把历史还原成 entries 交给它（`session.agent.state.messages` 不管用），
 *    见 `session-entries.ts`。
 *
 * 另外：工具的 `execute` 是**五参** `(toolCallId, params, signal, onUpdate, ctx)`。
 */

import { join } from "node:path";
import {
	createAgentSession,
	createMcpExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { env } from "../env.ts";
import type { CommandTool } from "../core/tools/types.ts";
import { createMcpServersExtension, type McpServerSpec } from "./mcp.ts";
import { buildSystemPrompt, createSkillsOverride } from "./skills.ts";
import { createLoadSkillTool } from "./skill-tools.ts";
import { buildSessionEntries } from "./session-entries.ts";
import type { AgentSessionLike } from "./session-registry.ts";
import type { MessageRecord } from "./store.ts";

/** pi 的凭据文件放在仓内 `.ai/` 下（只存环境变量鉴权的结果，通常是空的 `{}`）。 */
const AGENT_DIR = join(process.cwd(), ".ai");
const AUTH_PATH = join(AGENT_DIR, "auth.json");

/** 造 pi 会话需要的参数。 */
export interface PiSessionOptions {
	/** 业务命令工具（只注册我们自己的）。 */
	tools: CommandTool[];
	/** 系统提示词。 */
	systemPrompt: string;
	/**
	 * 会话 id。
	 *
	 * ⚠️ 它同时是 pi 的 session id ⇒ **同一个会话重建出来的 pi 会话是同一个**，
	 *    历史不会串到别的会话上。
	 */
	conversationId: string;
	/**
	 * 这个会话的历史消息（从 `ai_message` 表取）。
	 *
	 * ⚠️ **必须有**：pi 会话是内存态、懒创建的 ⇒ 进程重启或通道被回收后
	 *    新建的 pi 会话是空白的 ⇒ 模型不记得之前聊过什么。
	 *    把历史还原成 entries 交给 `SessionManager` ⇒ 上下文就回来了。
	 */
	history: MessageRecord[];
	/** 工作目录（默认当前目录）。 */
	cwd?: string;
	/**
	 * 技能目录（**绝对路径**；智能体配置里的 `skills`）。
	 *
	 * ⚠️ **不给 ⇒ 用 `<cwd>/.pi/skills`**（老行为）。
	 * ⚠️ 给了 ⇒ **只有这些目录里的技能算数**（空数组 ⇒ 一个技能都没有）
	 *    ⇒ 不跨智能体串味。
	 */
	skillsDirs?: string[];
	/** 模型标识（默认取环境变量里的）。 */
	model?: string;
	/**
	 * 思考级别（缺省取环境变量 `AI_THINKING_LEVEL`，再缺省就是 `off`）。
	 *
	 * ⚠️ 开了思考 ⇒ 模型**先想再写** ⇒ 用户等得更久 ⇒ 前端得能展示
	 *    「思考中…」（否则就是界面卡住）。思考增量会以 `thinking_delta`
	 *    事件外发（见 `event-mapper.ts`）。
	 */
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	/**
	 * 要挂的 MCP 服务器（**可以 0 / 1 / N 个**；不给 ⇒ 不挂 MCP）。
	 *
	 * ⚠️ token 是**这次调用方**的 ⇒ 每个会话一份（后端靠它做权限码校验）。
	 * ⚠️ 名字决定**工具名前缀**（`mcp__<name>__<tool>`）⇒ 多服务器的工具不会盖名。
	 */
	mcpServers?: McpServerSpec[];
	/**
	 * 闸门扩展（**修改已有数据要人点头**；不给就不拦）。
	 *
	 * ⚠️ 闸门是 pi 的 `tool_call` hook ⇒ 必须跟 MCP 扩展一样挂在 **loader** 上
	 *    （挂 `createAgentSession` 会被静默忽略 ⇒ 扩展根本不加载）。
	 */
	gate?: (pi: ExtensionAPI) => void;
}

/**
 * 造一个 pi 会话。
 *
 * @param options 命令工具、系统提示词、会话 id、历史。
 */
export async function createPiSession(
	options: PiSessionOptions,
): Promise<AgentSessionLike> {
	const cwd = options.cwd ?? process.cwd();
	const modelId = options.model ?? env.AI_MODEL;

	const modelRuntime = await ModelRuntime.create({ authPath: AUTH_PATH });

	const separator = modelId.indexOf("/");
	if (separator <= 0 || separator === modelId.length - 1) {
		throw new Error(`AI_MODEL 必须是 provider/model 的形式，当前是「${modelId}」`);
	}
	const provider = modelId.slice(0, separator);
	const model = modelRuntime.getModel(provider, modelId.slice(separator + 1));
	if (model === undefined) {
		throw new Error(`找不到模型 ${modelId}`);
	}

	// ⚠️ **两阶段**：技能要进系统提示词，而技能是 loader 发现的 ⇒ 顺序上
	//    「先发现技能，再定提示词」。而 loader 的 systemPrompt 是**构造时**定的
	//    ⇒ 先用一个 loader 把技能发现出来，再用带技能段的提示词建**最终**那个。
	//    （建会话是懒的、每会话一次 ⇒ 多发现一次的开销可以忽略。）
	// ⚠️ **技能目录**：来自智能体配置（不给 ⇒ 老口径 `<cwd>/.pi/skills`）。
	const skillsDirs = options.skillsDirs ?? [join(cwd, ".pi", "skills")];

	const loaderOptions = {
		cwd,
		agentDir: join(AGENT_DIR, "agent"),
		// 只用自己的提示词与工具：不要 pi 的扩展、提示词模板、上下文文件
		noExtensions: true,
		// ⚠️ **只加载智能体配置里列的目录**（`additionalSkillPaths`）。
		//    `noSkills: true` ⇒ pi **默认的项目目录（`<cwd>/.pi/skills`）与用户家目录
		//    一律不加载** ⇒
		//    ① 智能体之间不串味（不是靠事后过滤，而是**根本不加载**）；
		//    ② 默认目录里的技能**不会抢同名**（pi 按名字去重，先到先得
		//       ⇒ 若两边都加载，项目目录那份会赢 ⇒ 配置里的那份反而没了）。
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		// ⚠️ **额外的技能目录**（智能体配置里的那些）
		additionalSkillPaths: skillsDirs,
		// ⚠️ **兜底过滤**：只留配置里那些目录里的技能
		skillsOverride: createSkillsOverride(skillsDirs),
	};

	const discoveryLoader = new DefaultResourceLoader({
		...loaderOptions,
		systemPrompt: options.systemPrompt,
	});
	await discoveryLoader.reload();
	// pi 发现的技能（名字 → 文件位置）
	const skills = discoveryLoader.getSkills().skills;

	// ⚠️ **MCP 扩展只挂在最终的 loader 上**（发现用的那个不需要它）：
	//    扩展工厂在 reload 时会跑 ⇒ 挂两个就会注册两次（多跑一遍）。
	// ⚠️ `extensionFactories` 是 **loader** 的选项（不是 `createAgentSession` 的）
	//    —— 给错了会被静默忽略 ⇒ 扩展根本没加载 ⇒ 一个 MCP 工具都不出现。
	const mcpServers = options.mcpServers ?? [];
	// ⚠️ **测试用**：某台服务器注入了假传输层 ⇒ 给 pi 一个**按服务器名分发**的工厂。
	//    一台都没注入 ⇒ 不给（pi 用自己的真 HTTP 传输层）。
	const createTransport = mcpServers.some(
		(server) => server.createTransport !== undefined,
	)
		? (entry: unknown, cwd: string, authProvider: unknown): unknown => {
				const name = (entry as { name?: string }).name;
				const spec = mcpServers.find((server) => server.name === name);
				if (spec?.createTransport === undefined) {
					throw new Error(
						`MCP 服务器 ${name ?? "?"} 没有注入传输层（测试用）`,
					);
				}
				return spec.createTransport(entry, cwd, authProvider);
			}
		: undefined;

	const extensionFactories = [
		...(mcpServers.length > 0
			? [
					createMcpExtension({
						createTransport: createTransport as never,
					}),
					createMcpServersExtension(mcpServers),
				]
			: []),
		// 闸门（修改类工具要人点头）
		...(options.gate === undefined ? [] : [options.gate]),
	];

	const resourceLoader = new DefaultResourceLoader({
		...loaderOptions,
		extensionFactories,
		// 系统提示词 = 基础提示词 + 技能段（模型据此知道有哪些技能、怎么加载）
		systemPrompt: buildSystemPrompt(options.systemPrompt, skills),
	});
	await resourceLoader.reload();

	// ★ 把 DB 里的历史还原成 pi 的 entries ⇒ 模型有上下文（见 session-entries.ts）
	const entries = buildSessionEntries({
		conversationId: options.conversationId,
		cwd,
		history: options.history,
		model: modelId,
	});

	const { session } = await createAgentSession({
		model, // 对象，不是字符串
		modelRuntime,
		resourceLoader,
		thinkingLevel: options.thinkingLevel ?? env.AI_THINKING_LEVEL,
		// 关掉 pi 的 coding 内置工具（read/bash/edit/write）——
		// 它们能在服务器上乱跑，本服务只给模型业务命令。
		noTools: "builtin",
		// 业务命令 + `load_skill`（读技能文件；只读技能目录内的）
		// ⚠️ **没有技能时就不注册它** ⇒ 别给模型一个必然失败的工具。
		customTools:
			skills.length > 0
				? [...options.tools, createLoadSkillTool(skills)]
				: options.tools,
		// 内存态会话，但**带着我们还原出来的历史**：
		// 持久化归我们（ai_message 表），pi 这边只管「这一轮对话的上下文」。
		sessionManager: SessionManager.inMemory(cwd, { id: options.conversationId }, entries),
	});

	// ⚠️ **必须 bindExtensions**：它才发 `session_start` ⇒ MCP 服务器这时才连。
	//    没这一步 ⇒ 扩展加载了但连接不会建立 ⇒ 模型看不到任何 MCP 工具。
	//    （pi 自己的 headless print 模式也是这么调的：`mode: "print"`。）
	await session.bindExtensions({ mode: "print" });

	return session;
}
