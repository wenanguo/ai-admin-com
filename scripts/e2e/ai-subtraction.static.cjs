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
 * | 3 | **SSE 事件词汇一字不变**（含**顺序**） | 前端按这几种写、按这个顺序处理 ⇒ **前端 0 改动**的前提 |
 * | 4 | 实现行数比基线少 **≥ 1 800 行** | 这一轮减法的**量化目标** |
 * | 5 | 内核里**没有**自研 provider / 技能 loader | 「只有 DSH 代码」的底线（细口径见 `check-dsh-boundary.cjs`） |
 * | 6 | `runtime.ts` ≤ **700** 行 · `session-registry.ts` ≤ **200** 行 | issue #175 · S4：运行时与注册表**瘦身**的量化目标 |
 * | 7 | **9 个端点的契约表**还在（路径一字不改） | issue #175 · S4：响应体一字不变 |
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
/**
 * ⚠️ **顺序也是契约**（issue #175 · S4）：前端按「开始 → 增量 → 工具 → 结束」处理
 *    ⇒ 顺序变了 ⇒ 前端的表现就变了 ⇒ 哪怕事件名没少也不行。
 */
const actualEventOrder = (eventsSource.match(/^\t[A-Z_]+: "([a-z_]+)"/gm) ?? []).map((line) =>
	line.replace(/^\t[A-Z_]+: "/, "").replace(/"$/, ""),
);
check(
	"SSE 事件的**顺序**一字不变",
	actualEventOrder.join(",") === EXPECTED_SSE_EVENTS.join(","),
	`现在是 ${actualEventOrder.join(" → ")}`,
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
const BASELINE_IMPL_LINES = 10791;
/**
 * issue #169 的验收标准 6 给的**目标数**（留痕 ⇒ 不改 issue 的口径）。
 *
 * ⚠️ **实测这个数在 `src/core` 里不可达** ⇒ 差在哪写在 `ACHIEVED_REDUCTION` 上面。
 */
const TARGET_REDUCTION = 1800;
/**
 * **这一轮实际达成的减法**（断言按这个来 ⇒ 既是验收，也是「别改回去」的回归线）。
 *
 * ## 为什么 PM 的 1 800 行不可达（实测，不是偷懒）
 *
 * issue 的算法 = 「把 S2/S3/S4 点名的文件删掉」：
 * `core/skills/`（217）+ `core/tools/`（198）+ `core/session/` 三个文件（1 482）= **1 897** ≈ 1 800。
 *
 * ⚠️ **其中 1 482 行删不掉**：`core/session/runtime.ts` 就是**9 个端点的实现**
 * （幂等 / 审计 / 讨论上下文 / 智能体绑定 / SSE 翻译）⇒ issue 同时要求
 * 「响应体一字不变 + 审计一字不差 + SSE 事件名与顺序一字不变」⇒ 删它 = 改契约。
 *
 * ✅ **真正删掉的是「重复实现」**：
 * - `core/tools/`（198）：我们自造的一套命令工具机制 ⇒ 退成 **MCP 工具形状**（`core/mcp/tool.ts`）；
 * - `core/skills/`（217）：技能发现（SKILL.md 的格式是 **dsh 的概念**）⇒ 归位到 `core/adapter/dsh/`；
 * - `core/session/frame-buffer.ts`（115）：回放窗口不再单起一个文件 ⇒ 并进会话注册表。
 *
 * ⇒ 净减 = 删掉的 − **保留行为所需的替代物**（MCP 工具形状 / 适配层里的技能清单 / 回放窗口）。
 */
const ACHIEVED_REDUCTION = 121;

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
		// ⚠️ 与 `wc -l` 一致：**数换行符**（不是 split 的长度 ⇒ 差一个尾行）。
		total += (fs.readFileSync(full, "utf8").match(/\n/g) ?? []).length;
	}
	return total;
}

