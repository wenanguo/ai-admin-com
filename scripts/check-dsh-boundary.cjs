/**
 * dsh 边界守卫 —— **dsh 只许出现在适配层**。
 *
 * ## 为什么要有它
 *
 * dsh（DeepSeek Harness）现在是 RC ⇒ 它的 API 会变。
 * ⇒ 我们的设计（`docs/superpowers/specs/2026-11-19-dsh-底座摸底-目标架构-design.md` §7）
 * 把「**升级影响面 = 适配层目录**」当作整块架构的核心保险：
 *
 * - **目录边界**：dsh 的包只许出现在适配层（服务侧 `core/adapter/dsh/**` + dsh 侧插件包 `dsh-plugin/**`）；
 * - **类型边界**：dsh 的类型名（`LlmAdapter` / `HarnessClient` / `defineTool` ……）
 *   不许出现在适配层**以外**的服务代码里；
 * - **依赖边界**：dsh 侧不许出现 pi-ai（issue #120 的 D5=A 决定：
 *   **绝对不许用 `@deepseek-ai/dsh-llm-pi-ai`**，它建在 pi 的 `pi-ai` 上 ⇒ 自己的 provider 走 `dsh-llm` seam）；
 * - **pi 禁令**（issue #123）：**服务里一处 pi 都不许有**
 *   （依赖清单 / 源码 import ⇒ `@earendil-works/pi-*` 全不许）。
 *
 * ## 四档检查
 *
 * | 档 | 查什么 | 怎么查 |
 * | -- | ------ | ------ |
 * | **一** | dsh 的包只许在适配层 | 解析 import 说明符 ⇒ 算出落点 |
 * | **二** | dsh 的类型名不外泄 | 扫标识符（剥掉注释与字符串字面量） |
 * | **三** | dsh 侧不许有 pi-ai | 扫依赖清单 + 源码 |
 * | **四** | **服务里不许有 pi**（拔干净了） | 扫依赖清单 + 源码 import |
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-dsh-boundary.cjs              # 查仓
 * node scripts/check-dsh-boundary.cjs --root <目录> # 查别的目录（测试用）
 * ```
 *
 * 退出码：0 = 三档都干净；1 = 有违规（打印每一条）。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const rootArgIndex = argv.indexOf("--root");
const root = path.resolve(
	rootArgIndex >= 0 && argv[rootArgIndex + 1] !== undefined
		? argv[rootArgIndex + 1]
		: path.join(repoRoot, "backend/ai"),
);

/** 服务源码根（要查 dsh 类型外泄的地方）。 */
const srcDir = path.join(root, "src");
/** dsh 侧插件包（dsh 运行时装的 cordis 插件：我们的 provider + 我们的命令桥）。 */
const pluginDir = path.join(root, "dsh-plugin");

/**
 * **允许出现 dsh 的地方**（相对 root）。
 *
 * ⚠️ 两处：
 * ① `src/core/adapter/dsh/**` —— 服务侧的适配层（进程内）；
 * ② `dsh-plugin/**` —— dsh 侧的插件包（**跑在 dsh 运行时进程里** ⇒ 天然要用 dsh 的 API）。
 *
 * 两者合起来就是「适配层」—— 见 spec §7。
 */
const ALLOWED_PREFIXES = ["src/core/adapter/dsh/", "dsh-plugin/"];

/** dsh 的包名前缀（import 说明符以它开头 ⇒ 就是 dsh 的东西）。 */
const DSH_PACKAGE_PREFIX = "@deepseek-ai/";

/**
 * dsh 的**类型名**（不许出现在适配层以外的服务代码里）。
 *
 * ⚠️ 这些是 dsh 的**类型 / 类 / 函数名** ⇒ 出现在别处就说明「类型外泄」了。
 */
const DSH_TYPE_NAMES = [
	"LlmAdapter",
	"LlmRuntime",
	"HarnessClient",
	"DeepSeekHarness",
	"SessionEvent",
	"StreamChunk",
	"GenerateOptions",
	"defineTool",
	"ToolSchema",
	"ApprovalOutcome",
	"ApprovalService",
	"ContextSnapshotSection",
	// ⚠️ issue #122：**MCP 客户端**与**工具管线**的类型（它们住在 dsh 侧插件里）。
	"ToolsService",
	"PreToolDecision",
	"PostToolDecision",
	"ToolGuard",
	"ToolGuardDenial",
	"McpResult",
	"McpToolDefinitionOptions",
	"McpConnectionStatus",
	"SERVER_NAME_PATTERN",
];

