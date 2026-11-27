/**
 * **闸门口径漂移守卫**（issue #195）—— 「哪些工具要人点头」**只有内核那一份**。
 *
 * ## 为什么要有它
 *
 * 「**新增放行、修改要点头**」这条口径（人 2026-11-06 定的）本来**散在两处**：
 *
 * - `backend/ai/src/core/gate/gate.ts`（内核的闸门）⇒ `update_` / `patch_` 要点头；
 * - `backend/ai/dsh-plugin/src/mcp.js`（**dsh 侧插件**）⇒ **又硬编码了一遍**。
 *
 * ⇒ 那是**同源的两份** ⇒ 改一处忘另一处 ⇒ **口径漂移** ⇒
 *    「修改已有数据要点头」这条规矩被**静默**绕过（不报错、不告警）。
 *
 * ⇒ 本守卫钉住三件事：
 *
 * | # | 断言 |
 * | - | ---- |
 * | 1 | **dsh 侧插件里不许有前缀字面量**（它**不判**「要不要人点头」⇒ 判定交回内核） |
 * | 2 | **插件必须问**（`tools/pre-execute` ⇒ `kind: 'ask'`）⇒ 判定交回内核 ⇒ 不许自己放行写工具 |
 * | 3 | **内核那一份还在**（`core/gate/gate.ts` 里 `update_` / `patch_` 都在 ⇒ 口径没被改小） |
 * | 4 | 前缀字面量**只许住在内核那两处**（闸门 + 审计）⇒ 全仓别的地方都不许有 |
 * | 5 | **负例自测**（三条）：插件又硬编码 / 插件不问了 / 内核口径被改小 ⇒ 守卫必须红 |
 *
 * ## 为什么内核有**两处**（不是一处）
 *
 * - `core/gate/gate.ts` ⇒ **闸门口径**（哪些工具要人点头）—— 本条要守的就是它；
 * - `core/session/event-bridge.ts` ⇒ **审计口径**（MCP 的哪些工具算「改了数据」⇒ 要留审计）
 *   —— **另一条规则**（issue #195 的「不做」栏：审计记录语义不许变 ⇒ 不许合并这两条）。
 *
 * ⇒ 守卫只保证「**没有第三处**」⇒ 尤其不许出现在 dsh 侧插件里（进程边界 ⇒ 改起来最危险）。
 *
 * ## 口径（为什么测试文件里可以出现那几个词）
 *
 * - **测试文件**里出现 `update_` / `patch_` 是**断言**（把口径钉住）⇒ **允许**；
 * - **注释**里出现是**文档** ⇒ **允许**；
 * - ⇒ 本守卫只查**实现文件**里的**字符串字面量**（`"update_"` 这种**恰好等于**前缀的写法）
 *   ⇒ 业务侧的工具全名（`"update_task"`）**不算**（那不是前缀）。
 *
 * ## ⚠️ **离线**（不联网、不装依赖 ⇒ 任何 runner 都能跑）
 *
 * 用法：
 *
 * ```bash
 * node scripts/e2e/gate-policy.static.cjs                    # 在仓根跑
 * node scripts/e2e/gate-policy.static.cjs --root <目录>      # 查别的目录（负例自测用）
 * ```
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");

/** dsh 侧插件（**判定交回内核** ⇒ 这里不该有口径）。 */
const PLUGIN_FILE = path.join("backend", "ai", "dsh-plugin", "src", "mcp.js");
/** 内核的闸门（**唯一一份**「哪些工具要人点头」）。 */
const GATE_FILE = path.join("backend", "ai", "src", "core", "gate", "gate.ts");
/** 内核的审计规则（**另一条**规则 ⇒ 允许有前缀字面量）。 */
const AUDIT_FILE = path.join("backend", "ai", "src", "core", "session", "event-bridge.ts");

/**
 * 前缀字面量**允许住的地方**（⇒ 别的地方一律不许有）。
 *
 * ⚠️ 每加一个都要**想清楚**（这是「口径只有一份」的最后一道闸）。
 */
const PREFIX_OWNERS = {
	[GATE_FILE.split(path.sep).join("/")]: "闸门口径（唯一一份：哪些工具要人点头）",
	[AUDIT_FILE.split(path.sep).join("/")]: "审计口径（另一条规则：MCP 的写要留审计）",
};

/** 闸门口径的两个前缀（**人 2026-11-06 定的** ⇒ 钉住）。 */
const ASK_PREFIXES = ["update_", "patch_"];

/** 要扫的源码目录（**仓根相对**）。 */
const SCAN_DIRS = [
	path.join("backend", "ai", "src"),
	path.join("backend", "ai", "dsh-plugin", "src"),
];

