/**
 * 内核纯净度 —— **架构的单测**（不是靠人盯）。
 *
 * ## 钉住的事
 *
 * `core/**` **不许** import `plugins/**` ⇒ 依赖方向永远是 **插件 → 内核**。
 *
 * ⚠️ 靠 grep 业务词查不出来（注释里出现「任务」很正常）⇒
 *    这里查的是**真实的 import 关系**（解析说明符 ⇒ 算出落点）。
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
/** 检查脚本。 */
const SCRIPT = join(REPO_ROOT, "scripts", "check-core-purity.cjs");
/** 业务词检查脚本。 */
const WORDS_SCRIPT = join(REPO_ROOT, "scripts", "check-core-business-words.cjs");

/** 跑检查脚本 ⇒ 返回 {code, output}。 */
function runCheck(coreDir?: string): { code: number; output: string } {
	return runScript(SCRIPT, coreDir);
}

/** 跑另一个检查脚本（同样的调用方式）。 */
function runScript(script: string, coreDir?: string): { code: number; output: string } {
	try {
		const output = execFileSync("node", [script, ...(coreDir ? [coreDir] : [])], {
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

describe("内核业务词", () => {
	it("仓里的 core/ 代码里没有业务词（剥掉注释后查）", () => {
		const result = runScript(WORDS_SCRIPT);
		expect(result.output).not.toContain("❌");
		expect(result.code).toBe(0);
	});

	it("检查脚本**抓得住**业务词", () => {
		const root = mkdtempSync(join(tmpdir(), "core-words-"));
		const core = join(root, "core");
		mkdirSync(core, { recursive: true });
		writeFileSync(join(core, "bad.ts"), 'const table = "pm_task";\n', "utf8");

		const result = runScript(WORDS_SCRIPT, core);
		expect(result.code).toBe(1);
		expect(result.output).toContain("pm_task");
	});
});

describe("内核纯净度", () => {
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
