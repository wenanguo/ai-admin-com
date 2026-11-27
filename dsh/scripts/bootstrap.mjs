#!/usr/bin/env node
/**
 * 引导独立项目的 dsh profile —— **建 profile + 装外部插件 + 写模型路由**。
 *
 * ## 跑法
 *
 * ```bash
 * cd dsh
 * npm run bootstrap
 * ```
 *
 * ## 它做什么
 *
 * ① 建 profile（`$STANDALONE_HOME/profiles/<profile>` ⇒ 一个独立的 pnpm 工程）；
 * ② 写自己的补丁（插插件 + MiniMax 路由 + 默认模型）；
 * ③ **按 `file:` 引用装本仓的插件**（**外部插件** ⇒ 不复制源码）。
 *
 * ⚠️ **凭据不落盘**：补丁里只有**变量名**（`apiKeyEnv`）⇒ 密钥只在跑起来时的进程环境里。
 * ⚠️ **幂等**：插件**内容指纹**没变 ⇒ 跳过重装（装插件要联网、要时间）。
 */

import { loadConfig, loadEnvFile, projectRoot } from './lib/config.mjs'
import { ensureProfile } from './lib/profile.mjs'

const hasEnvFile = loadEnvFile()
const config = loadConfig()

console.log('引导独立项目的 dsh profile…')
console.log(`  项目目录：${projectRoot}`)
console.log(`  dsh home：${config.home}`)
console.log(`  profile ：${config.profile}`)
console.log(`  路由    ：${config.provider} / ${config.model} / ${config.baseURL}`)
console.log(`  key 变量：${config.apiKeyEnv}（**只写变量名** ⇒ 密钥不落盘）`)
if (hasEnvFile) {
	console.log('  .env    ：已读（凭据只在你机器上）')
}

const result = ensureProfile(config)

console.log(`✅ profile 好了：${result.profileDir}`)
console.log(
	result.pluginInstalled
		? `✅ 外部插件装好了（${'@ai-admin/dsh-plugin'} · 指纹 ${result.pluginFingerprint.slice(0, 12)}）`
		: 'ℹ️ 没装插件（STANDALONE_PLUGIN=off）⇒ 纯 dsh，不带 AiAdmin 的命令与提示词',
)
console.log('\n下一步：npm run doctor   # 自检（还差什么会列出来）')
console.log('        npm run chat -- "用一句话回答：1+1 等于几？"')
