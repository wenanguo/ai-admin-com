/**
 * 我们自己的 provider —— **OpenAI 兼容的 chat-completions 流**。
 *
 * ## 为什么自己写（issue #120 · D5=A）
 *
 * dsh 官方有 `@deepseek-ai/dsh-llm-pi-ai`（省事），但它**建在 pi 的 `pi-ai` 上**
 * ⇒ 与「拔掉 pi」的目标冲突 ⇒ **不许用**。
 *
 * ⇒ 我们在 **`dsh-llm` 的缝上**自己写一个适配器：
 * 一个 provider 适配器 = 「把 dsh 的请求装配成厂商协议 + 把厂商的流翻译成 dsh 的 chunk」。
 *
 * ## 一份代码，两个厂商
 *
 * DeepSeek 官方（`https://api.deepseek.com/v1`）与 MiniMax（`https://api.minimaxi.com/v1`）
 * **都是 OpenAI 兼容的** ⇒ 同一个适配器，换 `baseURL` + key 即可 ⇒ **两家都不依赖 pi-ai**。
 *
 * ## 形状对照
 *
 * | dsh 的东西 | OpenAI 兼容的东西 |
 * | ---------- | ------------------ |
 * | `options.messages` | `messages` |
 * | `options.tools`（JSON Schema） | `tools[].function.parameters` |
 * | `text-delta` chunk | `choices[0].delta.content` |
 * | `tool-call-delta` chunk | `choices[0].delta.tool_calls[]` |
 * | `finish` chunk | `choices[0].finish_reason` |
 */

import { LlmAdapter, attributionHeaders } from '@deepseek-ai/dsh-llm'

/** 一个 provider 路由的配置（**全部来自环境变量** ⇒ 不落盘、不进 git）。 */
export class OpenAiCompatibleAdapter extends LlmAdapter {
	/**
	 * @param {object} options 路由配置。
	 * @param {string} options.route 路由名（如 `deepseek-direct`）。
	 * @param {string} options.baseURL OpenAI 兼容的根地址（到 `/v1` 为止）。
	 * @param {string} options.apiKey 鉴权用的 key。
	 * @param {string} options.model 默认模型 id。
	 * @param {number} [options.contextWindow] 上下文窗口（token）。
	 * @param {number} [options.maxTokens] 单次请求的输出上限。
	 */
	constructor(options) {
		super()
		this.route = options.route
		this.baseURL = options.baseURL.replace(/\/+$/, '')
		this.apiKey = options.apiKey
		this.model = options.model
		this.contextWindow = options.contextWindow ?? 131072
		this.maxTokens = options.maxTokens ?? 8192
	}

	/** 路由的展示信息。 */
	providerInfo(provider) {
		return { id: provider, name: provider }
	}

	/** 这个路由能用的模型（**只有一个** ⇒ 就是配置里那个）。 */
	listModels() {
		return Promise.resolve([
			{ provider: this.route, id: this.model, name: this.model },
		])
	}

	/** 精确到某个模型的元信息。 */
	resolveModel(provider, model) {
		return Promise.resolve({
			provider,
			id: model,
			name: model,
			context: { contextWindow: this.contextWindow },
			defaultMaxTokens: this.maxTokens,
		})
	}

