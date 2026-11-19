/**
 * 工具装配 —— 我们的命令 → **dsh 的工具目录**。
 *
 * ## 两件事
 *
 * ① **schema 转换**：我们的工具参数是 **typebox**（`core/tools/types.ts`），
 *    dsh 要的是**它自己的 JSON-Schema 风格 DSL**
 *    （`{ 项目名: { type: 'string', required: true, description } }`）
 *    ⇒ 这里做一层转换（≈ 80 行；typebox 的 schema 树 → dsh 的值 schema）。
 *
 * ② **工具名归一化**：dsh 会把 MCP 工具限定成 `mcp__<server>__<tool>`
 *    ⇒ 前端的命令卡片直接显示工具名 ⇒ 不归一化就是**产品可见的变化**
 *    ⇒ 这里把前缀剥掉（`mcp__aiadmin__create_task` ⇒ `create_task`）。
 *
 * ## 目录长什么样
 *
 * 目录**不是**在这里发给 dsh 的 —— 它要进到 **dsh 运行时进程**里
 * （工具住在 dsh 的 tool registry 里）⇒ 这里产出的是一份 **JSON 目录**，
 * 由适配层在起运行时之前塞进环境变量（见 `runner.ts`）。
 */

import type { CommandTool } from "../../tools/types.ts";
import { requiresConfirmation } from "../../gate/gate.ts";
import { asRecord, asString } from "./protocol.ts";
import { bareToolName } from "../../mcp/tool-names.ts";

/** dsh 的**值 schema**（我们自己声明的形状 ⇒ 不 import dsh 的类型）。 */
export type DshValueSchema =
	| { type: "string"; description?: string; enum?: string[] }
	| { type: "number"; description?: string }
	| { type: "integer"; description?: string }
	| { type: "boolean"; description?: string }
	| { type: "null"; description?: string }
	| { type: "array"; description?: string; items?: DshValueSchema }
	| {
			type: "object";
			description?: string;
			properties?: DshParameterSpec;
			additionalProperties: boolean;
	  }
	| { type: "json"; description?: string };

/** dsh 的**参数 schema**（隐式对象根；必填写在每个属性上）。 */
export interface DshParameterSpec {
	[property: string]: DshValueSchema & { required?: true };
}

/**
 * 一条工具目录项（**发给 dsh 侧插件**的形状）。
 *
 * ⚠️ `confirm` = 这个工具**要不要人点头**（口径在**我们**这边算 ⇒ dsh 只负责问）。
 */
export interface DshToolSpec {
	/** 工具名（**归一化后**的 ⇒ 界面上显示的就是它）。 */
	name: string;
	/** 描述（模型靠这段话决定用不用它）。 */
	description: string;
	/** 参数 schema（dsh 的 DSL，给 dsh 的工具表用）。 */
	parameters: DshParameterSpec;
	/**
	 * 参数 schema（**JSON Schema**，给**模型**看的那份）。
	 *
	 * ⚠️ dsh 的**模型侧**工具声明来自提示词层的「工具 schema 提供者」
	 *    （不是工具表）⇒ 我们要把 JSON Schema 一起带过去。
	 */
	modelParameters: Record<string, unknown>;
	/** 要不要先问人（口径：「新增放行、修改要点头」）。 */
	confirm: boolean;
}

/**
 * 工具名归一化：剥掉已知的 `mcp__<server>__` 前缀。
 *
 * ⚠️ **规则只有一处**（`core/mcp/tool-names.ts`）⇒ 界面 / 审计 / 待确认
 *    看到的名字**永远一致**。
 *
 * @param name 原始工具名。
 * @param prefixes 已知的服务器前缀（如 `mcp__aiadmin__`）。
 */
export function normalizeToolName(name: string, prefixes: readonly string[]): string {
	for (const prefix of prefixes) {
		if (prefix.length > 0 && name.startsWith(prefix)) {
			return name.slice(prefix.length);
		}
	}
	return bareToolName(name);
}

/**
 * typebox 的 schema → dsh 的参数 schema。
 *
 * ⚠️ **不认识的一律降级成 `json`**（不认识的类型不许悄悄丢掉约束
 *    ⇒ 模型看到「随便给个 JSON」比看到错的约束安全）。
 *
 * @param schema typebox 的 schema（结构上是 JSON Schema）。
 */
