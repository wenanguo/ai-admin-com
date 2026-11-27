/**
 * profile 引导 —— **把独立项目的 profile 准备好**（dsh 的 profile = 一个独立的 pnpm 工程）。
 *
 * ## dsh 的 profile 是什么
 *
 * dsh 的运行时是**插件拼出来的** ⇒ 一个 profile = 一个**独立的 pnpm 工程**
 * （`$DSH_HOME/profiles/<name>/package.json` + 一份配置）。
 * ⇒ 插件要能被 profile 解析到 ⇒ **必须装进那个工程**（否则**静默不加载**）。
 *
 * ## 本项目做三件事
 *
 * ① **建 profile**（`package.json` + `pnpm-workspace.yaml`）；
 * ② **写自己的 profile 补丁**（`cordis.patch.yml`）：
 *    - 插**本仓的插件**（**外部插件** ⇒ 按 `file:` 引用，不复制源码）；
 *    - 声明**模型路由**（MiniMax ⇒ **只写环境变量名** ⇒ 密钥不落盘）；
 *    - 指定 `agent-default-model`（headless 跑任务时用哪条路由）；
 * ③ **装插件**（`pnpm add file:<源码目录>`）—— **按内容指纹判重**（改了插件就重装）。
 *
 * ## ⚠️ 凭据**只写变量名**
 *
 * 补丁里只有 `apiKeyEnv: "MINIMAX_CN_API_KEY"` ⇒ **没有密钥** ⇒ 密钥只在
 * dsh 子进程的**环境变量**里（进程内存）⇒ **不落盘**。
 *
 * ## ⚠️ 插件**不挂成 bundle**
 *
 * bundle 里的插件在 **root 作用域** ⇒ 看不见 agent 作用域里的服务（工具表 / 审批缝）
 * ⇒ 工具会变成「unknown tool」⇒ 走**补丁层**（`cordis.patch.yml`）。
 * （与 `backend/ai/src/core/adapter/dsh/profile.ts` 同一口径。）
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 本仓插件的包名（**装进 profile 的那个名字**）。 */
export const DSH_PLUGIN_PACKAGE = '@ai-admin/dsh-plugin'

/** 插件状态的**文件名**（放在 profile 目录里 ⇒ 跟着 profile 一起持久化）。 */
export const PLUGIN_STATE_FILE = '.ai-admin-plugin.json'

/** profile 里要用的 bundle（**dsh 自带** ⇒ 从 dsh 安装里解析）。 */
export const PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']

/** 算指纹时**不看**的目录（依赖 / 版本库 ⇒ 与「插件源码变没变」无关）。 */
const FINGERPRINT_IGNORED_DIRS = new Set(['node_modules', '.git', '.pnpm-store', '.turbo', '.cache'])

/**
 * profile 的目录。
 *
 * @param {object} config 配置。
 * @returns {string} 目录路径。
 */
export function profileDirOf(config) {
	return join(config.home, 'profiles', config.profile)
}

/**
 * 保证 profile 存在、补丁是最新的、插件装好了（**幂等**）。
 *
 * @param {object} config 配置。
 * @returns {{profileDir: string, pluginInstalled: boolean, pluginFingerprint: string}} 结果。
 */
export function ensureProfile(config) {
	const profileDir = profileDirOf(config)
	mkdirSync(profileDir, { recursive: true })

	// ① profile 的清单（**手写** ⇒ 不用 dsh 的插件管理器绕一圈）。
	writeProfileManifest(profileDir, config.profile)

	// ⚠️ **pnpm 的供应链策略要放开**（`minimumReleaseAge: 0`）
	//    ⇒ dsh 的包是 rc（刚发布不到一天）⇒ pnpm 11 默认会拦。
	writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 0\n', 'utf8')

	// ② **补丁层每次都重写**（模型路由变了也要跟上 ⇒ 不留旧值）。
	writeFileSync(join(profileDir, 'cordis.patch.yml'), profilePatch(config), 'utf8')

	// ③ 插件（**外部插件** ⇒ 按 `file:` 引用 ⇒ pnpm 把它**拷贝**进 profile）。
	const pluginInstalled = config.pluginEnabled
		? installPlugin(profileDir, config.pluginPath)
		: false
	return {
		profileDir,
		pluginInstalled,
		pluginFingerprint: config.pluginEnabled ? pluginFingerprint(config.pluginPath) : '',
	}
}

