/**
 * 独立 dsh 项目的**运行时验收**（issue #183）。
 *
 * ## 它证明什么
 *
 * 1. **独立目录能起 dsh**（**真跑起来**，不是写个 README）：
 *    引导 profile ⇒ 装外部插件 ⇒ 起 dsh 子进程 ⇒ **模型真的被调用** ⇒ 拿到回答；
 * 2. **凭据只走环境变量**：假 key **只出现在子进程的环境变量里**
 *    ⇒ **磁盘上搜不到**（连 dsh 的 home 里都搜不到）；
 * 3. **模型路由只有变量名**：profile 的补丁里有 `apiKeyEnv`，**没有** key。
 *
 * ## 为什么不需要模型凭据
 *
 * ⚠️ 脚本自己起一个**假模型服务**（OpenAI 兼容的 SSE）⇒
 *    测的是「**独立项目这一套接线**」⇒ **不花钱、不外网**（除了装插件要 pnpm）。
 *
 * ## 前置
 *
 * - **Node ≥ 24.9**（dsh 的 engines 要求）；
 * - **pnpm**（dsh 的 profile 是 pnpm 工程 ⇒ 装插件要它）；
 * - 依赖装好（`cd dsh && npm ci`）。
 *
 * 用法（**在仓根跑**）：
 *
 * ```bash
 * node scripts/e2e/dsh-standalone.cjs
 * ```
 */

const { spawn, spawnSync } = require("node:child_process");
const { createServer } = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DSH_DIR = path.join(REPO_ROOT, "dsh");

/** 假 key（**只在进程环境里** ⇒ 磁盘上搜不到）。 */
const FAKE_KEY = "e2e-fake-key-DO-NOT-LEAK-0123456789";
/** 模型回答里带的标记（⇒ 断言「答案真的回来了」）。 */
const ANSWER_MARK = "独立项目跑起来了";

/** 失败信息（收集起来 ⇒ 一次性报）。 */
const failures = [];

/**
 * 断言。
 *
 * @param {string} label 断言。
 * @param {boolean} ok 过没过。
 * @param {string} [detail] 细节。
 */
