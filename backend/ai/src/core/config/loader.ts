/**
 * 智能体配置的**装载器** —— 读目录、读 YAML、校验、解析成可用的配置。
 *
 * ## 位置规矩
 *
 * `agents/<agentId>/agent.yaml`（**cwd 相对** ⇒ 与 `.pi/skills` 同一个规矩：
 * AI 服务必须在 `backend/ai/` 下启动）。
 *
 * 一个智能体一个目录 ⇒ 提示词与技能可以与配置同目录
 * （`systemPromptFile: prompt.md`、`skills: [./skills]`）。
 *
 * ## 口径：非法配置**启动即报错**
 *
 * 缺字段 / 类型错 / 引用的目录或文件不存在 ⇒ 抛 `AgentConfigError`，
 * 消息里点名**是哪个字段** ⇒ 不静默忽略。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { AgentConfigError } from "./errors.ts";
import { parseAgentConfig } from "./schema.ts";
import type { AgentConfig } from "./types.ts";

/** 配置文件名（一个目录里就认这一个）。 */
export const AGENT_CONFIG_FILENAME = "agent.yaml";

/**
 * 智能体配置的根目录（**cwd 相对** —— 与 `pi-session.ts` 的发现逻辑一致）。
 */
export function agentsRoot(): string {
	return join(process.cwd(), "agents");
}

/**
 * 装载某个目录下的**全部**智能体配置。
 *
 * @param rootDir 智能体配置根目录（通常是 `<cwd>/agents`）。
 * @returns 配置清单（按 id 排序 ⇒ 清单顺序稳定）；根目录不存在 ⇒ 空列表。
 * @throws {AgentConfigError} 任何一个配置不合法（**不静默忽略**）。
 */
export function loadAgentConfigs(rootDir: string): AgentConfig[] {
	const root = resolve(rootDir);
	if (!existsSync(root)) {
		// 没有智能体配置目录 ⇒ 这个服务就是「没有智能体」，不是故障
		return [];
	}

	const configs: AgentConfig[] = [];
	const entries = readdirSync(root, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const dir = join(root, entry.name);
		const configPath = join(dir, AGENT_CONFIG_FILENAME);
		if (!existsSync(configPath)) {
			// 不是智能体目录（普通子目录）⇒ 跳过
			continue;
		}
		configs.push(loadAgentConfig(configPath, dir));
	}

	return configs.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 装载**一个**智能体配置。
 *
 * @param configPath 配置文件路径（绝对）。
 * @param dir 配置所在目录（绝对）。
 * @throws {AgentConfigError} 配置不合法。
 */
export function loadAgentConfig(configPath: string, dir: string): AgentConfig {
	const raw = readYaml(configPath);
	const parsed = parseAgentConfig(raw, configPath);

	// ⚠️ id 必须与目录名一致 ⇒ 清单里的 id 永远等于目录名 ⇒ 不会重复、也不会指错
	if (parsed.id !== basename(dir)) {
		throw new AgentConfigError(
			`智能体配置不合法 —— 字段 id：必须与目录名一致（目录是「${basename(dir)}」，写的是「${parsed.id}」）`,
			configPath,
		);
	}

	const systemPrompt = resolveSystemPrompt(parsed.systemPrompt, parsed.systemPromptFile, dir, configPath);
	const skills = parsed.skills.map((skill, index) => {
		const path = resolveInDir(skill, dir);
		if (!existsSync(path) || !statSync(path).isDirectory()) {
			throw new AgentConfigError(
				`智能体配置不合法 —— 字段 skills[${index}]：目录不存在（${path}）`,
				configPath,
			);
		}
		return path;
	});

	const seen = new Set<string>();
	for (const [index, server] of parsed.mcpServers.entries()) {
		if (seen.has(server.name)) {
			throw new AgentConfigError(
				`智能体配置不合法 —— 字段 mcpServers[${index}].name：重复的服务器名「${server.name}」`,
				configPath,
			);
		}
		seen.add(server.name);
	}

	const mcpServers = parsed.mcpServers.map((server, index) => ({
		name: server.name,
		// ⚠️ **url 里的 `${ENV_VAR}` 在装载时展开**（启动即失败 ⇒ 不静默忽略）
		url:
			server.url === undefined
				? undefined
				: expandEnvVars(server.url, `mcpServers[${index}].url`, configPath),
		type: server.type,
		exposure: server.exposure,
	}));

	return {
		id: parsed.id,
		name: parsed.name,
		description: parsed.description,
		model: parsed.model,
		systemPrompt,
		skills,
		mcpServers,
		tools: [...parsed.tools],
		dir,
		configPath,
	};
}

/** 读 YAML（语法错 ⇒ 报错并指出位置）。 */
function readYaml(configPath: string): unknown {
	let text: string;
	try {
		text = readFileSync(configPath, "utf8");
	} catch (error) {
		throw new AgentConfigError(
			`智能体配置读不出来 —— ${error instanceof Error ? error.message : String(error)}`,
			configPath,
		);
	}
	try {
		return parseYaml(text);
	} catch (error) {
		throw new AgentConfigError(
			`智能体配置无法解析（YAML 语法错）—— ${error instanceof Error ? error.message : String(error)}`,
			configPath,
		);
	}
}

/** 相对路径按配置目录解析（绝对路径原样用）。 */
function resolveInDir(relative: string, dir: string): string {
	return isAbsolute(relative) ? resolve(relative) : resolve(dir, relative);
}

/**
 * 把字符串里的 `${ENV_VAR}` 换成环境变量的值。
 *
 * ⚠️ **变量没值 ⇒ 报错**（不静默留着 `${...}` 去连 ⇒ 连不上还看不出原因）。
 * ⚠️ **在装载时展开**（启动即失败）⇒ 变量后来变了要重启才生效。
 *
 * @param value 原始值。
 * @param field 字段路径（报错时点名）。
 * @param configPath 配置文件路径（报错时指给用户看）。
 */
function expandEnvVars(
	value: string,
	field: string,
	configPath: string,
): string {
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
		const found = process.env[name];
		if (found === undefined || found === "") {
			throw new AgentConfigError(
				`智能体配置不合法 —— 字段 ${field}：环境变量 ${name} 没有值（${match}）`,
				configPath,
			);
		}
		return found;
	});
}

/** 系统提示词：要么直接给，要么从文件读。 */
function resolveSystemPrompt(
	inline: string | undefined,
	file: string | undefined,
	dir: string,
	configPath: string,
): string {
	if (inline !== undefined) {
		return inline;
	}
	if (file === undefined) {
		// 理论上到不了这里（schema 已经保证二选一）⇒ 兜底成一句人话
		throw new AgentConfigError(
			"智能体配置不合法 —— 字段 systemPrompt：必填：systemPrompt 与 systemPromptFile 二选一",
			configPath,
		);
	}
	const path = resolveInDir(file, dir);
	if (!existsSync(path) || !statSync(path).isFile()) {
		throw new AgentConfigError(
			`智能体配置不合法 —— 字段 systemPromptFile：文件不存在（${path}）`,
			configPath,
		);
	}
	const text = readFileSync(path, "utf8");
	if (text.trim().length === 0) {
		throw new AgentConfigError(
			`智能体配置不合法 —— 字段 systemPromptFile：文件是空的（${path}）`,
			configPath,
		);
	}
	return text;
}
