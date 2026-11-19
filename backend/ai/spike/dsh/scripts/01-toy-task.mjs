/**
 * issue #119 · spike 主脚本：起一个 dsh 运行时，跑通「模型 + 一个工具」的玩具任务。
 *
 * 跑法（见 ../README.md）：
 *   cd backend/ai/spike/dsh
 *   pnpm install                       # 装 dsh（精确版本，见 dsh-versions.lock.json）
 *   pnpm install --dir toy-mcp         # 装玩具 MCP server 的依赖
 *   DSH_SPIKE_API_KEY=… DSH_SPIKE_BASE_URL=… node scripts/01-toy-task.mjs
 *
 * 脚本干的事（每一步都留证据）：
 *   0. 准备 dshHome（首次会创建 `sdk` profile，并把玩具工具 + dsh-mcp-client 装进 profile）
 *   1. 模型        —— 真模型回一句话（证明 provider seam 通了）
 *   2. 我们的工具  —— 玩具工具被模型调用（证明 tool registry 接缝通了）
 *   3. MCP 工具    —— mcp__toy__toy_echo 被调用（证明 MCP 能挂）
 *   4. 闸门        —— approval/request 往返（allowed-once 与 rejected 各一次）
 *   5. 事件        —— 打印 dsh 的会话事件序列（= 我们 SSE 契约的映射依据）
 *
 * ⚠️ 不写任何真实业务数据：只回显玩具字符串。
 * ⚠️ 凭据从环境变量读（**不入库**）；也支持从 pi 的 models.json 里取现成路由。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const here = dirname(fileURLToPath(import.meta.url))
const spikeRoot = resolve(here, '..')
const outDir = join(spikeRoot, 'out')
mkdirSync(outDir, { recursive: true })

const logPath = join(outDir, 'spike-log.json')
const toolLogPath = join(outDir, 'toy-tool.log')
writeFileSync(toolLogPath, '')

/** 版本锁（唯一出处）。 */
const lock = JSON.parse(readFileSync(join(spikeRoot, 'dsh-versions.lock.json'), 'utf8'))
const V = lock.packages

/** dshHome：默认放在 out/ 下（gitignore 覆盖）。 */
const dshHome = process.env.DSH_SPIKE_HOME ?? join(outDir, 'dsh-home')
const profileDir = join(dshHome, 'profiles', 'sdk')

/** 模型路由：优先环境变量；否则从 pi 的 models.json 里取一个现成路由（凭据不落盘）。 */
function resolveRoute() {
	const apiKey = process.env.DSH_SPIKE_API_KEY
	const baseUrl = process.env.DSH_SPIKE_BASE_URL
	if (apiKey && baseUrl) return { apiKey, baseUrl }
	const modelsFile = process.env.PI_MODELS_FILE ?? join(homedir(), '.pi', 'agent', 'models.json')
	if (!existsSync(modelsFile)) {
		throw new Error(
			'没有模型凭据：请设 DSH_SPIKE_API_KEY + DSH_SPIKE_BASE_URL，或设 PI_MODELS_FILE 指向一个含 provider 路由的 models.json',
		)
	}
	const provider = process.env.SPIKE_PROVIDER ?? 'ppu'
	const route = JSON.parse(readFileSync(modelsFile, 'utf8')).providers?.[provider]
	if (!route) throw new Error(`${modelsFile} 里没有 provider 路由 "${provider}"`)
	return { apiKey: route.apiKey, baseUrl: route.baseUrl }
}

const route = resolveRoute()
const model = process.env.DSH_SPIKE_MODEL ?? 'deepseek-v4-flash'

