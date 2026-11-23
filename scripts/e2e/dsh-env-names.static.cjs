/**
 * 静态守卫（issue #124 阶段三的**真 bug**）：**入库的 `.env` 模板里不许出现 `DSH_` 开头的键**。
 *
 * ## 为什么
 *
 * dsh 的 app-boot 里 `BOOTSTRAP_PREFIXES = ['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']`
 * ⇒ **任何 `.env` 文件里写 `DSH_*`，dsh 都会拒绝启动**：
 *
 * ```
 * dsh: …/.env sets "DSH_BASE_URL", which only the launching environment may set
 * ```
 *
 * 而 dsh 会读**它启动目录**的 `.env`（`backend/ai/.env` 正是那个位置）
 * ⇒ 我们的 `.env.example` 要是又教用户写 `DSH_*` ⇒ **照着配就炸**。
 *
 * ## 它查什么
 *
 * ① 仓里**会被复制成 `.env` 的模板**（`.env.example` / `.env.sample` / `.env.template` /
 *    `.env.dist` / `*.env.example`）里**不许有** `DSH_` 开头的键（大小写不敏感）；
 * ② 这些模板里**我们自己的**变量（`AI_*` 那一族）**必须**是 `AI_DSH_*`（别写成 `DSH_*`）；
 * ③ 负例：把一份模板改坏 ⇒ 守卫**必须**拦（防这条规则被改松）。
 *
 * ⚠️ **只查入库的**（`git ls-files`）⇒ `.env` 本身不入库，不查。
 * ⚠️ 不查**文档**里的叙述性文字（那里的 `DSH_HOME` 是在说 dsh 自己认的名字，是合法的）。
 *
 * 用法（**在仓根跑**）：`node scripts/e2e/dsh-env-names.static.cjs`
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** 仓根。 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** 模板文件名的判定（会被复制成 `.env` 的那种）。 */
const TEMPLATE_PATTERNS = [
	/^\.env\.example$/,
	/^\.env\.sample$/,
	/^\.env\.template$/,
	/^\.env\.dist$/,
	/\.env\.example$/,
];

/** 一条 `KEY=…` 行。 */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * 是不是「会被复制成 `.env` 的模板」。
 *
 * @param {string} file 相对仓根的路径。
 */
function isTemplate(file) {
	return TEMPLATE_PATTERNS.some((pattern) => pattern.test(path.basename(file)));
}

/**
 * 模板里的**键名**（注释行不算 ⇒ `# DSH_HOME` 这种叙述是允许的；
 * 但 `# DSH_BASE_URL=…` 这种**注释掉的示例**要算 —— 它就是在教人配）。
 *
 * @param {string} text 文件内容。
 * @returns {{ name: string; line: number }[]}
 */
