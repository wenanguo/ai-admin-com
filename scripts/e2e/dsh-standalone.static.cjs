/**
 * 独立 dsh 项目的**静态验收**（issue #183）。
 *
 * ## 它证明什么
 *
 * 1. **独立**：自己的清单 / 自己的 lock / 自己的 profile / 自己的镜像
 *    ⇒ **依赖不进本仓依赖树**（本仓的三个 lock 一个字节没动）；
 * 2. **外部插件**：本仓的插件**按 `file:` 引用**装进 profile ⇒ **不复制源码**；
 * 3. **凭据只走环境变量**：仓库里**搜不到密钥** ⇒ 入库的模板里只有**变量名**；
 * 4. **文档可执行**：README 里的步骤**齐**（照着做就能装起来）。
 *
 * ## 为什么是静态的
 *
 * ⚠️ **不联网、不装依赖、不需要模型凭据** ⇒ 任何 runner 都能跑（CI 里当门禁）。
 * ⇒ 真起 dsh 的那一半在 `scripts/e2e/dsh-standalone.cjs`（要装依赖 + pnpm）。
 *
 * ## 负例自测
 *
 * ⚠️ 「守卫是摆设」是这类脚本最常见的失效方式 ⇒ 这里用**临时副本**改坏四处，
 *    证明**每条断言都会咬人**（真文件全程不碰）。
 *
 * 用法（**在仓根跑**）：
 *
 * ```bash
 * node scripts/e2e/dsh-standalone.static.cjs
 * ```
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** 断言结果（**只收「真实仓根」那轮的** ⇒ 负例自测的失败不算账）。 */
const results = [];

/**
 * 造一个断言函数（**收集到指定的池子里**）。
 *
 * @param {object[]} sink 结果池。
 * @returns {Function} 断言函数。
 */
