/**
 * 内核的**公开表面**（设计 §⑧：按「可发布」来设计）。
 *
 * ## 钉住的两条
 *
 * 1. **公开入口是唯一的** ⇒ `core/index.ts` 导出对外的那一套（改它 = 改对外契约）；
 * 2. **依赖不外泄** ⇒ 内核只依赖**通用件**（pi SDK / express / prisma / zod / typebox / yaml /
 *    node 内置）⇒ **不依赖任何业务系统** ⇒ 换个系统只要带自己的插件。
 *
 * ⚠️ 这两条都是**可执行**的断言（不是靠人盯）。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as core from "./index.ts";

/** 内核目录（**cwd 相对** ⇒ 测试要在这个包里跑）。 */
const CORE_DIR = join(process.cwd(), "src", "core");

/** 内核允许依赖的**通用件**（前缀匹配；`node:` 是内置）。 */
const ALLOWED_DEPENDENCIES = [
	"node:",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-mcp",
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
});
