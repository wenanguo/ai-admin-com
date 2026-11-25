/**
 * 静态验收（issue #169）：**AI 部分减法 —— 只留 DSH 代码**。
 *
 * ## 为什么要有它
 *
 * 这一轮减法（S2 技能 / S3 命令工具 / S4 session 瘦身）动的是**对外契约的边缘**
 * ⇒ 光靠单测钉不住「我们又自己造了一遍 dsh 的轮子」⇒ 这里把**能静态断言的**都钉死。
 *
 * ## 钉住的事
 *
 * | # | 断言 | 为什么 |
 * | - | ---- | ------ |
 * | 1 | `core/skills/` **不存在** | 技能目录归位给 dsh（我们自己那份是第二份真相） |
 * | 2 | `core/tools/` **不存在** | 命令工具归位给 **MCP 工具形状**（框架里的机制删掉，业务留下） |
 * | 3 | **SSE 事件词汇一字不变** | 前端按这几种写 ⇒ **前端 0 改动**的前提 |
 * | 4 | 实现行数比基线少 **≥ 1 800 行** | 这一轮减法的**量化目标** |
 * | 5 | 内核里**没有**自研 provider / 技能 loader | 「只有 DSH 代码」的底线（细口径见 `check-dsh-boundary.cjs`） |
 *
 * 用法：`node scripts/e2e/ai-subtraction.static.cjs`（在仓根跑）。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const aiRoot = path.join(repoRoot, "backend", "ai");
const coreDir = path.join(aiRoot, "src", "core");

/** 失败信息（收集起来 ⇒ 一次性报）。 */
const failures = [];

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

/** 读文件（不存在 ⇒ undefined）。 */
function read(file) {
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/* ------------------------------------------------------------------ *
 * ① ② 三个目录的归宿
 * ------------------------------------------------------------------ */

console.log("① 目录的归宿（core/skills · core/tools）");
check("`core/skills/` 不存在了（技能目录归位给 dsh）", !fs.existsSync(path.join(coreDir, "skills")));
check("`core/tools/` 不存在了（命令工具归位给 MCP 工具形状）", !fs.existsSync(path.join(coreDir, "tools")));

/* ------------------------------------------------------------------ *
 * ③ SSE 事件词汇（一字不变）
 * ------------------------------------------------------------------ */

console.log("② SSE 事件词汇（前端契约）");
const eventsSource = read(path.join(coreDir, "session", "events.ts")) ?? "";
check("`core/session/events.ts` 还在", eventsSource.length > 0);

/**
 * **前端按这几种写**（别多也别少）—— 抄一份在脚本里 ⇒ 改词就会红。
 *
 * ⚠️ 与 `core/session/events.ts` 的 `SSE_EVENTS` 一一对应。
 */
const EXPECTED_SSE_EVENTS = [
	"connected",
	"message_start",
	"text_delta",
	"thinking_delta",
	"message_end",
	"tool_call",
	"tool_result",
	"agent_settled",
	"pending",
	"entity_updated",
];
for (const name of EXPECTED_SSE_EVENTS) {
	check(`SSE 事件「${name}」还在`, eventsSource.includes(`"${name}"`));
}
check(
	"SSE 事件**不多**（就这 10 种）",
	(eventsSource.match(/^\t[A-Z_]+: "/gm) ?? []).length === EXPECTED_SSE_EVENTS.length,
	`找到 ${(eventsSource.match(/^\t[A-Z_]+: "/gm) ?? []).length} 个`,
);

/* ------------------------------------------------------------------ *
 * ④ 行数（这一轮的量化目标）
 * ------------------------------------------------------------------ */

console.log("③ 实现行数（这一轮减了多少）");
/**
 * **基线**（issue #169 开工前，`main` 上的 `src/core` 实现行数）。
 *
 * 量法与 issue 一致：`find src/core -name '*.ts' ! -name '*.test.ts' -exec cat {} + | wc -l`
 */
const BASELINE_IMPL_LINES = 10067;
/** 这一轮的目标（issue #169 的验收标准 6）。 */
const TARGET_REDUCTION = 1800;

/** 数 `src/core` 下的实现行数（**不含测试**）。 */
function countImplLines(dir) {
	let total = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			total += countImplLines(full);
			continue;
		}
		if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
			continue;
		}
		total += fs.readFileSync(full, "utf8").split("\n").length;
	}
	return total;
}

const implLines = countImplLines(coreDir);
const reduction = BASELINE_IMPL_LINES - implLines;
check(
	`实现行数比基线少 ≥ ${TARGET_REDUCTION} 行`,
	reduction >= TARGET_REDUCTION,
	`基线 ${BASELINE_IMPL_LINES} ⇒ 现在 ${implLines}（少了 ${reduction} 行）`,
);
console.log(`    （基线 ${BASELINE_IMPL_LINES} ⇒ 现在 ${implLines}，少了 ${reduction} 行）`);

/* ------------------------------------------------------------------ *
 * ⑤ 「只有 DSH 代码」的底线
 * ------------------------------------------------------------------ */

console.log("④ 底线（没有自己造轮子）");
const coreFiles = [];
(function collect(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collect(full);
			continue;
		}
		if (entry.name.endsWith(".ts")) {
			coreFiles.push(full);
		}
	}
})(coreDir);
const coreSource = coreFiles.map((file) => read(file) ?? "").join("\n");
check(
	"内核里没有**自研 provider**（`registerProvider` / `OpenAiCompatibleAdapter`）",
	!coreSource.includes("registerProvider") && !coreSource.includes("OpenAiCompatibleAdapter"),
);
check(
	"内核里没有**自研技能 loader**（`loadSkills` / `load_skill`）",
	!coreSource.includes("loadSkills") && !coreSource.includes("load_skill"),
);
check(
	"内核里没有**我们自己写的命令机制**（`buildCommandTools` / `CommandDefinition`）",
	!coreSource.includes("buildCommandTools") && !coreSource.includes("CommandDefinition"),
);

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

if (failures.length > 0) {
	console.error(`\n❌ 失败 ${failures.length} 条：`);
	for (const failure of failures) {
		console.error(`   - ${failure}`);
	}
	process.exit(1);
}
console.log("\n✅ AI 减法（静态断言）：全部通过");
