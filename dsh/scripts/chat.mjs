#!/usr/bin/env node
/**
 * 跑一轮对话 —— **真起 dsh**（headless 模式：答一个任务、打印结果、退出）。
 *
 * ## 跑法
 *
 * ```bash
 * cd dsh
 * npm run chat -- "用一句话回答：1+1 等于几？"
 * ```
 *
 * ## ⚠️ 凭据**只走环境变量**
 *
 * key 在 `STANDALONE_API_KEY_ENV` 指的那个变量里（缺省 `MINIMAX_CN_API_KEY`）
 * ⇒ 可以来自 `.env`（那个文件已被 gitignore）⇒ **仓库里搜不到密钥**。
 * ⇒ 密钥**只进子进程的环境变量**（进程内存）⇒ **不落盘**。
 */

import { spawn } from 'node:child_process'
import { loadConfig, loadEnvFile, projectRoot } from './lib/config.mjs'
import { ensureProfile } from './lib/profile.mjs'
import { buildChildEnv, resolveDshBin, systemPromptOf } from './lib/runtime.mjs'

const prompt = process.argv.slice(2).join(' ').trim()
if (prompt.length === 0) {
	console.error('用法：npm run chat -- "你的问题"')
	process.exit(1)
}

loadEnvFile()
const config = loadConfig()
const apiKey = process.env[config.apiKeyEnv]
if (apiKey === undefined || apiKey.length === 0) {
	console.error(
		`没有模型凭据：环境变量 ${config.apiKeyEnv} 是空的。\n` +
			'⇒ 两种配法（**都只走环境变量**）：\n' +
			`   1) 在 dsh/.env 里写一行 ${config.apiKeyEnv}=你的key（那个文件已被 gitignore）\n` +
			`   2) 临时导出：export ${config.apiKeyEnv}=你的key\n` +
			'（MiniMax 的 key 在 https://platform.minimaxi.com 控制台拿）',
	)
	process.exit(1)
}

// ⚠️ **profile 先准备好**（插件要装进去 ⇒ 工具与提示词才在）。
ensureProfile(config)

const dshBin = resolveDshBin()
const env = buildChildEnv(config, { apiKey })
const promptB64 = systemPromptOf(config)
if (promptB64.length > 0) {
	env.AI_DSH_SYSTEM_PROMPT = promptB64
}

console.log(`[dsh] 起 dsh（profile=${config.profile} · 路由=${config.provider}/${config.model}）…`)
const child = spawn(process.execPath, [dshBin, '--profile', config.profile, prompt], {
	cwd: projectRoot,
	stdio: 'inherit',
	env,
})
child.on('error', (error) => {
	console.error(`❌ 起不来 dsh：${error.message}`)
	process.exit(1)
})
child.on('exit', (code, signal) => {
	if (signal !== null) {
		console.error(`❌ dsh 被 ${signal} 掉了`)
		process.exit(1)
	}
	process.exit(code ?? 1)
})
