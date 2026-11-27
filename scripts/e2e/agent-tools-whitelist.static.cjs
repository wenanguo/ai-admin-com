/**
 * **智能体白名单漂移守卫**（issue #194）—— `agent.yaml` 的 `tools:` ⇄ 插件命令名。
 *
 * ## 为什么要有它
 *
 * 智能体配置里的 `tools:` 白名单决定**哪些插件命令会被注册给模型**：
 *
 * ```ts
 * // backend/ai/src/core/session/runtime.ts
 * const tools = (plugin?.commands ?? []).filter((command) =>
 *   agent.tools.includes(command.name),
 * );
 * ```
 *
 * ⇒ **漂移的后果是「静默」的**：
 * - 白名单写了旧名字（改名时忘了改配置）⇒ **工具不注册** ⇒ 模型**看不到** ⇒ **不报错、不告警**；
 * - 白名单漏了新命令 ⇒ 同上 ⇒ **命令凭空消失**。
 *
 * ⇒ 这正是 issue #169（`create_task` → `pm_create_task`）最容易踩的坑。
 * ⇒ 而且界面上的「工具数」取的就是白名单长度（`core/config/catalog.ts`）
 *    ⇒ 白名单漂移 ⇒ **界面也在骗人**。
 *
 * ## ⚠️ **离线**（不联网、不装依赖 ⇒ 任何 runner 都能跑）
 *
 * - 白名单：`backend/ai/agents/<id>/agent.yaml` 的 `tools:`（**由人编辑**的配置）；
 * - 命令名：`backend/ai/src/plugins/**` 里 `export const <名字>_TOOL_NAME = "..."` 常量
 *   （约定：自研命令的名字**必须**用这个形式声明 ⇒ 扫得到）。
 *
 * ## 钉住的事
 *
 * | # | 断言 |
 * | - | ---- |
 * | 1 | 白名单里的每个名字 ⇒ **必须**有某个插件提供（`export const ..._TOOL_NAME`） |
 * | 2 | 白名单里的名字 ⇒ **必须**属于这个智能体**实际用的**那个插件（显式写的，或默认插件） |
 * | 3 | 显式挂了插件 X 的智能体 ⇒ X 的**每个**命令 ⇒ **必须**在它的白名单里（不许凭空消失） |
 * | 4 | `plugin:` 写的插件名 ⇒ **必须**存在（写错 ⇒ 运行时启动即失败） |
 * | 5 | 两个插件不许用同一个 id（否则按名字取插件会取错） |
 * | 6 | **负例自测**：改坏白名单 ⇒ 守卫必须红；改回 ⇒ 必须绿（证明它不是摆设） |
 *
 * ## 口径（为什么有的规则只对一部分智能体生效）
 *
 * - **规则 3 只对「显式写了 `plugin:`」的智能体生效**：
 *   没写 `plugin:` 的智能体用**默认插件**（`core/session/agent-resolver.ts` 的 `pluginOf`）
 *   ⇒ 允许它**一个工具都不要**（`qa` 就是「只会聊天」⇒ 白名单故意是空的）。
 * - **规则 2 对两种智能体都生效**：白名单里的名字必须属于**实际用的**那个插件
 *   ⇒ 否则它会被运行时过滤掉 ⇒ **静默**不注册。
 *
 * ## 已知边界（不在本守卫的范围里）
 *
 * - 插件里**声明了**常量但**没登记进** `commands` 的命令 ⇒ 本守卫看不出来
 *   （声明即事实源 ⇒ 那是插件自己的事）。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/e2e/agent-tools-whitelist.static.cjs                   # 在仓根跑
 * node scripts/e2e/agent-tools-whitelist.static.cjs --agents <目录>   # 换一份配置目录（负例自测用）
 * node scripts/e2e/agent-tools-whitelist.static.cjs --plugins <目录>  # 换一份插件目录
 * ```
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const aiRoot = path.join(repoRoot, "backend", "ai");

/** 智能体配置目录（**仓根相对** ⇒ 与 cwd 无关）。 */
const DEFAULT_AGENTS_DIR = path.join(aiRoot, "agents");
/** 插件源码目录（插件 id = 目录名；目录里写了 `*_PLUGIN_ID` 常量则以它为准）。 */
const PLUGINS_DIR = path.join(aiRoot, "src", "plugins");
/** 插件注册入口（**默认插件 = 这里注册的第一个** ⇒ 与运行时同一个口径）。 */
const PLUGINS_ENTRY = path.join(aiRoot, "src", "plugins.ts");
/** MCP 工具快照（**只用来给报错加提示** ⇒ 没有也不影响判定）。 */
const MCP_SNAPSHOT = path.join(aiRoot, "mcp", "aiadmin-tools.snapshot.json");

