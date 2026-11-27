/**
 * MCP —— 把「我们的 MCP 服务器」挂进 dsh 的工具表（**管理面退给 dsh**，issue #153）。
 *
 * ## 为什么改用 dsh 的管理面
 *
 * 以前我们自己调 `@deepseek-ai/dsh-mcp-client` 的 `apply()` ⇒ 那只是「挂上去」。
 * 现在交给 **dsh 自带的管理面** `@deepseek-ai/dsh-mcp-manager`：
 * 服务器的**装 / 卸 / 列 / 探活 / 重连**都是它的活
 * （`register` / `list` / `watch` / `restart` / `probe`）⇒ **我们不造第二套**。
 *
 * ## 凭据仍然归我们
 *
 * ⚠️ **AiAdmin 的 MCP 要带调用方的 JWT**（后端靠它做权限码校验）
 * ⇒ token 只有我们知道 ⇒ **「按用户构造配置」那段仍在我们这边**
 *    （`core/mcp/mcp.ts`）⇒ 这里只负责把算好的配置**注册**进管理面。
 * ⇒ token 依然只活在**子进程的环境变量**里（**不落盘**）。
 *
 * ## 为什么管理面挂在**我们这个作用域**里
 *
 * ⚠️ dsh 的工具表是**按作用域**的：agent 有自己那一份
 *    ⇒ 工具注册在 root 作用域 ⇒ agent **看不见**（会变成 "unknown tool"）
 *    ⇒ 管理面必须挂在**我们插件的作用域**里（与 agent 同层）
 *    ⇒ 它挂出来的 MCP 工具才落进 agent 那份工具表。
 *
 * ## 工具名
 *
 * dsh 会把 MCP 的工具限定成 **`mcp__<serverName>__<toolName>`**
 * ⇒ **模型侧看到的就是这个名字**（技能正文里写的也是它 ⇒ 对得上）。
 * ⇒ **给人看的名字**由我们的适配层归一化（`core/mcp/tool-names.ts`）。
 */

/** dsh 的 MCP 管理面（**装 / 卸 / 列 / 探活都是它的活**）。 */
import McpServerManager from '@deepseek-ai/dsh-mcp-manager'

/** 一次工具调用的默认超时（毫秒）—— 与我们的 `core/mcp/mcp.ts` 同值。 */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** 启动一台 MCP 服务器的预算（毫秒）。 */
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000

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
 * 把 MCP 服务器注册进 dsh 的管理面（**每个实例一个连接**）。
 *
 * ⚠️ **一台挂不上不许连累别的**（挂不上 ⇒ 那台没有 MCP 工具，别的照常）。
 * ⚠️ 管理面是**异步挂**的 ⇒ 这里**等它挂上**再返回
 *    （模型第一轮就要看得见那批工具 ⇒ 早一步晚一步会变成「模型没工具可用」）。
 *
 * @param {object} ctx cordis 上下文。
 * @returns {Promise<number>} 注册上几台。
 */
export async function registerMcpServers(ctx) {
	const servers = readMcpServers()
	if (servers.length === 0) {
		return 0
	}
	let manager
	try {
		// ⚠️ **挂在我们这个作用域**（与 agent 同层 ⇒ 工具落进 agent 那份工具表）。
		await ctx.plugin(McpServerManager)
		manager = ctx.get('mcpManager')
	} catch (error) {
		console.error('[ai-admin] MCP 管理面挂不上：', error)
		return 0
	}
	if (manager === undefined) {
		console.error('[ai-admin] MCP 管理面拿不到（mcpManager 服务没起来）')
		return 0
	}
	let registered = 0
	for (const server of servers) {
		try {
			// ⚠️ **名字就是工具名的前缀**（`mcp__<name>__<tool>`）⇒ 不能重名。
			// ⚠️ **超时必须有**（dsh 的条目要求写明）⇒ 缺了就补默认值。
			manager.register(server.name, {
				toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
				startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
				...server.entry,
			})
			registered += 1
		} catch (error) {
			console.error('[ai-admin] MCP 服务器注册不上：', server?.name ?? '?', error)
		}
	}
	// ⚠️ **等它挂上**（管理面挂好了，模型才看得见那批工具）。
	for (const server of servers) {
		const state = await waitForServer(manager, server.name, server.entry?.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
		if (state !== 'connected') {
			console.error(`[ai-admin] MCP 服务器没连上：${server?.name ?? '?'}（${state}）`)
		}
	}
	return registered
}

/**
 * 等一台服务器挂完（**挂不上也要返回** ⇒ 别把启动卡死）。
 *
 * @param {object} manager dsh 的 MCP 管理面。
 * @param {string} name 服务器名。
 * @param {number} timeoutMs 预算（毫秒）。
 * @returns {Promise<string>} 最后的状态（`connected` = 好了）。
 */
async function waitForServer(manager, name, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const view = manager.list().find((item) => item.name === name)
		const state = view?.status?.state
		// ⚠️ `connecting` 之后还有 `connected` / `failed` / `closed` ⇒ 都不是「还在连」。
		if (state !== undefined && state !== 'connecting') {
			return state
		}
		await sleep(100)
	}
	return 'timeout'
}

/** 等一小会儿（毫秒）。 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * **闸门** —— MCP 的写操作也要人点头。
 *
 * ## 为什么需要它
 *
 * 我们的命令（`pm_create_task` 等）走命令桥 ⇒ 闸门在**我们这边**（`core/gate`）。
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
