/**
 * AI 管理面（issue #124）的**静态验收**。
 *
 * ## 为什么要有这个
 *
 * 这次的口径是「**不自造**管理界面」⇒ dsh 自带插件市场 / 技能 / MCP 管理
 * ⇒ 我们只嵌它的 UI。
 *
 * ⚠️ 这种口径最危险的失效方式就是「**又长回来**」：
 * 后来者顺手加几个 `/api/skills` 的增删改 ⇒ 重复造轮子又回来了。
 * ⇒ 这里用**静态检查**把三条钉死：
 *
 * ① **既有 9 个端点一字未改**（`core/routes/contract.ts` 逐条比对基线）；
 * ② **没有自造的管理面路由**（适配层里不许注册任何路由；
 *    核心里不许出现 `mcp-servers` / `plugin-market` 这类 CRUD）；
 * ③ **配置项齐了**（4 个环境变量都有实现与文档）。
 *
 * ## ⚠️ 还有第四条（PR #147 的修复轮）：**admin 判定不许解 JWT 载荷**
 *
 * 载荷**没验签** ⇒ 任何人伪造 `{"access":"admin"}` 就能拿到 dsh 的完整管理 UI
 * （插件市场 / 终端 / 文件）⇒ **权限提升**。
 * ⇒ 这里用**静态检查**钉死：
 *
 * ④ **反代里没有「解载荷」的代码**（不许出现 `base64url` / `decodeJwt` /
 *    `access === 'admin'` 这类形状）⇒ 且 **没注入判定器就拒绝**（fail closed）。
 *
 * ⚠️ **静态**（不真起服务）⇒ 快、能进 CI ⇒ 但它管不了「dsh 的 UI 长什么样」
 *    （那一条只能人工验 ⇒ 见 PR 正文）。
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = path.join(REPO_ROOT, "backend", "ai");
const CONTRACT_PATH = path.join(BACKEND, "src", "core", "routes", "contract.ts");
const DSH_ADMIN_DIR = path.join(BACKEND, "src", "core", "adapter", "dsh-admin");
const CORE_ROUTES_DIR = path.join(BACKEND, "src", "core", "routes");
const CORE_APP_PATH = path.join(BACKEND, "src", "core", "app.ts");
const ENV_EXAMPLE_PATH = path.join(BACKEND, ".env.example");

/**
 * 既有 9 个端点的**基线**（issue #124 之前就是这样）。
 *
 * ⚠️ 顺序也算（契约表的顺序就是行为顺序）。
 */
const BASELINE_ENDPOINTS = [
	["GET", "/api/agent/conversations"],
	["POST", "/api/agent/conversations"],
	["POST", "/api/agent/conv-1/command"],
	["GET", "/api/agent/conv-1/state"],
	["POST", "/api/agent/conv-1/abort"],
	["GET", "/api/pending"],
	["POST", "/api/agent/pending/p-1/approve"],
	["POST", "/api/agent/pending/p-1/reject"],
	["GET", "/api/audit"],
];

/** 4 个环境变量（缺省值都要有 ⇒ 文档里也要写）。 */
const REQUIRED_ENV_VARS = [
	"AI_DSH_ADMIN_ENABLED",
	"AI_DSH_ADMIN_PORT",
	"AI_DSH_ADMIN_HOME",
	"AI_DSH_ADMIN_TRUSTED_HOST",
];

/** 不许出现的「自造管理面」路径片段。 */
const FORBIDDEN_PATH_WORDS = ["mcp-server", "plugin-market", "marketplace", "dsh-admin"];

