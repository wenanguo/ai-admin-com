/**
 * MCP —— 把「我们的 MCP 服务器」挂进 dsh 的工具表。
 *
 * ## 为什么用 dsh 自带的客户端
 *
 * MCP 是**标准协议** ⇒ dsh 自带 `@deepseek-ai/dsh-mcp-client`（尖峰实测能挂
 * 标准 MCP server 并被模型调用）⇒ **不自己写协议**（少一处升级风险）。
 *
 * ## 配置从哪来
 *
 * ⚠️ **全部走环境变量**（`AI_DSH_MCP_SERVERS`：base64 的 JSON 数组）⇒
 *    **凭据不落盘**（token 只活在子进程内存里）。
 *    ⇒ 配置由**我们的服务**在起运行时之前算好（见 `core/adapter/dsh/runner.ts`）。
 *
 * ## 工具名
 *
 * dsh 会把 MCP 的工具限定成 **`mcp__<serverName>__<toolName>`**
 * ⇒ **模型侧看到的就是这个名字**（技能正文里写的也是它 ⇒ 对得上）。
 * ⇒ **给人看的名字**由我们的适配层归一化（`core/mcp/tool-names.ts`）。
 */

/** dsh 的 MCP 客户端（**配置 schema + 挂载入口**）。 */
import { Config, apply } from '@deepseek-ai/dsh-mcp-client'

/**
 * 读 MCP 服务器清单（环境变量里的 base64 JSON）。
 *
 * @returns 数组（**没有就是空** ⇒ 不挂 MCP）。
 */
export function readMcpServers() {
	const raw = process.env.AI_DSH_MCP_SERVERS
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
 * 把 MCP 服务器挂上去（**每个实例一个连接**）。
 *
 * ⚠️ **一台挂不上不许连累别的**（挂不上 ⇒ 那台没有 MCP 工具，别的照常）。
 * ⚠️ `failOnStartupError: false` ⇒ 连不上**不炸**（重连策略自己处理）⇒
 *    后端 MCP 临时不可用时，AI 还能用我们自己的命令。
 *
 * @param {object} ctx cordis 上下文。
 * @returns {Promise<number>} 挂上几台。
 */
export async function registerMcpServers(ctx) {
	const servers = readMcpServers()
	let registered = 0
	for (const server of servers) {
		try {
			// ⚠️ **过一遍 dsh 自己的 schema** ⇒ 默认值补齐（超时 / 重连策略……）。
			const config = Config({
				...server,
				failOnStartupError: false,
				startupTimeoutMs: 15_000,
			})
			await apply(ctx, config)
			registered += 1
		} catch (error) {
			console.error('[ai-admin] MCP 服务器挂不上：', server?.serverName ?? '?', error)
		}
	}
	return registered
}

/**
 * **闸门** —— MCP 的写操作也要人点头。
 *
 * ## 为什么需要它
 *
 * 我们的命令（`create_task` 等）走命令桥 ⇒ 闸门在**我们这边**（`core/gate`）。
 * 而 MCP 的工具是 **dsh 直接注册**的 ⇒ 不经过命令桥 ⇒ **不会有人问**。
 * ⚠️ 那就等于「修改已有数据」这条口径被绕过去了 ⇒ 必须补上。
 *
 * ## 怎么补
 *
 * dsh 的工具管线有一个**统一拦截点**（`tools/pre-execute`）⇒ 我们在这里
 * 对「MCP 的写工具」返回 `ask` ⇒ dsh 走**审批缝**（`approval/request`）
 * ⇒ **我们的进程**处理（挂待确认 ⇒ 等真人点头 ⇒ 回放行/拒绝）。
 *
 * ⚠️ **只问 MCP 的工具**（我们的命令在工具内部已经问过了 ⇒ 不许问两遍）。
 * ⚠️ **口径与我们这边一致**：`update_` / `patch_` 要点头，其余放行。
 *
 * @param {object} ctx cordis 上下文。
 */
export function registerGate(ctx) {
	ctx.on('tools/pre-execute', async (exec, next) => {
		const name = typeof exec?.name === 'string' ? exec.name : ''
		// ⚠️ **只管 MCP 的工具**（`mcp__<server>__<tool>`）。
		if (!name.startsWith('mcp__')) {
			return next()
		}
		const bare = name.replace(/^mcp__[^_]+__/, '')
		if (!bare.startsWith('update_') && !bare.startsWith('patch_')) {
			return next()
		}
		// ⚠️ **问**（由我们的服务回答 ⇒ 挂起待确认 ⇒ 等真人点头）。
		return {
			kind: 'ask',
			reason: '修改已有数据要先问人（我们的闸门口径）',
		}
	})
}
