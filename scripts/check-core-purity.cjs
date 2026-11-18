/**
 * 内核纯净度检查 —— **两档**：
 *
 * | 档 | 查什么 | 怎么查 |
 * | -- | ------ | ------ |
 * | **第一档** | `core/**` 不许 import `plugins/**` | 解析 import 说明符 ⇒ 算出落点 |
 * | **第二档** | `core/**` 的**代码**里不许出现**业务实体名** | 剥掉注释与字符串字面量 ⇒ 只查剩下的代码 |
 *
 * ## 为什么要有它
 *
 * 目录拆分的全部意义在于「内核不懂业务」⇒ 依赖方向必须是
 * **插件 → 内核**；内核一旦 import 插件，这个内核就绑死在那个业务上了
 * ⇒ 换个业务系统复用不了。
 *
 * ⚠️ **靠 grep 业务词查不出来**（注释里出现「任务」很正常）⇒
 *    第一档查的是**真实的 import 关系**（解析 import 说明符 ⇒ 算出落点）；
 *    第二档查的是**代码**（剥掉注释与字符串字面量 ⇒ 剩下的是标识符与结构）。
 *
 * ## 第二档：为什么「剥掉字符串字面量」
 *
 * 业务词在**注释**里出现是**正常的**（那是文档：说明这个内核目前接的是哪个业务系统）；
 * 在**字符串**里出现也常常是**正常的**（人话：「任务创建失败」这种提示文案）。
 * ⇒ 直接 grep 全文 ⇒ 一百多处命中 ⇒ 要么白名单一大片（等于没查），
 *   要么把文档与文案都逼成「上游」（可读性掉一截）。
 *
 * ⇒ 做法：**只查代码**（剥掉注释 + 字符串字面量 ⇒ 剩下的就是标识符 / 键名 / 结构）。
 *   ⚠️ 例外：**强业务标识**（表名 / 模块名，例如 `pm_task`）在字符串里也查
 *     —— 通用内核里没有它们的正常用法 ⇒ 出现就是**真依赖**。
 *
 * ## 允许清单（白名单）
 *
 * 确实需要提到业务词的**通用件**（例如某个环境变量名就长着业务词）⇒ 逐条豁免。
 * 清单在 [`core-business-words.allow.json`](./core-business-words.allow.json)：
 *
 * ```json
 * {
 *   "env/env.ts": { "words": ["aiadmin"], "reason": "为什么必须提（什么时候清掉）" }
 * }
 * ```
 *
 * - 键 = **相对 core 目录**的路径（`env/env.ts`）；
 * - `words` = 豁免哪些词（**只豁免这些词**⇒ 同文件别的业务词照样报）；
 * - `reason` = 为什么豁免（**必填** ⇒ 半年后有人看得懂为什么在这儿）。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-core-purity.cjs                      # 查仓里的 core/（两档）
 * node scripts/check-core-purity.cjs <core 目录>           # 查指定目录（测试用）
 * node scripts/check-core-purity.cjs <core 目录> --allowlist <清单文件>
 * ```
 *
 * 退出码：0 = 两档都干净；1 = 有违规（并打印每一条）。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
/** 参数：`<core 目录>` 与 `--allowlist <文件>`。 */
const argv = process.argv.slice(2);
const coreDirArg = argv.find((arg) => !arg.startsWith("--"));
const allowlistArgIndex = argv.indexOf("--allowlist");
const coreDir = coreDirArg
	? path.resolve(coreDirArg)
	: path.join(repoRoot, "backend/ai/src/core");
/** 插件目录 = core 的兄弟目录（core 与 plugins 是平级的）。 */
const pluginsDir = path.join(path.dirname(coreDir), "plugins");
/** 允许清单文件（默认在 scripts/ 下；测试可以另指一个）。 */
const allowlistFile =
	allowlistArgIndex >= 0 && argv[allowlistArgIndex + 1] !== undefined
		? path.resolve(argv[allowlistArgIndex + 1])
		: path.join(__dirname, "core-business-words.allow.json");

