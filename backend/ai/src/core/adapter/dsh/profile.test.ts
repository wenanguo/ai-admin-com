/**
 * profile 引导 —— **插件一改就要生效**（issue #158）。
 *
 * ## 为什么要有它
 *
 * 旧代码的判据是「**依赖已经是这个路径 ⇒ 直接跳过**」⇒
 * profile 里那份 `pnpm add file:` 拷进来的**插件永远是旧的**
 * ⇒ 我们把 `DSH_AI_*` 改名成 `AI_DSH_*` ⇒ profile 里的旧拷贝读不到新变量名
 * ⇒ dsh 报 `NO_ADAPTER: no adapter registered for provider "minimax"` ⇒ 派活瘫。
 *
 * ⇒ 所以这里**盯住那漏掉的另一半**：不是「装得上」，而是
 * **「插件内容改了 ⇒ profile 里的拷贝跟着变」**。
 *
 * ## 怎么测（不联网、不装真依赖）
 *
 * ⇒ PATH 前面放一个**假 pnpm**（它模仿 pnpm 的 `file:` 拷贝行为）
 *    ⇒ 测的是**我们的判据**（指纹变了就重装），不是 pnpm 本身。
 */

import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildPiAiProviderPatch,
	ensureDshProfile,
	pluginFingerprint,
	writePiAiProviderPatch,
} from "./profile.ts";

/**
 * 固定 fixture 的指纹。
 *
 * ⚠️ **两份实现要算出同一个值**：服务侧（`profile.ts`）与派活侧
 *    （`scripts/agent/lib/dsh-dispatch.cjs`）各有一份指纹算法
 *    ⇒ 两边的测试都钉住这个值 ⇒ 算法漂了就有人看见。
 */
const FIXTURE_FINGERPRINT =
	"9eb235d32ae23284a9c39f672e2a298c616e8e4ba9409ae4a90a4fc11c0cc9ff";

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

/** 每个用例的临时目录。 */
let workDir: string;
/** 原来的 PATH（**用完要还回去** ⇒ 别影响别的用例）。 */
let originalPath: string | undefined;

/** 装「假 pnpm」并把它放到 PATH 前面（**我们的代码起的就是它**）。 */
function installFakePnpm(binDir: string): void {
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, "fake-pnpm.cjs"), FAKE_PNPM);
	if (process.platform === "win32") {
		// ⚠️ Windows 上 `.cmd` 才能被 shell 找到（PATHEXT）。
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
function makePlugin(content: string, name = "plugin"): string {
	const pluginDir = join(workDir, name);
	mkdirSync(join(pluginDir, "src"), { recursive: true });
	writeFileSync(
		join(pluginDir, "package.json"),
		`${JSON.stringify({
			name: "@ai-admin/dsh-plugin",
			version: "0.0.0",
			private: true,
			type: "module",
			main: "src/index.js",
		})}\n`,
	);
	writeFileSync(join(pluginDir, "src", "index.js"), content);
	return pluginDir;
}

/** 造一个「profile 已经存在」的 dsh home（**不跑 dsh** ⇒ 测试不依赖运行时）。 */
function makeDshHome(profile = "test"): string {
	const dshHome = join(workDir, "dsh-home");
	const profileDir = join(dshHome, "profiles", profile);
	mkdirSync(profileDir, { recursive: true });
	writeFileSync(
		join(profileDir, "package.json"),
		`${JSON.stringify({ name: `dsh-profile-${profile}`, private: true }, null, 2)}\n`,
	);
	return dshHome;
}

/** 假 pnpm 被叫了几次（**每次记一行**）。 */
function pnpmCalls(): string[] {
	const log = join(workDir, "pnpm.log");
	if (!existsSyncSafe(log)) {
		return [];
	}
	return readFileSync(log, "utf8").split("\n").filter((line) => line.length > 0);
}

/** 文件在不在（**不抛**）。 */
function existsSyncSafe(file: string): boolean {
	try {
		readFileSync(file);
		return true;
	} catch {
		return false;
	}
}

/** profile 里那份拷贝。 */
function copiedFile(dshHome: string, profile = "test"): string {
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

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), "dsh-profile-"));
	originalPath = process.env.PATH;
	installFakePnpm(join(workDir, "bin"));
	process.env.PATH = `${join(workDir, "bin")}${delimiter}${originalPath ?? ""}`;
	process.env.FAKE_PNPM_LOG = join(workDir, "pnpm.log");
});