/**
 * 写 profile 的清单（**手写** ⇒ 不用 dsh 的插件管理器绕一圈）。
 *
 * ⚠️ bundle 从 **dsh 安装**里解析 ⇒ profile 自己的 `node_modules` 不必装 bundle。
 *
 * @param {string} profileDir profile 目录。
 * @param {string} profileName profile 名。
 */
function writeProfileManifest(profileDir, profileName) {
	const file = join(profileDir, 'package.json')
	if (existsSync(file)) {
		return
	}
	const manifest = {
		name: `dsh-profile-${profileName}`,
		private: true,
		dependencies: {},
		dsh: { profile: { bundles: [...PROFILE_BUNDLES] } },
	}
	writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/**
 * profile 的补丁层（**我们自己的**）：插插件 + **声明模型路由**。
 *
 * ⚠️ **provider 归位给 dsh 自带的适配器**（issue #168 · D5=B）：
 *    路由写在 `llm-pi-ai` 那一段的 `providers` 里 ⇒ dsh 自带的
 *    `@deepseek-ai/dsh-llm-pi-ai` 认它 ⇒ **我们不自研 provider**。
 * ⚠️ **凭据只写环境变量名**（`apiKeyEnv`）⇒ **密钥不落盘**（只在子进程的环境变量里）。
 *
 * @param {object} config 配置。
 * @returns {string} YAML 文本。
 */
export function profilePatch(config) {
	const lines = []
	if (config.pluginEnabled) {
		lines.push(
			'- insert:',
			'    - id: ai-admin',
			`      name: '${DSH_PLUGIN_PACKAGE}'`,
		)
	}
	lines.push(
		// ⚠️ **技能目录只认配置里列的那几个** ⇒ 不扫 dsh 的默认根
		//    （默认根会把「仓库自己的开发技能」与「开发者私人技能」混进业务会话）。
		'- id: skill-filesystem',
		"  name: '@deepseek-ai/dsh-skill-filesystem'",
		'  config:',
		'    includeDefaultRoots: false',
		'    customSkillDirs: !!js "process.env.AI_DSH_SKILL_DIRS ? JSON.parse(Buffer.from(process.env.AI_DSH_SKILL_DIRS, \'base64\').toString(\'utf8\')) : []"',
		'- id: llm-pi-ai',
		'  config:',
		'    providers:',
		`      ${yamlScalar(config.provider)}:`,
		`        displayName: ${yamlScalar(config.provider)}`,
		'        api: openai-completions',
		`        baseURL: ${yamlScalar(config.baseURL)}`,
		`        apiKeyEnv: ${yamlScalar(config.apiKeyEnv)}`,
		'        models:',
		`          - id: ${yamlScalar(config.model)}`,
		`            contextWindow: ${config.contextWindow}`,
		`            maxTokens: ${config.maxTokens}`,
		// ⚠️ **不声明思考档位** ⇒ 与旧的自研适配器一致：**不发**思考参数
		//    （思考预算会**挤占** `max_tokens` ⇒ 答案被截断的风险）。
		'            reasoningEfforts: false',
		'- id: agent-default-model',
		'  config:',
		`    provider: ${yamlScalar(config.provider)}`,
		`    model: ${yamlScalar(config.model)}`,
		'',
	)
	return lines.join('\n')
}

/**
 * 把插件装进 profile（`pnpm add file:<路径>`）。
 *
 * ⚠️ **判据 = 内容指纹**（issue #158 的坑）：`pnpm add file:` 是把插件**拷贝**进 profile 的
 *    ⇒ 路径永远不变 ⇒ **拷贝永远不刷新** ⇒ 改了插件等于没改
 *    ⇒ 按**内容**判：指纹变了就重装；没变就**跳过**（pnpm 装东西要联网、要时间）。
 *
 * ⚠️ **要 pnpm**（dsh 生态自己的包管理器）⇒ 没有就报错并说清怎么办
 *    （**不静默降级** —— 少了插件 ⇒ 工具与提示词都不在）。
 *
 * @param {string} profileDir profile 目录。
 * @param {string} pluginPath 插件的**源码目录**。
 * @returns {boolean} 插件是不是装好了。
 */
export function installPlugin(profileDir, pluginPath) {
	if (!existsSync(pluginPath)) {
		throw new Error(
			`找不到插件的源码目录：${pluginPath}\n` +
				'（这个项目把本仓的插件当「外部插件」装 ⇒ 插件源码仍然在 backend/ai/dsh-plugin）',
		)
	}
	const wanted = `file:${pluginPath.replace(/\\/g, '/')}`
	const fingerprint = pluginFingerprint(pluginPath)
	const state = readPluginState(profileDir)
	const installedCopy = join(profileDir, 'node_modules', ...DSH_PLUGIN_PACKAGE.split('/'))
	const manifestPath = join(profileDir, 'package.json')
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
	const upToDate =
		state !== undefined &&
		state.fingerprint === fingerprint &&
		state.spec === wanted &&
		manifest.dependencies?.[DSH_PLUGIN_PACKAGE] !== undefined &&
		existsSync(installedCopy)
	if (upToDate) {
		return true
	}
	// ⚠️ Windows 上 `.cmd` 只能经 shell 起（Node 的安全限制）⇒ 用一条命令串 + 引号。
	const added = spawnSync(`pnpm add "${DSH_PLUGIN_PACKAGE}@${wanted}"`, {
		cwd: profileDir,
		encoding: 'utf8',
		shell: true,
	})
	if (added.status !== 0) {
		throw new Error(
			`把 ${DSH_PLUGIN_PACKAGE} 装进 dsh profile 失败（需要 pnpm）：${
				added.stderr || added.stdout || '（没有输出）'
			}`,
		)
	}
	writePluginState(profileDir, { fingerprint, spec: wanted, installedAt: new Date().toISOString() })
	return true
}

/**
 * 插件的**内容指纹**（sha256，十六进制）。
 *
 * ⚠️ **与服务侧算出同一个值**（`backend/ai/src/core/adapter/dsh/profile.ts` 的同名函数）
 *    ⇒ 两边的算法不许漂（漂了 ⇒ 一边重装一边不重装 ⇒ 「改了插件没生效」）。
 *
 * @param {string} pluginPath 插件目录。
 * @returns {string} 指纹（十六进制）。
 */
export function pluginFingerprint(pluginPath) {
	if (!existsSync(pluginPath)) {
		throw new Error(`找不到插件目录：${pluginPath}`);
	}
	const hash = createHash('sha256')
	for (const file of pluginFiles(pluginPath)) {
		hash.update(file.relativePath)
		hash.update('\n')
		hash.update(createHash('sha256').update(readFileSync(file.absolutePath)).digest('hex'))
		hash.update('\n')
	}
	return hash.digest('hex')
}

/**
 * 插件目录里的文件（**按相对路径排序** ⇒ 指纹与遍历顺序无关）。
 *
 * @param {string} pluginPath 插件目录。
 * @returns {{relativePath: string, absolutePath: string}[]} 文件清单。
 */
function pluginFiles(pluginPath) {
	const out = []
	const walk = (dir) => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		)
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (FINGERPRINT_IGNORED_DIRS.has(entry.name)) {
					continue
				}
				walk(join(dir, entry.name))
				continue
			}
			if (!entry.isFile()) {
				continue
			}
			const absolutePath = join(dir, entry.name)
			out.push({
				relativePath: relative(pluginPath, absolutePath).split(sep).join('/'),
				absolutePath,
			})
		}
	}
	walk(pluginPath)
	out.sort((a, b) =>
		a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
	)
	return out
}