	/**
	 * 跑一次模型调用（**流式**）。
	 *
	 * @param {object} options dsh 装配好的请求。
	 * @returns {AsyncGenerator<object>} dsh 的 chunk 流。
	 */
	async *stream(options) {
		const body = {
			model: options.model ?? this.model,
			messages: toOpenAiMessages(options),
			stream: true,
			stream_options: { include_usage: true },
			...(options.tools && options.tools.length > 0
				? { tools: options.tools.map((tool) => ({
						type: 'function',
						function: {
							name: tool.name,
							description: tool.description,
							parameters: tool.parameters ?? { type: 'object', properties: {} },
						},
				  })) }
				: {}),
			...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
			...(options.temperature === undefined ? {} : { temperature: options.temperature }),
			...(options.stop && options.stop.length > 0 ? { stop: options.stop } : {}),
		}

		const response = await fetch(`${this.baseURL}/chat/completions`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${this.apiKey}`,
				// ⚠️ dsh 要求每个厂商请求都带归属头（不许抑制）
				...attributionHeaders(),
			},
			body: JSON.stringify(body),
			...(options.signal ? { signal: options.signal } : {}),
		})
		if (!response.ok) {
			const detail = await response.text().catch(() => '')
			throw new Error(`模型请求失败：HTTP ${response.status} ${detail.slice(0, 500)}`)
		}
		if (response.body === null) {
			throw new Error('模型响应没有流式正文')
		}

		yield* translateStream(response.body)
	}
}

/**
 * dsh 的消息 ⇒ OpenAI 兼容的 messages。
 *
 * ⚠️ dsh 的消息是 `{role, content: ContentBlock[]}` ⇒ 要把 block 拆成
 *    「文本」与「工具调用」两类。
 */
export function toOpenAiMessages(options) {
	const out = []
	if (typeof options.system === 'string' && options.system.length > 0) {
		out.push({ role: 'system', content: options.system })
	}
	for (const message of options.messages ?? []) {
		const blocks = Array.isArray(message.content) ? message.content : []
		const text = blocks
			.filter((block) => block?.type === 'text')
			.map((block) => block.text ?? '')
			.join('')
		const toolCalls = blocks
			.filter((block) => block?.type === 'tool-call')
			.map((block) => ({
				id: block.id,
				type: 'function',
				function: { name: block.name, arguments: block.arguments ?? '{}' },
			}))
		if (message.role === 'tool') {
			out.push({
				role: 'tool',
				tool_call_id: message.toolCallId ?? '',
				content: text,
			})
			continue
		}
		if (message.role === 'developer') {
			out.push({ role: 'system', content: text })
			continue
		}
		if (message.role === 'assistant') {
			out.push({
				role: 'assistant',
				content: text,
				...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
			})
			continue
		}
		out.push({ role: message.role, content: text })
	}
	return out
}

/**
 * OpenAI 兼容的 SSE ⇒ dsh 的 chunk 流。
 *
 * @param {ReadableStream<Uint8Array>} body 响应正文。
 * @returns {AsyncGenerator<object>} dsh 的 chunk。
 */
export async function* translateStream(body) {
	const decoder = new TextDecoder()
	let buffer = ''
	/** 文本块（**索引 0**）。 */
	let textStarted = false
	let text = ''
	/** 工具调用（按 OpenAI 的 `index` 归拢）。 */
	const calls = new Map()
	let finishReason = 'stop'
	let usage

	for await (const piece of readLines(body, decoder)) {
		const line = piece.trim()
		if (line.length === 0 || !line.startsWith('data:')) {
			continue
		}
		const data = line.slice(5).trim()
		if (data === '[DONE]') {
			break
		}
		let parsed
		try {
			parsed = JSON.parse(data)
		} catch {
			continue
		}
		if (parsed.usage !== undefined && parsed.usage !== null) {
			usage = parsed.usage
		}
		const choice = parsed.choices?.[0]
		if (choice === undefined) {
			continue
		}
		if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
			finishReason = choice.finish_reason
		}
		const delta = choice.delta ?? {}
		if (typeof delta.content === 'string' && delta.content.length > 0) {
			if (!textStarted) {
				textStarted = true
				yield { type: 'block-start', index: 0, blockType: 'text' }
			}
			text += delta.content
			yield { type: 'text-delta', index: 0, text: delta.content }
		}
		for (const call of delta.tool_calls ?? []) {
			const index = typeof call.index === 'number' ? call.index : 0
			const known = calls.get(index) ?? { id: '', name: '', arguments: '' }
			if (typeof call.id === 'string' && call.id.length > 0) {
				known.id = call.id
			}
			if (typeof call.function?.name === 'string' && call.function.name.length > 0) {
				known.name = call.function.name
			}
			if (typeof call.function?.arguments === 'string') {
				known.arguments += call.function.arguments
			}
			calls.set(index, known)
			yield {
				type: 'tool-call-delta',
				// ⚠️ 文本块占 0 ⇒ 工具块从 1 开始（块的索引不能重复）
				index: index + 1,
				id: known.id,
				...(known.name.length > 0 ? { name: known.name } : {}),
				argumentsDelta: typeof call.function?.arguments === 'string' ? call.function.arguments : '',
			}
		}
	}

	if (textStarted) {
		yield { type: 'block-end', index: 0, block: { type: 'text', text } }
	}
	for (const [index, call] of calls) {
		yield {
			type: 'block-end',
			index: index + 1,
			block: {
				type: 'tool-call',
				id: call.id,
				name: call.name,
				arguments: call.arguments,
			},
		}
	}
	if (usage !== undefined) {
		yield {
			type: 'usage',
			usage: {
				inputTokens: usage.prompt_tokens ?? 0,
				outputTokens: usage.completion_tokens ?? 0,
				...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
			},
		}
	}
	yield { type: 'finish', reason: finishReasonOf(finishReason) }
}

/**
 * OpenAI 的 `finish_reason` ⇒ dsh 的 finish 词汇。
 *
 * @param {string} reason 厂商给的原因。
 */
export function finishReasonOf(reason) {
	switch (reason) {
		case 'tool_calls':
		case 'function_call':
			return { kind: 'tool-calls' }
		case 'length':
			return { kind: 'max-tokens' }
		case 'stop':
			return { kind: 'stop' }
		default:
			return { kind: 'stop' }
	}
}

/**
 * 把响应正文按行切开（**跨块的处理**：SSE 的行可能被拆在两个 chunk 里）。
 *
 * @param {ReadableStream<Uint8Array>} body 响应正文。
 * @param {TextDecoder} decoder 解码器。
 * @returns {AsyncGenerator<string>} 每一行（不含换行）。
 */
export async function* readLines(body, decoder) {
	const reader = body.getReader()
	let buffer = ''
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) {
				break
			}
			buffer += decoder.decode(value, { stream: true })
			let newline = buffer.indexOf('\n')
			while (newline >= 0) {
				yield buffer.slice(0, newline)
				buffer = buffer.slice(newline + 1)
				newline = buffer.indexOf('\n')
			}
		}
		if (buffer.length > 0) {
			yield buffer
		}
	} finally {
		reader.releaseLock()
	}
}