afterEach(() => {
	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = originalPath;
	}
	delete process.env.FAKE_PNPM_LOG;
	rmSync(workDir, { recursive: true, force: true });
});

describe("dsh profile 的插件引导（issue #158）", () => {
	it("**插件内容改了 ⇒ profile 里的拷贝跟着变**（漏掉的正是这一半）", async () => {
		const pluginDir = makePlugin("export const v = 'v1';\n");
		const dshHome = makeDshHome();
		const options = {
			dshHome,
			profile: "test",
			dshBin: "unused",
			pluginPath: pluginDir,
		};

		await ensureDshProfile(options);
		expect(readFileSync(copiedFile(dshHome), "utf8")).toContain("v1");

		// ⚠️ **改插件**（这次的真事：把 `DSH_AI_*` 改名成 `AI_DSH_*`）。
		writeFileSync(join(pluginDir, "src", "index.js"), "export const v = 'v2';\n");
		await ensureDshProfile(options);

		expect(readFileSync(copiedFile(dshHome), "utf8")).toContain("v2");
		expect(pnpmCalls()).toHaveLength(2);
	});

	it("**内容没变 ⇒ 不重装**（pnpm 装东西要联网、要时间 ⇒ 别每次都装）", async () => {
		const pluginDir = makePlugin("export const v = 'v1';\n");
		const dshHome = makeDshHome();
		const options = {
			dshHome,
			profile: "test",
			dshBin: "unused",
			pluginPath: pluginDir,
		};

		await ensureDshProfile(options);
		await ensureDshProfile(options);
		await ensureDshProfile(options);

		expect(pnpmCalls()).toHaveLength(1);
	});

	it("**插件路径变了 ⇒ 重装**（换工作区 ⇒ 拷的该是另一份源码）", async () => {
		const pluginA = makePlugin("export const v = 'v1';\n", "plugin-a");
		const pluginB = makePlugin("export const v = 'v1';\n", "plugin-b");
		const dshHome = makeDshHome();

		await ensureDshProfile({
			dshHome,
			profile: "test",
			dshBin: "unused",
			pluginPath: pluginA,
		});
		await ensureDshProfile({
			dshHome,
			profile: "test",
			dshBin: "unused",
			pluginPath: pluginB,
		});

		expect(pnpmCalls()).toHaveLength(2);
	});

	it("profile 里的拷贝**被人删了** ⇒ 重新装（状态文件还在也不算数）", async () => {
		const pluginDir = makePlugin("export const v = 'v1';\n");
		const dshHome = makeDshHome();
		const options = {
			dshHome,
			profile: "test",
			dshBin: "unused",
			pluginPath: pluginDir,
		};

		await ensureDshProfile(options);
		rmSync(join(dshHome, "profiles", "test", "node_modules"), {
			recursive: true,
			force: true,
		});
		await ensureDshProfile(options);

		expect(pnpmCalls()).toHaveLength(2);
		expect(readFileSync(copiedFile(dshHome), "utf8")).toContain("v1");
	});

	it("装完留下**状态文件**（跨进程也判得出「插件变没变」）", async () => {
		const pluginDir = makePlugin("export const v = 'v1';\n");
		const dshHome = makeDshHome();
		await ensureDshProfile({
			dshHome,
			profile: "test",
			dshBin: "unused",
			pluginPath: pluginDir,
		});

		const state = JSON.parse(
			readFileSync(
				join(dshHome, "profiles", "test", ".ai-admin-plugin.json"),
				"utf8",
			),
		) as { fingerprint: string; spec: string };
		expect(state.fingerprint).toBe(pluginFingerprint(pluginDir));
		expect(state.spec).toContain("file:");
	});
});

