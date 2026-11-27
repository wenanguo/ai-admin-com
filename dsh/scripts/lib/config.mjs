/**
 * 独立项目的配置 —— **全部走环境变量**（凭据不落盘）。
 *
 * ## 为什么配置也走环境变量
 *
 * 这个项目要能被**没参与开发的人**装起来 ⇒ 配置只有一个出处：**环境变量**。
 * ⇒ 仓库里只有 `.env.example`（模板，**没有真值**）⇒ 真值只在那个人自己的机器上。
 *
 * ## ⚠️ 变量名**不许**以 `DSH_` 开头
 *
 * dsh 的 app-boot 里 `BOOTSTRAP_PREFIXES = ['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']`
 * ⇒ **任何 `.env` 文件里写 `DSH_*`，dsh 都拒绝启动**：
 * `dsh: …/.env sets "DSH_BASE_URL", which only the launching environment may set`。
 * ⇒ 本项目的用户可配变量一律叫 `STANDALONE_*`（见 `docs/notes/2026-11-20-dsh-凭据配置.md`）。
 *
 * ## 变量表
 *
 * | 变量 | 缺省 | 干什么 |
 * | ---- | ---- | ------ |
 * | `STANDALONE_HOME` | `<项目>/.dsh-home` | dsh 的 home（profile / 日志 / 会话） |
 * | `STANDALONE_PROFILE` | `standalone` | dsh 的具名 profile |
 * | `STANDALONE_PROVIDER` | `minimax` | 模型路由名（= dsh 的 provider 名） |
 * | `STANDALONE_MODEL` | `MiniMax-M3` | 模型 id |
 * | `STANDALONE_BASE_URL` | `https://api.minimaxi.com/v1` | OpenAI 兼容的根地址 |
 * | `STANDALONE_API_KEY_ENV` | `MINIMAX_CN_API_KEY` | **key 放在哪个环境变量里**（只写名字 ⇒ 密钥不落盘） |
 * | `STANDALONE_PLUGIN` | `on` | 要不要装本仓的插件（`off` = 纯 dsh，不带 AiAdmin） |
 * | `STANDALONE_PLUGIN_PATH` | `<仓根>/backend/ai/dsh-plugin` | 外部插件的**源码目录**（按 `file:` 引用，不复制） |
 * | `STANDALONE_SKILL_DIRS` | 空 | 技能目录（JSON 数组或逗号分隔）⇒ 只认这些目录 |
 * | `STANDALONE_SYSTEM_PROMPT_FILE` | 空 | 系统提示词文件（⇒ 交给插件 ⇒ 进模型上下文） |
 * | `STANDALONE_CONTEXT_WINDOW` | `262144` | 上下文窗口（token） |
 * | `STANDALONE_MAX_TOKENS` | `32768` | 单次输出上限（token） |
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 独立项目自己的根目录（`dsh/`）。 */
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 仓根目录（`dsh/` 的上一级）⇒ 用来定位「外部插件」的源码。 */
export const repoRoot = resolve(projectRoot, '..')

/**
 * 加载项目根目录下的 `.env`（**有就读，没有就算了**）。
 *
 * ⚠️ **不覆盖**已存在的环境变量（`process.loadEnvFile` 的行为）
 * ⇒ CI / 临时覆盖（`MINIMAX_CN_API_KEY=xxx node …`）仍然优先。
 *
 * @param {NodeJS.ProcessEnv} [env] 环境变量（只用来判断「有没有 .env」）。
 * @returns {boolean} 有没有读到 `.env`。
 */
export function loadEnvFile(env = process.env) {
	void env
	const file = join(projectRoot, '.env')
	if (!existsSync(file)) {
		return false
	}
	try {
		process.loadEnvFile(file)
	} catch {
		return false
	}
	return true
}

/**
 * 读配置（**全部走环境变量** ⇒ 凭据不落盘）。
 *
 * @param {NodeJS.ProcessEnv} [env] 环境变量来源。
 * @returns {object} 配置。
 */
export function loadConfig(env = process.env) {
	return {
		/** dsh 的 home。 */
		home: env.STANDALONE_HOME ?? join(projectRoot, '.dsh-home'),
		/** dsh 的具名 profile。 */
		profile: env.STANDALONE_PROFILE ?? 'standalone',
		/** 模型路由名（= dsh 的 provider 名）。 */
		provider: env.STANDALONE_PROVIDER ?? 'minimax',
		/** 模型 id。 */
		model: env.STANDALONE_MODEL ?? 'MiniMax-M3',
		/** OpenAI 兼容的根地址（到 `/v1` 为止）。 */
		baseURL: env.STANDALONE_BASE_URL ?? 'https://api.minimaxi.com/v1',
		/** key 放在哪个环境变量里（**只写名字** ⇒ 密钥不落盘）。 */
		apiKeyEnv: env.STANDALONE_API_KEY_ENV ?? 'MINIMAX_CN_API_KEY',
		/** 要不要装本仓的插件。 */
		pluginEnabled: (env.STANDALONE_PLUGIN ?? 'on').toLowerCase() !== 'off',
		/** 外部插件的**源码目录**（按 `file:` 引用 ⇒ 不复制源码）。 */
		pluginPath: env.STANDALONE_PLUGIN_PATH ?? join(repoRoot, 'backend', 'ai', 'dsh-plugin'),
		/** 技能目录（**绝对路径**）。 */
		skillDirs: skillDirsOf(env),
		/** 系统提示词文件（**可选**）。 */
		systemPromptFile: env.STANDALONE_SYSTEM_PROMPT_FILE ?? '',
		/** 上下文窗口（token）。 */
		contextWindow: numberEnv(env, 'STANDALONE_CONTEXT_WINDOW', 262144),
		/** 单次输出上限（token）。 */
		maxTokens: numberEnv(env, 'STANDALONE_MAX_TOKENS', 32768),
	}
}

/**
 * 技能目录（**绝对路径**）。
 *
 * ⚠️ 支持两种写法：JSON 数组（`["a","b"]`）或逗号分隔（`a,b`）。
 *
 * @param {NodeJS.ProcessEnv} env 环境变量。
 * @returns {string[]} 目录列表。
 */
export function skillDirsOf(env) {
	const raw = (env.STANDALONE_SKILL_DIRS ?? '').trim()
	if (raw.length === 0) {
		return []
	}
	if (raw.startsWith('[')) {
		try {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				return parsed.filter((item) => typeof item === 'string')
			}
		} catch {
			return []
		}
	}
	return raw
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
}

/**
 * 环境变量里的正整数（**读不懂就用缺省** ⇒ 不因为配置写错而崩）。
 *
 * @param {NodeJS.ProcessEnv} env 环境变量。
 * @param {string} name 变量名。
 * @param {number} fallback 缺省值。
 * @returns {number} 数值。
 */
export function numberEnv(env, name, fallback) {
	const raw = env[name]
	if (raw === undefined) {
		return fallback
	}
	const value = Number.parseInt(raw, 10)
	return Number.isFinite(value) && value > 0 ? value : fallback
}
