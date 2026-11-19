/**
 * 我们的 dsh 插件 —— 装进 dsh 的 profile 里（**跑在 dsh 运行时进程里**）。
 *
 * ## 它做三件事
 *
 * ① **注册我们自己的 provider**（`dsh-llm` 的缝 ⇒ **不依赖 pi-ai**）：
 *    一个 OpenAI 兼容的适配器 ⇒ DeepSeek 官方与 MiniMax 都走它（换 baseURL + key）。
 * ② **把系统提示词（含技能段）交给 dsh**：注册成一个 prompt section
 *    ⇒ 技能照旧进模型上下文（**语义保住**）。
 * ③ **把我们的命令挂进 dsh 的工具表**（命令本体仍在我们的进程里 ⇒ 走命令桥）。
 *
 * ## 配置全走环境变量
 *
 * ⚠️ 这个包会被 `pnpm add file:<路径>` 装进 dsh 的 profile ⇒ 它**没有自己的配置文件**
 *    ⇒ 路由、baseURL、key、提示词、工具目录、命令桥地址**全部由环境变量给**
 *    ⇒ **凭据不落盘**（只活在子进程的内存里）。
 */

import { OpenAiCompatibleAdapter } from './provider.js'
import { registerTools } from './tools.js'

/** dsh 里的插件名。 */
export const name = 'ai-admin'

/** 依赖的服务（`llm` / `tools` / `systemPrompt`）。 */
export const inject = ['llm', 'tools', 'systemPrompt']

/**
 * 装插件。
 *
 * @param {object} ctx cordis 上下文。
 */
export function apply(ctx) {
	// ⚠️ **三步各自兜住**：一段失败不许连累别的（插件挂不上去 ⇒ 工具与 provider 全没有）。
	try {
		registerProvider(ctx)
	} catch (error) {
		console.error('[ai-admin] provider 注册失败：', error)
	}
	try {
		registerSystemPrompt(ctx)
	} catch (error) {
		console.error('[ai-admin] 提示词注册失败：', error)
	}
	try {
		registerTools(ctx)
	} catch (error) {
		console.error('[ai-admin] 工具注册失败：', error)
	}
}

/**
 * 注册我们自己的 provider 路由。
 *
 * ⚠️ **路由名来自环境变量** ⇒ 换厂商只改配置，不改代码。
 */
function registerProvider(ctx) {
	const route = process.env.DSH_AI_PROVIDER
	const baseURL = process.env.DSH_AI_BASE_URL
	const apiKey = process.env.DSH_AI_API_KEY
	const model = process.env.DSH_AI_MODEL
	if (route === undefined || baseURL === undefined || apiKey === undefined) {
		// ⚠️ 没配 ⇒ 不注册（dsh 会报「找不到路由」⇒ 错误信息更直白）
		return
	}
	const adapter = new OpenAiCompatibleAdapter({
		route,
		baseURL,
		apiKey,
		model: model ?? 'deepseek-chat',
		contextWindow: numberEnv('DSH_AI_CONTEXT_WINDOW', 131072),
		maxTokens: numberEnv('DSH_AI_MAX_TOKENS', 8192),
	})
	// ⚠️ **注册到 root 的 llm 服务上**。
	//
	//    插件自己的 `ctx.llm` 是一个**作用域内的实例**（cordis 的 inject 语义）
	//    ⇒ 路由注册在它上面，**agent 那边看不见**（agent 用的是 root 的那个）。
	//    ⇒ dsh 官方的 provider 插件之所以没事，是因为它们挂在 root 作用域上。
	//    ⇒ 我们显式取 root 的那个（**实测：不取就报「no adapter registered」**）。
	const llm = ctx.root.get('llm')
	llm.registerAdapter([route], adapter)
}

/**
 * 把我们的系统提示词（含技能段）注册成一个 prompt section。
 *
 * ⚠️ **技能照旧进模型上下文** —— 这是「技能语义保住」的落点。
 */
function registerSystemPrompt(ctx) {
	const encoded = process.env.DSH_AI_SYSTEM_PROMPT
	if (encoded === undefined || encoded.length === 0) {
		return
	}
	let text
	try {
		text = Buffer.from(encoded, 'base64').toString('utf8')
	} catch {
		return
	}
	// ⚠️ **用 root 的提示词服务**（插件自己作用域里的那个，agent 装配时看不见）。
	ctx.root.get('systemPrompt').section({
		name: 'ai-admin',
		order: 0,
		text,
	})
}

/** 环境变量里的数字（坏了就用缺省值）。 */function numberEnv(name, fallback) {
	const raw = process.env[name]
	if (raw === undefined) {
		return fallback
	}
	const value = Number(raw)
	return Number.isFinite(value) && value > 0 ? value : fallback
}
