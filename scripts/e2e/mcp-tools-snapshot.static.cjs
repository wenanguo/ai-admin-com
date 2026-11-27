/**
 * **MCP 工具快照守卫**（issue #182 · C18-4）—— 技能正文 ⇄ MCP 工具清单。
 *
 * ## 为什么要有它
 *
 * 技能正文（`backend/ai/.pi/skills/<名字>/SKILL.md`）里写的是 **MCP 工具的真实
 * 参数名**（`project_id` / `type_code` / `status_code` ……）⇒ 后端改了工具，
 * 技能就**悄悄失配** ⇒ 没人知道 ⇒ 模型拿着旧参数名去调 ⇒ 422。
 *
 * ⇒ 工具清单**快照进仓**（`backend/ai/mcp/aiadmin-tools.snapshot.json`）
 *    ⇒ 本脚本**离线**比对「技能 ⇄ 快照」⇒ 漂移在 CI 里就红。
 *
 * ## ⚠️ **离线**（不连真 MCP ⇒ CI 里能跑）
 *
 * 真 MCP 是**事实源**，但 CI 里没有它 ⇒ 所以：
 * - **抓快照**（人工、联网）：`node scripts/mcp/snapshot-aiadmin-tools.cjs`
 * - **守卫**（离线、CI）：本脚本。
 *
 * ## 钉住的事
 *
 * | # | 断言 |
 * | - | ---- |
 * | 1 | 快照**格式合法**（服务器名 / 抓取日期 / 每个工具都有名字与参数 schema） |
 * | 2 | 技能正文里提到的 **MCP 工具都存在**（不许提到不存在的工具） |
 * | 3 | 技能正文里的**参数名 ⊆ schema 的 properties** |
 * | 4 | 技能正文里标「必填」的参数 **== schema 的 required**（双向） |
 * | 5 | 技能正文里的**参数类型 == schema 的类型** |
 * | 6 | 快照里**每个工具都被技能覆盖**（后端新增工具 ⇒ 红） |
 * | 7 | **自研命令名不许与 MCP 裸名撞车**（同名两义 ⇒ 模型会挑错） |
 * | 8 | **负例自测**：改坏快照 ⇒ 守卫必须报错（证明它不是摆设） |
 *
 * 用法：`node scripts/e2e/mcp-tools-snapshot.static.cjs`（在仓根跑）。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const aiRoot = path.join(repoRoot, "backend", "ai");

/** 快照文件（相对仓根）。 */
const SNAPSHOT_PATH = path.join("backend", "ai", "mcp", "aiadmin-tools.snapshot.json");
/** 技能目录。 */
const SKILLS_DIR = path.join(aiRoot, ".pi", "skills");
/** MCP 工具名前缀（模型侧看到的名字）。 */
const MCP_PREFIX = "mcp__";

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
 * 收集目录下的 `SKILL.md`（**只一层** ⇒ 与 dsh 的发现规则一致）。
 *
 * @param {string} dir 目录。
 * @returns {string[]} 文件路径。
 */
function skillFilesOf(dir) {
	if (!fs.existsSync(dir)) {
		return [];
	}
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			const file = path.join(full, "SKILL.md");
			if (fs.existsSync(file)) {
				out.push(file);
			}
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			out.push(full);
		}
	}
	return out;
}

/**
 * 相对仓根的路径（正斜杠）。
 *
 * @param {string} file 路径。
 * @returns {string} 相对路径。
 */
function rel(file) {
	return path.relative(repoRoot, file).split(path.sep).join("/");
}

/**
 * 一个技能正文里**提到**的 MCP 工具名（裸名）。
 *
 * ⚠️ 认的是**带前缀的完整名**（`mcp__aiadmin__create_task`）⇒ 剥掉前缀拿裸名。
 *
 * @param {string} source 技能正文。
 * @returns {string[]} 工具裸名（去重、保序）。
 */
function mentionedTools(source) {
	const out = [];
	const pattern = /mcp__[a-z0-9-]+__([A-Za-z0-9_]+)/g;
	let match;
	while ((match = pattern.exec(source)) !== null) {
		if (!out.includes(match[1])) {
			out.push(match[1]);
		}
	}
	return out;
}

/**
 * 一个技能正文里**参数表**声明的参数。
 *
 * 约定的写法（**人能读、机器也能读**）：
 *
 * ```markdown
 * ## 参数（`mcp__aiadmin__create_task`）
 *
 * | 参数 | 类型 | 必填 | 说明 |
 * | ---- | ---- | ---- | ---- |
 * | `project_id` | integer | ✅ | 所属项目 id |
 * ```
 *
 * @param {string} source 技能正文。
 * @returns {Array<{tool: string, params: Array<{name: string, type: string, required: boolean}>}>} 参数表。
 */
