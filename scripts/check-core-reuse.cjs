/**
 * 「只用公开入口」检查 —— **内核复用的验收**（issue #116）。
 *
 * | 档 | 查什么 | 怎么查 |
 * | -- | ------ | ------ |
 * | **第一档** | 示例系统**只从内核的公开入口** import | 解析 import 说明符 ⇒ 算出落点 |
 * | **第二档** | 示例系统**不碰 AiAdmin**（代码 / 配置 / 编排里都不许出现） | 全文找关键字 |
 * | **第三档** | 示例的 compose 里**没有 aiadmin 服务** | 读编排文件 |
 *
 * ## 为什么要有它
 *
 * 「内核可复用」这句话，只有**第二个使用方**用起来才算数（issue #116 的验收点）。
 * 而「只用公开入口」是复用的**前提**：
 * 示例一旦 import 了 `core/session/...` 这种内部路径 ⇒ 内核一改内部结构，示例就崩
 * ⇒ 「公开入口」那张契约就形同虚设。
 *
 * ⇒ 这条检查把那条前提**钉死**（进 CI），不靠人盯。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-core-reuse.cjs                    # 查仓里的示例
 * node scripts/check-core-reuse.cjs <示例目录>          # 查指定目录
 * ```
 *
 * 退出码：0 = 全部干净；1 = 有违规（并打印每一条）。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const exampleDirArg = argv.find((arg) => !arg.startsWith("--"));
const exampleDir = path.resolve(
	exampleDirArg ?? path.join(repoRoot, "backend/ai/examples/reading-notes"),
);

/** 内核的公开入口（相对仓根，**正斜杠**）。 */
const CORE_PUBLIC_ENTRY = "backend/ai/src/core/index.ts";

/** 内核目录（相对仓根，正斜杠）。 */
const CORE_DIR = "backend/ai/src/core";

/** AI 服务的源码目录（内核的兄弟）—— 示例只许碰 `core/index.ts`。 */
const AI_SRC_DIR = "backend/ai/src";

/** 不许出现的关键字（示例系统与 AiAdmin 无关）。 */
const FORBIDDEN_WORDS = ["aiadmin", "aipm"];

/** 收集目录下的所有文件（递归）。 */
function allFiles(dir) {
	const out = [];
	if (!fs.existsSync(dir)) {
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") {
				continue;
			}
			out.push(...allFiles(full));
		} else {
			out.push(full);
		}
	}
	return out;
}

/** 相对仓根的路径（正斜杠）。 */
function rel(file) {
	return path.relative(repoRoot, file).split(path.sep).join("/");
}

/** 抽出文件里的**相对**模块说明符。 */
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

/* ------------------------------------------------------------------ *
 * 第一档：示例只从内核的公开入口进
 * ------------------------------------------------------------------ */

/** @type {{file: string, specifier: string, target: string, why: string}[]} */
const entryViolations = [];
/** 有没有真的用上公开入口（用来「正向断言」）。 */
let usesPublicEntry = false;

const tsFiles = allFiles(exampleDir).filter((file) => file.endsWith(".ts"));
for (const file of tsFiles) {
	const source = fs.readFileSync(file, "utf8");
	for (const specifier of relativeSpecifiers(source)) {
		const target = path.resolve(path.dirname(file), specifier);
		const targetRel = path.relative(repoRoot, target).split(path.sep).join("/");
		if (targetRel === CORE_PUBLIC_ENTRY) {
			usesPublicEntry = true;
			continue;
		}
		// ⚠️ 落点在 AI 服务的源码目录里 ⇒ 就是在碰内核（或它的壳）⇒ 只许 index.ts
		if (targetRel.startsWith(`${AI_SRC_DIR}/`) || targetRel.startsWith(`${CORE_DIR}/`)) {
			entryViolations.push({
				file: rel(file),
				specifier,
				target: targetRel,
				why: "只许从内核的公开入口（core/index.ts）import",
			});
		}
	}
}

/* ------------------------------------------------------------------ *
 * 第二档：示例不碰 AiAdmin
 * ------------------------------------------------------------------ */

/** @type {{file: string, word: string, line: number}[]} */
const wordViolations = [];

/** 要查的文本文件（代码 / 配置 / 编排；**说明文档不算**）。 */
const TEXT_EXTENSIONS = [".ts", ".yaml", ".yml", ".json", ".sh"];

for (const file of allFiles(exampleDir)) {
	const extension = path.extname(file);
	if (!TEXT_EXTENSIONS.includes(extension)) {
		continue;
	}
	const lines = fs.readFileSync(file, "utf8").split("\n");
	lines.forEach((line, index) => {
		const lowered = line.toLowerCase();
		for (const word of FORBIDDEN_WORDS) {
			if (lowered.includes(word)) {
				wordViolations.push({ file: rel(file), word, line: index + 1 });
			}
		}
	});
}

/* ------------------------------------------------------------------ *
 * 第三档：示例的编排里没有 aiadmin 服务
 * ------------------------------------------------------------------ */

/** @type {string[]} */
const composeViolations = [];

const composeFile = path.join(exampleDir, "docker-compose.yaml");
if (!fs.existsSync(composeFile)) {
	composeViolations.push(`找不到示例的编排文件：${rel(composeFile)}`);
} else {
	const source = fs.readFileSync(composeFile, "utf8");
	if (source.toLowerCase().includes("aiadmin")) {
		composeViolations.push(`${rel(composeFile)} 里出现了 aiadmin`);
	}
	// 服务名也要单独看一眼（万一有人把关键字拆开写）
	const serviceNames = [...source.matchAll(/^\s{2}([a-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
	for (const name of serviceNames) {
		if (name.toLowerCase().includes("aiadmin")) {
			composeViolations.push(`${rel(composeFile)} 里有 aiadmin 的服务：${name}`);
		}
	}
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

if (entryViolations.length > 0) {
	console.error("❌ 示例系统不是「只用公开入口」接入内核的");
	for (const violation of entryViolations) {
		console.error(
			`   · ${violation.file} ⇒ ${violation.specifier}（落到 ${violation.target}）—— ${violation.why}`,
		);
	}
	console.error(
		"\n内核的**唯一**公开入口是 `backend/ai/src/core/index.ts`；" +
			"内部路径（core/session/... 之类）**不是契约** ⇒ 换一个系统照样能用，靠的就是这条。",
	);
}

if (!usesPublicEntry) {
	console.error(
		"❌ 示例系统压根没 import 内核的公开入口（backend/ai/src/core/index.ts）—— 那它没在用内核。",
	);
}

if (wordViolations.length > 0) {
	console.error("❌ 示例系统里出现了 AiAdmin 的痕迹（它不该依赖 AiAdmin）");
	for (const violation of wordViolations) {
		console.error(`   · ${violation.file}:${violation.line} 「${violation.word}」`);
	}
}

if (composeViolations.length > 0) {
	console.error("❌ 示例系统的编排里不该有 AiAdmin");
	for (const violation of composeViolations) {
		console.error(`   · ${violation}`);
	}
}

if (
	entryViolations.length > 0 ||
	wordViolations.length > 0 ||
	composeViolations.length > 0 ||
	!usesPublicEntry
) {
	process.exit(1);
}

console.log(`✅ 示例系统只用公开入口接入内核：${rel(exampleDir)}`);
console.log(`✅ 示例系统不碰 AiAdmin（代码 / 配置 / 编排里都没有 ${FORBIDDEN_WORDS.join("、")}）`);
console.log(`✅ 示例系统的编排里没有 aiadmin 服务`);