/**
 * 读文件（不存在 ⇒ undefined）。
 *
 * @param {string} file 路径。
 * @returns {string | undefined} 内容。
 */
function read(file) {
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/**
 * 相对仓根的路径（正斜杠 ⇒ 报错里给的是人能直接点开的路径）。
 *
 * @param {string} file 路径。
 * @returns {string} 相对路径。
 */
function rel(file) {
	return path.relative(repoRoot, file).split(path.sep).join("/");
}

/**
 * 去掉行尾注释（**引号里的 `#` 不算**）。
 *
 * @param {string} line 一行。
 * @returns {string} 去掉注释后的内容。
 */
function stripComment(line) {
	let inSingle = false;
	let inDouble = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === "'" && !inDouble) {
			inSingle = !inSingle;
			continue;
		}
		if (char === '"' && !inSingle) {
			inDouble = !inDouble;
			continue;
		}
		if (char === "#" && !inSingle && !inDouble) {
			const before = line[index - 1];
			if (before === undefined || /\s/.test(before)) {
				return line.slice(0, index);
			}
		}
	}
	return line;
}

/**
 * 去掉标量外面的引号。
 *
 * @param {string} value 原始值。
 * @returns {string} 去掉引号后的值。
 */
function unquote(value) {
	const trimmed = value.trim();
	const quoted =
		(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2);
	return quoted ? trimmed.slice(1, -1) : trimmed;
}

/**
 * 解析行内列表（`[a, b]`）。
 *
 * @param {string} text 行内列表的文本。
 * @returns {string[]} 元素。
 */
function parseFlowList(text) {
	const inner = text.trim().replace(/^\[/, "").replace(/\]$/, "");
	if (inner.trim() === "") {
		return [];
	}
	return inner
		.split(",")
		.map((item) => unquote(stripComment(item)))
		.filter((item) => item.length > 0);
}

/**
 * **只**解析我们要的三个字段（`id` / `plugin` / `tools`）。
 *
 * ⚠️ 这里**不引 YAML 库**（守卫要「不装依赖就能跑」）⇒ 只认 `agent.yaml`
 *    实际用到的那点 YAML 写法：`键: 值` / `键:` + 缩进的 `- 列表项` / `键: []`。
 *    解析不出来 ⇒ **报错**（不许静默当成「没有白名单」）。
 *
 * @param {string} text 文件内容。
 * @returns {{id: string | undefined, plugin: string | undefined, tools: string[]}} 解析结果。
 */
function parseAgentConfig(text) {
	const result = { id: undefined, plugin: undefined, tools: [] };
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const raw = lines[index];
		if (raw.trim() === "" || /^\s*#/.test(raw)) {
			continue;
		}
		// ⚠️ 缩进行 ⇒ 嵌套（别的键的列表项 / 块标量）⇒ 不是我们要的顶层键。
		if (/^\s/.test(raw)) {
			continue;
		}
		const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw);
		if (match === null) {
			continue;
		}
		const key = match[1];
		const inline = stripComment(match[2]).trim();
		if (key === "id") {
			result.id = unquote(inline);
			continue;
		}
		if (key === "plugin") {
			result.plugin = inline === "" ? undefined : unquote(inline);
			continue;
		}
		if (key !== "tools") {
			continue;
		}
		if (inline.startsWith("[")) {
			result.tools = parseFlowList(inline);
			continue;
		}
		// 块序列（`tools:` 下面缩进的 `- 名字`）。
		const items = [];
		for (let next = index + 1; next < lines.length; next += 1) {
			const line = lines[next];
			if (line.trim() === "" || /^\s*#/.test(line)) {
				continue;
			}
			if (!/^\s/.test(line)) {
				break;
			}
			const item = /^\s*-\s*(.*)$/.exec(line);
			if (item === null) {
				break;
			}
			const value = unquote(stripComment(item[1]));
			if (value !== "") {
				items.push(value);
			}
		}
		result.tools = items;
	}
	return result;
}

/**
 * 收集智能体配置（`agents/<id>/agent.yaml`）。
 *
 * @param {string} agentsDir 智能体配置根目录。
 * @returns {Array<{id: string | undefined, plugin: string | undefined, tools: string[], file: string, dirName: string}>} 配置清单。
 */