const results = [];
function check(label, ok, detail) {
	results.push({ label, ok, detail });
	console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` —— ${detail ?? ""}`}`);
}

/** 读一个目录下的 .ts 文件（**不含测试**）。 */
function sourceFiles(dir) {
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
		.map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));
}

console.log("① 既有 9 个端点一字未改");
{
	const contract = fs.readFileSync(CONTRACT_PATH, "utf8");
	const pattern = /missingToken\(\s*"[^"]*"\s*,\s*"(GET|POST)"\s*,\s*"([^"]+)"\s*\)/g;
	const found = [];
	let match;
	while ((match = pattern.exec(contract)) !== null) {
		found.push([match[1], match[2]]);
	}
	check(
		"端点数量还是 9 个",
		found.length === BASELINE_ENDPOINTS.length,
		`实际 ${found.length} 个`,
	);
	check(
		"逐条比对：方法与路径一字未改",
		JSON.stringify(found) === JSON.stringify(BASELINE_ENDPOINTS),
		`实际=${JSON.stringify(found)}`,
	);
}

console.log("② 没有自造的管理面路由");
{
	// ②-1 适配层是**纯反代** ⇒ 不许注册任何 Express 路由
	const routeRegistration = /(?:app|router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(/;
	const routerFactory = /new\s+Router\s*\(/;
	const offenders = sourceFiles(DSH_ADMIN_DIR).filter(
		(file) => routeRegistration.test(file.text) || routerFactory.test(file.text),
	);
	check(
		"dsh-admin 适配层里没有注册任何路由（纯反代）",
		offenders.length === 0,
		offenders.map((file) => file.name).join(", "),
	);

	// ②-2 核心里不许出现「自造管理面」的路径
	const coreFiles = [...sourceFiles(CORE_ROUTES_DIR), { name: "app.ts", text: fs.readFileSync(CORE_APP_PATH, "utf8") }];
	const wordOffenders = [];
	for (const file of coreFiles) {
		for (const word of FORBIDDEN_PATH_WORDS) {
			// ⚠️ `app.ts` 里**允许**出现 `DSH_ADMIN_MOUNT_PATH`（那是反代的挂载）
			if (file.name === "app.ts" && word === "dsh-admin") {
				continue;
			}
			if (file.text.includes(word)) {
				wordOffenders.push(`${file.name}:${word}`);
			}
		}
	}
	check(
		"核心里没有自造的管理面 CRUD 路由",
		wordOffenders.length === 0,
		wordOffenders.join(", "),
	);

	// ②-3 与管理面相关的挂载**只有一条**（反代）
	const appText = fs.readFileSync(CORE_APP_PATH, "utf8");
	const mounts = appText.match(/app\.use\([^)]*dshAdmin[^)]*\)/g) ?? [];
	check("core/app.ts 里管理面只挂了一条（反代）", mounts.length === 1, `实际 ${mounts.length} 条`);
}

console.log("③ 配置项齐了（4 个环境变量都有实现与文档）");
{
	const configPath = path.join(DSH_ADMIN_DIR, "config.ts");
	const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
	const envExample = fs.existsSync(ENV_EXAMPLE_PATH)
		? fs.readFileSync(ENV_EXAMPLE_PATH, "utf8")
		: "";
	for (const name of REQUIRED_ENV_VARS) {
		check(`config.ts 里实现了 ${name}`, config.includes(name), "没找到");
		check(
			`.env.example 里写了 ${name}`,
			envExample.includes(name),
			"没找到（文档缺了 ⇒ 用的人不知道怎么配）",
		);
	}
	// 缺省值：总开关缺省**关** ⇒ 不配就不起 dsh web
	check(
		"总开关缺省是关的（enabled 缺省 false）",
		/enabled:\s*isEnabled\(/.test(config),
		"没找到 enabled 的缺省",
	);
}

console.log("④ ⚠️ admin 判定**不许解 JWT 载荷**（载荷没验签 ⇒ 伪造即提权）");
{
	const proxyPath = path.join(DSH_ADMIN_DIR, "proxy.ts");
	const proxy = fs.existsSync(proxyPath) ? fs.readFileSync(proxyPath, "utf8") : "";

	// ④-1 反代里**不许**出现「解载荷」的形状
	//     （base64url 解码 / split(".") / 读 access 字段 ⇒ 都是「信载荷」）
	const payloadPatterns = [
		{ label: "base64url 解码", pattern: /base64url/ },
		{ label: "按 '.' 切 JWT", pattern: /split\(\s*["']\.["']\s*\)/ },
		{ label: "读 access 字段", pattern: /\[\s*["']access["']\s*\]/ },
		{ label: "读 is_superuser 字段", pattern: /\[\s*["']is_superuser["']\s*\]/ },
	];
	for (const entry of payloadPatterns) {
		check(
			`反代里没有「${entry.label}」这种解载荷的代码`,
			!entry.pattern.test(proxy),
			`proxy.ts 里出现了 ${entry.pattern}`,
		);
	}

	// ④-2 **fail closed**：没注入判定器 ⇒ 拒绝（不许回退到解载荷）
	check(
		"没注入判定器就拒绝（fail closed）",
		/options\.isAdmin\s*===\s*undefined/.test(proxy) ||
			/judge\s*===\s*undefined/.test(proxy),
		"没找到「没判定器 ⇒ 拒绝」的分支（⇒ 可能回退到了解载荷）",
	);
	check(
		"判定器缺省值**不是**某个本地函数（不许有兜底判定）",
		!/options\.isAdmin\s*\?\?/.test(proxy),
		"找到了 `options.isAdmin ?? …`（⇒ 有兜底判定 ⇒ 可能解载荷）",
	);

	// ④-3 判定器是**注入的**（问权威系统）
	check(
		"判定器是注入的（`isAdmin` 选项）",
		/isAdmin\??:\s*\(token:\s*string\)/.test(proxy),
		"没找到 isAdmin 选项",
	);

	// ④-4 判定器**带缓存**（同一个 token 只问一次 AiAdmin）
	//     ⇒ 缓存由内核的 `CachedCurrentUserResolver` 管（插件侧把它套在解析器外面）
	const judgePath = path.join(
		BACKEND,
		"src",
		"plugins",
		"pm",
		"adapter",
		"aadmin",
		"admin-judge.ts",
	);
	const judge = fs.existsSync(judgePath) ? fs.readFileSync(judgePath, "utf8") : "";
	check("插件侧有 admin 判定器（admin-judge.ts）", judge.length > 0, "找不到 admin-judge.ts");
	check(
		"判定器认的是 `is_superuser`（真后端的字段名）",
		/is_superuser/.test(
			fs.readFileSync(
				path.join(BACKEND, "src", "plugins", "pm", "adapter", "aadmin", "current-user.ts"),
				"utf8",
			),
		),
		"current-user.ts 里没有映射 is_superuser",
	);
	const pluginIndex = fs.readFileSync(path.join(BACKEND, "src", "plugins", "pm", "index.ts"), "utf8");
	check(
		"判定器**带缓存**（同一个 token 只问一次 AiAdmin）",
		/CachedCurrentUserResolver/.test(pluginIndex),
		"plugins/pm/index.ts 里没有用 CachedCurrentUserResolver",
	);

	// ④-5 入口侧**真的把判定器注入**了（不是只定义了不用）
	const serverText = fs.readFileSync(path.join(BACKEND, "src", "server.ts"), "utf8");
	check(
		"server.ts 把 admin 判定器注进了反代",
		/isAdmin:\s*adminJudge/.test(serverText),
		"server.ts 里没有 `isAdmin: adminJudge…`",
	);
}

const failed = results.filter((r) => !r.ok);
console.log(
	failed.length === 0
		? `✅ AI 管理面的静态验收全过（${results.length} 条）`
		: `❌ AI 管理面的静态验收失败 ${failed.length} 条（共 ${results.length} 条）`,
);
process.exit(failed.length === 0 ? 0 : 1);