/**
 * **服务侧**允许依赖的 dsh 包（**只有 SDK 客户端**）。
 *
 * ⚠️ dsh 的**运行时**是个子进程 ⇒ 我们只需要“能跟它说话”的那个客户端
 *    （`@deepseek-ai/dsh-sdk-client`）⇒ 其余 dsh 包（llm / tools / user-approval……）
 *    **只许**出现在 dsh 侧插件包（`dsh-plugin/**`）里。
 *
 * ⚠️ issue #122：**MCP 客户端**（`@deepseek-ai/dsh-mcp-client`）也只许在 dsh 侧
 *    ⇒ 它**不在**这个清单里 ⇒ 服务侧一旦 import 它就会被拦下。
 */
const ALLOWED_SERVICE_DSH_PACKAGES = ["@deepseek-ai/dsh-sdk-client"];

/**
 * **pi-ai 禁令**（D5=A）。
 *
 * ⚠️ `@deepseek-ai/dsh-llm-pi-ai` 是 dsh 官方的「pi-ai 支撑的 provider 适配器」
 *    ⇒ 它把 pi-ai 拖进来 ⇒ **本仓不许用**（自己写 provider，走 `dsh-llm` seam）。
 */
const FORBIDDEN_DSH_PACKAGES = ["@deepseek-ai/dsh-llm-pi-ai"];

/** dsh 侧（插件包）不许出现的 pi 包（pi-ai 及其同门）。 */
const FORBIDDEN_PI_PACKAGES = [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@deepseek-ai/dsh-llm-pi-ai",
];

/**
 * **服务里不许出现的 pi 包**（issue #123：拔干净了）。
 *
 * ⚠️ **前缀匹配** ⇒ `@earendil-works/pi-*` 一律不许（`pi-ai` / `pi-coding-agent` / `pi-mcp`……）。
 */
const FORBIDDEN_PI_PREFIX = "@earendil-works/pi";

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/**
 * 不扫的目录（依赖 / 产物 / 缓存 ⇒ 与我们的代码无关）。
 *
 * ⚠️ **`spike`**：issue #119 的**尖峰沙盒**（它自己带一份 pnpm 工程，故意用了
 *    `dsh-llm-pi-ai` 摸底）⇒ **不是生产代码** ⇒ 不受本检查约束
 *    （它的依赖也不进 `backend/ai` 的依赖树 —— 独立包，独立 lock）。
 */
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"build",
	"coverage",
	".umi",
	"out",
	".scratch",
	"spike",
]);

/** 收集目录下的所有文件（按扩展名过滤）。 */
function filesOf(dir, extensions) {
	const out = [];
	if (!fs.existsSync(dir)) {
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) {
				continue;
			}
			out.push(...filesOf(path.join(dir, entry.name), extensions));
		} else if (extensions.some((ext) => entry.name.endsWith(ext))) {
			out.push(path.join(dir, entry.name));
		}
	}
	return out;
}

/** 相对 root 的路径（统一用 `/` 分隔，方便打印与断言）。 */
function relOf(file) {
	return path.relative(root, file).split(path.sep).join("/");
}