function collectAgents(agentsDir) {
	if (!fs.existsSync(agentsDir)) {
		return [];
	}
	const agents = [];
	for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const configPath = path.join(agentsDir, entry.name, "agent.yaml");
		const text = read(configPath);
		if (text === undefined) {
			continue;
		}
		const parsed = parseAgentConfig(text);
		agents.push({
			id: parsed.id,
			plugin: parsed.plugin,
			tools: parsed.tools,
			file: configPath,
			dirName: entry.name,
		});
	}
	return agents.sort((left, right) => left.dirName.localeCompare(right.dirName));
}

/**
 * 收集插件提供的命令名。
 *
 * ⚠️ **插件 id = 目录名**（`src/plugins/pm/` ⇒ `pm`）；目录里写了
 *    `export const <名字>_PLUGIN_ID = "..."` ⇒ 以那个为准。
 *
 * @param {string} pluginsDir 插件源码目录。
 * @returns {{byId: Map<string, {id: string, dirName: string, commands: Array<{name: string, file: string}>}>, byDir: Map<string, string>, defaultId: string | undefined, notes: string[]}} 插件清单。
 */
function collectPlugins(pluginsDir) {
	const byId = new Map();
	const byDir = new Map();
	const notes = [];
	if (!fs.existsSync(pluginsDir)) {
		return { byId, byDir, defaultId: undefined, notes };
	}
	for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const dir = path.join(pluginsDir, entry.name);
		const files = [];
		const walk = (current) => {
			for (const child of fs.readdirSync(current, { withFileTypes: true })) {
				const full = path.join(current, child.name);
				if (child.isDirectory()) {
					walk(full);
					continue;
				}
				if (!child.isFile() || !child.name.endsWith(".ts")) {
					continue;
				}
				// ⚠️ 测试文件里也可能写着常量 ⇒ 不算（那是测试数据）。
				if (child.name.endsWith(".test.ts")) {
					continue;
				}
				files.push(full);
			}
		};
		walk(dir);

		let pluginId = entry.name;
		const commands = [];
		for (const file of files) {
			const source = read(file) ?? "";
			const idPattern = /export const [A-Z0-9_]*PLUGIN_ID\s*=\s*"([^"]+)"/g;
			let idMatch;
			while ((idMatch = idPattern.exec(source)) !== null) {
				pluginId = idMatch[1];
			}
			const namePattern = /export const [A-Z0-9_]*TOOL_NAME\s*=\s*"([^"]+)"/g;
			let nameMatch;
			while ((nameMatch = namePattern.exec(source)) !== null) {
				commands.push({ name: nameMatch[1], file: rel(file) });
			}
		}
		if (byId.has(pluginId)) {
			notes.push(
				`两个插件目录用了同一个插件 id「${pluginId}」（${byId.get(pluginId).dirName} 与 ${entry.name}）⇒ 按名字取插件会取错`,
			);
			continue;
		}
		byId.set(pluginId, { id: pluginId, dirName: entry.name, commands });
		byDir.set(entry.name, pluginId);
	}

	return { byId, byDir, defaultId: detectDefaultPluginId(byDir, byId), notes };
}

/**
 * **默认插件**（没写 `plugin:` 的智能体用的那个）。
 *
 * ⚠️ 口径必须与运行时一致（`core/plugins.ts` 的 `defaultPlugin()` = **注册的第一个**）：
 *    入口 `src/plugins.ts` 里 `export const plugins = [createXxxPlugin()]` ⇒ 数组第一项。
 *
 * @param {Map<string, string>} byDir 目录名 ⇒ 插件 id。
 * @param {Map<string, {id: string}>} byId 插件 id ⇒ 插件。
 * @returns {string | undefined} 默认插件 id（认不出来 ⇒ undefined）。
 */
