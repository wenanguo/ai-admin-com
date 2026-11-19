/**
 * 玩具工具（spike）—— 证明两件事：
 *
 * 1. **我们自己的工具能挂进 dsh 的 tool registry**：
 *    cordis 插件里 `ctx.tools.register(defineTool({...}))` 即可；
 *    ⚠️ dsh 的参数 schema 是**自己的 JSON-Schema 风格 DSL**（`{ type: 'string', required: true }`），
 *    **不是 typebox** ⇒ 我们现有的 typebox schema 要转一层（见 spec §2.3）。
 *
 * 2. **闸门（gate）能挂在 dsh 的审批缝上**：
 *    `ctx.get('approval').request({ agent, toolName, reason })` ⇒ dsh 发 `approval/request`
 *    ⇒ SDK 客户端（= 我们的服务）回答 `allowed-once | rejected | cancelled`。
 *    没有回答者 ⇒ 结果 `unavailable` ⇒ **fail closed**（与我们的口径一致）。
 *
 * 文本以 `MUTATE` 开头 ⇒ 走审批；否则直接放行（=「新增放行、修改要点头」的玩具版）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendFileSync } from 'node:fs'

export const inject = ['tools']

/** 把玩具工具的轨迹写进日志文件（spike 的「可复现日志」）。 */
function log(line) {
	try {
		appendFileSync(process.env.DSH_SPIKE_LOG ?? 'toy-tool.log', `${line}\n`)
	} catch {
		/* 日志写不了不算失败 */
	}
}

export function apply(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'toy_echo',
			description: '玩具工具：回显传入的文本。spike 用（text 以 MUTATE 开头时需要人点头）。',
			parameters: {
				text: { type: 'string', required: true, description: '要回显的文本' },
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: { echo: { type: 'string', required: true } },
				},
				render: (args, value) => [{ type: 'text', text: value.echo }],
			},
			execute: async (args, exec) => {
				const text = String(args.text ?? '')
				log(`tool-call toy_echo ${JSON.stringify(args)}`)
				if (text.startsWith('MUTATE')) {
					const approval = ctx.get('approval')
					if (approval === undefined) {
						log('approval-service missing ⇒ fail closed')
						return { echo: 'REJECTED:no-approval-service' }
					}
					try {
						const outcome = await approval.request({
							agent: exec.agent,
							toolName: 'toy_echo',
							reason: '玩具闸门：修改类操作要人点头',
						})
						log(`approval outcome=${outcome}`)
						if (outcome !== 'allowed-once') {
							return { echo: `REJECTED:${outcome}` }
						}
					} catch (error) {
						log(`approval request failed: ${error.message}`)
						return { echo: `REJECTED:error:${error.message}` }
					}
				}
				return { echo: `TOY-ECHO:${text}` }
			},
		}),
	)
}
