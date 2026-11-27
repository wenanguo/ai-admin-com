/**
 * 我们的命令 → **dsh 的工具**（挂在 dsh 的 tool registry 里）。
 *
 * ## 为什么工具住在 dsh 那边
 *
 * dsh 是**子进程** ⇒ 它是真正跑 agent loop 的那个 ⇒ 工具必须注册在**它**的
 * tool registry 里，模型才看得见。
 *
 * ## 命令本体还在**我们**的进程里
 *
 * 我们的命令（`pm_create_task` 等）要数据库、要审计、要用户的 token ⇒ 不能在 dsh 进程里跑。
 * ⇒ **命令桥**：dsh 侧插件把调用**回调**到我们的服务（loopback HTTP + 进程内随机密钥）
 * ⇒ 我们的服务执行命令（**参数收窄也在这边做** ⇒ 口径与 pi 路径一致）。
 *
 * ## 闸门
 *
 * 「新增放行、修改要点头」的口径在**我们**这边算好（目录项里的 `confirm`）
 * ⇒ 插件只负责**问**（`approval/request`）⇒ 我们的服务回答（等真人点头）。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendFileSync } from 'node:fs'

/** 调试日志（**只写到环境变量指的那个文件** ⇒ 不污染 stderr）。 */
function debug(line) {
	const target = process.env.AI_DSH_DEBUG_LOG
	if (target === undefined || target.length === 0) return
	try {
		appendFileSync(target, `${line}\n`)
	} catch {
		/* 写不了就算了 */
	}
}

/**
 * 注册我们的命令（**目录来自环境变量** ⇒ 目录由我们的服务在起运行时之前算好）。
 *
 * @param {object} ctx cordis 上下文。
 */
export function registerTools(ctx) {
	const catalog = readCatalog()
	// ⚠️ **工具表用插件自己作用域里的那个**（补丁层 ⇒ 与 agent 同作用域 ⇒ agent 看得见）。
	const tools = ctx.tools
	debug(`注册工具：catalog=${catalog.length} root.tools=${typeof ctx.root.get('tools')?.register} 本地=${typeof tools?.register}`)
	debug(`approval：root=${typeof ctx.root.get('approval')} 本地=${typeof ctx.get('approval')}`)
	// ⚠️ **模型侧的工具声明**：在 agent 作用域里，工具表里的工具**自带**声明
	//    （dsh 组装模型请求时从工具表取）⇒ 我们不用再报一遍（报两遍模型会看到重名）。
	debug(`工具声明：靠工具表自带（catalog=${catalog.length}）`)
	for (const spec of catalog) {
		tools.register(
			defineTool({
				name: spec.name,
				description: spec.description,
				parameters: spec.parameters ?? {},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							ok: { type: 'boolean', required: true },
							summary: { type: 'string', required: true },
						},
					},
					render: (args, value) => [
						{ type: 'text', text: value?.summary ?? `工具 ${args?.tool ?? ''} 执行完成` },
					],
				},
				execute: async (args, exec) => {
					// ① 「修改要点头」⇒ 先问（**问的结果由我们的服务给**）
					if (spec.confirm === true) {
						// ⚠️ **审批服务也要用 root 的那个**（同上：作用域内的实例 agent 看不见）。
						const approval = ctx.get('approval') ?? ctx.root.get('approval')
						debug(`问审批：${spec.name} approval=${typeof approval?.request}`)
						if (approval === undefined) {
							// ⚠️ 没有审批服务 ⇒ **fail closed**（与我们的口径一致）
							return { ok: false, summary: '这次修改没有获得批准，没有执行。' }
						}
						let outcome
						try {
							outcome = await approval.request({
								agent: exec.agent,
								toolName: spec.name,
								callId: exec.callId,
								reason: '修改已有数据要先问人（我们的闸门口径）',
							})
						} catch (error) {
							return {
								ok: false,
								summary: `这次修改没有获得批准，没有执行（${error?.message ?? error}）`,
							}
						}
						if (outcome !== 'allowed-once') {
							return { ok: false, summary: '这次修改没有获得批准，没有执行。' }
						}
					}
					// ② 执行（**回调我们的服务** ⇒ 命令本体与审计都在那边）
					return callBridge(spec.name, args ?? {})
				},
			}),
		)
	}
}

/** 读工具目录（环境变量里的 base64 JSON）。 */
export function readCatalog() {
	const raw = process.env.AI_DSH_TOOLS
	if (raw === undefined || raw.length === 0) {
		return []
	}
	try {
		const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

/**
 * 回调我们的服务执行命令。
 *
 * @param {string} tool 工具名。
 * @param {object} args 参数。
 */
export async function callBridge(tool, args) {
	const url = process.env.AI_DSH_BRIDGE_URL
	const secret = process.env.AI_DSH_BRIDGE_SECRET
	const conversationId = process.env.AI_DSH_CONVERSATION_ID
	if (url === undefined || secret === undefined) {
		return { ok: false, summary: '命令桥没有配置好（AI_DSH_BRIDGE_URL / AI_DSH_BRIDGE_SECRET）' }
	}
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-dsh-bridge-secret': secret,
			},
			body: JSON.stringify({ conversationId, tool, args }),
		})
		const payload = await response.json().catch(() => ({}))
		if (!response.ok) {
			return {
				ok: false,
				summary: String(payload?.message ?? `命令执行失败（HTTP ${response.status}）`),
			}
		}
		return {
			ok: payload?.ok === true,
			summary: String(payload?.summary ?? '命令执行完成'),
		}
	} catch (error) {
		return { ok: false, summary: `命令执行失败：${error?.message ?? error}` }
	}
}
