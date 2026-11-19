/**
 * 我们自己的 provider（D5=A：**不依赖 pi-ai**）—— OpenAI 兼容的流 ⇒ dsh 的 chunk。
 *
 * ⚠️ 这些断言是「**协议翻译**」的断言（不需要任何模型凭据）。
 */

import { describe, expect, it } from 'vitest'
import { finishReasonOf, toOpenAiMessages, translateStream } from './provider.js'

/** 造一个假的 SSE 响应正文。 */
function sseBody(lines) {
	const text = lines.map((line) => `data: ${line}\n\n`).join('')
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text))
			controller.close()
		},
	})
}

/** 把 chunk 流收集成数组。 */
async function collect(stream) {
	const out = []
	for await (const chunk of stream) {
		out.push(chunk)
	}
	return out
}

describe('OpenAI 兼容的流 ⇒ dsh 的 chunk', () => {
	it('文本增量 ⇒ block-start / text-delta / block-end', async () => {
		const chunks = await collect(
			translateStream(
				sseBody([
					JSON.stringify({ choices: [{ delta: { content: '你' } }] }),
					JSON.stringify({ choices: [{ delta: { content: '好' } }] }),
					JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
				]),
			),
		)
		expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'text' })
		expect(chunks[1]).toEqual({ type: 'text-delta', index: 0, text: '你' })
		expect(chunks[2]).toEqual({ type: 'text-delta', index: 0, text: '好' })
		expect(chunks[3]).toEqual({ type: 'block-end', index: 0, block: { type: 'text', text: '你好' } })
		expect(chunks[chunks.length - 1]).toEqual({ type: 'finish', reason: { kind: 'stop' } })
	})

	it('工具调用 ⇒ tool-call-delta / block-end（**参数是原始 JSON 串**）', async () => {
		const chunks = await collect(
			translateStream(
				sseBody([
					JSON.stringify({
						choices: [
							{
								delta: {
									tool_calls: [
										{ index: 0, id: 'call-1', function: { name: 'create_task', arguments: '{"ti' } },
									],
								},
							},
						],
					}),
					JSON.stringify({
						choices: [
							{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tle":"x"}' } }] } },
						],
					}),
					JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
				]),
			),
		)
		const deltas = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
		expect(deltas[0]).toMatchObject({ id: 'call-1', name: 'create_task' })
		const end = chunks.find((chunk) => chunk.type === 'block-end')
		expect(end).toEqual({
			type: 'block-end',
			index: 1,
			block: { type: 'tool-call', id: 'call-1', name: 'create_task', arguments: '{"title":"x"}' },
		})
		expect(chunks[chunks.length - 1]).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
	})

	it('usage ⇒ usage chunk', async () => {
		const chunks = await collect(
			translateStream(
				sseBody([
					JSON.stringify({
						choices: [{ delta: { content: 'x' } }],
						usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
					}),
					JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
				]),
			),
		)
		const usage = chunks.find((chunk) => chunk.type === 'usage')
		expect(usage).toEqual({
			type: 'usage',
			usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 },
		})
	})
})

describe('dsh 的消息 ⇒ OpenAI 的 messages', () => {
	it('system / user / assistant / tool 都能映射', () => {
		const messages = toOpenAiMessages({
			system: '系统提示词',
			messages: [
				{ role: 'user', content: [{ type: 'text', text: '你好' }] },
				{
					role: 'assistant',
					content: [
						{ type: 'text', text: '我建一下' },
						{ type: 'tool-call', id: 'call-1', name: 'create_task', arguments: '{"title":"x"}' },
					],
				},
				{ role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: '建好了' }] },
			],
		})
		expect(messages[0]).toEqual({ role: 'system', content: '系统提示词' })
		expect(messages[1]).toEqual({ role: 'user', content: '你好' })
		expect(messages[2]).toMatchObject({
			role: 'assistant',
			content: '我建一下',
			tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'create_task' } }],
		})
		expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: '建好了' })
	})
})

describe('finish_reason 的映射', () => {
	it('stop / tool_calls / length', () => {
		expect(finishReasonOf('stop')).toEqual({ kind: 'stop' })
		expect(finishReasonOf('tool_calls')).toEqual({ kind: 'tool-calls' })
		expect(finishReasonOf('length')).toEqual({ kind: 'max-tokens' })
	})
})
