/**
 * 静态验收（issue #122 · #153）：**技能 / MCP / 插件三层在 dsh 上的形状**。
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
 * | 3 | **减法**：我们自己的技能 loader / 技能段 / `load_skill` 工具**都没了** |
 * | 4 | 技能**目录交给 dsh**（profile 补丁配 `skill-filesystem` · 服务侧只给目录） |
 * | 5 | **MCP 管理面退给 dsh**（dsh 侧插件依赖 `dsh-mcp-manager`；服务侧不 import） |
 * | 6 | MCP 的**工具名归一化**只有一处规则（`core/mcp/tool-names.ts`） |
 * | 7 | **插件注册表机制**还在：`core/**` 不 import `plugins/**`；`src/plugins.ts` 是唯一注册处 |
 * | 8 | 业务插件（`src/plugins/pm/**`）**逻辑没重写**（只挂载方式变了） |
 * | 9 | **版本锁**里锁着 `dsh-mcp-client` / `dsh-mcp-manager`（精确版本） |
 * | 10 | **冷启动**：握手超时 ≥ 120 秒（**第一次跑就要绿**）· 会话层传得下去 · 验收脚本自己也给足 |
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
	// ⚠️ **名字必须是 kebab-case**（dsh 的硬要求 ⇒ 写错就等于技能不存在）。
	const name = /^name:\s*(\S+)/m.exec(source)?.[1] ?? "";
	check(`${rel(file)}：名字是 kebab-case（dsh 的发现规则）`, /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), name);
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

/* ------------------------------------------------------------------ *
 * ③ 减法：我们自己的技能 loader / 技能段 / `load_skill` 都没了
 * ------------------------------------------------------------------ */

console.log("③ 减法（issue #153：**技能退给 dsh** ⇒ 我们自己的那套没了）");
check(
	"**我们自己的** loader 没了（`core/skills/skill-loader.ts`）",
	!fs.existsSync(path.join(aiRoot, "src", "core", "skills", "skill-loader.ts")),
);
check(
	"**我们自己拼的**技能段没了（`core/skills/skills.ts`）",
	!fs.existsSync(path.join(aiRoot, "src", "core", "skills", "skills.ts")),
);
check(
	"**我们自己的** `load_skill` 工具没了（`core/skills/skill-tools.ts`）",
	!fs.existsSync(path.join(aiRoot, "src", "core", "skills", "skill-tools.ts")),
);
check(
	"**我们自己拼**技能提示词的适配层没了（`core/adapter/dsh/system-prompt.ts`）",
	!fs.existsSync(path.join(aiRoot, "src", "core", "adapter", "dsh", "system-prompt.ts")),
);
const serviceSkillSources = filesOf(path.join(aiRoot, "src"), [".ts"])
	// ⚠️ **单测不算**（测试里可以把 `load_skill` 当成普通工具名举例）。
	.filter((file) => !file.endsWith(".test.ts"))
	.map((file) => [file, read(file) ?? ""])
	.filter(([, source]) => source.includes("load_skill"));
check(
	"服务侧**不再有** `load_skill`（那件事归 dsh 的 `skill` 工具了）",
	serviceSkillSources.length === 0,
	serviceSkillSources.map(([file]) => rel(file)).join("、"),
);
const catalogSource = read(path.join(aiRoot, "src", "core", "skills", "skill-catalog.ts")) ?? "";
check(
	"清单读取**还在**（`GET /api/agent/skills` 要它 ⇒ dsh 的登记表面问不到）",
	catalogSource.includes("listSkillSummaries"),
);
check(
	"清单的**发现规则与 dsh 对齐**（kebab-case 名字）",
	catalogSource.includes("isSkillName") && catalogSource.includes("a-z0-9"),
);

/* ------------------------------------------------------------------ *
 * ④ 技能目录交给 dsh
 * ------------------------------------------------------------------ */

console.log("④ 技能目录（**我们只给目录，dsh 负责发现**）");
const profilePatch = read(path.join(aiRoot, "dsh-plugin", "profile.patch.yml")) ?? "";
check(
	"profile 补丁里配了 `skill-filesystem`（dsh 的技能 provider）",
	profilePatch.includes("id: skill-filesystem"),
);
check(
	"**默认根不扫**（不许把项目 / 用户家目录的技能混进来）",
	profilePatch.includes("includeDefaultRoots: false"),
);
check(
	"目录**从环境变量来**（每个会话一份 ⇒ 不串味）",
	profilePatch.includes("AI_DSH_SKILL_DIRS"),
);
const runnerSource = read(path.join(aiRoot, "src", "core", "adapter", "dsh", "runner.ts")) ?? "";
check("服务侧把技能目录**交给 dsh**（`AI_DSH_SKILL_DIRS`）", runnerSource.includes("AI_DSH_SKILL_DIRS"));
const runtimeSource = read(path.join(aiRoot, "src", "core", "session", "runtime.ts")) ?? "";
check("会话层把**智能体的技能目录**传下去（`skillDirs`）", runtimeSource.includes("skillDirs"));

/* ------------------------------------------------------------------ *
 * ⑤ MCP 管理面退给 dsh
 * ------------------------------------------------------------------ */