/**
 * 是不是**测试文件**（测试里允许出现那几个词 ⇒ 它们是断言，不是口径）。
 *
 * @param {string} file 相对路径（正斜杠）。
 * @returns {boolean}
 */
function isTestFile(file) {
	return /\.(test|spec)\.[cm]?[jt]s$/.test(file);
}

/**
 * 收集目录下的源码文件（**相对根的路径**）。
 *
 * @param {string} root 根目录。
 * @param {string} dir 相对目录。
 * @param {string[]} out 收集结果。
 * @returns {string[]} 收集结果。
 */
function collect(root, dir, out = []) {
	const full = path.join(root, dir);
	if (!fs.existsSync(full)) {
		return out;
	}
	for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
		const rel = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collect(root, rel, out);
		} else if (/\.[cm]?js$/.test(entry.name) || /\.ts$/.test(entry.name)) {
			out.push(rel);
		}
	}
	return out;
}

/**
 * 找出「**恰好等于**某个前缀」的字符串字面量（**注释里的不算**）。
 *
 * ⚠️ 只认**恰好等于**（`"update_"`）⇒ 业务侧的工具全名（`"update_task"`）**不算**。
 *
 * @param {string} source 文件内容。
 * @returns {{ prefix: string; index: number }[]} 命中的字面量。
 */
