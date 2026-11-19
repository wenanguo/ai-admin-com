/**
 * dsh 的 **profile 引导** —— 第一次用时把「我们的插件」装进 dsh 的 profile。
 *
 * ## dsh 的 profile 是什么
 *
 * dsh 的运行时是**插件拼出来的** ⇒ 一个 profile = 一个**独立的 pnpm 工程**
 * （`$DSH_HOME/profiles/<name>/package.json` + 一份配置）。
 * ⇒ 我们的插件要能被 profile 解析到 ⇒ **必须装进那个工程**。
 *
 * ## 引导步骤（幂等）
 *
 * ① profile 不在 ⇒ 用 dsh 自己建（`dsh --profile <name> --dump-config`）；
 * ② 我们的插件不在它的依赖里 ⇒ `pnpm add file:<我们的插件路径>`。
 *
 * ⚠️ **要 pnpm**（dsh 生态自己的包管理器）⇒ 生产镜像里要有它；
 *    没有就报错并说清怎么办（**不静默降级** —— 少了插件 ⇒ 工具与 provider 都不在）。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 我们插件的包名（**装进 profile 的那个名字**）。 */
export const DSH_PLUGIN_PACKAGE = "@ai-admin/dsh-plugin";

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

/**
 * 保证 profile 存在且装了我们的插件。
 *
 * @param options 引导参数。
 */
export function ensureDshProfile(options: EnsureProfileOptions): void {
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
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		dependencies?: Record<string, string>;
		dsh?: { profile?: { bundles?: string[] } };
	};
	const installed = manifest.dependencies?.[DSH_PLUGIN_PACKAGE];
	// ⚠️ **用 `link:` 而不是 `file:`** ⇒ pnpm 建的是**符号链接**
	//    ⇒ 改了插件源码**立即生效**（不用重装）⇒ 开发时不会拿着旧代码跑。
	const wanted = `link:${options.pluginPath.replace(/\\/g, "/")}`;
	if (installed !== wanted) {
		// ⚠️ Windows 上 `.cmd` 只能经 shell 起（Node 的安全限制）⇒ 用一条命令串 + 引号。
		const added = spawnSync(
			`pnpm add "${DSH_PLUGIN_PACKAGE}@${wanted}"`,
			{ cwd: profileDir, encoding: "utf8", shell: true },
		);
		if (added.status !== 0) {
			throw new Error(
				`把 ${DSH_PLUGIN_PACKAGE} 装进 dsh profile 失败（需要 pnpm）：${
					added.stderr || added.stdout || "（没有输出）"
				}`,
			);
		}
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