export function toDshParameters(schema: unknown): DshParameterSpec {
	const node = asRecord(schema);
	const properties = asRecord(node?.["properties"]) ?? {};
	const required = new Set(
		Array.isArray(node?.["required"])
			? node["required"].filter((item): item is string => typeof item === "string")
			: [],
	);
	const out: DshParameterSpec = {};
	for (const [name, property] of Object.entries(properties)) {
		const value = toDshValueSchema(property);
		out[name] = required.has(name) ? { ...value, required: true } : value;
	}
	return out;
}

/** 一个 JSON Schema 节点 → dsh 的值 schema。 */
function toDshValueSchema(node: unknown): DshValueSchema {
	const record = asRecord(node) ?? {};
	const description = asString(record["description"]);
	const type = asString(record["type"]);
	switch (type) {
		case "string": {
			const values = record["enum"];
			const enumValues = Array.isArray(values)
				? values.filter((item): item is string => typeof item === "string")
				: undefined;
			return {
				type: "string",
				...(description === undefined ? {} : { description }),
				...(enumValues === undefined ? {} : { enum: enumValues }),
			};
		}
		case "number":
			return description === undefined ? { type: "number" } : { type: "number", description };
		case "integer":
			return description === undefined ? { type: "integer" } : { type: "integer", description };
		case "boolean":
			return description === undefined ? { type: "boolean" } : { type: "boolean", description };
		case "null":
			return description === undefined ? { type: "null" } : { type: "null", description };
		case "array": {
			const items = record["items"];
			return {
				type: "array",
				...(description === undefined ? {} : { description }),
				...(items === undefined ? {} : { items: toDshValueSchema(items) }),
			};
		}
		case "object": {
			return {
				type: "object",
				...(description === undefined ? {} : { description }),
				properties: toDshParameters(record),
				// ⚠️ dsh 的对象 schema **必须**显式写开闭（不许默认）
				additionalProperties: record["additionalProperties"] === true,
			};
		}
		default:
			return description === undefined ? { type: "json" } : { type: "json", description };
	}
}

/**
 * 造工具目录（发给 dsh 侧插件）。
 *
 * @param tools 我们的命令工具（**已按智能体配置的白名单过滤**）。
 * @param prefixes 已知的 MCP 服务器前缀（用来归一化工具名）。
 */
export function buildToolCatalog(
	tools: readonly CommandTool[],
	prefixes: readonly string[] = [],
): DshToolSpec[] {
	return tools.map((tool) => {
		const name = normalizeToolName(tool.name, prefixes);
		return {
			name,
			description: tool.description,
			parameters: toDshParameters(tool.parameters),
			modelParameters: toJsonSchema(tool.parameters),
			// ⚠️ **口径在我们这边算**（`update_` / `patch_` 要点头）⇒ dsh 只负责「问」。
			confirm: requiresConfirmation(name),
		};
	});
}

/**
 * typebox 的 schema → **JSON Schema**（**模型侧**要的那份）。
 *
 * ⚠️ dsh 的**模型侧**工具声明是 JSON Schema；工具表那边是它自己的 DSL
 *    ⇒ 两份都要（`toDshParameters` 给工具表，这份给模型）。
 */
export function toJsonSchema(schema: unknown): Record<string, unknown> {
	const node = asRecord(schema);
	const properties = asRecord(node?.["properties"]) ?? {};
	const required = Array.isArray(node?.["required"])
		? node["required"].filter((item): item is string => typeof item === "string")
		: [];
	return {
		type: "object",
		properties: Object.fromEntries(
			Object.entries(properties).map(([name, property]) => [name, jsonNodeOf(property)]),
		),
		...(required.length > 0 ? { required } : {}),
		additionalProperties: false,
	};
}

/** 一个 JSON Schema 节点（**原样带走** ⇒ 不丢约束）。 */
function jsonNodeOf(node: unknown): unknown {
	const record = asRecord(node);
	if (record === undefined) {
		return {};
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (key === "properties") {
			out["properties"] = Object.fromEntries(
				Object.entries(asRecord(value) ?? {}).map(([name, property]) => [
					name,
					jsonNodeOf(property),
				]),
			);
			continue;
		}
		if (key === "items") {
			out["items"] = jsonNodeOf(value);
			continue;
		}
		out[key] = value;
	}
	return out;
}