describe("插件的内容指纹", () => {
	it("同样的内容 ⇒ 同样的哈希（**跨平台一致** ⇒ 两份实现算出同一个值）", () => {
		const dir = join(workDir, "fixture");
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "package.json"), '{"name":"@ai-admin/dsh-plugin"}');
		writeFileSync(join(dir, "src", "index.js"), "export const v = 1;\n");

		expect(pluginFingerprint(dir)).toBe(FIXTURE_FINGERPRINT);
	});

	it("内容变了 ⇒ 哈希变了（**这才是判据**）", () => {
		const dir = join(workDir, "fixture");
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "package.json"), '{"name":"@ai-admin/dsh-plugin"}');
		writeFileSync(join(dir, "src", "index.js"), "export const v = 1;\n");
		const before = pluginFingerprint(dir);

		writeFileSync(join(dir, "src", "index.js"), "export const v = 2;\n");
		expect(pluginFingerprint(dir)).not.toBe(before);
	});

	it("`node_modules` 里的东西**不算**（依赖装没装与源码无关）", () => {
		const dir = join(workDir, "fixture");
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "package.json"), '{"name":"@ai-admin/dsh-plugin"}');
		writeFileSync(join(dir, "src", "index.js"), "export const v = 1;\n");
		const before = pluginFingerprint(dir);

		mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
		writeFileSync(join(dir, "node_modules", "left-pad", "index.js"), "x");
		expect(pluginFingerprint(dir)).toBe(before);
	});

	it("插件目录不在 ⇒ **说清怎么办**（别让 ENOENT 飘出去）", () => {
		expect(() => pluginFingerprint(join(workDir, "nope"))).toThrow(
			/找不到我们的插件目录/,
		);
	});
});

describe("模型路由补丁（issue #168 · D5=B）", () => {
	it("补丁喂的是 **dsh 自带的适配器**（`llm-pi-ai` 那一段）", () => {
		const patch = buildPiAiProviderPatch({
			route: "minimax",
			baseURL: "https://api.minimaxi.com/v1",
			apiKeyEnv: "MINIMAX_CN_API_KEY",
			model: "MiniMax-M3.1-Flash",
			contextWindow: 131072,
			maxTokens: 8192,
		});
		expect(patch).toContain("- id: llm-pi-ai");
		expect(patch).toContain('"minimax":');
		expect(patch).toContain("api: openai-completions");
		expect(patch).toContain('baseURL: "https://api.minimaxi.com/v1"');
		expect(patch).toContain('apiKeyEnv: "MINIMAX_CN_API_KEY"');
		expect(patch).toContain('id: "MiniMax-M3.1-Flash"');
		expect(patch).toContain("contextWindow: 131072");
		expect(patch).toContain("maxTokens: 8192");
	});

	it("**凭据只写变量名** ⇒ 补丁里没有密钥（issue #168 的硬要求）", () => {
		const patch = buildPiAiProviderPatch({
			route: "minimax",
			baseURL: "https://api.minimaxi.com/v1",
			apiKeyEnv: "MINIMAX_CN_API_KEY",
			model: "MiniMax-M3.1-Flash",
			contextWindow: 131072,
			maxTokens: 8192,
		});
		// ⚠️ 补丁**落盘** ⇒ 里面绝不能有 key 本身。
		expect(patch).not.toMatch(/sk-[A-Za-z0-9]/);
		expect(patch).toContain("MINIMAX_CN_API_KEY");
	});

	it("写盘 ⇒ **文件名按内容定**（同样的配置写同一个文件 ⇒ 幂等）", () => {
		const dir = join(workDir, "routes");
		const route = {
			route: "minimax",
			baseURL: "https://api.minimaxi.com/v1",
			apiKeyEnv: "MINIMAX_CN_API_KEY",
			model: "MiniMax-M3.1-Flash",
			contextWindow: 131072,
			maxTokens: 8192,
		};
		const first = writePiAiProviderPatch(dir, route);
		const second = writePiAiProviderPatch(dir, route);
		expect(first).toBe(second);
		expect(readFileSync(first, "utf8")).toContain("llm-pi-ai");
		// ⚠️ 换模型 ⇒ 另一个文件（**不覆盖别人的** ⇒ 并发会话互不干扰）。
		const other = writePiAiProviderPatch(dir, { ...route, model: "MiniMax-M3" });
		expect(other).not.toBe(first);
	});
});
