/**
 * 静态验收（issue #180）：**减法摸底清单** —— 清单与代码**不许漂**。
 *
 * ## 为什么要有它
 *
 * issue #180 只出**一份清单**（不改产品代码）⇒ 清单里的**行数**一旦与代码脱节，
 * 它就从「可决策的清单」变成「骗人的数字」⇒ 这里把**能机器查的部分**钉死：
 *
 * | # | 断言 | 为什么 |
 * | - | ---- | ------ |
 * | 1 | 清单**逐文件覆盖** `backend/ai/src/core` 的每一个实现文件（不多不少） | 「逐文件清单」是本条的交付物 ⇒ 漏一个文件 = 清单不完整 |
 * | 2 | 每个文件的**行数与代码一致**（wc -l 口径） | 行数是清单的主干 ⇒ 数字错了整份清单就没法用 |
 * | 3 | 分类**只能是三个**（必须留 / 还能退给 dsh / 死代码） | 分类是本条的核心产出 ⇒ 出现第四种说法 = 口径破了 |
 * | 4 | 「还能退给 dsh」的行**必须写出去处**（dsh 包/协议/RPC） | issue 的验收：逐条给出具体退法 ⇒ 没写 = 没做 |
 * | 5 | 「死代码」的行**必须给证据**（grep） | 判「没人用」要证据 ⇒ 否则只是「没人敢删」的原样 |
 * | 6 | 「预计可减行数」的**合计 == 清单里承诺的数字** | 承诺的数字必须能从表里算出来 ⇒ 不许口头拍 |
 * | 7 | 清单**回答了 issue 的四个问题** | 四个问题是本条的验收项 |
 * | 8 | 本 PR **没改产品代码**（`backend/ai/src/**` 与 `frontend/src/**`） | issue 的硬约束：不改产品代码 · 前端 0 改动 |
 *
 * 用法：`node scripts/e2e/ai-subtraction-inventory.static.cjs`（在仓根跑）。
 *
 * ⚠️ 断言 8 需要 `origin/main`（要 `git fetch-depth: 0`）⇒ 拿不到时**只警告并跳过**
 *    （与 `scripts/e2e/node-version.static.cjs` 同一套路）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const coreDir = path.join(repoRoot, "backend", "ai", "src", "core");
/** 清单的路径（issue #180 的交付物）。 */
const INVENTORY_PATH = path.join(repoRoot, "docs", "pm", "减法摸底-逐文件清单.md");

/** 失败信息（收集起来 ⇒ 一次性报）。 */
const failures = [];
/** 警告信息（拿不到基线分支等 ⇒ 不红，只提醒）。 */
const warnings = [];

/**
 * 断言。
 *
 * @param {string} label 用例名。
 * @param {boolean} ok 通过？
 * @param {string} [detail] 失败时的细节。
 */
function check(label, ok, detail) {
	if (ok) {
		console.log(`  ✓ ${label}`);
		return;
	}
	console.error(`  ✗ ${label}${detail === undefined ? "" : ` —— ${detail}`}`);
	failures.push(detail === undefined ? label : `${label} —— ${detail}`);
}

/**
 * 数一个文件的行数（**与 `wc -l` 一致** ⇒ 数换行符）。
 *
 * ⚠️ 与 `scripts/e2e/ai-subtraction.static.cjs` 同一个口径（数换行符，不是 split 的长度）。
 *
 * @param {string} file 文件路径。
 * @returns {number} 行数。
 */
function countLines(file) {
	return (fs.readFileSync(file, "utf8").match(/\n/g) ?? []).length;
}

/* ------------------------------------------------------------------ *
 * ① 清单文件在不在
 * ------------------------------------------------------------------ */

console.log("① 清单文件");
check("`docs/pm/减法摸底-逐文件清单.md` 在库里", fs.existsSync(INVENTORY_PATH));
if (!fs.existsSync(INVENTORY_PATH)) {
	console.error("\n❌ 失败：清单文件不在 ⇒ 后面没法查");
	process.exit(1);
}
const inventory = fs.readFileSync(INVENTORY_PATH, "utf8");

/* ------------------------------------------------------------------ *
 * ② 逐文件覆盖 + 行数一致
 * ------------------------------------------------------------------ */

/** 实现文件（**不含测试**）的相对路径集合。 */
const implFiles = [];
(function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full);
			continue;
		}
		if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
		implFiles.push(path.relative(repoRoot, full).replace(/\\/g, "/"));
	}
})(coreDir);

console.log("② 逐文件覆盖与行数");
/**
 * 清单里的一行（**整行**都要 ⇒ 后面按格取字段）。
 *
 * ⚠️ 分类那一格可能带 markdown 强调（`**必须留**`）⇒ 取值前先去掉 `*`。
 */
const ROW = /^\|\s*`(backend\/ai\/src\/core\/[^`]+)`\s*\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|(.*)$/gm;
const rows = [];
let match = ROW.exec(inventory);
while (match !== null) {
	rows.push({
		file: match[1],
		lines: Number(match[2]),
		kind: match[3].replace(/[*`]/g, "").trim(),
		raw: match[0],
	});
	match = ROW.exec(inventory);
}

check(
	`清单里的行数条数 == 实现文件数（${implFiles.length}）`,
	rows.length === implFiles.length,
	`清单里有 ${rows.length} 条`,
);

