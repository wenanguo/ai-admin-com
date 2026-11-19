/**
 * 静态验收（issue #122）：**技能 / MCP / 插件三层在 dsh 上的形状**。
 *
 * ## 为什么要有它（静态的）
 *
 * 端到端的那套（`backend/ai/scripts/e2e/dsh-skills-mcp-plugins.ts`）要 **pnpm**
 * ⇒ CI 跑不动 ⇒ 这里把**能静态断言的**都钉死 ⇒ **任何 runner 都能跑**。
 *
 * ## 钉住的事
 *
 * | # | 断言 |
 * | - | ---- |
 * | 1 | **技能正文一个字没改**（`SKILL.md` 都在，且带 frontmatter） |
 * | 2 | 技能层**不依赖 pi**（`core/skills/**` 不 import pi） |
 * | 3 | 提示词段还是 `<available_skills>` 那套 XML（**一字不改**） |
 * | 4 | **MCP 客户端**只住在 dsh 侧插件里（服务侧不许 import） |
 * | 5 | MCP 的**工具名归一化**只有一处规则（`core/mcp/tool-names.ts`） |
 * | 6 | **插件注册表机制**还在：`core/**` 不 import `plugins/**`；`src/plugins.ts` 是唯一注册处 |
 * | 7 | 业务插件（`src/plugins/pm/**`）**逻辑没重写**（只挂载方式变了） |
 * | 8 | **版本锁**里锁着 `dsh-mcp-client`（精确版本） |
 *
 * 用法：`node scripts/e2e/dsh-skills-mcp-plugins.static.cjs`（在仓根跑）。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const aiRoot = path.join(repoRoot, "backend", "ai");

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

/** 收集目录下的文件（按扩展名过滤）。 */
function filesOf(dir, extensions) {
	const out = [];
	if (!fs.existsSync(dir)) {
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...filesOf(full, extensions));
		} else if (extensions.some((ext) => entry.name.endsWith(ext))) {
			out.push(full);
		}
	}
	return out;
}

/**
 * 抽出文件里的**模块说明符**（import / export from / import() / require）。
 *
 * ⚠️ **只看真的 import** ⇒ 注释里写着「@deepseek-ai/dsh-mcp-client」不算。
 *
 * @param {string} source 源码全文。
 * @returns {string[]} 说明符列表。
 */
