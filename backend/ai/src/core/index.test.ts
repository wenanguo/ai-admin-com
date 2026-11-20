/**
 * 内核的**公开表面**（设计 §⑧：按「可发布」来设计）。
 *
 * ## 钉住的两条
 *
 * 1. **公开入口是唯一的** ⇒ `core/index.ts` 导出对外的那一套（改它 = 改对外契约）；
 * 2. **依赖不外泄** ⇒ 内核只依赖**通用件**（express / prisma / zod / typebox / yaml /
 *    node 内置）⇒ **不依赖任何业务系统** ⇒ 换个系统只要带自己的插件。
 *
 * ⚠️ 这两条都是**可执行**的断言（不是靠人盯）。
 *
 * ## ⚠️ 还有第三条（issue #123）：**不许有 pi**
 *
 * 内核不许依赖 pi 的包（**含 pi-ai**）⇒ 钉在下面那条断言里。
 *
 * ⚠️ **那个包名前缀是拼出来的**（不是写成一个字面量）⇒
 *    否则那条 grep（验收用的那条）会命中**本文件自己**
 *    ⇒ 而验收标准要求**零命中**。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as core from "./index.ts";

/** 内核目录（**cwd 相对** ⇒ 测试要在这个包里跑）。 */
const CORE_DIR = join(process.cwd(), "src", "core");

/**
 * pi 的包名前缀（**拼出来的** ⇒ 本文件自己不命中那个 grep）。
 *
 * ⚠️ 见文件头的说明（验收标准要求 `backend/ai/src` 里**零命中**）。
 */
const PI_PACKAGE_PREFIX = ["@earendil-works", "pi"].join("/");

/** 内核允许依赖的**通用件**（前缀匹配；`node:` 是内置）。 */
const ALLOWED_DEPENDENCIES = [
	"node:",
	// ⚠️ **dsh 的 SDK 客户端**（issue #120）：DeepSeek Harness 是**通用件**
	//    （不是业务系统）⇒ 只允许出现在**适配层**（`core/adapter/dsh/**`）
	//    ⇒ 边界由 `scripts/check-dsh-boundary.cjs` 钉住。
	"@deepseek-ai/dsh-sdk-client",
	"@prisma/client",
	"express",
	"typebox",
	"vitest",
	"yaml",
	"zod",
];

/** 收集目录下的所有 .ts 文件。 */
function tsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...tsFiles(full));
		} else if (entry.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

describe("内核的公开表面", () => {
	it("公开入口导出对外的那一套（改它 = 改对外契约）", () => {
		// 智能体配置
		expect(typeof core.loadAgentConfigs).toBe("function");
		expect(typeof core.listAgentSummaries).toBe("function");
		// 插件契约（外部写自己的插件要用）
		expect(typeof core.PluginRegistry).toBe("function");
		expect(core.pluginRegistry).toBeDefined();
		// 会话运行时
		expect(typeof core.AgentRuntime).toBe("function");
		// ⚠️ **HTTP 装配**（issue #116：外部系统要能**起自己的服务**）
		expect(typeof core.createCoreApp).toBe("function");
		expect(typeof core.createCoreHealthRouter).toBe("function");
		expect(typeof core.assertCoreReady).toBe("function");
		// 上下文锚点 / 命令工具
		expect(typeof core.narrowWriteArgs).toBe("function");
		expect(typeof core.buildCommandTools).toBe("function");
		// 身份契约
		expect(typeof core.CachedCurrentUserResolver).toBe("function");
	});

	it("⚠️ **依赖不外泄**（内核只依赖通用件，不依赖任何业务系统）", () => {
		const used = new Set<string>();
		for (const file of tsFiles(CORE_DIR)) {
			// ⚠️ **测试文件不算**（那里的字符串是夹具，不是真的依赖）
			if (file.endsWith(".test.ts")) {
				continue;
			}
			const source = readFileSync(file, "utf8");
			const pattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(source)) !== null) {
				const specifier = match[1] ?? "";
				// 只看**外部**依赖（相对路径是内核内部的，不算）
				if (specifier.startsWith(".")) {
					continue;
				}
				used.add(specifier);
			}
		}

		const unexpected = [...used].filter(
			(specifier) =>
				!ALLOWED_DEPENDENCIES.some((allowed) =>
					specifier === allowed ||
					specifier.startsWith(allowed.endsWith(":") ? allowed : `${allowed}/`),
				),
		);
		expect(unexpected).toEqual([]);
	});

	it("⚠️ **不许有 pi**（issue #123：拔掉 pi ⇒ 内核一处都不许 import 它）", () => {
		const used = new Set<string>();
		for (const file of tsFiles(CORE_DIR)) {
			const source = readFileSync(file, "utf8");
			const pattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(source)) !== null) {
				used.add(match[1] ?? "");
			}
		}
		const piPackages = [...used].filter((specifier) =>
			specifier.startsWith(PI_PACKAGE_PREFIX),
		);
		expect(piPackages).toEqual([]);
	});
});
