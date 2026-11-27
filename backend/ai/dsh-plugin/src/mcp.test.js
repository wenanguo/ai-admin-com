/**
 * MCP —— dsh 侧插件的这一半（**纯 JS** ⇒ 跑在 dsh 运行时进程里）。
 *
 * ## 它证明什么
 *
 * 1. **配置从环境变量来**（base64 的 JSON ⇒ 凭据不落盘）；
 * 2. **闸门只问 MCP 的写工具**（我们的命令在工具内部已经问过了 ⇒ 不许问两遍）；
 * 3. **口径不在插件这边**（issue #195）⇒ 插件按**内核给的清单**问
 *    ⇒ **拿不到清单 ⇒ 一律问**（fail closed ⇒ 不会因为漏配就绕过闸门）。
 */

import { describe, expect, it } from 'vitest'
import { readMcpServers, registerGate, readAskPrefixes } from './mcp.js'

/** 把配置写进环境变量（base64 的 JSON）。 */
function withServers(servers, run) {
	const previous = process.env.AI_DSH_MCP_SERVERS
	if (servers === undefined) {
		delete process.env.AI_DSH_MCP_SERVERS
	} else {
		process.env.AI_DSH_MCP_SERVERS = Buffer.from(JSON.stringify(servers), 'utf8').toString('base64')
	}
	try {
		return run()
	} finally {
		if (previous === undefined) {
			delete process.env.AI_DSH_MCP_SERVERS
		} else {
			process.env.AI_DSH_MCP_SERVERS = previous
		}
	}
}

/**
 * 把「要人点头的前缀清单」写进环境变量（**内核给的那一份** ⇒ base64 的 JSON）。
 *
 * @param {string[] | undefined} prefixes 清单（`undefined` = 不给 ⇒ 插件一律问）。
 * @param {() => void} run 要跑的。
 */
function withAskPrefixes(prefixes, run) {
	const previous = process.env.AI_DSH_GATE_ASK_PREFIXES
	if (prefixes === undefined) {
		delete process.env.AI_DSH_GATE_ASK_PREFIXES
	} else {
		process.env.AI_DSH_GATE_ASK_PREFIXES = Buffer.from(
			JSON.stringify(prefixes),
			'utf8',
		).toString('base64')
	}
	try {
		return run()
	} finally {
		if (previous === undefined) {
			delete process.env.AI_DSH_GATE_ASK_PREFIXES
		} else {
			process.env.AI_DSH_GATE_ASK_PREFIXES = previous
		}
	}
}

/** 内核给的那份清单（**测试里照抄一份** ⇒ 插件不认得具体是哪几个前缀）。 */
const ASK_PREFIXES = ['update_', 'patch_']

describe('MCP 服务器清单（环境变量）', () => {
	it('没配 ⇒ 空列表', () => {
		withServers(undefined, () => {
			expect(readMcpServers()).toEqual([])
		})
	})

	it('配了 ⇒ 读回来（服务器名 / 地址 / 头）', () => {
		withServers(
			[
				{
					transport: 'streamable-http',
					serverName: 'aiadmin',
					url: 'https://example.test/mcp',
					headers: { Authorization: 'Bearer jwt' },
					toolCallTimeoutMs: 60000,
				},
			],
			() => {
				const servers = readMcpServers()
				expect(servers).toHaveLength(1)
				expect(servers[0].serverName).toBe('aiadmin')
				expect(servers[0].headers.Authorization).toBe('Bearer jwt')
			},
		)
	})

	it('坏了的载荷 ⇒ 空列表（不许炸）', () => {
		const previous = process.env.AI_DSH_MCP_SERVERS
		process.env.AI_DSH_MCP_SERVERS = '不是 base64 的 JSON'
		try {
			expect(readMcpServers()).toEqual([])
		} finally {
			if (previous === undefined) {
				delete process.env.AI_DSH_MCP_SERVERS
			} else {
				process.env.AI_DSH_MCP_SERVERS = previous
			}
		}
	})
})