function specifiersOf(source) {
	const pattern =
		/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bvi\.(?:mock|doMock|unmock)\s*\(\s*)(["'])([^"']+)\1/g;
	const out = [];
	let match;
	while ((match = pattern.exec(source)) !== null) {
		out.push(match[2]);
	}
	return out;
}

/** 相对仓根的路径（正斜杠）。 */
function rel(file) {
	return path.relative(repoRoot, file).split(path.sep).join("/");
}

/* ------------------------------------------------------------------ *
 * ① 技能正文一个字没改
 * ------------------------------------------------------------------ */

console.log("① 技能资产（`backend/ai/.pi/skills/**`）");
const skillsDir = path.join(aiRoot, ".pi", "skills");
const skillFiles = filesOf(skillsDir, [".md"]).filter((file) => file.endsWith("SKILL.md"));
check("技能文件都在（三个样板）", skillFiles.length === 3, `找到 ${skillFiles.length} 个`);
for (const file of skillFiles) {
	const source = read(file) ?? "";
	const hasFrontmatter = /^---\r?\n[\s\S]*?\r?\n---/.test(source);
	const hasName = /^name:\s*\S+/m.test(source);
	const hasDescription = /^description:\s*\S+/m.test(source);
	check(
		`${rel(file)}：frontmatter 完整（name + description）`,
		hasFrontmatter && hasName && hasDescription,
	);
}

/* ------------------------------------------------------------------ *
 * ② 技能层不依赖 pi
 * ------------------------------------------------------------------ */

console.log("② 技能层**不依赖 pi**（技能是 Agent Skills 标准格式，不是 pi 私有）");
const skillsLayer = filesOf(path.join(aiRoot, "src", "core", "skills"), [".ts"]);
const piFreeFiles = skillsLayer.filter(
	(file) =>
		!file.endsWith(".pi.ts") && !file.endsWith(".pi.test.ts") && !file.endsWith(".test.ts"),
);
for (const file of piFreeFiles) {
	const source = read(file) ?? "";
	const usesPi = specifiersOf(source).some((specifier) =>
		specifier.startsWith("@earendil-works/pi-coding-agent"),
	);
	check(`${rel(file)}：不 import pi`, !usesPi);
}
check(
	"**我们自己的** loader 在（core/skills/skill-loader.ts）",
	fs.existsSync(path.join(aiRoot, "src", "core", "skills", "skill-loader.ts")),
);
check(
	"dsh 的系统提示词走**我们自己的** loader",
	(read(path.join(aiRoot, "src", "core", "adapter", "dsh", "system-prompt.ts")) ?? "").includes(
		"skills/skill-loader.ts",
	),
);

/* ------------------------------------------------------------------ *
 * ③ 提示词段还是那套 XML
 * ------------------------------------------------------------------ */

console.log("③ 提示词段（**一字不改**）");
const skillsSource = read(path.join(aiRoot, "src", "core", "skills", "skills.ts")) ?? "";
check("还是 <available_skills> 那套 XML", skillsSource.includes("<available_skills>"));
check("措辞还是指向 load_skill", skillsSource.includes("load_skill"));
check(
	"`load_skill` 工具还在（按需加载）",
	fs.existsSync(path.join(aiRoot, "src", "core", "skills", "skill-tools.ts")),
);

/* ------------------------------------------------------------------ *
 * ④ MCP 客户端只住在 dsh 侧插件里
 * ------------------------------------------------------------------ */

console.log("④ MCP（dsh 自带的客户端）");
const pluginManifest = JSON.parse(
	read(path.join(aiRoot, "dsh-plugin", "package.json")) ?? "{}",
);
check(
	"dsh 侧插件依赖 **@deepseek-ai/dsh-mcp-client**",
	typeof pluginManifest?.dependencies?.["@deepseek-ai/dsh-mcp-client"] === "string",
);
check(
	"版本**精确锁死**（没有 ^ / ~）",
	/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(
		String(pluginManifest?.dependencies?.["@deepseek-ai/dsh-mcp-client"] ?? ""),
	),
);
const serviceManifest = JSON.parse(read(path.join(aiRoot, "package.json")) ?? "{}");
check(
	"**服务侧不依赖** dsh 的 MCP 客户端（类型不外泄）",
	serviceManifest?.dependencies?.["@deepseek-ai/dsh-mcp-client"] === undefined,
);
const serviceSources = filesOf(path.join(aiRoot, "src"), [".ts"]).filter(
	(file) => !file.includes(`${path.sep}adapter${path.sep}dsh${path.sep}`),
);
for (const file of serviceSources) {
	const source = read(file) ?? "";
	const usesMcpClient = specifiersOf(source).some(
		(specifier) => specifier === "@deepseek-ai/dsh-mcp-client",
	);
	check(`${rel(file)}：不 import dsh 的 MCP 客户端`, !usesMcpClient);
}

/* ------------------------------------------------------------------ *
 * ⑤ 工具名归一化只有一处规则
 * ------------------------------------------------------------------ */

console.log("⑤ 工具名归一化（spec §5.3）");
const toolNames = read(path.join(aiRoot, "src", "core", "mcp", "tool-names.ts")) ?? "";
check("归一化的规则在 core/mcp/tool-names.ts", toolNames.includes("bareToolName"));
check(
	"规则是剥掉 `mcp__<server>__` 前缀",
	toolNames.includes("mcp__[^_]+__"),
);
check(
	"dsh 路径用它归一化（界面 / 待确认 / 审计）",
	(read(path.join(aiRoot, "src", "core", "session", "event-mapper.ts")) ?? "").includes(
		"normalizeToolName",
	) &&
		(read(path.join(aiRoot, "src", "core", "adapter", "dsh", "approvals.ts")) ?? "").includes(
			"bareToolName",
		),
);

/* ------------------------------------------------------------------ *
 * ⑥ 插件注册表机制还在
 * ------------------------------------------------------------------ */

console.log("⑥ 插件（**注册表 + 依赖注入**还在）");
const corePlugins = read(path.join(aiRoot, "src", "core", "plugins.ts")) ?? "";
check("注册表还在（core/plugins.ts）", corePlugins.includes("class PluginRegistry"));
check("入口侧注册还在（src/plugins.ts）", fs.existsSync(path.join(aiRoot, "src", "plugins.ts")));
const entryPlugins = read(path.join(aiRoot, "src", "plugins.ts")) ?? "";
check(
	"**入口侧是唯一 import 业务插件的地方**",
	entryPlugins.includes("./plugins/pm/index.ts"),
);
const pluginImports = [];
for (const file of filesOf(path.join(aiRoot, "src"), [".ts"])) {
	const source = read(file) ?? "";
	const match = /from\s+"(\.[^"]*plugins\/[^"]*)"/.exec(source);
	if (match !== null) {
		pluginImports.push(rel(file));
	}
}
check(
	"只有入口侧 import 业务插件（core 不许）",
	pluginImports.every((file) => file === "backend/ai/src/plugins.ts"),
	pluginImports.join("、"),
);

/* ------------------------------------------------------------------ *
 * ⑦ 业务插件逻辑没重写
 * ------------------------------------------------------------------ */

console.log("⑦ 业务插件（**逻辑不重写**，只改挂载方式）");
const pmPlugin = read(path.join(aiRoot, "src", "plugins", "pm", "index.ts")) ?? "";
check("PM 插件还在（命令目录 / 身份 / 上下文 / 探针）", pmPlugin.includes("createPmPlugin"));
check("PM 插件仍提供命令目录", pmPlugin.includes("commands:"));
check("PM 插件仍提供讨论上下文", pmPlugin.includes("context:"));
check(
	"PM 插件**不 import dsh**（它跑在我们的进程里 ⇒ 与 dsh 无关）",
	!pmPlugin.includes("@deepseek-ai"),
);

/* ------------------------------------------------------------------ *
 * ⑧ 版本锁
 * ------------------------------------------------------------------ */

console.log("⑧ 版本锁（dsh 版本的**唯一出处**）");
const lock = JSON.parse(read(path.join(aiRoot, "spike", "dsh", "dsh-versions.lock.json")) ?? "{}");
const locked = lock?.packages?.["@deepseek-ai/dsh-mcp-client"];
check("版本锁里有 dsh-mcp-client", typeof locked === "string", String(locked));
check(
	"版本锁里是**精确版本**",
	typeof locked === "string" && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(locked),
);
check(
	"peer 依赖也显式锁了（pnpm 装得上）",
	typeof lock?.peerDependenciesInstalledExplicitly?.["@deepseek-ai/dsh-mcp-client"] ===
		"string",
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
console.log("\n✅ 技能 / MCP / 插件三层（静态断言）：全部通过");
