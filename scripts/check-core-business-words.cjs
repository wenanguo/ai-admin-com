/**
 * 内核**业务词**检查 —— `core/**` 的**代码**里不许出现业务词。
 *
 * ## 为什么要有它
 *
 * 目录拆分的判据是「**内核不认识 PM**」⇒ 内核的代码里不该出现
 * 业务字段名 / 表名 / 枚举 / 业务接口路径。
 *
 * ## 为什么**剥掉注释**再查
 *
 * ⚠️ 注释里出现业务名词是**正常的**（那是文档：说明这个内核目前接的是哪个业务系统）⇒
 *    直接 grep 全文会命中一百多处 ⇒ 要么白名单一大片（等于没查），
 *    要么把文档也逼成「上游」（可读性掉一截）。
 * ⇒ 这里只查**代码**（剥掉行注释与块注释之后的部分）⇒ 查出来的一定是「真依赖」。
 *
 * ## 允许清单（白名单）
 *
 * - `core/env/env.ts` —— `AIADMIN_*` 这几个**环境变量名**还在内核里
 *   （设计 §12.3 说「由插件声明」⇒ 挪它要连带健康检查探针与 MCP 默认地址
 *   ⇒ 那是**阶段 4 接线**的活）⇒ 先列入白名单，别假装它已经干净了。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-core-business-words.cjs              # 查仓里的 core/
 * node scripts/check-core-business-words.cjs <core 目录>  # 查指定目录（测试用）
 * ```
 *
 * 退出码：0 = 干净；1 = 有业务词（并打印每一条）。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
/** 要查的目录（可传参 ⇒ 测试能造临时的目录）。 */
const coreDir = process.argv[2]
	? path.resolve(process.argv[2])
	: path.join(repoRoot, "backend/ai/src/core");

/** 业务词（issue #82 的判据 ①）。 */
const BUSINESS_WORDS = [
	"AiAdmin",
	"aipm",
	"AIADMIN",
	"pm_task",
	"pm_project",
	"module_pm",
	"任务",
	"项目",
	"里程碑",
	"风险",
];

/**
 * 允许清单：`<相对路径>` ⇒ 原因。
 *
 * ⚠️ 每一条都要写清**为什么**，并**在阶段 5 之前清掉**。
 *
 * ✅ **现在是空的** —— 阶段 5 把 `AIADMIN_*` 挪进插件之后，内核真的零业务词了。
 */
const ALLOWLIST = new Map([
	// （空 ⇒ 没有豁免）
]);

/** 收集目录下的所有 .ts 文件。 */
function tsFiles(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...tsFiles(full));
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			// ⚠️ **测试文件不算**：那里的业务词是**夹具**（模拟上游的载荷）
			//    ⇒ 内核的**代码**没有依赖它。
			out.push(full);
		}
	}
	return out;
}

/**
 * 剥掉注释（**只留代码**）。
 *
 * ⚠️ 粗糙但够用：字符串里的 `//` 会被误当注释（⇒ 少查，不会误报）。
 */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
}

const violations = [];
for (const file of tsFiles(coreDir)) {
	const relative = path.relative(repoRoot, file).split(path.sep).join("/");
	const allowance = ALLOWLIST.get(relative);
	const code = stripComments(fs.readFileSync(file, "utf8"));
	for (const word of BUSINESS_WORDS) {
		if (!code.includes(word)) {
			continue;
		}
		if (allowance !== undefined) {
			continue;
		}
		const lines = code
			.split("\n")
			.map((line, index) => ({ line, index: index + 1 }))
			.filter((item) => item.line.includes(word));
		for (const item of lines) {
			violations.push({ file: relative, word, line: item.index });
		}
	}
}

if (violations.length > 0) {
	console.error("❌ 内核里有业务词（内核不认识业务 ⇒ 代码里不该出现）");
	for (const violation of violations) {
		console.error(`   · ${violation.file}:${violation.line} 「${violation.word}」`);
	}
	console.error(
		"\n（注释不算 —— 已经剥掉了；测试夹具也不算 ⇒ 见脚本头的说明。）",
	);
	process.exit(1);
}

const allowed = [...ALLOWLIST.entries()].map(
	([file, reason]) => `   · ${file} —— ${reason}`,
);
console.log(`✅ 内核无业务词（${BUSINESS_WORDS.length} 个词，剥掉注释后查）`);
if (allowed.length > 0) {
	console.log("允许清单（暂时豁免）：");
	for (const line of allowed) {
		console.log(line);
	}
}
