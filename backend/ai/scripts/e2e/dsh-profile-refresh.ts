/**
 * 端到端验收（issue #158）：**profile 里那份插件拷贝会跟着插件变**。
 *
 * ## 它证明什么
 *
 * 1. **插件改了 ⇒ profile 里的拷贝跟着改**（这正是旧实现漏掉的那一半）：
 *    旧判据是「**依赖已经是这个路径 ⇒ 直接跳过**」⇒ `pnpm add file:` 拷进去的
 *    永远是旧拷贝 ⇒ 我们把 `DSH_AI_*` 改名成 `AI_DSH_*` ⇒ 旧拷贝读不到新变量名
 *    ⇒ dsh 报 `NO_ADAPTER: no adapter registered for provider "minimax"` ⇒ 派活瘫；
 * 2. **内容没变 ⇒ 不重装**（pnpm 装东西要联网、要时间 ⇒ 别每次都装）。
 *
 * ## 怎么跑
 *
 * ```bash
 * node scripts/e2e/dsh-profile-refresh.cjs
 * ```
 *
 * ⚠️ **不需要模型凭据、不连数据库**；**第一段用「假 pnpm」⇒ 不联网**；
 *    **第二段用真 pnpm**（机器上有才跑 ⇒ 证明「pnpm 会把 `file:` 目录重新打包」）。
 */

import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { ensureDshProfile } from "../../src/core/adapter/dsh/profile.ts";

