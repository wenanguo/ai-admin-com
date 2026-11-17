/**
 * 内核纯净度检查 —— **`core/**` 不许 import `plugins/**`**。
 *
 * ## 为什么要有它
 *
 * 目录拆分的全部意义在于「内核不懂业务」⇒ 依赖方向必须是
 * **插件 → 内核**；内核一旦 import 插件，这个内核就绑死在那个业务上了
 * ⇒ 换个业务系统复用不了。
 *
 * ⚠️ **靠 grep 业务词查不出来**（注释里出现「任务」很正常）⇒
 *    这里查的是**真实的 import 关系**（解析 import 说明符 ⇒ 算出落点）。
 *
 * ## 规则
 *
 * - `backend/ai/src/core/**` 里的任何文件 ⇒ **不许** import `backend/ai/src/plugins/**`；
 * - 反过来（插件 import 内核）⇒ **允许**（那是正确方向）；
 * - 别的目录（`src/agent/` 之类还没搬完的）⇒ 不管。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-core-purity.cjs                 # 查仓里的 core/
 * node scripts/check-core-purity.cjs <core 目录>     # 查指定目录（测试用）
 * ```
 *
 * 退出码：0 = 干净；1 = 有违规（并打印每一条）。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const coreDir = process.argv[2]
	? path.resolve(process.argv[2])
	: path.join(repoRoot, "backend/ai/src/core");
/** 插件目录 = core 的兄弟目录（core 与 plugins 是平级的）。 */
const pluginsDir = path.join(path.dirname(coreDir), "plugins");

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

const violations = [];
for (const file of tsFiles(coreDir)) {
	const source = fs.readFileSync(file, "utf8");
	for (const specifier of relativeSpecifiers(source)) {
		const target = path.resolve(path.dirname(file), specifier);
		if (isUnder(target, pluginsDir)) {
			violations.push({
				file: path.relative(repoRoot, file).split(path.sep).join("/"),
				specifier,
				target: path.relative(repoRoot, target).split(path.sep).join("/"),
			});
		}
	}
}

if (violations.length > 0) {
	console.error("❌ 内核不干净：`core/**` import 了 `plugins/**`");
	for (const violation of violations) {
		console.error(`   · ${violation.file} ⇒ ${violation.specifier}（落到 ${violation.target}）`);
	}
	console.error(
		"\n依赖方向只能是 **插件 → 内核**；内核要插件的东西 ⇒ 用**注册表 + 依赖注入**（见 core/plugins.ts）。",
	);
	process.exit(1);
}

console.log(
	`✅ 内核纯净：${path.relative(repoRoot, coreDir).split(path.sep).join("/")} 没有 import plugins/**`,
);