/** dsh 可执行文件（与 sdk-client 同版本）。 */
const dshBin = process.env.DSH_SPIKE_BIN ?? join(spikeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** 让 profile 里装上：玩具工具（file:）+ dsh-mcp-client（精确版本）。 */
function prepareProfile() {
	if (!existsSync(profileDir)) {
		console.log(`[0] 创建 dsh profile: ${profileDir}`)
		const created = spawnSync(process.execPath, [dshBin, '--profile', 'sdk', '--dump-config'], {
			env: { ...process.env, DSH_HOME: dshHome },
			encoding: 'utf8',
		})
		if (created.status !== 0) {
			throw new Error(`创建 profile 失败：${created.stderr || created.stdout}`)
		}
	}
	const profilePkg = join(profileDir, 'package.json')
	const pkg = JSON.parse(readFileSync(profilePkg, 'utf8'))
	const deps = pkg.dependencies ?? {}
	const wanted = {
		'@ai-admin/dsh-toy-tool': `file:${join(spikeRoot, 'toy-tool').replace(/\\/g, '/')}`,
		'@deepseek-ai/dsh-mcp-client': V['@deepseek-ai/dsh-mcp-client'],
	}
	if (Object.entries(wanted).every(([k, v]) => deps[k] === v)) {
		console.log('[0] profile 依赖已就位')
		return
	}
	console.log('[0] 往 profile 里装：玩具工具 + dsh-mcp-client（pnpm，dsh 的机制本身就是 pnpm）')
	// ⚠️ Windows 上 .cmd 只能经 shell 起（Node 的安全限制）⇒ 用一条命令串 + 引号。
	const specs = Object.entries(wanted).map(([k, v]) => `"${k}@${v}"`).join(' ')
	const added = spawnSync(`pnpm add ${specs}`, {
		cwd: profileDir,
		encoding: 'utf8',
		shell: true,
	})
	if (added.status !== 0) {
		throw new Error(`pnpm add 失败：${added.stderr || added.stdout}`)
	}
}

prepareProfile()

const childEnv = {
	...process.env,
	DSH_HOME: dshHome,
	DSH_SPIKE_API_KEY: route.apiKey,
	DSH_SPIKE_BASE_URL: route.baseUrl,
	DSH_SPIKE_MCP_SERVER: join(spikeRoot, 'toy-mcp', 'server.mjs'),
	DSH_SPIKE_LOG: toolLogPath,
}

const report = {
	lockedReleaseLine: lock.releaseLine,
	model,
	provider: 'spike-gw（dsh-llm-pi-ai ⇒ OpenAI 兼容网关上的 DeepSeek 模型）',
	stages: [],
}

/** 起一个 dsh 运行时（子进程 + stdio JSON-RPC）。 */
function newHarness(extra = {}) {
	return new DeepSeekHarness({
		profile: 'sdk',
		dshHome,
		dshBin,
		patches: [join(spikeRoot, 'patch-pi-ai.yml')],
		provider: 'spike-gw',
		model,
		maxTokens: 2048,
		env: childEnv,
		...extra,
	})
}

/** 事件的类型序列（我们要映射成 SSE 的那些）。 */
function eventTypes(result) {
	return result.events.map((event) => event.type ?? event.kind)
}

/** 工具调用 / 结果的摘要。 */
function toolCalls(result) {
	return result.events
		.filter((event) => (event.type ?? event.kind) === 'tool/call')
		.map((event) => event.data?.name)
}

function toolResults(result) {
	return result.events
		.filter((event) => (event.type ?? event.kind) === 'tool/result')
		.map((event) => String(event.data?.message?.content?.[0]?.text ?? '').slice(0, 120))
}

// ── 1. 模型 ────────────────────────────────────────────────────────────────
{
	console.log('\n=== 1) 只问模型（证明 provider seam 通了）')
	await using harness = newHarness()
	const result = await harness.run('用一句话回答：1+1 等于几？')
	console.log('   final:', result.finalResponse)
	report.stages.push({
		stage: 'model',
		ok: /2/.test(result.finalResponse ?? ''),
		finalResponse: result.finalResponse,
		eventTypes: eventTypes(result),
	})
}

// ── 2. 我们自己的工具 ──────────────────────────────────────────────────────
{
	console.log('\n=== 2) 调用「我们自己的」玩具工具（证明 tool registry 接缝通了）')
	await using harness = newHarness()
	const result = await harness.run('请调用 toy_echo 工具，参数 text 传 "hello-dsh"。调用完成后只回复工具返回的字符串。')
	console.log('   final:', result.finalResponse)
	console.log('   tool calls:', toolCalls(result).join(', '))
	report.stages.push({
		stage: 'own-tool',
		ok: toolCalls(result).includes('toy_echo'),
		finalResponse: result.finalResponse,
		toolCalls: toolCalls(result),
		toolResults: toolResults(result),
	})
}

// ── 3. MCP 工具 ────────────────────────────────────────────────────────────
{
	console.log('\n=== 3) 调用玩具 MCP 的工具（证明 MCP 能挂）')
	await using harness = newHarness()
	const result = await harness.run(
		'请调用 mcp__toy__toy_echo 工具，参数 text 传 "hello-mcp"。调用完成后只回复工具返回的字符串。',
	)
	console.log('   final:', result.finalResponse)
	console.log('   tool calls:', toolCalls(result).join(', '))
	report.stages.push({
		stage: 'mcp-tool',
		ok: toolCalls(result).includes('mcp__toy__toy_echo'),
		finalResponse: result.finalResponse,
		toolCalls: toolCalls(result),
		toolResults: toolResults(result),
	})
}

// ── 4. 闸门（审批往返） ────────────────────────────────────────────────────
for (const outcome of ['allowed-once', 'rejected']) {
	console.log(`\n=== 4) 闸门：approval/request ⇒ ${outcome}`)
	const harness = newHarness({ approvalRequests: true })
	harness.client.start()
	const approvals = []
	harness.client.onRequest(async (method, params) => {
		approvals.push({ method, params })
		return { outcome }
	})
	await using _h = harness
	const result = await harness.run('请调用 toy_echo 工具，参数 text 传 "MUTATE-task-42"。调用完成后只回复工具返回的字符串。')
	console.log('   approval requests:', approvals.length, JSON.stringify(approvals[0]?.params ?? {}))
	console.log('   final:', result.finalResponse)
	report.stages.push({
		stage: `gate-${outcome}`,
		ok: approvals.length === 1 && approvals[0].method === 'approval/request',
		approvals,
		finalResponse: result.finalResponse,
	})
}

// ── 5. 事件序列（SSE 映射依据） ───────────────────────────────────────────
{
	console.log('\n=== 5) 会话事件序列（= 我们 SSE 契约的映射依据）')
	await using harness = newHarness()
	const result = await harness.run('说一句"开始"，然后调用 toy_echo（text 参数 "MUTATE-x"），然后补一句"结束"。')
	const stream = result.events.find((event) => (event.type ?? event.kind) === 'assistant/message')?.data?.stream
	console.log('   events:', eventTypes(result).join(' → '))
	console.log('   stream chunks:', JSON.stringify(stream)?.slice(0, 400))
	report.stages.push({
		stage: 'events',
		// 断言结构（模型是否真的调工具是随机的 ⇒ 不拿它当验收条件）
		ok:
			eventTypes(result).includes('assistant/message') &&
			eventTypes(result).includes('step/end') &&
			eventTypes(result).includes('turn/end'),
		eventTypes: eventTypes(result),
		streamSample: stream,
	})
}

writeFileSync(logPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`\n日志：${logPath}`)
const failed = report.stages.filter((stage) => !stage.ok)
console.log(failed.length === 0 ? '✅ 全部阶段通过' : `❌ 失败阶段：${failed.map((s) => s.stage).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