function envKeysIn(text) {
	const keys = [];
	text.split(/\r?\n/).forEach((rawLine, index) => {
		// 去掉注释前缀（`# DSH_BASE_URL=x` 是在教人怎么配 ⇒ 也算）
		const line = rawLine.replace(/^\s*#+\s*/, "");
		const match = ASSIGNMENT.exec(line);
		if (match?.[1] !== undefined) {
			keys.push({ name: match[1], line: index + 1 });
		}
	});
	return keys;
}

/**
 * 检查一份模板的内容。
 *
 * @param {string} file 相对仓根的路径（报错用）。
 * @param {string} text 内容。
 * @returns {string[]} 违规描述（空 ⇒ 干净）。
 */
function inspect(file, text) {
	const problems = [];
	for (const { name, line } of envKeysIn(text)) {
		// ① dsh 的保留前缀
		if (name.toUpperCase().startsWith("DSH_")) {
			problems.push(
				`${file}:${line} 「${name}」—— dsh 的 app-boot 拒收 .env 里的 DSH_*（会拒绝启动）；` +
					`换成 AI_${name.toUpperCase()}`,
			);
			continue;
		}
		// ② 我们自己的变量必须是 AI_DSH_*（不是别的拼法）
		if (name.toUpperCase().startsWith("AI_DSH") && !name.toUpperCase().startsWith("AI_DSH_")) {
			problems.push(`${file}:${line} 「${name}」—— 我们的变量要用 AI_DSH_ 前缀`);
		}
	}
	return problems;
}

/** 跑守卫，返回 { code, output }。 */
function runGuard(root) {
	try {
		const output = execFileSync(process.execPath, [__filename, "--root", root], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: 0, output };
	} catch (error) {
		return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
	}
}

const results = [];
function check(label, ok, detail) {
	results.push({ label, ok, detail });
	console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` —— ${detail ?? ""}`}`);
}

/** 真检查（也是负例子进程被调用的那个模式）。 */
function main() {
	const rootIndex = process.argv.indexOf("--root");
	const root = rootIndex === -1 ? REPO_ROOT : path.resolve(process.argv[rootIndex + 1]);

	// ⚠️ **只看入库的**（`git ls-files`）
	let tracked;
	try {
		tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
			.split("\0")
			.filter((file) => file.length > 0);
	} catch (error) {
		console.error(`❌ 读不到 git 的文件清单（${error.message}）`);
		process.exit(1);
	}

	const templates = tracked.filter(isTemplate);
	if (templates.length === 0) {
		console.error("❌ 一份 .env 模板都没找到 ⇒ 守卫形同虚设（模板被挪走了？）");
		process.exit(1);
	}

	const problems = [];
	for (const file of templates) {
		problems.push(...inspect(file, fs.readFileSync(path.join(root, file), "utf8")));
	}

	if (problems.length > 0) {
		console.error(`❌ .env 模板里有 dsh 不许的键 ${problems.length} 条：`);
		for (const problem of problems) {
			console.error(`   - ${problem}`);
		}
		process.exit(1);
	}
	console.log(`✅ .env 模板干净（查了 ${templates.length} 份：${templates.join(" · ")}）`);
	process.exit(0);
}

/** 仓根模式：真检查。 */
if (process.argv.includes("--root") || !require.main) {
	main();
} else {
	/* ---------------------------------------------------------------- *
	 * 负例（证明守卫真的会拦）
	 * ---------------------------------------------------------------- */

	console.log("① 真的模板 ⇒ 必须干净");
	{
		const { code, output } = runGuard(REPO_ROOT);
		check("仓里的 .env 模板没有 DSH_ 键", code === 0, output.trim().slice(0, 400));
	}

	console.log("② 模板里写 DSH_BASE_URL ⇒ 必须被拦");
	{
		const problems = inspect(".env.example", "DEEPSEEK_API_KEY=\nDSH_BASE_URL=https://x.test/v1\n");
		check("被拦下", problems.length === 1, JSON.stringify(problems));
		check("报出了键名", problems.some((text) => text.includes("DSH_BASE_URL")), problems.join(";"));
	}

	console.log("③ 注释掉的示例 `# DSH_MODEL=…` 也算（它就是在教人配）");
	{
		const problems = inspect(".env.example", "# DSH_MODEL=deepseek-chat\n");
		check("被拦下", problems.length === 1, JSON.stringify(problems));
	}

	console.log("④ 叙述性的注释（不带 `=`）⇒ 允许（`DSH_HOME` 是 dsh 自己认的名字）");
	{
		const problems = inspect(".env.example", "# 缺省 <DSH_HOME>/dsh-admin\nDSH_HOME_DIR=\n");
		check("只拦带 `=` 的 DSH_ 键", problems.length === 1 && problems[0].includes("DSH_HOME_DIR"), JSON.stringify(problems));
	}

	console.log("⑤ 大小写混写 ⇒ 也要拦（dsh 是大小写不敏感地比前缀）");
	{
		const problems = inspect(".env.example", "Dsh_Model=x\n");
		check("被拦下", problems.length === 1, JSON.stringify(problems));
	}

	console.log("⑥ AI_DSH_* 与别的 AI_* ⇒ 干净");
	{
		const problems = inspect(
			".env.example",
			"DEEPSEEK_API_KEY=\nAI_DSH_MODEL=deepseek-chat\nAI_MODEL=x\nAIADMIN_MCP_URL=\n",
		);
		check("干净", problems.length === 0, JSON.stringify(problems));
	}

	console.log("⑦ 在真模板上改坏 ⇒ 守卫真的亮红（端到端负例）");
	{
		const os = require("node:os");
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-env-names-"));
		// 造一个最小 git 仓 + 一份改坏的模板
		execFileSync("git", ["init", "-q"], { cwd: temp });
		fs.writeFileSync(path.join(temp, ".env.example"), "DSH_BASE_URL=https://x.test/v1\n");
		execFileSync("git", ["add", "-A"], { cwd: temp });
		const { code, output } = runGuard(temp);
		check("退出码非 0", code !== 0, `退出码=${code}`);
		check("报出了 DSH_BASE_URL", output.includes("DSH_BASE_URL"), output.slice(0, 300));
		fs.rmSync(temp, { recursive: true, force: true });
	}

	const failed = results.filter((result) => !result.ok);
	console.log(
		failed.length === 0
			? `✅ .env 变量名守卫全过（${results.length} 条）`
			: `❌ .env 变量名守卫失败 ${failed.length} 条（共 ${results.length} 条）`,
	);
	process.exit(failed.length === 0 ? 0 : 1);
}
