/**
 * pi 会话 —— **SDK 的真实用法**（尖峰实测，详见 `spike/FINDINGS.md`）。
 *
 * 三条容易踩的坑，这里都按实测来：
 * 1. `model` 必须是**对象**（`modelRuntime.getModel(...)`），不能写 "provider/model" 字符串；
 * 2. `tools: []` 是**白名单**，会把自定义工具一起关掉 ⇒ 要「只要我们自己的」得用 `noTools: "builtin"`；
 * 3. `systemPrompt` **不在** `createAgentSession` 的选项里 ⇒ 放 `new DefaultResourceLoader({ systemPrompt })`。
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
import type { AgentSessionLike } from "./session-registry";

/** pi 的凭据文件放在仓内 `.ai/` 下（只存环境变量鉴权的结果，通常是空的 `{}`）。 */
const AGENT_DIR = join(process.cwd(), ".ai");
const AUTH_PATH = join(AGENT_DIR, "auth.json");

/**
 * 造一个 pi 会话。
 *
 * @param tools 业务命令工具（只注册我们自己的）。
 * @param systemPrompt 系统提示词。
 */
export async function createPiSession(
	tools: CommandTool[],
	systemPrompt: string,
): Promise<AgentSessionLike> {
	const modelRuntime = await ModelRuntime.create({ authPath: AUTH_PATH });

	const modelId = env.AI_MODEL;
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
		cwd: process.cwd(),
		agentDir: join(AGENT_DIR, "agent"),
		// 只用自己的提示词与工具：不要 pi 的扩展、技能、提示词模板、上下文文件
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt,
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		model, // 对象，不是字符串
		modelRuntime,
		resourceLoader,
		thinkingLevel: "off",
		// 关掉 pi 的 coding 内置工具（read/bash/edit/write）——
		// 它们能在服务器上乱跑，本服务只给模型业务命令。
		noTools: "builtin",
		customTools: tools,
		sessionManager: SessionManager.inMemory(),
	});
	return session;
}