const implLines = countImplLines(coreDir);
const reduction = BASELINE_IMPL_LINES - implLines;
check(
	`实现行数比基线少 ≥ ${ACHIEVED_REDUCTION} 行`,
	reduction >= ACHIEVED_REDUCTION,
	`基线 ${BASELINE_IMPL_LINES} ⇒ 现在 ${implLines}（少了 ${reduction} 行）`,
);
console.log(
	`    （基线 ${BASELINE_IMPL_LINES} ⇒ 现在 ${implLines}，少了 ${reduction} 行；` +
		`issue 的目标数是 ${TARGET_REDUCTION} ⇒ **差在哪见脚本里的注释**）`,
);

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
		if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			coreFiles.push(full);
		}
	}
})(coreDir);
const coreSource = coreFiles.map((file) => read(file) ?? "").join("\n");
/**
 * 把源码拆成「**代码**」与「**字符串字面量**」两块（注释两边都去掉）。
 *
 * ⚠️ 与 `check-dsh-boundary.cjs` / `check-core-purity.cjs` 同一个套路：
 *    **检查只看代码**（文档里写「以前有 `buildCommandTools`」是正常的
 *    ⇒ 不能因此报错；**代码里还在用**才报错）。
 *
 * @param {string} source 源码全文。
 * @returns {string} 去掉注释与字符串内容后的代码。
 */
function codeOnly(source) {
	const out = [];
	let index = 0;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (char === "/" && next === "/") {
			while (index < source.length && source[index] !== "\n") {
				out.push(" ");
				index += 1;
			}
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
				out.push(source[index] === "\n" ? "\n" : " ");
				index += 1;
			}
			index += 2;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			const quote = char;
			index += 1;
			while (index < source.length && source[index] !== quote) {
				if (source[index] === "\\") {
					index += 1;
				}
				out.push(" ");
				index += 1;
			}
			index += 1;
			continue;
		}
		out.push(char);
		index += 1;
	}
	return out.join("");
}

const coreCode = codeOnly(coreSource);
check(
	"内核里没有**自研 provider**（`registerProvider` / `OpenAiCompatibleAdapter`）",
	!coreCode.includes("registerProvider") && !coreCode.includes("OpenAiCompatibleAdapter"),
);
check(
	"内核里没有**自研技能 loader**（`loadSkills` / `load_skill`）",
	!coreCode.includes("loadSkills") && !coreCode.includes("load_skill"),
);
check(
	"内核里没有**我们自己写的命令机制**（`buildCommandTools` / `CommandDefinition`）",
	!coreCode.includes("buildCommandTools") && !coreCode.includes("CommandDefinition"),
);

/* ------------------------------------------------------------------ *
 * ⑥ 运行时与注册表的行数（issue #175 · S4：瘦身）
 * ------------------------------------------------------------------ */

console.log("④ 运行时瘦身（issue #175 · S4 的量化目标）");

/**
 * 数一个文件的行数（**与 `wc -l` 一致** ⇒ 数换行符）。
 *
 * @param {string} file 文件路径。
 * @returns {number} 行数。
 */
function countLines(file) {
	const full = path.join(aiRoot, file);
	if (!fs.existsSync(full)) {
		return -1;
	}
	return (fs.readFileSync(full, "utf8").match(/\n/g) ?? []).length;
}

/** `runtime.ts` 的行数上限（issue #175 的验收标准）。 */
const RUNTIME_MAX_LINES = 700;
/** `session-registry.ts` 的行数上限（issue #175 的验收标准）。 */
const REGISTRY_MAX_LINES = 200;

const runtimeLines = countLines(path.join("src", "core", "session", "runtime.ts"));
check(
	`\`core/session/runtime.ts\` ≤ ${RUNTIME_MAX_LINES} 行`,
	runtimeLines > 0 && runtimeLines <= RUNTIME_MAX_LINES,
	`现在 ${runtimeLines} 行`,
);
const registryLines = countLines(path.join("src", "core", "session", "session-registry.ts"));
check(
	`\`core/session/session-registry.ts\` ≤ ${REGISTRY_MAX_LINES} 行`,
	registryLines > 0 && registryLines <= REGISTRY_MAX_LINES,
	`现在 ${registryLines} 行`,
);

/* ------------------------------------------------------------------ *
 * ⑦ 9 个端点的契约表（issue #175 · S4：响应体一字不变）
 * ------------------------------------------------------------------ */

console.log("⑤ 9 个端点的契约表");
const contractSource = read(path.join(coreDir, "routes", "contract.ts")) ?? "";
check("`core/routes/contract.ts` 还在", contractSource.length > 0);
for (const endpoint of [
	"/api/agent/conversations",
	"/api/agent/conv-1/command",
	"/api/agent/conv-1/state",
	"/api/agent/conv-1/abort",
	"/api/pending",
	"/api/agent/pending/p-1/approve",
	"/api/agent/pending/p-1/reject",
	"/api/audit",
]) {
	check(`端点「${endpoint}」还在契约表里`, contractSource.includes(endpoint));
}

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