function makeChecker(sink) {
	return function check(label, ok, detail) {
		sink.push({ label, ok, detail });
		console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` —— ${detail}`}`);
	};
}

/** 主断言函数（**负例自测的结果不进这里** ⇒ 故意改坏副本不会算账）。 */
const check = makeChecker(results);

/**
 * 读一个 JSON 文件（读不到 ⇒ undefined）。
 *
 * @param {string} file 路径。
 * @returns {object|undefined} 解析结果。
 */
function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * 目录下的文件（**递归**；跳过 `node_modules` 与 `.git`）。
 *
 * @param {string} dir 目录。
 * @returns {string[]} 文件路径。
 */
function filesOf(dir) {
	const out = [];
	if (!fs.existsSync(dir)) {
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".dsh-home") {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...filesOf(full));
		} else if (entry.isFile()) {
			out.push(full);
		}
	}
	return out;
}

/** 密钥的样子（**真 key** 长这样 ⇒ 模板里的占位符不算）。 */
const SECRET_PATTERNS = [
	/sk-[A-Za-z0-9]{16,}/,
	/MINIMAX_CN_API_KEY=[A-Za-z0-9_-]{16,}/,
	/DEEPSEEK_API_KEY=[A-Za-z0-9_-]{16,}/,
];

/**
 * 检查一个仓根（**真实仓根 / 临时副本**都能查 ⇒ 负例自测靠它）。
 *
 * @param {string} root 仓根。
 * @returns {{label: string, ok: boolean, detail: string|undefined}[]} 断言结果。
 */
function inspect(root) {
	const sink = [];
	const check = makeChecker(sink);
	const dsh = path.join(root, "dsh");

	// ── ① 骨架 ────────────────────────────────────────────────────────────
	const manifest = readJson(path.join(dsh, "package.json"));
	check("dsh/package.json 存在且合法", manifest !== undefined);
	if (manifest === undefined) {
		return sink;
	}
	check("dsh/package.json：private（不发布）", manifest.private === true);
	check("dsh/package.json：ESM（type=module）", manifest.type === "module");
	check(
		"dsh/package.json：engines.node ≥ 24.9（dsh 的要求）",
		typeof manifest.engines?.node === "string" &&
			Number.parseFloat(manifest.engines.node.replace(/^[^\d]*/, "")) >= 24.9,
		`实际是 ${manifest.engines?.node}`,
	);
	check("dsh/package-lock.json 存在（**自己的 lock**）", fs.existsSync(path.join(dsh, "package-lock.json")));
	check("dsh/Dockerfile 存在（**自己的镜像**）", fs.existsSync(path.join(dsh, "Dockerfile")));
	check("dsh/README.md 存在", fs.existsSync(path.join(dsh, "README.md")));
	check("dsh/docs/minimax.md 存在（MiniMax 说明）", fs.existsSync(path.join(dsh, "docs", "minimax.md")));

	// ── ② 依赖：只有 dsh 的包 · 版本精确锁死 ──────────────────────────────
	const deps = { ...(manifest.dependencies ?? {}) };
	const depNames = Object.keys(deps);
	check(
		"依赖里只有 @deepseek-ai/* 的包（**不依赖本仓的任何包**）",
		depNames.every((name) => name.startsWith("@deepseek-ai/")),
		`实际：${depNames.join(", ") || "（空）"}`,
	);
	check("依赖里有 dsh 运行时本体（@deepseek-ai/dsh）", depNames.includes("@deepseek-ai/dsh"));
	const loose = depNames.filter((name) => /[\^~><*]|latest/.test(deps[name]));
	check("dsh 的版本**精确锁死**（无 ^ / ~ / latest）", loose.length === 0, `松的：${loose.join(", ")}`);

	// ── ③ 不进本仓依赖树 ──────────────────────────────────────────────────
	const rootManifest = readJson(path.join(root, "package.json"));
	const workspaces = rootManifest?.workspaces;
	const workspaceList = Array.isArray(workspaces)
		? workspaces
		: typeof workspaces?.packages === "object"
			? Object.keys(workspaces.packages)
			: [];
	check(
		"根 package.json 没有把 dsh/ 收进 workspaces（⇒ 独立）",
		!workspaceList.some((item) => String(item).includes("dsh")),
		`workspaces=${JSON.stringify(workspaceList)}`,
	);
	const aiManifest = readJson(path.join(root, "backend", "ai", "package.json"));
	const aiDeps = { ...(aiManifest?.dependencies ?? {}), ...(aiManifest?.devDependencies ?? {}) };
	check(
		"backend/ai 的清单里没有指向 dsh/ 的依赖（⇒ 两边不互相污染）",
		!Object.values(aiDeps).some((value) => String(value).includes("dsh/")),
	);

	// ── ④ 外部插件：按引用装，不复制源码 ─────────────────────────────────
	const dshFiles = filesOf(dsh);
	const copiedPlugin = dshFiles.filter((file) => /dsh-plugin[\\/]/.test(file));
	check(
		"dsh/ 里**没有**插件源码的拷贝（⇒ 插件是「外部插件」）",
		copiedPlugin.length === 0,
		`拷进来了：${copiedPlugin.map((f) => path.relative(root, f)).join(", ")}`,
	);
	const profileLib = fs.existsSync(path.join(dsh, "scripts", "lib", "profile.mjs"))
		? fs.readFileSync(path.join(dsh, "scripts", "lib", "profile.mjs"), "utf8")
		: "";
	check(
		"引导脚本按 **file: 引用**装插件（不是复制源码）",
		profileLib.includes("file:") && profileLib.includes("@ai-admin/dsh-plugin"),
	);
	check(
		"引导脚本按**内容指纹**判重（改了插件会重装）",
		profileLib.includes("pluginFingerprint") && profileLib.includes("sha256"),
	);

	// ── ⑤ 凭据：只走环境变量 · 仓库里搜不到密钥 ──────────────────────────
	const secretHits = [];
	for (const file of dshFiles) {
		const text = fs.readFileSync(file, "utf8");
		for (const pattern of SECRET_PATTERNS) {
			const match = pattern.exec(text);
			if (match !== null) {
				secretHits.push(`${path.relative(root, file)}：${match[0].slice(0, 24)}…`);
			}
		}
	}
	check("dsh/ 里**搜不到密钥**", secretHits.length === 0, secretHits.join(" / "));
	const envExample = path.join(dsh, ".env.example");
	const envText = fs.existsSync(envExample) ? fs.readFileSync(envExample, "utf8") : "";
	const keyLine = envText.split(/\r?\n/).find((line) => line.startsWith("MINIMAX_CN_API_KEY="));
	check(
		".env.example 里的 key 是**空值**（只有真值才进 .env）",
		keyLine !== undefined && keyLine.trim() === "MINIMAX_CN_API_KEY=",
		`实际是「${keyLine}」`,
	);
	const dshKeys = envText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
		.map((line) => line.split("=")[0])
		.filter((key) => key.startsWith("DSH_"));
	check(
		".env.example 里**没有 DSH_ 开头的键**（dsh 拒收 ⇒ 照着配就炸）",
		dshKeys.length === 0,
		`有：${dshKeys.join(", ")}`,
	);
	const gitignore = fs.existsSync(path.join(dsh, ".gitignore"))
		? fs.readFileSync(path.join(dsh, ".gitignore"), "utf8")
		: "";
	check("dsh/.gitignore 忽略 .env（凭据不入库）", /^\.env$/m.test(gitignore));
	check("dsh/.gitignore 忽略 .dsh-home（dsh 的本地状态）", /^\.dsh-home\/?$/m.test(gitignore));

	// ── ⑥ profile 与路由：只有变量名 ─────────────────────────────────────
	check(
		"模型路由只写**变量名**（apiKeyEnv）⇒ 密钥不落盘",
		profileLib.includes("apiKeyEnv") && !/apiKey:\s/.test(profileLib),
	);
	check("profile 的补丁层是 cordis.patch.yml（dsh 的用户层）", profileLib.includes("cordis.patch.yml"));

	// ── ⑦ 文档可执行 ─────────────────────────────────────────────────────
	const readme = fs.existsSync(path.join(dsh, "README.md"))
		? fs.readFileSync(path.join(dsh, "README.md"), "utf8")
		: "";
	for (const step of ["npm ci", ".env.example", "npm run doctor", "npm run bootstrap", "npm run chat"]) {
		check(`README 里有这一步：${step}`, readme.includes(step));
	}
	check("README 链到 MiniMax 的说明", readme.includes("docs/minimax.md"));

	// ── ⑧ 镜像 ───────────────────────────────────────────────────────────
	const dockerfile = fs.existsSync(path.join(dsh, "Dockerfile"))
		? fs.readFileSync(path.join(dsh, "Dockerfile"), "utf8")
		: "";
	check("Dockerfile：ARG NODE_VERSION=24", /ARG NODE_VERSION=24/.test(dockerfile));
	check("Dockerfile：装了 pnpm（装插件要它）", dockerfile.includes("pnpm"));
	check("Dockerfile：把插件源码拷进镜像（外部插件）", dockerfile.includes("backend/ai/dsh-plugin"));
	// ⚠️ **只查 `.env` 本身**（`.env.example` 是**模板** ⇒ 允许拷进镜像）。
	check(
		"Dockerfile：凭据只从环境变量进（镜像里没有 .env）",
		!/COPY\s+\S*\.env(\s|$)/m.test(dockerfile),
	);

	return sink;
}

/**
 * 造一个「最小可跑」的仓根副本（**只拷守卫会看的部分** ⇒ 快）。
 *
 * @param {Function} mutate 改副本（负例自测用）。
 * @returns {string} 副本的仓根。
 */
function makeFixture(mutate) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-standalone-"));
	const copy = (from, to) => {
		const target = path.join(root, to);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.cpSync(from, target, { recursive: true, filter: (src) => !src.includes("node_modules") });
	};
	copy(path.join(REPO_ROOT, "dsh"), "dsh");
	copy(path.join(REPO_ROOT, "package.json"), "package.json");
	copy(path.join(REPO_ROOT, "backend", "ai", "package.json"), path.join("backend", "ai", "package.json"));
	mutate(root);
	return root;
}

/** 跑一遍检查（**在临时副本上** ⇒ 真文件不碰）。 */
function runInspect(root) {
	return inspect(root);
}

console.log("① 真实的独立项目 ⇒ 全部断言通过");
results.push(...inspect(REPO_ROOT));

console.log("② 负例：把真值写进 .env.example ⇒ 必须被抓");
{
	const root = makeFixture((dir) => {
		const file = path.join(dir, "dsh", ".env.example");
		fs.writeFileSync(file, "MINIMAX_CN_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345\n", "utf8");
	});
	const hits = runInspect(root).filter((item) => !item.ok);
	check("被抓（断言没过）", hits.length > 0, `过的断言有 ${hits.length} 条`);
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("③ 负例：.env.example 里写 DSH_ 开头的键 ⇒ 必须被抓");
{
	const root = makeFixture((dir) => {
		const file = path.join(dir, "dsh", ".env.example");
		fs.appendFileSync(file, "DSH_HOME=./x\n", "utf8");
	});
	const hits = runInspect(root).filter((item) => !item.ok);
	check("被抓（断言没过）", hits.length > 0);
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("④ 负例：把插件源码拷进 dsh/ ⇒ 必须被抓（不许复制源码）");
{
	const root = makeFixture((dir) => {
		const file = path.join(dir, "dsh", "dsh-plugin", "src", "index.js");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "export const name = 'ai-admin'\n", "utf8");
	});
	const hits = runInspect(root).filter((item) => !item.ok);
	check("被抓（断言没过）", hits.length > 0);
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("⑤ 负例：把版本写成 ^0.2.2-rc.5 ⇒ 必须被抓（要精确锁死）");
{
	const root = makeFixture((dir) => {
		const file = path.join(dir, "dsh", "package.json");
		const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
		manifest.dependencies["@deepseek-ai/dsh"] = "^0.2.2-rc.5";
		fs.writeFileSync(file, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
	});
	const hits = runInspect(root).filter((item) => !item.ok);
	check("被抓（断言没过）", hits.length > 0);
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("⑥ 负例：依赖本仓的包（ai-admin-ai）⇒ 必须被抓（要独立）");
{
	const root = makeFixture((dir) => {
		const file = path.join(dir, "dsh", "package.json");
		const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
		manifest.dependencies["ai-admin-ai"] = "file:../backend/ai";
		fs.writeFileSync(file, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
	});
	const hits = runInspect(root).filter((item) => !item.ok);
	check("被抓（断言没过）", hits.length > 0);
	fs.rmSync(root, { recursive: true, force: true });
}

/**
 * 本仓的三个 lock **一个字节没动**（⇒ 独立依赖真的没进本仓依赖树）。
 *
 * ## 怎么比才不出错
 *
 * ⚠️ **比「基线 → HEAD 的树」**（`git diff <base> HEAD -- <lock>`），**不**比工作区：
 *   ① 比工作区（`git diff <base> -- <lock>`）会被**换行符转换**骗到
 *      （本仓的 lock 在 blob 里是 CRLF ⇒ Linux runner 上 checkout 后工作区是 LF
 *      ⇒ 明明没改，却报「改了」⇒ **假红**）；
 *   ② 基线取 **merge-base**：本地是「分支点」⇒ 差异 = 这条分支的改动；
 *      CI 里 HEAD 是**合并提交**⇒ merge-base 就是 main 的 tip ⇒ 差异 = 这个 PR 的改动。
 *
 * ⚠️ 拿不到基线分支 ⇒ **只警告、不失败**（与仓里其它脚本同一口径）。
 */
console.log("⑦ 本仓的三个 lock 没被改（⇒ 独立依赖不进本仓依赖树）");
{
	const locks = ["package-lock.json", "frontend/package-lock.json", "backend/ai/package-lock.json"];
	let base = null;
	try {
		base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
	} catch {
		base = null;
	}
	if (!base) {
		console.log("  ⚠ 拿不到基线分支（origin/main）⇒ 跳过本项（只警告，不失败）");
	} else {
		for (const lock of locks) {
			let diff = "";
			try {
				diff = execFileSync("git", ["diff", "--name-only", base, "HEAD", "--", lock], {
					encoding: "utf8",
				});
			} catch {
				diff = "";
			}
			check(`${lock}：没被这个 PR 改`, diff.trim().length === 0, diff.trim());
		}
	}
}

const failed = results.filter((item) => !item.ok);
console.log(
	failed.length === 0
		? `✅ 独立 dsh 项目的静态验收全过（${results.length} 条）`
		: `❌ 独立 dsh 项目的静态验收失败 ${failed.length} 条（共 ${results.length} 条）：\n` +
			failed.map((item) => `   - ${item.label}${item.detail ? `（${item.detail}）` : ""}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