/**
 * 读插件的安装状态（**没有 / 坏了 ⇒ undefined** ⇒ 视为「要重装」）。
 *
 * @param {string} profileDir profile 目录。
 * @returns {{fingerprint: string, spec: string, installedAt: string}|undefined} 状态。
 */
export function readPluginState(profileDir) {
	const file = join(profileDir, PLUGIN_STATE_FILE)
	if (!existsSync(file)) {
		return undefined
	}
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8'))
		if (typeof parsed?.fingerprint !== 'string' || typeof parsed?.spec !== 'string') {
			return undefined
		}
		return {
			fingerprint: parsed.fingerprint,
			spec: parsed.spec,
			installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : '',
		}
	} catch {
		return undefined
	}
}

/**
 * 写插件的安装状态（**装完才写** ⇒ 写坏了就当没装过 ⇒ 下次重装）。
 *
 * @param {string} profileDir profile 目录。
 * @param {{fingerprint: string, spec: string, installedAt: string}} state 状态。
 */
export function writePluginState(profileDir, state) {
	writeFileSync(
		join(profileDir, PLUGIN_STATE_FILE),
		`${JSON.stringify(state, null, 2)}\n`,
		'utf8',
	)
}

/**
 * YAML 的**双引号标量**（⇒ 值里的 `:` / `#` / 引号都不会被当成语法）。
 *
 * @param {string} value 字符串。
 * @returns {string} YAML 标量。
 */
export function yamlScalar(value) {
	return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