function prefixLiterals(source) {
	const hits = [];
	// ⚠️ **先剥掉注释**（`//` 与 `/* *\/`）⇒ 文档里提到前缀不算。
	const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	const pattern = /(['"`])(update_|patch_|create_)\1/g;
	let match;
	while ((match = pattern.exec(code)) !== null) {
		hits.push({ prefix: match[2], index: match.index });
	}
	return hits;
}

/**
 * 查一份根目录（**真的检查** ⇒ 负例自测也用它）。
 *
 * @param {string} root 根目录。
 * @returns {{ problems: string[]; notes: string[] }}
 */
function inspect(root) {
	const problems = [];
	const notes = [];

	// ① 前缀字面量只许住在内核那两处（**尤其是插件** ⇒ 那就是 #195 要收掉的那份）。
	const files = SCAN_DIRS.flatMap((dir) => collect(root, dir));
	for (const file of files) {
		if (isTestFile(file)) {
			continue;
		}
		const rel = file.split(path.sep).join("/");
		const source = fs.readFileSync(path.join(root, file), "utf8");
		for (const hit of prefixLiterals(source)) {
			if (PREFIX_OWNERS[rel] !== undefined) {
				continue;
			}
			const why =
				rel === PLUGIN_FILE.split(path.sep).join("/")
					? "（dsh 侧插件**不该判**「要不要人点头」⇒ 判定交回内核）"
					: "";
			problems.push(
				`${rel}：出现了前缀字面量「${hit.prefix}」${why}` +
					`（口径只有一份 ⇒ 只许住在 ${Object.keys(PREFIX_OWNERS).join(" / ")}）`,
			);
		}
	}
	notes.push(`扫了 ${files.length} 个源码文件`);

	// ② 插件**必须问**（判定交回内核 ⇒ 插件不许自己放行写工具）。
	const pluginPath = path.join(root, PLUGIN_FILE);
	const pluginRel = PLUGIN_FILE.split(path.sep).join("/");
	if (!fs.existsSync(pluginPath)) {
		problems.push(`${pluginRel}：dsh 侧插件不见了`);
	} else {
		const plugin = fs.readFileSync(pluginPath, "utf8");
		if (!plugin.includes("tools/pre-execute")) {
			problems.push(`${pluginRel}：没有挂在 tools/pre-execute 上 ⇒ MCP 的工具没人问`);
		}
		if (!/kind:\s*['"]ask['"]/.test(plugin)) {
			problems.push(
				`${pluginRel}：没有返回 kind: 'ask' ⇒ 插件自己放行了 ⇒ 「修改已有数据要点头」被绕过`,
			);
		}
	}

	// ③ 内核那一份还在（口径没被改小 ⇒ 结论不变）。
	const gatePath = path.join(root, GATE_FILE);
	const gateRel = GATE_FILE.split(path.sep).join("/");
	if (!fs.existsSync(gatePath)) {
		problems.push(`${gateRel}：内核的闸门不见了`);
	} else {
		const gate = fs.readFileSync(gatePath, "utf8");
		for (const prefix of ASK_PREFIXES) {
			if (!prefixLiterals(gate).some((hit) => hit.prefix === prefix)) {
				problems.push(
					`${gateRel}：口径里没有「${prefix}」⇒ 闸门被改小了（要人点头的判定会变）`,
				);
			}
		}
	}

	return { problems, notes };
}

/** 跑一次检查（**子进程** ⇒ 负例自测要用它的退出码）。 */
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

/** 造一份「只含关键文件」的副本（负例自测用 ⇒ 改坏的地方能被守卫看见）。 */
function copySkeleton(temp, files) {
	for (const rel of files) {
		const target = path.join(temp, rel);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(path.join(repoRoot, rel), target);
	}
}

/** 真检查（也是负例子进程被调用的那个模式）。 */
function main() {
	const rootIndex = process.argv.indexOf("--root");
	const root = rootIndex === -1 ? repoRoot : path.resolve(process.argv[rootIndex + 1]);
	const { problems, notes } = inspect(root);
	if (problems.length > 0) {
		console.error(`❌ 闸门口径不止一份（${problems.length} 条）：`);
		for (const problem of problems) {
			console.error(`   - ${problem}`);
		}
		console.error(
			"\n   为什么这很要紧：口径漂移 ⇒ 「修改已有数据要点头」被**静默**绕过（不报错、不告警）",
		);
		process.exit(1);
	}
	console.log(`✅ 闸门口径只有内核那一份（${notes.join(" · ")}）`);
	process.exit(0);
}

/* ------------------------------------------------------------------ *
 * 负例（证明守卫真的会拦）
 * ------------------------------------------------------------------ */

if (process.argv.includes("--root") || !require.main) {
	main();
} else {
	const SKELETON = [PLUGIN_FILE, GATE_FILE, AUDIT_FILE];
	const results = [];
	function check(label, ok, detail) {
		results.push({ label, ok });
		console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` —— ${detail ?? ""}`}`);
	}

	console.log("① 真的仓 ⇒ 必须干净");
	{
		const { code, output } = runGuard(repoRoot);
		check("仓里的口径只有内核那一份", code === 0, output.trim().slice(0, 600));
	}

	console.log("② 插件又硬编码了一遍前缀 ⇒ 必须被拦");
	{
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-policy-"));
		copySkeleton(temp, SKELETON);
		// ⚠️ **注入第二份口径**（插件又自己判了一遍）。
		const pluginPath = path.join(temp, PLUGIN_FILE);
		const plugin = fs.readFileSync(pluginPath, "utf8");
		fs.writeFileSync(
			pluginPath,
			plugin.replace(
				"export function registerGate(ctx) {",
				"export function registerGate(ctx) {\n\tconst legacy = (name) => name.startsWith('update_')",
			),
			"utf8",
		);
		const { code, output } = runGuard(temp);
		check("退出码非 0", code !== 0, `退出码=${code}`);
		check("报出了插件这个文件", output.includes("mcp.js"), output.slice(0, 400));
		check("报出了那个前缀", output.includes("update_"), output.slice(0, 400));
		fs.rmSync(temp, { recursive: true, force: true });
	}

	console.log("③ 插件不问了（自己放行）⇒ 必须被拦");
	{
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-policy-"));
		copySkeleton(temp, SKELETON);
		const pluginPath = path.join(temp, PLUGIN_FILE);
		const plugin = fs.readFileSync(pluginPath, "utf8");
		fs.writeFileSync(pluginPath, plugin.replace(/kind:\s*'ask'/g, "kind: 'allow'"), "utf8");
		const { code, output } = runGuard(temp);
		check("退出码非 0", code !== 0, `退出码=${code}`);
		check("报出了没有 ask", output.includes("kind: 'ask'"), output.slice(0, 400));
		fs.rmSync(temp, { recursive: true, force: true });
	}

	console.log("④ 内核的口径被改小 ⇒ 必须被拦");
	{
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-policy-"));
		copySkeleton(temp, SKELETON);
		const gatePath = path.join(temp, GATE_FILE);
		const gate = fs.readFileSync(gatePath, "utf8");
		fs.writeFileSync(
			gatePath,
			gate.replace(/bare\.startsWith\("update_"\)\s*\|\|\s*/, ""),
			"utf8",
		);
		const { code, output } = runGuard(temp);
		check("退出码非 0", code !== 0, `退出码=${code}`);
		check("报出了口径被改小", output.includes("口径里没有"), output.slice(0, 400));
		fs.rmSync(temp, { recursive: true, force: true });
	}

	const failed = results.filter((result) => !result.ok);
	console.log(
		failed.length === 0
			? `✅ 闸门口径漂移守卫全过（${results.length} 条）`
			: `❌ 闸门口径漂移守卫失败 ${failed.length} 条（共 ${results.length} 条）`,
	);
	process.exit(failed.length === 0 ? 0 : 1);
}
