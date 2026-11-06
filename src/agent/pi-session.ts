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

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: join(AGENT_DIR, "agent"),
		// 只用自己的提示词与工具：不要 pi 的扩展、技能、提示词模板、上下文文件
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: options.systemPrompt,
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
		thinkingLevel: "off",
		// 关掉 pi 的 coding 内置工具（read/bash/edit/write）——
		// 它们能在服务器上乱跑，本服务只给模型业务命令。
		noTools: "builtin",
		customTools: options.tools,
		// 内存态会话，但**带着我们还原出来的历史**：
		// 持久化归我们（ai_message 表），pi 这边只管「这一轮对话的上下文」。
		sessionManager: SessionManager.inMemory(cwd, { id: options.conversationId }, entries),
	});
	return session;
}
