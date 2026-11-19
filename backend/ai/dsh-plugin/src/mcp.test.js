/**
 * MCP —— dsh 侧插件的这一半（**纯 JS** ⇒ 跑在 dsh 运行时进程里）。
 *
 * ## 它证明什么
 *
 * 1. **配置从环境变量来**（base64 的 JSON ⇒ 凭据不落盘）；
 * 2. **闸门只问 MCP 的写工具**（我们的命令在工具内部已经问过了 ⇒ 不许问两遍）。
 */

import { describe, expect, it } from 'vitest'
import { readMcpServers, registerGate } from './mcp.js'

/** 把配置写进环境变量（base64 的 JSON）。 */
function withServers(servers, run) {
	const previous = process.env.DSH_AI_MCP_SERVERS
	if (servers === undefined) {
		delete process.env.DSH_AI_MCP_SERVERS
	} else {
		process.env.DSH_AI_MCP_SERVERS = Buffer.from(JSON.stringify(servers), 'utf8').toString('base64')
	}
	try {
		return run()
	} finally {
		if (previous === undefined) {
			delete process.env.DSH_AI_MCP_SERVERS
		} else {
			process.env.DSH_AI_MCP_SERVERS = previous
		}
	}
}

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
		const previous = process.env.DSH_AI_MCP_SERVERS
		process.env.DSH_AI_MCP_SERVERS = '不是 base64 的 JSON'
		try {
			expect(readMcpServers()).toEqual([])
		} finally {
			if (previous === undefined) {
				delete process.env.DSH_AI_MCP_SERVERS
			} else {
				process.env.DSH_AI_MCP_SERVERS = previous
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
		const ctx = fakeCtx()
		registerGate(ctx)
		expect(await decide(ctx, 'mcp__aiadmin__update_task')).toEqual({
			kind: 'ask',
			reason: '修改已有数据要先问人（我们的闸门口径）',
		})
	})

	it('MCP 的**读 / 新建**工具 ⇒ 放行', async () => {
		const ctx = fakeCtx()
		registerGate(ctx)
		expect(await decide(ctx, 'mcp__aiadmin__create_task')).toEqual({ kind: 'allow' })
		expect(await decide(ctx, 'mcp__aiadmin__list_tasks')).toEqual({ kind: 'allow' })
	})

	it('**我们自己的**命令 ⇒ 不问（工具内部已经问过了）', async () => {
		const ctx = fakeCtx()
		registerGate(ctx)
		expect(await decide(ctx, 'update_task')).toEqual({ kind: 'allow' })
		expect(await decide(ctx, 'create_task')).toEqual({ kind: 'allow' })
	})
})
