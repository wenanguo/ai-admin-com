/**
 * 我们的 dsh 插件 —— 装进 dsh 的 profile 里（**跑在 dsh 运行时进程里**）。
 *
 * ## 它做四件事
 *
 * ① **注册我们自己的 provider**（`dsh-llm` 的缝 ⇒ **不依赖 pi-ai**）：
 *    一个 OpenAI 兼容的适配器 ⇒ DeepSeek 官方与 MiniMax 都走它（换 baseURL + key）。
 * ② **把系统提示词交给 dsh**：注册成一个 prompt section
 *    ⇒ ⚠️ **技能段不再由我们拼**（issue #153：技能退给 dsh ⇒ 技能目录由
 *    dsh 的 `dsh-tool-skill` 作为**用户消息**给模型 ⇒ 这里只给智能体自己的提示词）。
 * ③ **把我们的命令挂进 dsh 的工具表**（命令本体仍在我们的进程里 ⇒ 走命令桥）。
 * ④ **把 MCP 服务器挂进 dsh 的工具表**（用 dsh 自带的**管理面** `dsh-mcp-manager`）
 *    ⇒ 并给 MCP 的写操作补上**闸门**（修改已有数据要人点头）。
 *
 * ## 配置全走环境变量
 *
 * ⚠️ 这个包会被 `pnpm add file:<路径>` 装进 dsh 的 profile ⇒ 它**没有自己的配置文件**
 *    ⇒ 路由、baseURL、key、提示词、工具目录、命令桥地址、MCP 清单**全部由环境变量给**
 *    ⇒ **凭据不落盘**（只活在子进程的内存里）。
 */

import { OpenAiCompatibleAdapter } from './provider.js'
import { registerTools } from './tools.js'
import { registerGate, registerMcpServers } from './mcp.js'

/** dsh 里的插件名。 */
export const name = 'ai-admin'

/** 依赖的服务（`llm` / `tools` / `systemPrompt`）。 */
export const inject = ['llm', 'tools', 'systemPrompt']

/**
 * 装插件。
 *
 * @param {object} ctx cordis 上下文。
 */
export async function apply(ctx) {
	// ⚠️ **几步各自兜住**：一段失败不许连累别的（插件挂不上去 ⇒ 工具与 provider 全没有）。
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
	try {
		// ⚠️ **闸门先挂**（MCP 的写操作也要人点头 ⇒ 拦在工具执行之前）。
		registerGate(ctx)
	} catch (error) {
		console.error('[ai-admin] 闸门注册失败：', error)
	}
	try {
		// ⚠️ **MCP 最后挂**（它要连服务器 ⇒ 慢 ⇒ 别拖住别的）。
		const count = await registerMcpServers(ctx)
		if (count > 0) {
			console.error(`[ai-admin] MCP 服务器挂上 ${count} 台`)
		}
	} catch (error) {
		console.error('[ai-admin] MCP 注册失败：', error)
	}
}

/**
 * 注册我们自己的 provider 路由。
 *
 * ⚠️ **路由名来自环境变量** ⇒ 换厂商只改配置，不改代码。
 */
function registerProvider(ctx) {
	const route = process.env.AI_DSH_PROVIDER
	const baseURL = process.env.AI_DSH_BASE_URL
	const apiKey = process.env.AI_DSH_API_KEY
	const model = process.env.AI_DSH_MODEL
	if (route === undefined || baseURL === undefined || apiKey === undefined) {
		// ⚠️ 没配 ⇒ 不注册（dsh 会报「找不到路由」⇒ 错误信息更直白）
		return
	}
	const adapter = new OpenAiCompatibleAdapter({
		route,
		baseURL,
		apiKey,
		model: model ?? 'deepseek-chat',
		contextWindow: numberEnv('AI_DSH_CONTEXT_WINDOW', 131072),
		maxTokens: numberEnv('AI_DSH_MAX_TOKENS', 8192),
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
 * 把我们的系统提示词注册成一个 prompt section。
 *
 * ⚠️ **只有智能体自己的提示词**（issue #153：技能段退给 dsh
 *    ⇒ 技能目录由 `dsh-tool-skill` 单独给模型 ⇒ 这里不拼技能）。
 */
function registerSystemPrompt(ctx) {
	const encoded = process.env.AI_DSH_SYSTEM_PROMPT
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
