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
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { env } from "../env";
import type { CommandTool } from "../tools/types";
import { buildSystemPrompt, createProjectSkillsOverride } from "./skills";
import { createLoadSkillTool } from "./skill-tools";
import { buildSessionEntries } from "./session-entries";
import type { AgentSessionLike } from "./session-registry";
import type { MessageRecord } from "./store";

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
	// ⚠️ **项目技能目录**：只有这里的技能算数。
	//    pi 还会扫用户家目录的 `~/.agents/skills/` ⇒ 会被过滤掉（见 skills.ts）。
	const projectSkillsDir = join(cwd, ".pi", "skills");

	const loaderOptions = {
		cwd,
		agentDir: join(AGENT_DIR, "agent"),
		// 只用自己的提示词与工具：不要 pi 的扩展、提示词模板、上下文文件
		noExtensions: true,
		// ⚠️ **技能要开着**（默认 false）：让 pi 自己去发现 `.pi/skills/`，
		//    我们只读它发现的结果（不自己再扫一遍目录 ⇒ 与 pi 的去重/诊断一致）。
		//    这**不等于**放开 pi 的 read/bash 工具（那仍然关着）——
		//    读技能文件靠我们自己的 `load_skill`（只读技能目录内的文件）。
		noSkills: false,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		// ⚠️ 只留项目技能目录里的（用户家目录的那一堆与本服务无关）
		skillsOverride: createProjectSkillsOverride(projectSkillsDir),
	};

	const discoveryLoader = new DefaultResourceLoader({
		...loaderOptions,
		systemPrompt: options.systemPrompt,
	});
	await discoveryLoader.reload();
	// pi 发现的技能（名字 → 文件位置）
	const skills = discoveryLoader.getSkills().skills;

	const resourceLoader = new DefaultResourceLoader({
		...loaderOptions,
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
		customTools: [...options.tools, createLoadSkillTool(skills)],
		// 内存态会话，但**带着我们还原出来的历史**：
		// 持久化归我们（ai_message 表），pi 这边只管「这一轮对话的上下文」。
		sessionManager: SessionManager.inMemory(cwd, { id: options.conversationId }, entries),
	});
	return session;
}
