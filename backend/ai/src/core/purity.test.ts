/**
 * 内核纯净度 —— **架构的单测**（不是靠人盯）。
 *
 * ## 钉住的事
 *
 * `core/**` **不许** import `plugins/**` ⇒ 依赖方向永远是 **插件 → 内核**。
 * `core/**` 的**代码**里 **不许**出现业务实体名 ⇒ 内核真的「不认识业务」。
 *
 * ⚠️ 靠 grep 业务词查不出来（注释里出现「任务」很正常）⇒
 *    第一档查的是**真实的 import 关系**（解析说明符 ⇒ 算出落点）；
 *    第二档查的是**代码**（剥掉注释与字符串字面量 ⇒ 剩下的是标识符）。
 *
 * ⇒ 检查本体在 `scripts/check-core-purity.cjs`（CI 也跑它）⇒ 这里跑它 + 验它**抓得住**。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 仓根（vitest 的 cwd = `backend/ai`）。 */
const REPO_ROOT = join(process.cwd(), "..", "..");
/** 检查脚本（两档都在里面）。 */
const SCRIPT = join(REPO_ROOT, "scripts", "check-core-purity.cjs");

/** 跑检查脚本 ⇒ 返回 {code, output}。 */
function runCheck(coreDir?: string, allowlistFile?: string): { code: number; output: string } {
	const args = [SCRIPT, ...(coreDir ? [coreDir] : [])];
	if (allowlistFile !== undefined) {
		args.push("--allowlist", allowlistFile);
	}
	try {
		const output = execFileSync("node", args, {
			cwd: REPO_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: 0, output };
	} catch (error) {
		const err = error as { status?: number; stdout?: string; stderr?: string };
		return {
			code: err.status ?? 1,
			output: `${err.stdout ?? ""}${err.stderr ?? ""}`,
		};
	}
}

/** 造一个临时的 core 目录（里面放给定的文件）。 */
function tempCore(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "core-purity-"));
	const core = join(root, "core");
	mkdirSync(core, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(core, name), content, "utf8");
	}
	return core;
}

describe("内核纯净度 · 第一档（依赖方向）", () => {
	it("仓里的 core/ 没有 import plugins/（CI 也跑同一条检查）", () => {
		const result = runCheck();
		expect(result.output).not.toContain("❌");
		expect(result.code).toBe(0);
	});

	it("检查脚本**抓得住**违规（内核 import 了插件）", () => {
		// 造一个临时的 core/ + plugins/ ⇒ 内核里那个文件 import 了插件
		// ⚠️ 说明符**分片拼**（不写成字面量）⇒ 否则本文件自己会被检查脚本当成违规。
		const pluginSpec = ["..", "plugins", "pm", "thing.ts"].join("/");
		const root = mkdtempSync(join(tmpdir(), "core-purity-"));
		const core = join(root, "core");
		const plugins = join(root, "plugins", "pm");
		mkdirSync(core, { recursive: true });
		mkdirSync(plugins, { recursive: true });
		writeFileSync(
			join(core, "bad.ts"),
			`import { thing } from "${pluginSpec}";\n`,
			"utf8",
		);
		writeFileSync(join(plugins, "thing.ts"), "export const thing = 1;\n", "utf8");

		const result = runCheck(core);
		expect(result.code).toBe(1);
		expect(result.output).toContain("import 了");
		expect(result.output).toContain("bad.ts");
	});
});

describe("内核纯净度 · 第二档（业务词）", () => {
	it("仓里的 core/ 代码里没有业务词（剥掉注释与字符串后查）", () => {
		const result = runCheck();
		expect(result.output).not.toContain("❌");
		expect(result.code).toBe(0);
	});

	it("抓得住**代码里**的业务词（标识符）", () => {
		const core = tempCore({ "bad.ts": "const pm_task = 1;\n" });
		const result = runCheck(core);
		expect(result.code).toBe(1);
		expect(result.output).toContain("pm_task");
		expect(result.output).toContain("bad.ts");
	});

	it("抓得住**字符串里**的强业务标识（表名 / 字段名）", () => {
		const core = tempCore({ "bad.ts": 'const table = "pm_task";\n' });
		const result = runCheck(core);
		expect(result.code).toBe(1);
		expect(result.output).toContain("pm_task");
		expect(result.output).toContain("字符串");
	});

	it("**放过**注释与字符串里的正常用法（那是文档与人话，不是依赖）", () => {
		const core = tempCore({
			"ok.ts": [
				"// 注释里讲清楚这个内核目前接的是哪个业务：任务 / 项目 / 里程碑 / 风险",
				"/* 块注释也一样：AiAdmin */",
				'const message = "任务创建失败";',
				"const ok = 1;",
			].join("\n"),
		});
		const result = runCheck(core);
		expect(result.output).not.toContain("❌");
		expect(result.code).toBe(0);
	});

	it("**允许清单**能豁免（逐词豁免 ⇒ 同文件别的业务词照样报）", () => {
		const core = tempCore({ "bad.ts": "const pm_task = 1;\n" });
		const allowlist = join(core, "..", "allow.json");
		writeFileSync(
			allowlist,
			JSON.stringify({
				"bad.ts": { words: ["pm_task"], reason: "测试用" },
			}),
			"utf8",
		);

		const allowed = runCheck(core, allowlist);
		expect(allowed.output).not.toContain("❌");
		expect(allowed.code).toBe(0);
		expect(allowed.output).toContain("允许清单");

		// ⚠️ 豁免的是**这个词** ⇒ 换个业务词照样报
		const other = tempCore({ "bad.ts": "const pm_project = 1;\n" });
		const otherAllowlist = join(other, "..", "allow.json");
		writeFileSync(
			otherAllowlist,
			JSON.stringify({
				"bad.ts": { words: ["pm_task"], reason: "测试用" },
			}),
			"utf8",
		);
		const notAllowed = runCheck(other, otherAllowlist);
		expect(notAllowed.code).toBe(1);
		expect(notAllowed.output).toContain("pm_project");
	});
});