describe('闸门（只问 MCP 的写工具）', () => {
	/** 造一个假的 cordis 上下文（只记监听器）。 */
	function fakeCtx() {
		const listeners = []
		return {
			listeners,
			on(name, listener) {
				listeners.push({ name, listener })
			},
		}
	}

	/** 跑一次 pre-execute ⇒ 得到决策。 */
	async function decide(ctx, toolName) {
		const entry = ctx.listeners.find((item) => item.name === 'tools/pre-execute')
		expect(entry).toBeDefined()
		return entry.listener({ name: toolName }, async () => ({ kind: 'allow' }))
	}

	it('MCP 的**写**工具 ⇒ 问（ask）', async () => {
		await withAskPrefixes(ASK_PREFIXES, async () => {
			const ctx = fakeCtx()
			registerGate(ctx)
			expect(await decide(ctx, 'mcp__aiadmin__update_task')).toEqual({
				kind: 'ask',
				reason: '修改已有数据要先问人（我们的闸门口径）',
			})
		})
	})

	it('MCP 的**读 / 新建**工具 ⇒ 放行', async () => {
		await withAskPrefixes(ASK_PREFIXES, async () => {
			const ctx = fakeCtx()
			registerGate(ctx)
			expect(await decide(ctx, 'mcp__aiadmin__create_task')).toEqual({ kind: 'allow' })
			expect(await decide(ctx, 'mcp__aiadmin__list_tasks')).toEqual({ kind: 'allow' })
		})
	})

	it('**我们自己的**命令 ⇒ 不问（工具内部已经问过了）', async () => {
		await withAskPrefixes(ASK_PREFIXES, async () => {
			const ctx = fakeCtx()
			registerGate(ctx)
			expect(await decide(ctx, 'update_task')).toEqual({ kind: 'allow' })
			expect(await decide(ctx, 'create_task')).toEqual({ kind: 'allow' })
		})
	})

	it('**清单由内核给** ⇒ 插件照着判（换个前缀 ⇒ 换个结论）', async () => {
		await withAskPrefixes(['destroy_'], async () => {
			const ctx = fakeCtx()
			registerGate(ctx)
			// ⚠️ 内核说「destroy_ 要点头」⇒ 插件就问 destroy_（它不认得具体是哪些前缀）
			expect(await decide(ctx, 'mcp__aiadmin__destroy_task')).toEqual({
				kind: 'ask',
				reason: '修改已有数据要先问人（我们的闸门口径）',
			})
			// ⚠️ 内核没说 update_ 要点头 ⇒ 插件就放行（**口径只有内核那一份**）
			expect(await decide(ctx, 'mcp__aiadmin__update_task')).toEqual({ kind: 'allow' })
		})
	})

	it('**拿不到清单 ⇒ 一律问**（fail closed ⇒ 不会因为漏配就绕过闸门）', async () => {
		await withAskPrefixes(undefined, async () => {
			const ctx = fakeCtx()
			registerGate(ctx)
			expect(await decide(ctx, 'mcp__aiadmin__create_task')).toEqual({
				kind: 'ask',
				reason: '修改已有数据要先问人（我们的闸门口径）',
			})
			expect(await decide(ctx, 'mcp__aiadmin__list_tasks')).toEqual({
				kind: 'ask',
				reason: '修改已有数据要先问人（我们的闸门口径）',
			})
		})
	})
})

describe('闸门清单（内核给的那一份）', () => {
	it('没配 ⇒ undefined（一律问）', () => {
		withAskPrefixes(undefined, () => {
			expect(readAskPrefixes()).toBeUndefined()
		})
	})

	it('配了 ⇒ 读回来', () => {
		withAskPrefixes(['update_', 'patch_'], () => {
			expect(readAskPrefixes()).toEqual(['update_', 'patch_'])
		})
	})

	it('坏了的载荷 ⇒ undefined（一律问 ⇒ 不许静默放行）', () => {
		const previous = process.env.AI_DSH_GATE_ASK_PREFIXES
		process.env.AI_DSH_GATE_ASK_PREFIXES = '不是 base64 的 JSON'
		try {
			expect(readAskPrefixes()).toBeUndefined()
		} finally {
			if (previous === undefined) {
				delete process.env.AI_DSH_GATE_ASK_PREFIXES
			} else {
				process.env.AI_DSH_GATE_ASK_PREFIXES = previous
			}
		}
	})

	it('不是数组 ⇒ undefined（一律问）', () => {
		const previous = process.env.AI_DSH_GATE_ASK_PREFIXES
		process.env.AI_DSH_GATE_ASK_PREFIXES = Buffer.from(
			JSON.stringify({ update_: true }),
			'utf8',
		).toString('base64')
		try {
			expect(readAskPrefixes()).toBeUndefined()
		} finally {
			if (previous === undefined) {
				delete process.env.AI_DSH_GATE_ASK_PREFIXES
			} else {
				process.env.AI_DSH_GATE_ASK_PREFIXES = previous
			}
		}
	})
})
