/**
 * 运行时 —— **起 dsh 子进程**（独立项目的「执行层」）。
 *
 * ## 为什么是子进程
 *
 * dsh 的运行时是**插件拼出来的** ⇒ 它自己就是一个进程 ⇒ 我们用**命令行**起它
 * （`dsh --profile <name> "<任务>"` ⇒ headless 模式：答一个任务、打印结果、退出）。
 * ⇒ 类型零外泄、故障隔离、升级只换子进程。
 *
 * ## 凭据**只走子进程的环境变量**
 *
 * ⚠️ **不落盘**（密钥只在进程内存里）⇒ 补丁里只有**变量名**（`apiKeyEnv`）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './config.mjs'

/**
 * 找 dsh 的可执行文件（**JS 入口** ⇒ 用 node 起）。
 *
 * ⚠️ **只认本项目自己装的那份**（`dsh/node_modules`）⇒ 不猜 PATH
 *    （免得起错版本 ⇒ 症状是「模型不听话」）。
 *
 * @returns {string} dsh 的 JS 入口路径。
 */
export function resolveDshBin() {
	const file = join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
	if (!existsSync(file)) {
		throw new Error(
			`找不到 dsh 运行时：${file}\n` +
				'⇒ 先装依赖：cd dsh && npm ci（见 dsh/README.md）',
		)
	}
	return file
}

/**
 * 子进程的环境变量（**凭据只走这里** ⇒ 不落盘）。
 *
 * ⚠️ `DSH_HOME` 是 **dsh 自己认的名字** ⇒ 它只出现在**进程环境**里
 *    （dsh 禁的是 `.env` **文件**里的 `DSH_*`，不是进程环境）。
 *
 * @param {object} config 配置。
 * @param {object} input 输入。
 * @param {string} input.apiKey 模型 key（**只在内存里**）。
 * @param {NodeJS.ProcessEnv} [env] 环境变量来源。
 * @returns {NodeJS.ProcessEnv} 子进程环境变量。
 */
export function buildChildEnv(config, input, env = process.env) {
	return {
		...env,
		// ⚠️ dsh 的 home（**进程环境**里 ⇒ 合法）。
		DSH_HOME: config.home,
		// ⚠️ **key 落在「它自己的名字」那个变量里** ⇒ dsh 自带的适配器
		//    按补丁里的 `apiKeyEnv` 去环境变量里取 ⇒ 密钥仍然只在内存里。
		[config.apiKeyEnv]: input.apiKey,
		// ⚠️ **技能目录**（base64 的 JSON 数组）⇒ 只认配置里列的那几个。
		AI_DSH_SKILL_DIRS: Buffer.from(JSON.stringify(config.skillDirs), 'utf8').toString('base64'),
	}
}

/**
 * 系统提示词（**可选** ⇒ 从文件读 ⇒ 交给插件 ⇒ 进模型上下文）。
 *
 * ⚠️ 多行文本 ⇒ **base64**（免得换行/编码出问题）。
 *
 * @param {object} config 配置。
 * @returns {string} base64 文本（没有 ⇒ 空串）。
 */
export function systemPromptOf(config) {
	if (config.systemPromptFile.length === 0) {
		return ''
	}
	const file = config.systemPromptFile
	if (!existsSync(file)) {
		throw new Error(`找不到系统提示词文件：${file}`)
	}
	// ⚠️ 多行文本 ⇒ **base64**（免得换行/编码出问题）。
	const text = readFileSync(file, 'utf8')
	return Buffer.from(text, 'utf8').toString('base64')
}