/** 收集目录下的所有 .ts 文件。 */
function tsFiles(dir) {
	const out = [];
	if (!fs.existsSync(dir)) {
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...tsFiles(full));
		} else if (entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

/**
 * 抽出文件里的**相对**模块说明符。
 *
 * 覆盖四种写法：`import x from "…"` · `export … from "…"` · `import("…")` · `vi.mock("…")`。
 */
function relativeSpecifiers(source) {
	const pattern =
		/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bvi\.(?:mock|doMock|unmock)\s*\(\s*)(["'])(\.[^"']+)\1/g;
	const out = [];
	let match;
	while ((match = pattern.exec(source)) !== null) {
		out.push(match[2]);
	}
	return out;
}

/** 落点是否在 plugins 目录里。 */
function isUnder(target, dir) {
	const relative = path.relative(dir, target);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/* ------------------------------------------------------------------ *
 * 第一档：依赖方向（core 不 import plugins）
 * ------------------------------------------------------------------ */

/** @type {{file: string, specifier: string, target: string}[]} */
const importViolations = [];
for (const file of tsFiles(coreDir)) {
	const source = fs.readFileSync(file, "utf8");
	for (const specifier of relativeSpecifiers(source)) {
		const target = path.resolve(path.dirname(file), specifier);
		if (isUnder(target, pluginsDir)) {
			importViolations.push({
				file: path.relative(repoRoot, file).split(path.sep).join("/"),
				specifier,
				target: path.relative(repoRoot, target).split(path.sep).join("/"),
			});
		}
	}
}

/* ------------------------------------------------------------------ *
 * 第二档：业务词（core 的代码里不许出现业务实体名）
 * ------------------------------------------------------------------ */

/**
 * 业务词（issue #82 的判据 ①）。
 *
 * ⚠️ `pattern` 是**大小写不敏感**的 ⇒ `AiAdmin` / `AIADMIN` / `aipm` 都算。
 * ⚠️ 中文词（任务 / 项目 / 里程碑 / 风险）只在**代码**里查（字符串与注释里放过）。
 */
const BUSINESS_WORDS = [
	{ word: "aiadmin", pattern: /aiadmin/i },
	{ word: "aipm", pattern: /aipm/i },
	{ word: "pm_task", pattern: /pm_task/i },
	{ word: "pm_project", pattern: /pm_project/i },
	{ word: "module_pm", pattern: /module_pm/i },
	{ word: "status_code", pattern: /status_code/i },
	{ word: "任务", pattern: /任务/ },
	{ word: "项目", pattern: /项目/ },
	{ word: "里程碑", pattern: /里程碑/ },
	{ word: "风险", pattern: /风险/ },
];

/**
 * **强业务标识** —— 连字符串里也不许出现。
 *
 * ⚠️ 这些是**表名 / 模块名 / 字段名**（`pm_task`、`status_code`……）
 *    ⇒ 通用内核里没有它们的正常用法 ⇒ 在字符串里出现就是**真依赖**。
 */
const STRONG_BUSINESS_WORDS = BUSINESS_WORDS.filter((entry) =>
	["pm_task", "pm_project", "module_pm", "aipm", "status_code"].includes(entry.word),
);

/**
 * 把源码拆成「**代码**」与「**字符串字面量**」两块（注释两边都去掉）。
 *
 * @param source 源码全文。
 * @returns `{ code, strings }`：`code` = 去掉注释与字符串内容后的代码（行数不变 ⇒ 行号可对）；
 *   `strings` = 每个字符串字面量 `{ text, line }`。
 */
function splitCodeAndStrings(source) {
	const code = [];
	const strings = [];
	let index = 0;
	let line = 1;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		// 行注释
		if (char === "/" && next === "/") {
			while (index < source.length && source[index] !== "\n") {
				code.push(" ");
				index += 1;
			}
			continue;
		}
		// 块注释
		if (char === "/" && next === "*") {
			code.push("  ");
			index += 2;
			while (
				index < source.length &&
				!(source[index] === "*" && source[index + 1] === "/")
			) {
				if (source[index] === "\n") {
					line += 1;
				}
				code.push(source[index] === "\n" ? "\n" : " ");
				index += 1;
			}
			if (index < source.length) {
				code.push("  ");
				index += 2;
			}
			continue;
		}
		// 字符串字面量（单引号 / 双引号 / 模板串）
		if (char === '"' || char === "'" || char === "`") {
			const quote = char;
			const startLine = line;
			let text = "";
			code.push(" ");
			index += 1;
			while (index < source.length && source[index] !== quote) {
				if (source[index] === "\\") {
					text += source[index] + (source[index + 1] ?? "");
					index += 2;
					continue;
				}
				if (source[index] === "\n") {
					line += 1;
				}
				text += source[index];
				code.push(source[index] === "\n" ? "\n" : " ");
				index += 1;
			}
			if (index < source.length) {
				code.push(" ");
				index += 1;
			}
			strings.push({ text, line: startLine });
			continue;
		}
		if (char === "\n") {
			line += 1;
		}
		code.push(char);
		index += 1;
	}
	return { code: code.join(""), strings };
}

/**
 * 读允许清单（`<相对 core 目录的路径>` ⇒ `{ words, reason }`）。
 *
 * ⚠️ 文件不存在 ⇒ 当作空清单（不许因为清单缺失就崩 ⇒ 检查还得跑）。
 */
function loadAllowlist() {
	if (!fs.existsSync(allowlistFile)) {
		return new Map();
	}
	const parsed = JSON.parse(fs.readFileSync(allowlistFile, "utf8"));
	const out = new Map();
	for (const [key, value] of Object.entries(parsed)) {
		const words = Array.isArray(value?.words) ? value.words.map(String) : [];
		out.set(key, { words, reason: String(value?.reason ?? "") });
	}
	return out;
}

const allowlist = loadAllowlist();

/**
 * 这个文件里这些词是不是被豁免了。
 *
 * @param relativeToCore 相对 core 目录的路径（`env/env.ts`）。
 * @param word 命中的词。
 */
function isAllowed(relativeToCore, word) {
	const entry = allowlist.get(relativeToCore);
	return entry !== undefined && entry.words.includes(word);
}

/** @type {{file: string, line: number, word: string, where: string}[]} */
const wordViolations = [];
for (const file of tsFiles(coreDir)) {
	// ⚠️ **测试文件不算**：那里的业务词是**夹具**（模拟上游的载荷）
	//    ⇒ 内核的**代码**没有依赖它。
	if (file.endsWith(".test.ts")) {
		continue;
	}
	const relative = path.relative(repoRoot, file).split(path.sep).join("/");
	const relativeToCore = path.relative(coreDir, file).split(path.sep).join("/");
	const { code, strings } = splitCodeAndStrings(fs.readFileSync(file, "utf8"));
	const codeLines = code.split("\n");
	for (const entry of BUSINESS_WORDS) {
		for (let index = 0; index < codeLines.length; index += 1) {
			if (!entry.pattern.test(codeLines[index])) {
				continue;
			}
			if (isAllowed(relativeToCore, entry.word)) {
				continue;
			}
			wordViolations.push({
				file: relative,
				line: index + 1,
				word: entry.word,
				where: "代码",
			});
		}
	}
	for (const literal of strings) {
		for (const entry of STRONG_BUSINESS_WORDS) {
			if (!entry.pattern.test(literal.text)) {
				continue;
			}
			if (isAllowed(relativeToCore, entry.word)) {
				continue;
			}
			wordViolations.push({
				file: relative,
				line: literal.line,
				word: entry.word,
				where: "字符串",
			});
		}
	}
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

if (importViolations.length > 0) {
	console.error("❌ 内核不干净：`core/**` import 了 `plugins/**`");
	for (const violation of importViolations) {
		console.error(`   · ${violation.file} ⇒ ${violation.specifier}（落到 ${violation.target}）`);
	}
	console.error(
		"\n依赖方向只能是 **插件 → 内核**；内核要插件的东西 ⇒ 用**注册表 + 依赖注入**（见 core/plugins.ts）。",
	);
}

if (wordViolations.length > 0) {
	console.error("❌ 内核里有业务词（内核不认识业务 ⇒ 代码里不该出现）");
	for (const violation of wordViolations) {
		console.error(
			`   · ${violation.file}:${violation.line} 「${violation.word}」（${violation.where}）`,
		);
	}
	console.error(
		"\n注释与字符串字面量里的正常用法**不算**（已剥掉）；真要提 ⇒ 写进允许清单" +
			"（scripts/core-business-words.allow.json）并写清为什么。",
	);
}

if (importViolations.length > 0 || wordViolations.length > 0) {
	process.exit(1);
}

const coreRelative = path.relative(repoRoot, coreDir).split(path.sep).join("/");
console.log(`✅ 内核纯净：${coreRelative} 没有 import plugins/**`);
console.log(
	`✅ 内核无业务词：${BUSINESS_WORDS.length} 个词（剥掉注释与字符串后查代码 + 强业务标识查字符串）`,
);
const allowed = [...allowlist.entries()].map(
	([file, entry]) => `   · ${file} —— ${entry.words.join("、")}（${entry.reason}）`,
);
if (allowed.length > 0) {
	console.log("允许清单（暂时豁免）：");
	for (const line of allowed) {
		console.log(line);
	}
}