/** 这个相对路径是不是在允许清单里。 */
function isAllowed(relative) {
	return ALLOWED_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

/**
 * 抽出文件里的**模块说明符**（import / export from / import() / require()）。
 *
 * @param source 源码全文。
 * @returns 说明符列表。
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

/**
 * 把源码拆成「**代码**」与「**字符串字面量**」两块（注释两边都去掉）。
 *
 * ⚠️ 与 `check-core-purity.cjs` 同一个套路：**类型名检查只看代码**
 *    （文档里写「dsh 的 LlmAdapter」是正常的 ⇒ 不能因此报错）。
 *
 * @param source 源码全文。
 * @returns 去掉注释与字符串内容后的代码。
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
				index += 1;
			}
			index += 1;
			out.push('""');
			continue;
		}
		out.push(char);
		index += 1;
	}
	return out.join("");
}

/* ------------------------------------------------------------------ *
 * 第一档：目录边界（dsh 的包只许在适配层）
 * ------------------------------------------------------------------ */

const violations = [];

/** 记一条违规。 */
function report(file, kind, detail) {
	violations.push({ file: relOf(file), kind, detail });
}

for (const file of filesOf(root, [".ts", ".tsx", ".js", ".mjs", ".cjs"])) {
	const relative = relOf(file);
	if (isAllowed(relative)) {
		continue;
	}
	const source = fs.readFileSync(file, "utf8");
	for (const specifier of specifiersOf(source)) {
		if (specifier.startsWith(DSH_PACKAGE_PREFIX)) {
			report(file, "目录边界", `import 了 dsh 的包「${specifier}」（只许在适配层）`);
		}
	}
}

/* ------------------------------------------------------------------ *
 * 第二档：类型边界（dsh 的类型名不外泄）
 * ------------------------------------------------------------------ */

for (const file of filesOf(srcDir, [".ts"])) {
	const relative = relOf(file);
	if (isAllowed(relative)) {
		continue;
	}
	const code = codeOnly(fs.readFileSync(file, "utf8"));
	for (const name of DSH_TYPE_NAMES) {
		const pattern = new RegExp(`\\b${name}\\b`);
		if (pattern.test(code)) {
			report(file, "类型边界", `出现了 dsh 的类型名「${name}」（只许在适配层）`);
		}
	}
}

/* ------------------------------------------------------------------ *
 * 第三档：pi-ai 禁令（D5=A）
 * ------------------------------------------------------------------ */

for (const file of filesOf(root, [".ts", ".js", ".mjs", ".cjs", ".json"])) {
	const relative = relOf(file);
	const source = fs.readFileSync(file, "utf8");
	// ⚠️ **源码只看代码**（剥掉注释与字符串）⇒ 文档里提一句「不许用 xxx」不算违规。
	// ⚠️ **lock 文件不看**（它是生成物 ⇒ 会把 dsh 运行时的**传递依赖**也列出来）。
	const isSource = !file.endsWith(".json");
	const haystack = isSource ? codeOnly(source) : source;
	if (file.endsWith("package-lock.json")) {
		continue;
	}
	// ⚠️ **清单文件另说**（下面那段按依赖表查 ⇒ 更准）
	//    ⇒ 这里只看「清单里有没有提到它」（`overrides` 里提到是**故意的** ⇒ 放过）。
	if (file.endsWith("package.json")) {
		continue;
	}
	// ⚠️ **空壳目录放过**（`stubs/dsh-llm-pi-ai/` ⇒ 它**必须**叫那个名字才能顶替它）
	if (relative.startsWith("stubs/")) {
		continue;
	}
	for (const forbidden of FORBIDDEN_DSH_PACKAGES) {
		if (haystack.includes(forbidden)) {
			report(file, "pi-ai 禁令", `出现了「${forbidden}」（D5=A：自己写 provider，不许用它）`);
		}
	}
}

// dsh 侧插件包的依赖里不许有 pi 系
for (const manifestName of ["dsh-plugin/package.json", "package.json"]) {
	const manifestPath = path.join(root, manifestName);
	if (!fs.existsSync(manifestPath)) {
		continue;
	}
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const deps = {
		...(manifest.dependencies ?? {}),
		...(manifest.devDependencies ?? {}),
		...(manifest.peerDependencies ?? {}),
	};
	for (const [name] of Object.entries(deps)) {
		const isDshSide = manifestName.startsWith("dsh-plugin/");
		if (isDshSide && FORBIDDEN_PI_PACKAGES.includes(name)) {
			report(manifestPath, "pi-ai 禁令", `dsh 侧的依赖里有「${name}」`);
		}
		if (name.startsWith(DSH_PACKAGE_PREFIX) && !isDshSide) {
			if (!ALLOWED_SERVICE_DSH_PACKAGES.includes(name)) {
				report(manifestPath, "目录边界", `服务的依赖清单里有 dsh 的包「${name}」`);
			}
		}
	}
}

/* ------------------------------------------------------------------ *
 * 第四档：pi 禁令（issue #123：拔干净了）
 * ------------------------------------------------------------------ */

for (const file of filesOf(root, [".ts", ".tsx", ".js", ".mjs", ".cjs"])) {
	const relative = relOf(file);
	const source = fs.readFileSync(file, "utf8");
	// ⚠️ **源码只看真的 import**（字符串里提一句「pi」不算 ⇒ 断言里会写那个名字）。
	const pattern = /(?:from|import|require)\s*\(?\s*["'](@earendil-works\/pi[^"']*)["']/g;
	let match;
	while ((match = pattern.exec(source)) !== null) {
		report(file, "pi 禁令", `import 了 pi 的包「${match[1]}」（服务里一处 pi 都不许有）`);
	}
}

// 依赖清单里也不许有 pi（**直接依赖** ⇒ 一律不许）
for (const manifestName of ["dsh-plugin/package.json", "package.json"]) {
	const manifestPath = path.join(root, manifestName);
	if (!fs.existsSync(manifestPath)) {
		continue;
	}
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const deps = {
		...(manifest.dependencies ?? {}),
		...(manifest.devDependencies ?? {}),
		...(manifest.peerDependencies ?? {}),
	};
	for (const name of Object.keys(deps)) {
		if (name.startsWith(FORBIDDEN_PI_PREFIX)) {
			report(manifestPath, "pi 禁令", `依赖清单里有 pi 的包「${name}」`);
		}
	}
}

/* ------------------------------------------------------------------ *
 * 打印
 * ------------------------------------------------------------------ */

if (violations.length === 0) {
	console.log("✅ dsh 边界干净（目录 / 类型 / pi-ai / pi 四档）");
	process.exit(0);
}

for (const violation of violations) {
	console.error(`❌ [${violation.kind}] ${violation.file}：${violation.detail}`);
}
console.error(`\n共 ${violations.length} 条违规。`);
process.exit(1);