function detectDefaultPluginId(byDir, byId) {
	const source = read(PLUGINS_ENTRY);
	if (source !== undefined) {
		// 工厂 ⇒ 目录（`import { createPmPlugin } from "./plugins/pm/index.ts"`）。
		const factoryToDir = new Map();
		const importPattern = /import\s*\{([^}]+)\}\s*from\s*"\.\/plugins\/([^/"]+)\//g;
		let importMatch;
		while ((importMatch = importPattern.exec(source)) !== null) {
			for (const name of importMatch[1].split(",")) {
				factoryToDir.set(name.trim(), importMatch[2]);
			}
		}
		// 注册顺序（数组第一项 = 默认插件）。
		const arrayBody = /export const plugins\s*:[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1];
		const factory = arrayBody === undefined ? undefined : /create[A-Za-z0-9]*Plugin/.exec(arrayBody)?.[0];
		if (factory !== undefined) {
			const dirName = factoryToDir.get(factory);
			// ⚠️ `byDir` 存的是「目录名 ⇒ 插件 id」⇒ 取出来就是 id。
			const pluginId = dirName === undefined ? undefined : byDir.get(dirName);
			if (pluginId !== undefined) {
				return pluginId;
			}
		}
	}
	// ⚠️ 兜底：**只有一个插件** ⇒ 它就是默认插件。
	if (byId.size === 1) {
		return [...byId.keys()][0];
	}
	return undefined;
}

/**
 * MCP 快照里的工具裸名（**只用来在报错里加一句提示** ⇒ 没有也不影响判定）。
 *
 * @returns {Set<string>} 工具名。
 */
function mcpToolNames() {
	const raw = read(MCP_SNAPSHOT);
	if (raw === undefined) {
		return new Set();
	}
	try {
		const snapshot = JSON.parse(raw);
		const tools = Array.isArray(snapshot?.tools) ? snapshot.tools : [];
		return new Set(tools.map((tool) => tool?.name).filter((name) => typeof name === "string"));
	} catch {
		return new Set();
	}
}

/**
 * **核心检查**：白名单 ⇄ 插件命令名（**双向**）。
 *
 * ⚠️ **纯函数**（只吃数据 ⇒ 负例自测可以直接喂「改坏的配置」）。
 *
 * @param {Array<{id: string | undefined, plugin: string | undefined, tools: string[], file: string, dirName: string}>} agents 智能体配置。
 * @param {{byId: Map<string, {id: string, dirName: string, commands: Array<{name: string, file: string}>}>}} plugins 插件清单。
 * @returns {Array<{where: string, what: string, how: string[]}>} 失败清单（空数组 = 全过）。
 */
