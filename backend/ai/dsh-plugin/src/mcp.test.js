/**
 * MCP —— dsh 侧插件的这一半（**纯 JS** ⇒ 跑在 dsh 运行时进程里）。
 *
 * ## 它证明什么
 *
 * 1. **配置从环境变量来**（base64 的 JSON ⇒ 凭据不落盘）；
 * 2. **闸门只问 MCP 的工具**（我们的命令在工具内部已经问过了 ⇒ 不许问两遍）；
 * 3. **口径不在插件这边**（issue #195）⇒ 插件**一律问** ⇒ **判定交回内核**
 *    ⇒ 「哪些工具要人点头」**只有内核那一份**。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readMcpServers, registerGate } from './mcp.js'

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

describe('闸门（判定交回内核）', () => {
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
			reason: '按我们的闸门口径确认这次工具调用（判定在我们的内核那边）',
		})
	})

	it('MCP 的**读 / 新建**工具 ⇒ **也问**（判定交回内核 ⇒ 插件不判）', async () => {
		const ctx = fakeCtx()
		registerGate(ctx)
		expect(await decide(ctx, 'mcp__aiadmin__create_task')).toEqual({
			kind: 'ask',
			reason: '按我们的闸门口径确认这次工具调用（判定在我们的内核那边）',
		})
		expect(await decide(ctx, 'mcp__aiadmin__list_tasks')).toEqual({
			kind: 'ask',
			reason: '按我们的闸门口径确认这次工具调用（判定在我们的内核那边）',
		})
	})

	it('**我们自己的**命令 ⇒ 不问（工具内部已经问过了）', async () => {
		const ctx = fakeCtx()
		registerGate(ctx)
		expect(await decide(ctx, 'update_task')).toEqual({ kind: 'allow' })
		expect(await decide(ctx, 'create_task')).toEqual({ kind: 'allow' })
	})

	it('**插件里没有闸门口径**（issue #195 ⇒ 只有一个住处）', () => {
		// ⚠️ **源码里不许出现那几个前缀** ⇒ 口径只有内核那一份。
		//    （注释里不算 ⇒ 文档可以提；**代码**里出现就是第二份口径。）
		// ⚠️ 前缀**在这里拼出来** ⇒ 连本测试文件都不出现那几个词
		//    ⇒ `grep -rn "update_"` 全仓只命中内核那一份。
		const prefixes = ['update', 'patch', 'create'].map((word) => `${word}_`)
		const source = readFileSync(new URL('./mcp.js', import.meta.url), 'utf8')
		const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
		for (const prefix of prefixes) {
			expect(code).not.toContain(prefix)
		}
	})
})