function check(label, ok, detail) {
	console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` —— ${detail}`}`);
	if (!ok) {
		failures.push(detail === undefined ? label : `${label} —— ${detail}`);
	}
}

/* ------------------------------------------------------------------ *
 * 假模型服务（OpenAI 兼容的 SSE）
 * ------------------------------------------------------------------ */

/** 模型被调用了几次。 */
let modelCalls = 0;
/** 模型看到的请求头（⇒ 断言 key 是走环境变量 ⇒ 变成了 Authorization）。 */
let seenAuth = "";
/** 模型看到的模型 id。 */
let seenModel = "";

const model = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		modelCalls += 1;
		seenAuth = String(req.headers.authorization ?? "");
		try {
			seenModel = String(JSON.parse(body).model ?? "");
		} catch {
			seenModel = "";
		}
		res.writeHead(200, { "content-type": "text/event-stream" });
		const send = (payload) => {
			res.write(`data: ${JSON.stringify(payload)}\n\n`);
		};
		// ⚠️ **分三块发** ⇒ 断言「拼起来 == 整句话」（真的是流式，不是只拿最后一块）。
		for (const piece of ["独立", "项目", "跑起来了"]) {
			send({ choices: [{ delta: { content: piece } }] });
		}
		send({ choices: [{ delta: {}, finish_reason: "stop" }] });
		res.end();
	});
});

/**
 * 跑一个 dsh 项目的脚本（**等它跑完**）。
 *
 * @param {string} script 脚本名（相对 dsh/scripts）。
 * @param {string[]} args 参数。
 * @param {number} timeoutMs 超时。
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} 结果。
 */
function runNode(script, args, timeoutMs = 180_000) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [path.join(DSH_DIR, "scripts", script), ...args], {
			cwd: DSH_DIR,
			env: childEnv,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			child.kill();
		}, timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
}

// ⚠️ **dsh 的 home 放临时目录** ⇒ 验收不碰开发者本地的 profile。
const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-standalone-e2e-"));

const childEnv = {
	...process.env,
	STANDALONE_HOME: dshHome,
	STANDALONE_MODEL: "MiniMax-M3",
	STANDALONE_PROVIDER: "minimax",
	STANDALONE_API_KEY_ENV: "MINIMAX_CN_API_KEY",
	MINIMAX_CN_API_KEY: FAKE_KEY,
	// ⚠️ **插件的调试日志**写到临时目录（不污染仓库）。
	AI_DSH_DEBUG_LOG: path.join(dshHome, "plugin-debug.log"),
};

async function main() {
	await new Promise((resolve) => model.listen(0, resolve));
	const modelPort = model.address().port;
	const baseURL = `http://127.0.0.1:${modelPort}/v1`;
	childEnv.STANDALONE_BASE_URL = baseURL;

	console.log("① 前置检查…");
	{
		const dshPkg = path.join(DSH_DIR, "node_modules", "@deepseek-ai", "dsh", "package.json");
		check("依赖装好了（cd dsh && npm ci）", fs.existsSync(dshPkg));
		const pnpm = spawnSync("pnpm -v", { encoding: "utf8", shell: true });
		check(`pnpm 可用（${pnpm.status === 0 ? pnpm.stdout.trim() : "没找到"}）`, pnpm.status === 0);
	}

	console.log("② 引导 profile（建 profile + 装外部插件 + 写模型路由）…");
	{
		const result = await runNode("bootstrap.mjs", []);
		check("引导成功", result.code === 0, result.stderr.slice(0, 400));
		const profileDir = path.join(dshHome, "profiles", "standalone");
		const patchPath = path.join(profileDir, "cordis.patch.yml");
		check("profile 的补丁写出来了", fs.existsSync(patchPath));
		if (fs.existsSync(patchPath)) {
			const patch = fs.readFileSync(patchPath, "utf8");
			check("补丁里有模型路由（llm-pi-ai）", patch.includes("llm-pi-ai"));
			check(
				"补丁里只有**变量名**（apiKeyEnv）",
				patch.includes('apiKeyEnv: "MINIMAX_CN_API_KEY"'),
				patch.slice(0, 300),
			);
			check("补丁里**没有**密钥", !patch.includes(FAKE_KEY));
		}
		const manifestPath = path.join(profileDir, "package.json");
		if (fs.existsSync(manifestPath)) {
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
			const spec = manifest.dependencies?.["@ai-admin/dsh-plugin"];
			check(
				"外部插件按 **file: 引用**装进 profile（不是复制源码）",
				typeof spec === "string" && spec.startsWith("file:"),
				`实际是 ${spec}`,
			);
		}
		check(
			"插件的拷贝在 profile 里",
			fs.existsSync(path.join(profileDir, "node_modules", "@ai-admin", "dsh-plugin")),
		);
	}

	console.log("③ 真起 dsh 跑一轮对话（假模型服务 ⇒ 不花钱、不外网）…");
	{
		const result = await runNode("chat.mjs", ["用一句话回答：1+1 等于几？"]);
		check("对话跑完了（退出码 0）", result.code === 0, result.stderr.slice(0, 600));
		check("模型真的被调用了", modelCalls >= 1, `modelCalls=${modelCalls}`);
		check("模型 id 是我们配的那个", seenModel === "MiniMax-M3", `实际是 ${seenModel}`);
		check(
			"key 是**走环境变量**变成请求头的（⇒ 没落盘）",
			seenAuth.includes(FAKE_KEY),
			`Authorization=${seenAuth.slice(0, 24)}…`,
		);
		check("答案回来了", result.stdout.includes(ANSWER_MARK), result.stdout.slice(-300));
	}

	console.log("④ 凭据**不落盘**（连 dsh 的 home 里都搜不到）…");
	{
		const hits = [];
		const walk = (dir) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				if (!entry.isFile()) {
					continue;
				}
				const text = fs.readFileSync(full, "utf8");
				if (text.includes(FAKE_KEY)) {
					hits.push(path.relative(dshHome, full));
				}
			}
		};
		if (fs.existsSync(dshHome)) {
			walk(dshHome);
		}
		check("dsh 的 home 里搜不到 key", hits.length === 0, `命中：${hits.join(", ")}`);
	}

	model.close();
	fs.rmSync(dshHome, { recursive: true, force: true });

	if (failures.length > 0) {
		console.error(`\n❌ 失败 ${failures.length} 条：`);
		for (const failure of failures) {
			console.error(`   - ${failure}`);
		}
		process.exit(1);
	}
	console.log("\n✅ 独立 dsh 项目：起得来 · 外部插件装得上 · 凭据不落盘");
	process.exit(0);
}

main();

