/**
 * 我们的 dsh 插件 —— 装进 dsh 的 profile 里（**跑在 dsh 运行时进程里**）。
 *
 * ## 它做三件事
 *
 * ① **把系统提示词交给 dsh**：注册成一个 prompt section
 *    ⇒ ⚠️ **技能段不再由我们拼**（issue #153：技能退给 dsh ⇒ 技能目录由
 *    dsh 的 `dsh-tool-skill` 作为**用户消息**给模型 ⇒ 这里只给智能体自己的提示词）。
 * ② **把我们的命令挂进 dsh 的工具表**（命令本体仍在我们的进程里 ⇒ 走命令桥）。
 * ③ **把 MCP 服务器挂进 dsh 的工具表**（用 dsh 自带的**管理面** `dsh-mcp-manager`）
 *    ⇒ 并给 MCP 的写操作补上**闸门**（修改已有数据要人点头）。
 *
 * ## ⚠️ **provider 不归我们管**（issue #168 · D5=B）
 *
 * 模型路由由 **dsh 自带的 `@deepseek-ai/dsh-llm-pi-ai`** 提供
 * ⇒ 路由（baseURL / 模型 / key 的**变量名**）由**我们生成一段 profile 补丁**喂给它
 * （见 `core/adapter/dsh/profile.ts` 的 `writePiAiProviderPatch`）
 * ⇒ **我们不再自研 provider 适配器**（`provider.js` 已删 ⇒ 重复实现消失）。
 *
 * ## 配置全走环境变量
 *
 * ⚠️ 这个包会被 `pnpm add file:<路径>` 装进 dsh 的 profile ⇒ 它**没有自己的配置文件**
 *    ⇒ 提示词、工具目录、命令桥地址、MCP 清单**全部由环境变量给**
 *    ⇒ **凭据不落盘**（只活在子进程的内存里）。
 */

import { registerTools } from './tools.js'
import { registerGate, registerMcpServers } from './mcp.js'

/** dsh 里的插件名。 */
export const name = 'ai-admin'

/**
 * 依赖的服务（`llm` / `tools` / `systemPrompt`）。
 *
 * ⚠️ **仍然 inject `llm`**：provider 虽然归 dsh 自带的适配器管，
 *    但插件挂在这个作用域里 ⇒ dsh 组装模型请求时的工具表与提示词都看得见（口径不变）。
 */
export const inject = ['llm', 'tools', 'systemPrompt']

/**
 * 装插件。
 *
 * @param {object} ctx cordis 上下文。
 */
export async function apply(ctx) {
	// ⚠️ **几步各自兜住**：一段失败不许连累别的（插件挂不上去 ⇒ 工具全没有）。
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