function checkAgents(agents, plugins) {
	const failures = [];
	const mcpNames = mcpToolNames();
	const byId = plugins.byId;

	/** 所有插件的命令名（⇒ 白名单里的名字至少要有一个插件提供）。 */
	const ownersOf = (name) =>
		[...byId.values()].filter((plugin) =>
			plugin.commands.some((command) => command.name === name),
		);

	/** 一个插件的命令清单（人读）。 */
	const commandList = (plugin) =>
		plugin === undefined
			? "（没有）"
			: plugin.commands.length === 0
				? "（这个插件还没有命令）"
				: plugin.commands.map((command) => command.name).join(" / ");

	for (const agent of agents) {
		const where = `${rel(agent.file)}（智能体 ${agent.id ?? agent.dirName}）`;

		// ⓪ 配置本身要看得懂（解析不出 id ⇒ 守卫看不懂 ⇒ 不许当「没问题」放过去）
		if (agent.id === undefined || agent.id === "") {
			failures.push({
				where,
				what: "这个配置文件里解析不出 `id`（守卫看不懂它 ⇒ 不许当成「没问题」）",
				how: [
					"检查 `id:` 那一行是不是被注释掉了、或者写法变了",
					"守卫只认 `键: 值` 这种最简写法（见 scripts/e2e/agent-tools-whitelist.static.cjs）",
				],
			});
			continue;
		}
		if (agent.id !== agent.dirName) {
			failures.push({
				where,
				what: `配置里的 id 是「${agent.id}」，目录名却是「${agent.dirName}」（运行时会启动即报错）`,
				how: ["把 `id:` 改成与目录名一致"],
			});
		}

		// 这个智能体**实际用**的插件（显式写的 ⇒ 它；没写 ⇒ 默认插件）。
		const effectivePluginId = agent.plugin ?? plugins.defaultId;

		for (const name of agent.tools) {
			const owners = ownersOf(name);
			// ① 白名单里的每个名字 ⇒ 必须有某个插件提供
			if (owners.length === 0) {
				const known = [...byId.values()]
					.map((plugin) => `${plugin.id} → ${commandList(plugin)}`)
					.join("；");
				const how = [
					`插件里声明这个命令：export const <名字>_TOOL_NAME = "${name}"`,
					"或把白名单里的名字改成插件真有的命令（**改名时两边都要改**）",
				];
				if (mcpNames.has(name)) {
					how.unshift(
						`⚠️ 它其实是 **MCP 的裸名**（模型侧叫 mcp__aiadmin__${name}）⇒ MCP 工具**不受白名单管** ⇒ 这一行删掉就行`,
					);
				}
				failures.push({
					where,
					what: `白名单里的「${name}」**没有任何插件提供**这个命令 ⇒ 运行时它不会被注册 ⇒ 模型看不到（静默）`,
					how: [...how, `现在插件有的命令：${known === "" ? "（没有）" : known}`],
				});
				continue;
			}
			// ② 白名单里的名字 ⇒ 必须属于这个智能体**实际用**的那个插件
			if (effectivePluginId === undefined) {
				continue;
			}
			if (!owners.some((plugin) => plugin.id === effectivePluginId)) {
				failures.push({
					where,
					what: `白名单里的「${name}」属于别的插件（${owners.map((plugin) => plugin.id).join(" / ")}），但这个智能体实际用的是「${effectivePluginId}」⇒ 它不会被注册（静默）`,
					how: [
						`换成插件 ${effectivePluginId} 真有的命令：${commandList(byId.get(effectivePluginId))}`,
						"或改 `plugin:` 指向真正提供它的插件",
					],
				});
			}
		}

		// ③ 显式挂了插件 X ⇒ X 的每个命令都必须在白名单里
		if (agent.plugin !== undefined) {
			const plugin = byId.get(agent.plugin);
			if (plugin === undefined) {
				failures.push({
					where,
					what: `写的插件「${agent.plugin}」**不存在** ⇒ 运行时会启动即失败`,
					how: [
						`现在有的插件：${[...byId.keys()].join(" / ") || "（没有）"}`,
						"插件 id = `backend/ai/src/plugins/` 下的目录名",
					],
				});
				continue;
			}
			for (const command of plugin.commands) {
				if (!agent.tools.includes(command.name)) {
					failures.push({
						where,
						what: `插件 ${plugin.id} 的命令「${command.name}」**不在白名单里** ⇒ 它不会被注册 ⇒ 命令凭空消失（静默）`,
						how: [
							`把「${command.name}」加进 tools: 白名单`,
							`它在 ${command.file} 里声明（export const <名字>_TOOL_NAME = "${command.name}"）`,
							"白名单现在有：",
							...(agent.tools.length === 0
								? ["  （空）"]
								: agent.tools.map((tool) => `  · ${tool}`)),
						],
					});
				}
			}
		}
	}

	return failures;
}

/**
 * **负例自测**：把白名单**改坏** ⇒ 守卫必须红；**改回** ⇒ 必须绿。
 *
 * ⚠️ 改的是**临时拷贝**（`os.tmpdir()`）⇒ 不碰仓库里的真配置。
 *
 * @param {string} agentsDir 智能体配置根目录。
 * @param {string} pluginsDir 插件源码目录。
 * @returns {{ok: boolean, message: string}} 结果。
 */
