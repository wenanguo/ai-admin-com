/**
 * dsh 的 **profile 引导** —— 把「我们的插件」装进 dsh 的 profile。
 *
 * ## dsh 的 profile 是什么
 *
 * dsh 的运行时是**插件拼出来的** ⇒ 一个 profile = 一个**独立的 pnpm 工程**
 * （`$DSH_HOME/profiles/<name>/package.json` + 一份配置）。
 * ⇒ 我们的插件要能被 profile 解析到 ⇒ **必须装进那个工程**。
 *
 * ## 引导步骤（幂等 + **插件一改就生效**）
 *
 * ① profile 不在 ⇒ 用 dsh 自己建（`dsh --profile <name> --dump-config`）；
 * ② **插件的「内容指纹」变了** ⇒ 重装（`pnpm add file:<我们的插件路径>`）；
 *    指纹没变 ⇒ **跳过**（装插件要联网、要时间 ⇒ 别每次都装）。
 *
 * ⚠️ **为什么判据必须是「内容」而不是「路径」**（issue #158）：
 *
 *    `pnpm add file:<路径>` 会把插件**拷贝**进 profile ⇒ 我们改了插件源码，
 *    profile 里那份**拷贝**还是旧的 ⇒ provider / 工具全是旧版
 *    （实测：把 `DSH_AI_*` 改名成 `AI_DSH_*` ⇒ dsh 直接报
 *    `NO_ADAPTER: no adapter registered for provider "minimax"` ⇒ 派活瘫）。
 *
 *    ⇒ 旧代码那句「**依赖已经是这个路径 ⇒ 直接跳过**」就是元凶：
 *    路径永远不变 ⇒ 拷贝永远不刷新 ⇒ **改了插件等于没改**。
 *    ⇒ 现在改成：**内容指纹**（sha256）变了 ⇒ 重装（pnpm 会把 `file:` 目录
 *    **重新打包**⇒ 拷进去的就是新内容）。
 *
 * ⚠️ **生产更要紧**（同一个坑的另一面）：容器里 profile 在**卷**上
 *    ⇒ 镜像升级后插件**永远不更新** ⇒ 指纹判据把这条也一起修掉
 *    （镜像里的插件内容变了 ⇒ 指纹变了 ⇒ 重装）。
 *
 * ⚠️ **要 pnpm**（dsh 生态自己的包管理器）⇒ 生产镜像里要有它；
 *    没有就报错并说清怎么办（**不静默降级** —— 少了插件 ⇒ 工具与 provider 都不在）。
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 我们插件的包名（**装进 profile 的那个名字**）。 */
export const DSH_PLUGIN_PACKAGE = "@ai-admin/dsh-plugin";

/**
 * 插件状态的**文件名**（放在 profile 目录里 ⇒ 跟着 profile 一起持久化）。
 *
 * ⚠️ 生产里 profile 在卷上 ⇒ 这份状态也跟着持久化 ⇒
 *    「镜像里的插件变没变」这件事**跨进程**也判得出来。
 */
export const PLUGIN_STATE_FILE = ".ai-admin-plugin.json";

/** 算指纹时**不看**的目录（依赖 / 版本库 ⇒ 与「插件源码变没变」无关）。 */
const FINGERPRINT_IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	".pnpm-store",
	".turbo",
	".cache",
]);

/** 引导 profile 需要的参数。 */
export interface EnsureProfileOptions {
	/** dsh 的 home（`$DSH_HOME`）。 */
	dshHome: string;
	/** profile 名。 */
	profile: string;
	/** dsh 可执行文件（用来建 profile）。 */
	dshBin: string;
	/** 我们插件的**绝对路径**（`file:` 依赖的源）。 */
	pluginPath: string;
}

/** 插件在 profile 里的**安装状态**（写在 profile 目录里）。 */
export interface PluginState {
	/** 装进去那一刻的**内容指纹**（sha256）。 */
	fingerprint: string;
	/** 装的时候用的依赖说明符（`file:<路径>`）。 */
	spec: string;
	/** 装的时间（ISO ⇒ 只给人看）。 */
	installedAt: string;
}

/**
 * 保证 profile 存在且装了我们的插件（**插件一改就重装**）。
 *
 * ⚠️ **不做长缓存**：以前是「每个进程只做一次」（怕 `pnpm add` 慢）。
 *    现在**贵的部分只有「重装」**（内容变了才发生）⇒
 *    「检查」只是算个指纹 + 读个状态文件（毫秒级）⇒
 *    ⇒ 每次会话都检查 ⇒ **同一个进程里改了插件，下一个会话就生效**。
 * ⇒ 只保留「**同时进行**的引导合并成一次」（免得并发会话一起装）。
 *
 * @param options 引导参数。
 */