console.log("⑤ MCP（**管理面退给 dsh**）");
const pluginManifest = JSON.parse(read(path.join(aiRoot, "dsh-plugin", "package.json")) ?? "{}");
check(
	"dsh 侧插件依赖 **@deepseek-ai/dsh-mcp-manager**",
	typeof pluginManifest?.dependencies?.["@deepseek-ai/dsh-mcp-manager"] === "string",
);
check(
	"版本**精确锁死**（没有 ^ / ~）",
	/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(
		String(pluginManifest?.dependencies?.["@deepseek-ai/dsh-mcp-manager"] ?? ""),
	),
);
const pluginMcpSource = read(path.join(aiRoot, "dsh-plugin", "src", "mcp.js")) ?? "";
check(
	"插件用**管理面**注册服务器（`manager.register`）",
	pluginMcpSource.includes("manager.register"),
);
check(
	"管理面挂在**我们这个作用域**（工具要落进 agent 那份工具表）",
	pluginMcpSource.includes("ctx.plugin(McpServerManager)"),
);
check(
	"闸门**还在**（MCP 的写操作也要人点头）",
	pluginMcpSource.includes("tools/pre-execute") && pluginMcpSource.includes("kind: 'ask'"),
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
const serviceMcpSource = read(path.join(aiRoot, "src", "core", "mcp", "mcp.ts")) ?? "";
check(
	"服务侧只负责**按用户算配置**（token 进 header）",
	serviceMcpSource.includes("Authorization") && serviceMcpSource.includes("Bearer"),
);
check(
	"服务侧**不装不卸**（那是管理面的活）",
	!serviceMcpSource.includes("install") && !serviceMcpSource.includes("uninstall"),
);

/* ------------------------------------------------------------------ *
 * ⑥ 工具名归一化只有一处规则
 * ------------------------------------------------------------------ */

console.log("⑥ 工具名归一化（spec §5.3）");
const toolNames = read(path.join(aiRoot, "src", "core", "mcp", "tool-names.ts")) ?? "";
check("归一化的规则在 core/mcp/tool-names.ts", toolNames.includes("bareToolName"));
check("规则是剥掉 `mcp__<server>__` 前缀", toolNames.includes("mcp__[^_]+__"));
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
 * ⑦ 插件注册表机制还在
 * ------------------------------------------------------------------ */

console.log("⑦ 插件（**注册表 + 依赖注入**还在）");
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
 * ⑧ 业务插件逻辑没重写
 * ------------------------------------------------------------------ */

console.log("⑧ 业务插件（**逻辑不重写**，只改挂载方式）");
const pmPlugin = read(path.join(aiRoot, "src", "plugins", "pm", "index.ts")) ?? "";
check("PM 插件还在（命令目录 / 身份 / 上下文 / 探针）", pmPlugin.includes("createPmPlugin"));
check("PM 插件仍提供命令目录", pmPlugin.includes("commands:"));
check("PM 插件仍提供讨论上下文", pmPlugin.includes("context:"));
check(
	"PM 插件**不 import dsh**（它跑在我们的进程里 ⇒ 与 dsh 无关）",
	!pmPlugin.includes("@deepseek-ai"),
);

/* ------------------------------------------------------------------ *
 * ⑨ 版本锁
 * ------------------------------------------------------------------ */

console.log("⑨ 版本锁（dsh 版本的**唯一出处**）");
const lock = JSON.parse(read(path.join(aiRoot, "spike", "dsh", "dsh-versions.lock.json")) ?? "{}");
for (const name of ["@deepseek-ai/dsh-mcp-client", "@deepseek-ai/dsh-mcp-manager"]) {
	const locked = lock?.packages?.[name];
	check(`版本锁里有 ${name}`, typeof locked === "string", String(locked));
	check(
		`${name} 是**精确版本**`,
		typeof locked === "string" && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(locked),
	);
}
check(
	"peer 依赖也显式锁了（pnpm 装得上）",
	typeof lock?.peerDependenciesInstalledExplicitly?.["@deepseek-ai/dsh-mcp-client"] ===
		"string",
);

/* ------------------------------------------------------------------ *
 * ⑩ 冷启动：握手超时（**别让「第一次跑」就红**）
 * ------------------------------------------------------------------ */

console.log("⑩ 冷启动（**握手超时**：dsh 挂插件树实测 ≈ 15 秒 ⇒ 30 秒会红）");
const clientSource = read(path.join(aiRoot, "src", "core", "adapter", "dsh", "client.ts")) ?? "";
const defaultTimeout = /DEFAULT_INITIALIZE_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(clientSource);
const defaultTimeoutMs = defaultTimeout === null ? 0 : Number(defaultTimeout[1].replaceAll("_", ""));
check(
	"握手超时有个**具名缺省**（不许是散落的魔法数）",
	defaultTimeout !== null,
	clientSource.includes("initializeTimeoutMs") ? "" : "client.ts 里没有 initializeTimeoutMs",
);
check(
	"缺省握手超时 **≥ 120 秒**（实测起一次 dsh 运行时 ≈ 15 秒 ⇒ 30 秒会红）",
	defaultTimeoutMs >= 120_000,
	`现在是 ${defaultTimeoutMs} ms`,
);
const sessionSource = read(path.join(aiRoot, "src", "core", "adapter", "dsh", "session.ts")) ?? "";
check(
	"会话层把握手超时**传下去**（可按会话调）",
	sessionSource.includes("initializeTimeoutMs") && sessionSource.includes("initializeTimeoutMs:"),
);
const runtimeE2eSource = read(path.join(aiRoot, "scripts", "e2e", "dsh-skills-mcp-plugins.ts")) ?? "";
const e2eTimeout = /(?:^|\s)INITIALIZE_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(runtimeE2eSource);
check(
	"运行时验收脚本**自己也给足**（冷 CI runner 更慢 ⇒ 第一次跑也要绿）",
	e2eTimeout !== null && Number(e2eTimeout[1].replaceAll("_", "")) >= 120_000,
	e2eTimeout === null ? "脚本里没写死" : `${Number(e2eTimeout[1].replaceAll("_", ""))} ms`,
);
check(
	"运行时验收脚本**显式传**了这个超时（不然用的是缺省）",
	runtimeE2eSource.includes("initializeTimeoutMs: INITIALIZE_TIMEOUT_MS"),
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
