/**
 * 「dsh 边界守卫」的**负例测试**（issue #123 收尾 · 派活链路要 dsh 运行时）。
 *
 * ## 为什么要有这个
 *
 * `scripts/check-dsh-boundary.cjs` 现在放行 `@deepseek-ai/dsh` 作为 **devDependency**
 * （PM 派活链路要起 dsh 的 headless 子会话 ⇒ 需要运行时本体；**服务**不需要它）。
 *
 * ⚠️ 这种「放行」最危险的失效方式就是**被改松**（后来者顺手把清单合并一下、
 * 或把 devDependencies 也放进去 ⇒ 规则的边界就没了）。
 * ⇒ 这里用**负例**把边界钉死：
 *   ① dsh 运行时进 **`dependencies`** ⇒ 必须被拦；
 *   ② **别的** dsh 包进 `devDependencies` ⇒ 必须被拦；
 *   ③ 干净的清单 ⇒ 必须通过；
 *   ④ **自研 provider 复活**（issue #168 · D5=B）⇒ 必须被拦。
 *
 * 做法：把 `backend/ai/package.json` 复制到临时目录、原地改坏、跑守卫、还原。
 * ⚠️ **不碰真文件**：全程在 **临时目录的副本**上做（守卫脚本接受根目录参数）。
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(REPO_ROOT, "scripts", "check-dsh-boundary.cjs");

/** 跑守卫，返回 { code, output }。 */
function runGuard(root) {
	try {
		const output = execFileSync("node", [GUARD, "--root", root], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: 0, output };
	} catch (error) {
		return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
	}
}

/**
 * 造一个「最小可跑」的仓根副本：只要守卫脚本会看的那几个文件。
 * ⚠️ 守卫会扫全仓 ⇒ 这里只复制它需要的部分（清单 + 适配层目录），避免太慢。
 *
 * @param {Function} mutate 改清单（测试用）。
 * @param {object} [options] 选项。
 * @param {string} [options.providerFile] 造一个「自研 provider」文件（相对 backend/ai）。
 * @returns 守卫的 root 参数（backend/ai 那一层）。
 */
function makeFixture(mutate, options = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-boundary-"));
	const manifestPath = path.join(root, "backend", "ai", "package.json");
	fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
	const manifest = JSON.parse(
		fs.readFileSync(path.join(REPO_ROOT, "backend", "ai", "package.json"), "utf8"),
	);
	mutate(manifest);
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	if (typeof options.providerFile === "string") {
		const file = path.join(root, "backend", "ai", options.providerFile);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			"import { LlmAdapter } from '@deepseek-ai/dsh-llm'\nexport class X extends LlmAdapter {}\n",
			"utf8",
		);
	}
	// ⚠️ 守卫的 root 指向 **backend/ai 那一层**（它的默认值就是这里）
	return path.join(root, "backend", "ai");
}

const results = [];
function check(label, ok, detail) {
	results.push({ label, ok, detail });
	console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` —— ${detail ?? ""}`}`);
}

console.log("① 干净的清单 ⇒ 守卫通过");
{
	const root = makeFixture(() => {});
	const { code, output } = runGuard(root);
	check("干净清单不报违规", code === 0, output.slice(0, 300));
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("② dsh 运行时进 dependencies ⇒ 必须被拦");
{
	const root = makeFixture((manifest) => {
		manifest.dependencies = manifest.dependencies ?? {};
		manifest.dependencies["@deepseek-ai/dsh"] = "0.2.2-rc.5";
	});
	const { code, output } = runGuard(root);
	check("被拦下（退出码非 0）", code !== 0, `退出码=${code}`);
	check("报的是「目录边界」", output.includes("目录边界"), output.slice(0, 300));
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("③ 别的 dsh 包进 devDependencies ⇒ 必须被拦");
{
	const root = makeFixture((manifest) => {
		manifest.devDependencies = manifest.devDependencies ?? {};
		manifest.devDependencies["@deepseek-ai/dsh-mcp-client"] = "0.2.2-rc.5";
	});
	const { code, output } = runGuard(root);
	check("被拦下（退出码非 0）", code !== 0, `退出码=${code}`);
	check("报的是「目录边界」", output.includes("目录边界"), output.slice(0, 300));
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("④ dsh 运行时在 devDependencies ⇒ 放行（派活链路需要它）");
{
	const root = makeFixture((manifest) => {
		manifest.devDependencies = manifest.devDependencies ?? {};
		manifest.devDependencies["@deepseek-ai/dsh"] = "0.2.2-rc.5";
	});
	const { code, output } = runGuard(root);
	check("放行（退出码 0）", code === 0, output.slice(0, 300));
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("⑤ **自研 provider 复活** ⇒ 必须被拦（issue #168 · D5=B）");
{
	const root = makeFixture(() => {}, { providerFile: "dsh-plugin/src/provider.js" });
	const { code, output } = runGuard(root);
	check("被拦下（退出码非 0）", code !== 0, `退出码=${code}`);
	check("报的是「自研 provider」", output.includes("自研 provider"), output.slice(0, 300));
	fs.rmSync(root, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(
	failed.length === 0
		? `✅ dsh 边界守卫的负例全过（${results.length} 条）`
		: `❌ dsh 边界守卫的负例失败 ${failed.length} 条（共 ${results.length} 条）`,
);
process.exit(failed.length === 0 ? 0 : 1);