export function ensureDshProfile(options: EnsureProfileOptions): Promise<void> {
	const key = JSON.stringify([options.dshHome, options.profile, options.pluginPath]);
	const pending = bootstraps.get(key);
	if (pending !== undefined) {
		return pending;
	}
	const running = bootstrapProfile(options).finally(() => {
		bootstraps.delete(key);
	});
	bootstraps.set(key, running);
	return running;
}

/** **正在进行中**的引导（按参数分组 ⇒ 同一组只装一次）。 */
const bootstraps = new Map<string, Promise<void>>();

/**
 * 插件的**内容指纹**（sha256，十六进制）。
 *
 * ## 算什么
 *
 * 插件目录里**每个文件**的（相对路径 + 内容哈希）⇒ 排序后拼起来再哈希。
 *
 * ## 为什么这么算
 *
 * - **只看内容** ⇒ 路径没变但内容变了 ⇒ 指纹也变（这正是 issue #158 的坑）；
 * - **相对路径统一用 `/`** ⇒ Windows 与 Linux 算出来一样（跨平台一致）；
 * - **不看 `node_modules`** ⇒ 依赖装没装不该影响「插件源码变没变」。
 *
 * @param pluginPath 插件目录。
 * @returns 指纹（十六进制）。
 */
export function pluginFingerprint(pluginPath: string): string {
	if (!existsSync(pluginPath)) {
		throw new Error(`找不到我们的插件目录：${pluginPath}`);
	}
	const hash = createHash("sha256");
	for (const file of pluginFiles(pluginPath)) {
		hash.update(file.relativePath);
		hash.update("\n");
		hash.update(
			createHash("sha256").update(readFileSync(file.absolutePath)).digest("hex"),
		);
		hash.update("\n");
	}
	return hash.digest("hex");
}

/** 插件目录里的文件（**按相对路径排序** ⇒ 指纹与遍历顺序无关）。 */
function pluginFiles(pluginPath: string): {
	relativePath: string;
	absolutePath: string;
}[] {
	const out: { relativePath: string; absolutePath: string }[] = [];
	const walk = (dir: string): void => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		);
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (FINGERPRINT_IGNORED_DIRS.has(entry.name)) {
					continue;
				}
				walk(join(dir, entry.name));
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			const absolutePath = join(dir, entry.name);
			out.push({
				relativePath: relative(pluginPath, absolutePath).split(sep).join("/"),
				absolutePath,
			});
		}
	};
	walk(pluginPath);
	out.sort((a, b) =>
		a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
	);
	return out;
}

/**
 * 读插件的安装状态（**没有 / 坏了 ⇒ undefined** ⇒ 视为「要重装」）。
 *
 * @param profileDir profile 目录。
 */
export function readPluginState(profileDir: string): PluginState | undefined {
	const file = join(profileDir, PLUGIN_STATE_FILE);
	if (!existsSync(file)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PluginState>;
		if (typeof parsed.fingerprint !== "string" || typeof parsed.spec !== "string") {
			return undefined;
		}
		return {
			fingerprint: parsed.fingerprint,
			spec: parsed.spec,
			installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : "",
		};
	} catch {
		return undefined;
	}
}

/**
 * 写插件的安装状态（**装完才写** ⇒ 写坏了就当没装过 ⇒ 下次重装）。
 *
 * @param profileDir profile 目录。
 * @param state 状态。
 */
export function writePluginState(profileDir: string, state: PluginState): void {
	writeFileSync(
		join(profileDir, PLUGIN_STATE_FILE),
		`${JSON.stringify(state, null, 2)}\n`,
		"utf8",
	);
}

/**
 * 写 profile 的 `pnpm-workspace.yaml`（**放开供应链策略**）。
 *
 * @param profileDir profile 目录。
 */
function writePnpmWorkspace(profileDir: string): void {
	const file = join(profileDir, "pnpm-workspace.yaml");
	const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
	const kept = existing
		.split("\n")
		.filter((line) => !line.trim().startsWith("minimumReleaseAge"))
		.join("\n");
	writeFileSync(file, `${kept.trimEnd()}\nminimumReleaseAge: 0\n`, "utf8");
}