/** 假 pnpm 的源码（**模仿 pnpm 的 `file:` 拷贝** ⇒ 不联网、不装真依赖）。 */
const FAKE_PNPM = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const arg = args.find((a) => a.includes('@file:')) || '';
const at = arg.indexOf('@file:');
const spec = at >= 0 ? arg.slice(at + 1) : '';
const source = spec.startsWith('file:') ? spec.slice('file:'.length) : '';
const target = path.join(process.cwd(), 'node_modules', '@ai-admin', 'dsh-plugin');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
if (source) {
  fs.cpSync(source, target, { recursive: true });
}
const manifestPath = path.join(process.cwd(), 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.dependencies = manifest.dependencies || {};
manifest.dependencies['@ai-admin/dsh-plugin'] = spec;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n');
if (process.env.FAKE_PNPM_LOG) {
  fs.appendFileSync(process.env.FAKE_PNPM_LOG, spec + '\\n');
}
`;

/** 装「假 pnpm」并把它放到 PATH 前面。 */
function installFakePnpm(binDir: string): void {
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, "fake-pnpm.cjs"), FAKE_PNPM);
	if (process.platform === "win32") {
		writeFileSync(
			join(binDir, "pnpm.cmd"),
			'@echo off\r\nnode "%~dp0fake-pnpm.cjs" %*\r\n',
		);
		return;
	}
	const shim = join(binDir, "pnpm");
	writeFileSync(shim, '#!/bin/sh\nexec node "$(dirname "$0")/fake-pnpm.cjs" "$@"\n');
	chmodSync(shim, 0o755);
}

/** 造一个「插件目录」（**内容可控** ⇒ 改内容就是改插件）。 */
function makePlugin(dir: string, content: string): string {
	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		`${JSON.stringify({
			name: "@ai-admin/dsh-plugin",
			version: "0.0.0",
			private: true,
			type: "module",
			main: "src/index.js",
		})}\n`,
	);
	writeFileSync(join(dir, "src", "index.js"), content);
	return dir;
}

/** 造一个「profile 已经存在」的 dsh home（**不跑 dsh** ⇒ 不依赖运行时）。 */
function makeDshHome(root: string, profile = "e2e"): string {
	const dshHome = join(root, "dsh-home");
	const profileDir = join(dshHome, "profiles", profile);
	mkdirSync(profileDir, { recursive: true });
	writeFileSync(
		join(profileDir, "package.json"),
		`${JSON.stringify({ name: `dsh-profile-${profile}`, private: true }, null, 2)}\n`,
	);
	return dshHome;
}

/** profile 里那份拷贝。 */
function copiedFile(dshHome: string, profile = "e2e"): string {
	return join(
		dshHome,
		"profiles",
		profile,
		"node_modules",
		"@ai-admin",
		"dsh-plugin",
		"src",
		"index.js",
	);
}

/** 假 pnpm 被叫了几次。 */
function pnpmCalls(log: string): number {
	if (!existsSync(log)) {
		return 0;
	}
	return readFileSync(log, "utf8").split("\n").filter((line) => line.length > 0).length;
}

/** 断言（**失败就抛** ⇒ 退出码非 0）。 */
function check(ok: boolean, message: string): void {
	if (!ok) {
		throw new Error(`❌ ${message}`);
	}
	console.log(`✅ ${message}`);
}

/**
 * 第一段：**假 pnpm**（不联网）⇒ 盯住「改没改」这件事本身。
 *
 * @param work 临时目录。
 */
async function withFakePnpm(work: string): Promise<void> {
	const binDir = join(work, "bin");
	installFakePnpm(binDir);
	const originalPath = process.env.PATH;
	const originalLog = process.env.FAKE_PNPM_LOG;
	const log = join(work, "pnpm.log");
	process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
	process.env.FAKE_PNPM_LOG = log;
	try {
		const pluginDir = makePlugin(join(work, "plugin"), "export const v = 'v1';\n");
		const dshHome = makeDshHome(work);
		const options = {
			dshHome,
			profile: "e2e",
			dshBin: "unused",
			pluginPath: pluginDir,
		};

		await ensureDshProfile(options);
		check(
			readFileSync(copiedFile(dshHome), "utf8").includes("v1"),
			"首次引导：插件装进了 profile",
		);

		// ⚠️ **改插件**（这次的真事：把 `DSH_AI_*` 改名成 `AI_DSH_*`）。
		writeFileSync(join(pluginDir, "src", "index.js"), "export const v = 'v2';\n");
		await ensureDshProfile(options);
		check(
			readFileSync(copiedFile(dshHome), "utf8").includes("v2"),
			"**插件内容改了 ⇒ profile 里的拷贝跟着变**（issue #158 的正主）",
		);

		await ensureDshProfile(options);
		await ensureDshProfile(options);
		check(
			pnpmCalls(log) === 2,
			"内容没变 ⇒ **不重装**（pnpm 装东西要联网、要时间 ⇒ 别每次都装）",
		);
	} finally {
		if (originalPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = originalPath;
		}
		if (originalLog === undefined) {
			delete process.env.FAKE_PNPM_LOG;
		} else {
			process.env.FAKE_PNPM_LOG = originalLog;
		}
	}
}

/**
 * 第二段：**真 pnpm**（机器上有才跑）⇒ 证明「pnpm 会把 `file:` 目录重新打包」。
 *
 * @param work 临时目录。
 */
async function withRealPnpm(work: string): Promise<void> {
	const pluginDir = makePlugin(join(work, "plugin-real"), "export const v = 'r1';\n");
	const dshHome = makeDshHome(join(work, "real"), "e2e-real");
	const options = {
		dshHome,
		profile: "e2e-real",
		dshBin: "unused",
		pluginPath: pluginDir,
	};
	await ensureDshProfile(options);
	check(
		readFileSync(copiedFile(dshHome, "e2e-real"), "utf8").includes("r1"),
		"真 pnpm：首次装得上",
	);
	writeFileSync(join(pluginDir, "src", "index.js"), "export const v = 'r2';\n");
	await ensureDshProfile(options);
	check(
		readFileSync(copiedFile(dshHome, "e2e-real"), "utf8").includes("r2"),
		"真 pnpm：**改了插件 ⇒ 重装 ⇒ 拷进去的是新内容**（整个修复就靠这一条）",
	);
}

/** 主流程。 */
async function main(): Promise<void> {
	const work = mkdtempSync(join(tmpdir(), "dsh-profile-e2e-"));
	try {
		await withFakePnpm(work);
		const hasPnpm =
			spawnSync("pnpm --version", { encoding: "utf8", shell: true }).status === 0;
		if (!hasPnpm) {
			console.log("⚠️ 机器上没有 pnpm ⇒ 跳过「真 pnpm」那一段（不影响上面的结论）。");
			return;
		}
		await withRealPnpm(work);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

await main();
console.log("\n✅ dsh profile 的插件拷贝会跟着插件变（issue #158）。");