const listed = new Map(rows.map((row) => [row.file, row]));
for (const file of implFiles) {
	const row = listed.get(file);
	if (row === undefined) {
		check(`清单里有 \`${file}\``, false, "缺这一行");
		continue;
	}
	const actual = countLines(path.join(repoRoot, file));
	check(`\`${file}\` 的行数对（${actual}）`, row.lines === actual, `清单写的是 ${row.lines}`);
}
for (const row of rows) {
	if (!implFiles.includes(row.file)) {
		check(`清单里的 \`${row.file}\` 是真实文件`, false, "清单里有个不存在的文件");
	}
}

/* ------------------------------------------------------------------ *
 * ③ 分类只能是三个 + 退法 / 证据
 * ------------------------------------------------------------------ */

console.log("③ 分类口径");
const KINDS = ["必须留", "还能退给 dsh", "死代码"];
for (const row of rows) {
	check(
		`\`${row.file}\` 的分类合法（${row.kind}）`,
		KINDS.includes(row.kind),
		`只许这三种：${KINDS.join(" / ")}`,
	);
}

/**
 * 取表格里某一行的**某一格**。
 *
 * @param {string} raw 整行的 markdown 文本。
 * @param {number} index 格序号（0 = 文件列）。
 * @returns {string} 格里的文字（去掉了强调标记与空白）。
 */
function cell(raw, index) {
	const parts = raw.split("|").slice(1);
	return (parts[index] ?? "").replace(/[`*]/g, "").trim();
}

for (const row of rows) {
	if (row.kind === "还能退给 dsh") {
		const retreat = cell(row.raw, 4);
		check(
			`\`${row.file}\` 写了退法`,
			retreat.length > 0 && retreat !== "—" && retreat !== "-",
			"「还能退给 dsh」必须写出去处（dsh 包 / 协议 / RPC）",
		);
		check(
			`\`${row.file}\` 的退法指到了 dsh`,
			/dsh[-@]/.test(retreat),
			`退法里没提 dsh 的包/协议：${retreat}`,
		);
	}
	if (row.kind === "死代码") {
		const reason = cell(row.raw, 3);
		check(
			`\`${row.file}\` 的死代码判据带证据`,
			reason.includes("grep") || reason.includes("无引用"),
			"判「没人用」要给 grep 证据",
		);
	}
}

/* ------------------------------------------------------------------ *
 * ④ 承诺的减法行数 == 表里合计
 * ------------------------------------------------------------------ */

console.log("④ 可承诺的减法行数");
let sum = 0;
let sumFailed = false;
for (const row of rows) {
	const value = Number(cell(row.raw, 5));
	if (!Number.isFinite(value)) {
		sumFailed = true;
		check(`\`${row.file}\` 的「预计可减行数」是数字`, false, cell(row.raw, 5));
		continue;
	}
	if (value < 0 || value > row.lines) {
		sumFailed = true;
		check(
			`\`${row.file}\` 的「预计可减行数」合理（0 ≤ v ≤ ${row.lines}）`,
			false,
			`写的是 ${value}`,
		);
	}
	sum += value;
}
if (!sumFailed) {
	// 清单里承诺的数字（形如「**承诺：可减 1 234 行**」⇒ 抓第一个数字）。
	const promised = inventory.match(/承诺[：:]\s*可减\s*([\d\s]+?)\s*行/);
	check("清单里写了承诺的减法行数", promised !== null);
	if (promised !== null) {
		const promisedNumber = Number(promised[1].replace(/[\s,]/g, ""));
		check(
			`承诺的数字（${promisedNumber}）== 表里合计（${sum}）`,
			promisedNumber === sum,
			"承诺的数字必须能从表里算出来",
		);
	}
}

/* ------------------------------------------------------------------ *
 * ⑤ 四个问题都回答了
 * ------------------------------------------------------------------ */

console.log("⑤ issue 的四个问题");
for (const question of [
	"runtime.ts",
	"core/store/",
	"core/session/",
	"还能减多少行",
]) {
	check(`清单回答了「${question}」`, inventory.includes(question));
}

/* ------------------------------------------------------------------ *
 * ⑥ 本 PR 不改产品代码 / 前端 0 改动
 * ------------------------------------------------------------------ */

console.log("⑥ 不改产品代码 · 前端 0 改动");
/**
 * 拿基线分支（`origin/main`）比对本 PR 改了哪些文件。
 *
 * ⚠️ 拿不到（浅克隆 / 没有 origin/main）⇒ **只警告并跳过**（不红）。
 *
 * @returns {string[] | undefined} 改动过的文件清单（拿不到 ⇒ undefined）。
 */
function changedFiles() {
	try {
		const output = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return output.split("\n").filter((line) => line.trim().length > 0);
	} catch {
		return undefined;
	}
}

const changed = changedFiles();
if (changed === undefined) {
	warnings.push("拿不到 `origin/main` ⇒ 断言「不改产品代码」已跳过");
	console.log("  ! 拿不到 origin/main ⇒ 跳过「不改产品代码」的核对");
} else {
	const productChanges = changed.filter(
		(file) => file.startsWith("backend/ai/src/") || file.startsWith("frontend/src/"),
	);
	check(
		"本 PR 没改产品代码（`backend/ai/src/**` · `frontend/src/**`）",
		productChanges.length === 0,
		`改动了：${productChanges.join("、")}`,
	);
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

if (warnings.length > 0) {
	console.log(`\n⚠️ 提醒 ${warnings.length} 条：`);
	for (const warning of warnings) {
		console.log(`   - ${warning}`);
	}
}

if (failures.length > 0) {
	console.error(`\n❌ 失败 ${failures.length} 条：`);
	for (const failure of failures) {
		console.error(`   - ${failure}`);
	}
	process.exit(1);
}
console.log("\n✅ 减法摸底清单（静态断言）：全部通过");