/** 真正做引导的那一段。 */
async function bootstrapProfile(options: EnsureProfileOptions): Promise<void> {
	const profileDir = join(options.dshHome, "profiles", options.profile);
	if (!existsSync(profileDir)) {
		const created = spawnSync(
			process.execPath,
			[options.dshBin, "--profile", options.profile, "--dump-config"],
			{
				env: { ...process.env, DSH_HOME: options.dshHome },
				encoding: "utf8",
			},
		);
		if (created.status !== 0) {
			throw new Error(
				`创建 dsh profile 失败：${created.stderr || created.stdout || "（没有输出）"}`,
			);
		}
	}

	const manifestPath = join(profileDir, "package.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`dsh profile 的清单不在：${manifestPath}`);
	}

	// ⚠️ **pnpm 的供应链策略要放开**（`minimumReleaseAge: 0`）。
	//
	//    dsh 的包是 rc（刚发布不到一天）⇒ pnpm 11 默认会拦
	//    （尖峰里已经踩过：见 `backend/ai/spike/dsh/pnpm-workspace.yaml`）。
	//    ⇒ 我们**精确锁死**了版本（dsh-versions.lock.json）⇒ 不是「装最新的」。
	writePnpmWorkspace(profileDir);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		dependencies?: Record<string, string>;
		dsh?: { profile?: { bundles?: string[] } };
	};

	// ⚠️ **用 `file:` 而不是 `link:`** ⇒ pnpm 会把插件**拷贝**进 profile
	//    （连带装上它的依赖）⇒ 插件在 dsh 进程里能 import 到 @deepseek-ai/*。
	//    （`link:` 在开发时方便，但插件的依赖不会被装进 profile ⇒ import 会失败。）
	const wanted = `file:${options.pluginPath.replace(/\\/g, "/")}`;

	// ⚠️ **判据 = 内容指纹**（issue #158）：路径一样但内容变了 ⇒ 也要重装。
	const fingerprint = pluginFingerprint(options.pluginPath);
	const state = readPluginState(profileDir);
	const installedCopy = join(
		profileDir,
		"node_modules",
		...DSH_PLUGIN_PACKAGE.split("/"),
	);
	const upToDate =
		state !== undefined &&
		state.fingerprint === fingerprint &&
		state.spec === wanted &&
		manifest.dependencies?.[DSH_PLUGIN_PACKAGE] !== undefined &&
		existsSync(installedCopy);
	if (!upToDate) {
		installPlugin(profileDir, wanted);
		writePluginState(profileDir, {
			fingerprint,
			spec: wanted,
			installedAt: new Date().toISOString(),
		});
	}

	// ⚠️ **插件装进 profile**（`link:` ⇒ 符号链接 ⇒ 改源码立即生效）。
	//
	//    ⚠️ **不挂成 bundle**：bundle 里的插件在 **root 作用域** ⇒ 看不见
	//    agent 作用域里的服务（审批缝 / 工具表）⇒ 我们的工具会变成「unknown tool」。
	//    ⇒ 走**补丁层**（`--patch profile.patch.yml`）⇒ 与尖峰的玩具工具同一个位置。
	const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		dsh?: { profile?: { bundles?: string[] } };
	};
	const bundles = (manifestAfter.dsh?.profile?.bundles ?? []).filter(
		(name) => name !== DSH_PLUGIN_PACKAGE,
	);
	manifestAfter.dsh = { ...(manifestAfter.dsh ?? {}), profile: { bundles } };
	writeFileSync(manifestPath, `${JSON.stringify(manifestAfter, null, 2)}\n`, "utf8");
}

/**
 * 把插件装进 profile（`pnpm add file:<路径>`）。
 *
 * ⚠️ **pnpm 会把 `file:` 目录重新打包** ⇒ 源目录内容变了 ⇒ 拷进去的就是新内容
 *    （实测：同一路径、内容改了 ⇒ 重跑 `pnpm add` ⇒ profile 里的拷贝跟着变）。
 *
 * @param profileDir profile 目录。
 * @param wanted 依赖说明符（`file:<路径>`）。
 */
function installPlugin(profileDir: string, wanted: string): void {
	// ⚠️ Windows 上 `.cmd` 只能经 shell 起（Node 的安全限制）⇒ 用一条命令串 + 引号。
	const added = spawnSync(`pnpm add "${DSH_PLUGIN_PACKAGE}@${wanted}"`, {
		cwd: profileDir,
		encoding: "utf8",
		shell: true,
	});
	if (added.status !== 0) {
		throw new Error(
			`把 ${DSH_PLUGIN_PACKAGE} 装进 dsh profile 失败（需要 pnpm）：${
				added.stderr || added.stdout || "（没有输出）"
			}`,
		);
	}
}