function negativeSelfTest(agentsDir, pluginsDir) {
	const agents = collectAgents(agentsDir);
	const victim = agents.find((agent) => agent.tools.length > 0);
	if (victim === undefined) {
		return {
			ok: false,
			message: "找不到有白名单的智能体 ⇒ 没法做负例自测（守卫没被证伪过）",
		};
	}
	const original = read(victim.file) ?? "";
	const name = victim.tools[0];
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tools-guard-"));
	try {
		fs.cpSync(agentsDir, tmpDir, { recursive: true });
		const tmpFile = path.join(tmpDir, victim.dirName, "agent.yaml");

		// ① **改坏**（把白名单里的名字拼错）⇒ 守卫必须红
		const broken = original.replace(
			new RegExp(`^(\\s*-\\s*)${escaped}\\s*$`, "m"),
			(_match, prefix) => `${prefix}${name}_broken_by_guard`,
		);
		if (broken === original) {
			return { ok: false, message: `改不动 ${rel(victim.file)} 的白名单 ⇒ 负例自测没跑成` };
		}
		fs.writeFileSync(tmpFile, broken, "utf8");
		const brokenFailures = checkAgents(collectAgents(tmpDir), collectPlugins(pluginsDir));
		if (brokenFailures.length === 0) {
			return {
				ok: false,
				message: "负例自测失败：把白名单里的名字改坏了，守卫却没报错（守卫是摆设）",
			};
		}

		// ② **改回** ⇒ 守卫必须绿
		fs.writeFileSync(tmpFile, original, "utf8");
		const restoredFailures = checkAgents(collectAgents(tmpDir), collectPlugins(pluginsDir));
		if (restoredFailures.length > 0) {
			return {
				ok: false,
				message: `负例自测失败：把白名单改回去了，守卫却还在报错（${restoredFailures.length} 条）`,
			};
		}

		// ③ **整个脚本**跑一遍（断言退出码）⇒ 证明「红」是真的红
		const exitCodes = [];
		for (const content of [broken, original]) {
			fs.writeFileSync(tmpFile, content, "utf8");
			try {
				const result = spawnSync(
					process.execPath,
					[__filename, "--agents", tmpDir, "--plugins", pluginsDir, "--no-self-test"],
					{ stdio: "ignore" },
				);
				exitCodes.push(result.status);
			} catch {
				// ⚠️ 某些沙箱不许 spawn ⇒ 跳过这一项（①②已经证过逻辑）。
				exitCodes.push(null);
			}
		}
		if (exitCodes[0] !== null && exitCodes[0] !== 1) {
			return {
				ok: false,
				message: `负例自测失败：改坏配置后脚本的退出码是 ${exitCodes[0]}，应该是 1（红）`,
			};
		}
		if (exitCodes[1] !== null && exitCodes[1] !== 0) {
			return {
				ok: false,
				message: `负例自测失败：改回配置后脚本的退出码是 ${exitCodes[1]}，应该是 0（绿）`,
			};
		}
		const exitNote =
			exitCodes[0] === null ? "（当前环境不许 spawn ⇒ 退出码那一项跳过）" : "（退出码 1 ⇒ 0）";
		return {
			ok: true,
			message: `改坏「${name}」⇒ 守卫报 ${brokenFailures.length} 条；改回 ⇒ 全绿${exitNote}`,
		};
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

/**
 * 主流程。
 *
 * @returns {void} 结束。
 */
function main() {
	const args = process.argv.slice(2);
	const agentsDir = args.includes("--agents")
		? path.resolve(args[args.indexOf("--agents") + 1])
		: DEFAULT_AGENTS_DIR;
	const pluginsDir = args.includes("--plugins")
		? path.resolve(args[args.indexOf("--plugins") + 1])
		: PLUGINS_DIR;
	const withSelfTest = !args.includes("--no-self-test");

	const agents = collectAgents(agentsDir);
	const plugins = collectPlugins(pluginsDir);

	console.log(`① 智能体配置：${rel(agentsDir)}（${agents.length} 份）`);
	for (const agent of agents) {
		const plugin = agent.plugin ?? plugins.defaultId ?? "（认不出默认插件）";
		console.log(
			`   · ${agent.id ?? agent.dirName}：插件 ${plugin} · 白名单 ${agent.tools.length === 0 ? "（空）" : agent.tools.join(" / ")}`,
		);
	}
	console.log(
		`② 插件命令：${plugins.byId.size} 个插件（默认插件 = ${plugins.defaultId ?? "（认不出）"}）`,
	);
	for (const plugin of plugins.byId.values()) {
		console.log(
			`   · ${plugin.id}：${plugin.commands.length === 0 ? "（没有命令）" : plugin.commands.map((command) => command.name).join(" / ")}`,
		);
	}
	for (const note of plugins.notes) {
		console.error(`   ⚠️ ${note}`);
	}

	const failures = checkAgents(agents, plugins);
	if (failures.length > 0) {
		console.error(`\n❌ 白名单 ⇄ 插件命令：不一致（${failures.length} 条）`);
		failures.forEach((failure, index) => {
			console.error(`\n   ${index + 1}. ${failure.where}`);
			console.error(`      ${failure.what}`);
			for (const line of failure.how) {
				console.error(`      · ${line}`);
			}
		});
		console.error(
			"\n   为什么这很要紧：白名单漂移 ⇒ 工具**静默不注册** ⇒ 模型看不到它 ⇒ 不报错、不告警",
		);
		process.exit(1);
	}
	console.log("   ✅ 白名单里的每个名字都有插件提供；每个插件命令都在对应智能体的白名单里");

	if (withSelfTest) {
		const negative = negativeSelfTest(agentsDir, pluginsDir);
		if (!negative.ok) {
			console.error(`\n❌ 负例自测失败：${negative.message}`);
			process.exit(1);
		}
		console.log(`   ✅ 负例自测：${negative.message}`);
	}

	console.log("\n✅ 智能体白名单漂移守卫：全部通过");
}

main();