function parameterTables(source) {
	const tables = [];
	const heading = /^#{2,3}\s*参数[（(]\s*`([^`]+)`\s*[）)]\s*$/gm;
	let match;
	while ((match = heading.exec(source)) !== null) {
		const tool = match[1];
		const params = [];
		// ⚠️ 从标题往后找**第一张表**（跳过表头行与分隔行）。
		const lines = source.slice(match.index + match[0].length).split(/\r?\n/);
		let rowIndex = 0;
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("|")) {
				if (rowIndex > 0) {
					break;
				}
				continue;
			}
			const cells = trimmed
				.slice(1, trimmed.endsWith("|") ? -1 : undefined)
				.split("|")
				.map((cell) => cell.trim());
			// ⚠️ 第一行是**表头**、第二行是**分隔行**（`| ---- |`）⇒ 都跳过。
			if (rowIndex === 0) {
				rowIndex += 1;
				continue;
			}
			if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
				rowIndex += 1;
				continue;
			}
			rowIndex += 1;
			const name = /`([^`]+)`/.exec(cells[0] ?? "")?.[1];
			if (name === undefined) {
				continue;
			}
			params.push({
				name,
				type: (cells[1] ?? "").toLowerCase(),
				required: /✅|必填|是/.test(cells[2] ?? ""),
			});
		}
		if (params.length > 0) {
			tables.push({ tool, params });
		}
	}
	return tables;
}

/**
 * schema 的**有效类型**（`anyOf` 里第一个非 null 的类型）。
 *
 * @param {object | undefined} schema 参数的 schema。
 * @returns {string | null} 类型名（认不出 ⇒ null）。
 */
function effectiveType(schema) {
	if (schema === undefined || schema === null) {
		return null;
	}
	if (typeof schema.type === "string") {
		return schema.type;
	}
	if (Array.isArray(schema.anyOf)) {
		for (const node of schema.anyOf) {
			const type = node?.type;
			if (typeof type === "string" && type !== "null") {
				return type;
			}
		}
	}
	return null;
}

/**
 * **核心检查**：技能正文 ⇄ 工具快照。
 *
 * ⚠️ **纯函数**（不碰文件系统）⇒ 负例自测可以直接喂「改坏的快照」。
 *
 * @param {object} snapshot 快照。
 * @param {Array<{file: string, source: string}>} skills 技能正文。
 * @returns {string[]} 失败清单（空数组 = 全过）。
 */
function checkSnapshot(snapshot, skills) {
	const failures = [];

	// ① 快照本身的形状
	if (typeof snapshot?.server !== "string" || snapshot.server.length === 0) {
		failures.push("快照缺 server（服务器名）");
	}
	if (typeof snapshot?.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.capturedAt)) {
		failures.push("快照缺 capturedAt（YYYY-MM-DD）");
	}
	const tools = Array.isArray(snapshot?.tools) ? snapshot.tools : [];
	if (tools.length === 0) {
		failures.push("快照里一个工具都没有");
		return failures;
	}
	const byName = new Map();
	for (const tool of tools) {
		if (typeof tool?.name !== "string" || tool.name.length === 0) {
			failures.push("快照里有工具缺 name");
			continue;
		}
		if (byName.has(tool.name)) {
			failures.push(`快照里工具 ${tool.name} 出现了两次`);
		}
		byName.set(tool.name, tool);
		const schema = tool.inputSchema;
		if (typeof schema !== "object" || schema === null) {
			failures.push(`快照里的 ${tool.name} 缺 inputSchema`);
			continue;
		}
		if (schema.properties === undefined && (schema.required ?? []).length > 0) {
			failures.push(`快照里的 ${tool.name} 有 required 却没有 properties`);
		}
	}

	// ② 技能提到的工具都存在
	const mentioned = new Map();
	for (const skill of skills) {
		for (const tool of mentionedTools(skill.source)) {
			if (!mentioned.has(tool)) {
				mentioned.set(tool, skill.file);
			}
		}
	}
	for (const [tool, file] of mentioned) {
		if (!byName.has(tool)) {
			failures.push(`${file}：提到了 MCP 工具 ${tool}，但快照里没有（后端改名了？先刷新快照）`);
		}
	}

	// ③④⑤ 参数表 ⇄ schema
	const covered = new Set();
	for (const skill of skills) {
		for (const table of parameterTables(skill.source)) {
			const bare = table.tool.replace(new RegExp(`^${MCP_PREFIX}[a-z0-9-]+__`), "");
			const tool = byName.get(bare);
			if (tool === undefined) {
				failures.push(
					`${skill.file}：参数表写的工具 ${table.tool} 不在快照里（技能 ⇄ MCP 已经漂移）`,
				);
				continue;
			}
			covered.add(bare);
			const properties = tool.inputSchema?.properties ?? {};
			const required = new Set(tool.inputSchema?.required ?? []);
			const declared = new Set();
			for (const param of table.params) {
				declared.add(param.name);
				const schema = properties[param.name];
				if (schema === undefined) {
					failures.push(
						`${skill.file}：${bare} 的参数 ${param.name} 不在 MCP schema 里（后端改了参数？）`,
					);
					continue;
				}
				// 必填：双向
				if (param.required && !required.has(param.name)) {
					failures.push(
						`${skill.file}：${bare}.${param.name} 标了必填，但 MCP schema 里不是必填`,
					);
				}
				if (!param.required && required.has(param.name)) {
					failures.push(
						`${skill.file}：${bare}.${param.name} 没标必填，但 MCP schema 里是必填`,
					);
				}
				// 类型
				const expected = effectiveType(schema);
				if (expected !== null && param.type.length > 0 && param.type !== expected) {
					failures.push(
						`${skill.file}：${bare}.${param.name} 的类型写的是 ${param.type}，MCP schema 是 ${expected}`,
					);
				}
			}
			for (const name of required) {
				if (!declared.has(name)) {
					failures.push(
						`${skill.file}：${bare} 的必填参数 ${name} 没写进参数表（MCP 要求必填）`,
					);
				}
			}
		}
	}

	// ⑥ 快照里每个工具都被技能覆盖（后端新增工具 ⇒ 红）
	for (const tool of tools) {
		if (!covered.has(tool.name)) {
			failures.push(`快照里的工具 ${tool.name} 没有技能覆盖（后端新增了工具？补一条技能）`);
		}
	}

	return failures;
}

/**
 * **我们自研**的命令名（从插件源码里扫 `*_TOOL_NAME` 常量）。
 *
 * ⚠️ 约定：自研命令的名字**必须**用 `export const <名字>_TOOL_NAME = "..."` 声明
 *    ⇒ 扫得到 ⇒ 守卫能盯着「不许与 MCP 裸名撞车」。
 *
 * @returns {string[]} 命令名。
 */
function ownToolNames() {
	const dir = path.join(aiRoot, "src", "plugins");
	const names = [];
	const walk = (current) => {
		if (!fs.existsSync(current)) {
			return;
		}
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
				continue;
			}
			const source = read(full) ?? "";
			const pattern = /export const [A-Z0-9_]*TOOL_NAME\s*=\s*"([^"]+)"/g;
			let match;
			while ((match = pattern.exec(source)) !== null) {
				names.push({ name: match[1], file: rel(full) });
			}
		}
	};
	walk(dir);
	return names;
}

/**
 * 主流程。
 *
 * @returns {void} 结束。
 */
function main() {
	const snapshotFile = path.join(repoRoot, SNAPSHOT_PATH);
	const raw = read(snapshotFile);
	if (raw === undefined) {
		console.error(`❌ 快照文件不在：${SNAPSHOT_PATH.split(path.sep).join("/")}`);
		console.error("   抓一份：node scripts/mcp/snapshot-aiadmin-tools.cjs");
		process.exit(1);
	}
	let snapshot;
	try {
		snapshot = JSON.parse(raw);
	} catch (error) {
		console.error(`❌ 快照不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}

	const skillFiles = skillFilesOf(SKILLS_DIR);
	const skills = skillFiles.map((file) => ({ file: rel(file), source: read(file) ?? "" }));

	console.log(`① 快照：${SNAPSHOT_PATH.split(path.sep).join("/")}`);
	console.log(`   服务器 ${snapshot.server} · 抓于 ${snapshot.capturedAt} · ${snapshot.tools?.length ?? 0} 个工具`);
	console.log(`② 技能：${skills.length} 份`);

	const failures = checkSnapshot(snapshot, skills);

	// ⑦ 自研命令名不许与 MCP 裸名撞车（**同名两义** ⇒ 模型会挑错）
	const own = ownToolNames();
	for (const tool of own) {
		const mcpTool = (snapshot.tools ?? []).find((candidate) => candidate.name === tool.name);
		if (mcpTool !== undefined) {
			failures.push(
				`${tool.file}：自研命令 ${tool.name} 与 MCP 工具**同名**（模型侧叫 mcp__aiadmin__${tool.name}）⇒ 同名两义 ⇒ 改名（issue #182）`,
			);
		}
	}
	if (own.length > 0) {
		console.log(`   自研命令：${own.map((tool) => tool.name).join(" / ")}（不许与 MCP 裸名撞车）`);
	}

	if (failures.length > 0) {
		console.error(`\n❌ 技能 ⇄ MCP 快照：不一致（${failures.length} 条）`);
		for (const failure of failures) {
			console.error(`   - ${failure}`);
		}
		console.error(
			"\n   怎么修：① 后端改了工具 ⇒ 先刷新快照 node scripts/mcp/snapshot-aiadmin-tools.cjs",
		);
		console.error("        ② 技能正文按快照里的真实参数名与必填项改（技能是提示词 ⇒ 走 git 评审）");
		process.exit(1);
	}
	console.log("   ✅ 技能正文与快照一致（工具名 / 参数名 / 必填 / 类型）");

	// ⑧ 负例自测：**改坏快照 ⇒ 守卫必须报错**（否则守卫就是摆设）。
	const broken = JSON.parse(raw);
	broken.tools[0].name = `${broken.tools[0].name}_renamed`;
	const negativeFailures = checkSnapshot(broken, skills);
	if (negativeFailures.length === 0) {
		console.error("\n❌ 负例自测失败：把快照里的工具改名了，守卫却没报错（守卫是摆设）");
		process.exit(1);
	}
	console.log(`   ✅ 负例自测：改坏快照 ⇒ 守卫报了 ${negativeFailures.length} 条（守卫不是摆设）`);

	console.log("\n✅ MCP 工具快照守卫：全部通过");
}

main();
