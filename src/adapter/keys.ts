/**
 * 统一模型的 key —— 实体在统一模型里的身份。
 *
 * 统一模型不用后端的数字 id 当身份（id 是后端内部实现），而是套一层**透明包装**：
 * `task:123`、`project:45`、`user:7`（AIPM 02 §2 的 `ext:12345` 风格）。
 *
 * 好处：
 * - 一眼看出是什么实体（LLM 不会把任务 id 和项目 id 搞混）；
 * - 后端 id 变了，只要映射跟着改，上层拿到的 key 语义不变；
 * - 解析失败能立刻给出人话提示，而不是把一个坏字符串丢给后端。
 */

import { AdapterErrorException } from "../aadmin/errors";

/** 统一模型里能出现的实体种类。 */
export type EntityKind = "project" | "milestone" | "task" | "risk" | "user";

/** 所有实体种类（用来做白名单校验）。 */
export const ENTITY_KINDS: readonly EntityKind[] = ["project", "milestone", "task", "risk", "user"];

/** 解析出来的 key。 */
export interface ParsedEntityKey {
	kind: EntityKind;
	id: number;
}

/** 造一个 key：`entityKey("task", 123)` → `"task:123"`。 */
export function entityKey(kind: EntityKind, id: number): string {
	return `${kind}:${id}`;
}

/** 这个字符串是不是一种实体种类（类型守卫，不用 `as`）。 */
function isEntityKind(value: string): value is EntityKind {
	for (const kind of ENTITY_KINDS) {
		if (kind === value) {
			return true;
		}
	}
	return false;
}

/** 纯数字 id（`"45"`）→ 45；不合法返回 undefined。 */
export function tryParseNumericId(value: string): number | undefined {
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) {
		return undefined;
	}
	const id = Number(trimmed);
	return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/**
 * 解析 `<kind>:<id>` 形式的 key；不合法返回 undefined（**不抛**）。
 *
 * id 必须是正整数 —— 0 与负数都不是后端的主键。
 */
export function tryParseEntityKey(key: string): ParsedEntityKey | undefined {
	const trimmed = key.trim();
	const separator = trimmed.indexOf(":");
	if (separator <= 0) {
		return undefined;
	}
	const kind = trimmed.slice(0, separator);
	const idText = trimmed.slice(separator + 1);
	if (!isEntityKind(kind)) {
		return undefined;
	}
	const id = tryParseNumericId(idText);
	if (id === undefined) {
		return undefined;
	}
	return { kind, id };
}

/**
 * 解析 key，不合法就抛 `VALIDATION` 错误（带人能看懂的原因）。
 *
 * `expectedKind` 给了的话，种类对不上也算不合法
 * （别把 `project:45` 当成任务 id 用）。
 */
export function parseEntityKey(key: string, expectedKind?: EntityKind): ParsedEntityKey {
	const parsed = tryParseEntityKey(key);
	if (parsed === undefined) {
		throw new AdapterErrorException(
			"VALIDATION",
			`「${key}」不是合法的实体 key（形如 task:123 / project:45）`,
		);
	}
	if (expectedKind !== undefined && parsed.kind !== expectedKind) {
		throw new AdapterErrorException(
			"VALIDATION",
			`「${key}」是 ${parsed.kind} 的 key，这里需要 ${expectedKind} 的 key`,
		);
	}
	return parsed;
}
