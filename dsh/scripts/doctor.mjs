#!/usr/bin/env node
/**
 * 自检 —— **还差什么，一行列出来**。
 *
 * ## 跑法
 *
 * ```bash
 * cd dsh
 * npm run doctor
 * ```
 *
 * ## 为什么要有它
 *
 * 这个项目是给**没参与开发的人**用的 ⇒ 「装不起来」是最常见的场景
 * ⇒ 把前置条件一项项查清楚，比让人去翻日志快得多。
 *
 * ⚠️ **不打印任何凭据**（只说「有没有」）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, loadEnvFile, projectRoot } from './lib/config.mjs'
import { DSH_PLUGIN_PACKAGE, profileDirOf, readPluginState } from './lib/profile.mjs'

loadEnvFile()
const config = loadConfig()

/** 检查项（`ok` 决定退出码）。 */
const checks = []

/**
 * 记一条检查。
 *
 * @param {string} label 检查项。
 * @param {boolean} ok 过没过。
 * @param {string} hint 没过时怎么办。
 */
function check(label, ok, hint) {
	checks.push({ label, ok, hint })
	console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ` —— ${hint}`}`)
}

/** Node 版本（dsh 的 engines 要求 ≥ 24.9）。 */
{
	const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
	const minor = Number.parseInt(process.versions.node.split('.')[1] ?? '0', 10)
	const ok = major > 24 || (major === 24 && minor >= 9)
	check(`Node ${process.versions.node}（dsh 要求 ≥ 24.9）`, ok, '装 Node 24.9 或更新的')
}

/** 依赖装没装。 */
{
	const dshPkg = join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
	check('依赖装好了（dsh/node_modules）', existsSync(dshPkg), 'cd dsh && npm ci')
}

/** pnpm（装插件要它 ⇒ dsh 生态自己的包管理器）。 */
{
	const probe = spawnSync('pnpm -v', { encoding: 'utf8', shell: true })
	const ok = probe.status === 0
	check(`pnpm 可用（${ok ? probe.stdout.trim() : '没找到'}）`, ok, 'npm install -g pnpm@11.22.0')
}

/** 模型凭据（**只说有没有** ⇒ 不打印）。 */
{
	const key = process.env[config.apiKeyEnv]
	check(`模型凭据 ${config.apiKeyEnv}`, key !== undefined && key.length > 0, '在 dsh/.env 里写一行，或 export 出来')
}

/** profile 好了没。 */
{
	const profileDir = profileDirOf(config)
	const manifest = join(profileDir, 'package.json')
	const ok = existsSync(manifest)
	check(`profile 好了（${config.profile}）`, ok, 'npm run bootstrap')
	if (ok) {
		const patch = join(profileDir, 'cordis.patch.yml')
		check('profile 的补丁在（插件 + 模型路由）', existsSync(patch), 'npm run bootstrap')
	}
}

/** 插件装没装（**外部插件** ⇒ 按 file: 引用）。 */
if (config.pluginEnabled) {
	const profileDir = profileDirOf(config)
	const state = readPluginState(profileDir)
	const copy = join(profileDir, 'node_modules', ...DSH_PLUGIN_PACKAGE.split('/'))
	check(
		`外部插件装好了（${DSH_PLUGIN_PACKAGE}）`,
		state !== undefined && existsSync(copy),
		'npm run bootstrap（要 pnpm + 联网）',
	)
}

const failed = checks.filter((item) => !item.ok)
console.log(
	failed.length === 0
		? '\n✅ 都齐了 ⇒ 可以跑：npm run chat -- "用一句话回答：1+1 等于几？"'
		: `\n⚠️ 还差 ${failed.length} 项 ⇒ 按上面的提示补齐再跑。`,
)
process.exit(failed.length === 0 ? 0 : 1)
