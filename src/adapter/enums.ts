/**
 * 枚举归一 —— 把 AiAdmin 的**字典值**（线上码）归一成 AIPM 02 §2 的**统一模型名**。
 *
 * 事实源是后端字典，不是 AIPM 文档：
 * - `D:/project/AiAdmin/backend/sql/mysql/pm_v2_seed_v1.sql`（种子里的 `dict_value` 列）
 * - 线上库 `sys_dict_data`（2026-11-04 实测；唯一偏差见 task-4-report.md）
 *
 * 映射是**双向多对一**：
 * - 线上码 → 统一名：一个统一名可以对应多个线上码（表里是数组）；
 * - 统一名 → 线上码：取数组里的**第一个**（标准码）。
 * 目前八个字段实测下来都是 1:1，但结构本身支持多对一 —— 别把它写死成一对一。
 *
 * **未命中的值不猜语义**：归一为该字段的默认值（后端字典里 `is_default=1` 的那一个）
 * 并**记一条告警**。调用方可以注入自己的 sink 把告警带出去（写进审计日志 / 回给用户）。
 */

/* ------------------------------------------------------------------ 统一枚举 */

/** 任务状态（后端字典 `module_pm_task_status`）。 */
export type UnifiedTaskStatus =
	| "BACKLOG"
	| "TODO"
	| "IN_PROGRESS"
	| "REVIEW"
	| "DONE"
	| "BLOCKED"
	| "CANCELLED";

/**
 * 任务类型（后端字典 `module_pm_task_type`）。
 *
 * ⚠️ 与 AIPM 02 §2 的 `FEATURE | BUG | TASK | CHORE` **不一致** ——
 * 后端字典里是 feature/bug/ops/research/spike，没有 TASK/CHORE。
 * 事实源是后端字典，所以这里以 ops/research/spike 为准（详见 task-4-report.md）。
 */
export type UnifiedTaskType = "FEATURE" | "BUG" | "OPS" | "RESEARCH" | "SPIKE";

/** 优先级（后端字典 `module_pm_priority`；线上码本身就是 P0~P3）。 */
export type UnifiedPriority = "P0" | "P1" | "P2" | "P3";

/** 项目状态（后端字典 `module_pm_project_status`）。 */
export type UnifiedProjectStatus =
	| "PLANNING"
	| "ACTIVE"
	| "ON_HOLD"
	| "COMPLETED"
	| "CANCELLED"
	| "ARCHIVED";

/** 里程碑状态（后端字典 `module_pm_milestone_status`；**没有 cancelled**）。 */
export type UnifiedMilestoneStatus = "UPCOMING" | "IN_PROGRESS" | "AT_RISK" | "DONE" | "MISSED";

/** 风险状态（后端字典 `module_pm_risk_status`）。 */
export type UnifiedRiskStatus = "IDENTIFIED" | "ANALYZING" | "MITIGATING" | "REALIZED" | "CLOSED";

/** 风险分类（后端字典 `module_pm_risk_category`）。 */
export type UnifiedRiskCategory = "SCHEDULE" | "SCOPE" | "QUALITY" | "RESOURCE" | "COMPLIANCE";

/**
 * 任务创建来源（后端字典 `module_pm_task_created_via`）。
 *
 * ⚠️ 与 AIPM 02 §2 的 `MANUAL | AI | IMPORT` 不一致 —— 后端字典是
 * manual/nl_chat/import/api（**没有 'web'**，后端 schema 注释里说的 'web' 兜底
 * 既不在字典里、service 里也没实现）。
 */
export type UnifiedTaskSource = "MANUAL" | "NL_CHAT" | "IMPORT" | "API";

/* ------------------------------------------------------------------ 告警 */

/** 一条「值不认识」的告警。 */
export interface EnumWarning {
	/** 字段名（机器可读，如 `task_status`）。 */
	field: string;
	/** 原始值（线上码或统一名，原样保留）。 */
	raw: string;
	/** 归一到的默认值（统一名）。 */
	fallback: string;
	/** 人类可读说明。 */
	message: string;
}

/** 告警的去处（注入自己的实现即可把告警写进审计日志 / 回给用户）。 */
export type EnumWarningSink = (warning: EnumWarning) => void;

/** 内存里保留的告警条数上限（防止长跑进程把内存吃满）。 */
const MAX_COLLECTED_WARNINGS = 100;

/** 默认收集器留痕的告警。 */
const collectedWarnings: EnumWarning[] = [];

/** 默认 sink：把告警收进内存（`getEnumWarnings()` 可查）。 */
const defaultSink: EnumWarningSink = (warning) => {
	collectedWarnings.push(warning);
	if (collectedWarnings.length > MAX_COLLECTED_WARNINGS) {
		collectedWarnings.shift();
	}
};

/** 当前生效的全局 sink。 */
let activeSink: EnumWarningSink = defaultSink;

/**
 * 换掉全局告警去处；传 `undefined` 恢复默认收集器。
 *
 * 调用方也可以在**每次调用**时单独传 sink（参数优先于全局 sink）。
 */
export function setEnumWarningSink(sink: EnumWarningSink | undefined): void {
	activeSink = sink ?? defaultSink;
}

/** 内存里收集到的告警（最近的若干条）。 */
export function getEnumWarnings(): readonly EnumWarning[] {
	return collectedWarnings;
}

/** 清空内存里收集到的告警。 */
export function clearEnumWarnings(): void {
	collectedWarnings.length = 0;
}

/* ------------------------------------------------------------------ 归一表 */

/** 归一表：统一名 → 线上码列表（**第一个是标准码**）。 */
export type WireTable<Unified extends string> = ReadonlyMap<Unified, readonly string[]>;

/** 一个枚举字段的归一表与两个方向的换算。 */
export interface EnumMapping<Unified extends string = string> {
	/** 字段名（机器可读，告警里用）。 */
	readonly field: string;
	/** 字段中文名（告警文案里用）。 */
	readonly label: string;
	/** 未命中时的默认值（统一名）—— 后端字典里 `is_default=1` 的那一个。 */
	readonly fallback: Unified;
	/** 统一名 → 线上码列表（第一个是标准码）。 */
	readonly toWire: ReadonlyMap<string, readonly string[]>;
	/** 线上码 → 统一名；未命中 ⇒ 归一为 `fallback` 并告警。 */
	readonly toUnified: (value: string, sink?: EnumWarningSink) => Unified;
	/** 统一名 → 线上码（取标准码）；不认识 ⇒ 退回 `fallback` 的标准码并告警。 */
	readonly fromUnified: (value: string, sink?: EnumWarningSink) => string;
}

/**
 * 造一张归一表。
 *
 * - 反查表按**小写**建 ⇒ 匹配时忽略大小写（`IN_PROGRESS` 与 `in_progress` 是同一个 token，
 *   这不是「猜语义」）；
 * - 统一名本身也进反查表 ⇒ `toUnified("IN_PROGRESS")` 与 `toUnified("in_progress")` 等价。
 */
function buildMapping<Unified extends string>(
	field: string,
	label: string,
	fallback: Unified,
	toWire: WireTable<Unified>,
): EnumMapping<Unified> {
	const reverse = new Map<string, Unified>();
	const wireByName = new Map<string, readonly string[]>();
	for (const [unified, codes] of toWire) {
		wireByName.set(unified, codes);
		reverse.set(unified.toLowerCase(), unified);
		for (const code of codes) {
			reverse.set(code.toLowerCase(), unified);
		}
	}

	const fallbackCodes = wireByName.get(fallback) ?? [];
	if (fallbackCodes.length === 0) {
		// 映射表写错了 —— 启动时就炸，别等到发请求时发一个空码出去
		throw new Error(`枚举表「${field}」的默认值 ${fallback} 不在映射表里`);
	}
	const fallbackCode = fallbackCodes[0];

	return {
		field,
		label,
		fallback,
		toWire: wireByName,
		toUnified: (value, sink) => {
			// 防御：后端万一给了 null/数字，也不能把整个请求打崩（归一为默认 + 告警）
			const raw = typeof value === "string" ? value : String(value);
			const found = reverse.get(raw.trim().toLowerCase());
			if (found !== undefined) {
				return found;
			}
			report(field, label, raw, fallback, sink);
			return fallback;
		},
		fromUnified: (value, sink) => {
			const raw = typeof value === "string" ? value : String(value);
			const codes = wireByName.get(raw.trim().toUpperCase());
			const standard = codes?.[0];
			if (standard !== undefined) {
				return standard;
			}
			report(field, label, raw, fallback, sink);
			return fallbackCode;
		},
	};
}

/** 记一条告警（按次传入的 sink 优先于全局 sink）。 */
function report(
	field: string,
	label: string,
	raw: string,
	fallback: string,
	sink?: EnumWarningSink,
): void {
	const warning: EnumWarning = {
		field,
		raw,
		fallback,
		message: `未知的${label}「${raw}」，已归一为默认「${fallback}」`,
	};
	(sink ?? activeSink)(warning);
}

/* ------------------------------------------------------------------ 八张表 */

/**
 * 任务状态（`module_pm_task_status`）。
 * 字典值：backlog / todo / in_progress / blocked / review / done / cancelled；
 * 默认（is_default=1）是 backlog —— 与 AIPM 02 §4.3「新建 ⇒ BACKLOG」一致。
 */
export const TASK_STATUS_MAPPING: EnumMapping<UnifiedTaskStatus> = buildMapping(
	"task_status",
	"任务状态",
	"BACKLOG",
	new Map<UnifiedTaskStatus, readonly string[]>([
		["BACKLOG", ["backlog"]],
		["TODO", ["todo"]],
		["IN_PROGRESS", ["in_progress"]],
		["BLOCKED", ["blocked"]],
		["REVIEW", ["review"]],
		["DONE", ["done"]],
		["CANCELLED", ["cancelled"]],
	]),
);

/**
 * 任务类型（`module_pm_task_type`）。
 * 字典值：feature / bug / ops / research / spike；默认是 feature。
 */
export const TASK_TYPE_MAPPING: EnumMapping<UnifiedTaskType> = buildMapping(
	"task_type",
	"任务类型",
	"FEATURE",
	new Map<UnifiedTaskType, readonly string[]>([
		["FEATURE", ["feature"]],
		["BUG", ["bug"]],
		["OPS", ["ops"]],
		["RESEARCH", ["research"]],
		["SPIKE", ["spike"]],
	]),
);

/**
 * 优先级（`module_pm_priority`）。
 * 字典值：P0 / P1 / P2 / P3；默认（is_default=1）是 P2。
 */
export const PRIORITY_MAPPING: EnumMapping<UnifiedPriority> = buildMapping(
	"priority",
	"优先级",
	"P2",
	new Map<UnifiedPriority, readonly string[]>([
		["P0", ["P0"]],
		["P1", ["P1"]],
		["P2", ["P2"]],
		["P3", ["P3"]],
	]),
);

/**
 * 项目状态（`module_pm_project_status`）。
 * 字典值：planning / active / on_hold / completed / cancelled / archived；默认是 planning。
 *
 * ⚠️ 线上库的该字典**少了 on_hold 与 cancelled**（种子里有）——
 * 归一表按**种子**（设计值）写全，见 task-4-report.md。
 */
export const PROJECT_STATUS_MAPPING: EnumMapping<UnifiedProjectStatus> = buildMapping(
	"project_status",
	"项目状态",
	"PLANNING",
	new Map<UnifiedProjectStatus, readonly string[]>([
		["PLANNING", ["planning"]],
		["ACTIVE", ["active"]],
		["ON_HOLD", ["on_hold"]],
		["COMPLETED", ["completed"]],
		["CANCELLED", ["cancelled"]],
		["ARCHIVED", ["archived"]],
	]),
);

/**
 * 里程碑状态（`module_pm_milestone_status`）。
 * 字典值：upcoming / in_progress / at_risk / done / missed；默认是 upcoming。
 *
 * ⚠️ **没有 cancelled** —— 传进来只能归一为 UPCOMING 并告警，
 * 绝不能借用任务状态的 cancelled 映射。
 */
export const MILESTONE_STATUS_MAPPING: EnumMapping<UnifiedMilestoneStatus> = buildMapping(
	"milestone_status",
	"里程碑状态",
	"UPCOMING",
	new Map<UnifiedMilestoneStatus, readonly string[]>([
		["UPCOMING", ["upcoming"]],
		["IN_PROGRESS", ["in_progress"]],
		["AT_RISK", ["at_risk"]],
		["DONE", ["done"]],
		["MISSED", ["missed"]],
	]),
);

/**
 * 风险状态（`module_pm_risk_status`）。
 * 字典值：identified / analyzing / mitigating / realized / closed；默认是 identified。
 */
export const RISK_STATUS_MAPPING: EnumMapping<UnifiedRiskStatus> = buildMapping(
	"risk_status",
	"风险状态",
	"IDENTIFIED",
	new Map<UnifiedRiskStatus, readonly string[]>([
		["IDENTIFIED", ["identified"]],
		["ANALYZING", ["analyzing"]],
		["MITIGATING", ["mitigating"]],
		["REALIZED", ["realized"]],
		["CLOSED", ["closed"]],
	]),
);

/**
 * 风险分类（`module_pm_risk_category`）。
 * 字典值：schedule / scope / quality / resource / compliance；默认是 schedule。
 */
export const RISK_CATEGORY_MAPPING: EnumMapping<UnifiedRiskCategory> = buildMapping(
	"risk_category",
	"风险分类",
	"SCHEDULE",
	new Map<UnifiedRiskCategory, readonly string[]>([
		["SCHEDULE", ["schedule"]],
		["SCOPE", ["scope"]],
		["QUALITY", ["quality"]],
		["RESOURCE", ["resource"]],
		["COMPLIANCE", ["compliance"]],
	]),
);

/**
 * 任务创建来源（`module_pm_task_created_via`）。
 * 字典值：manual / nl_chat / import / api；默认是 manual。
 */
export const TASK_SOURCE_MAPPING: EnumMapping<UnifiedTaskSource> = buildMapping(
	"task_source",
	"任务创建来源",
	"MANUAL",
	new Map<UnifiedTaskSource, readonly string[]>([
		["MANUAL", ["manual"]],
		["NL_CHAT", ["nl_chat"]],
		["IMPORT", ["import"]],
		["API", ["api"]],
	]),
);

/** 全部归一表（测试用它遍历，保证每一对都被覆盖）。 */
export const ENUM_TABLES: readonly EnumMapping[] = [
	TASK_STATUS_MAPPING,
	TASK_TYPE_MAPPING,
	PRIORITY_MAPPING,
	PROJECT_STATUS_MAPPING,
	MILESTONE_STATUS_MAPPING,
	RISK_STATUS_MAPPING,
	RISK_CATEGORY_MAPPING,
	TASK_SOURCE_MAPPING,
];

/* ------------------------------------------------------------------ 对外接口 */

/** 任务状态：线上码 → 统一名（未命中 ⇒ BACKLOG + 告警）。 */
export function taskStatusToUnified(value: string, sink?: EnumWarningSink): UnifiedTaskStatus {
	return TASK_STATUS_MAPPING.toUnified(value, sink);
}

/** 任务状态：统一名 → 线上码（标准码 `backlog`/`todo`/…）。 */
export function taskStatusFromUnified(value: UnifiedTaskStatus, sink?: EnumWarningSink): string {
	return TASK_STATUS_MAPPING.fromUnified(value, sink);
}

/** 任务类型：线上码 → 统一名（未命中 ⇒ FEATURE + 告警）。 */
export function taskTypeToUnified(value: string, sink?: EnumWarningSink): UnifiedTaskType {
	return TASK_TYPE_MAPPING.toUnified(value, sink);
}

/** 任务类型：统一名 → 线上码（`feature`/`bug`/`ops`/…）。 */
export function taskTypeFromUnified(value: UnifiedTaskType, sink?: EnumWarningSink): string {
	return TASK_TYPE_MAPPING.fromUnified(value, sink);
}

/** 优先级：线上码 → 统一名（未命中 ⇒ P2 + 告警）。 */
export function priorityToUnified(value: string, sink?: EnumWarningSink): UnifiedPriority {
	return PRIORITY_MAPPING.toUnified(value, sink);
}

/** 优先级：统一名 → 线上码（`P0`~`P3`）。 */
export function priorityFromUnified(value: UnifiedPriority, sink?: EnumWarningSink): string {
	return PRIORITY_MAPPING.fromUnified(value, sink);
}

/** 项目状态：线上码 → 统一名（未命中 ⇒ PLANNING + 告警）。 */
export function projectStatusToUnified(value: string, sink?: EnumWarningSink): UnifiedProjectStatus {
	return PROJECT_STATUS_MAPPING.toUnified(value, sink);
}

/** 项目状态：统一名 → 线上码。 */
export function projectStatusFromUnified(value: UnifiedProjectStatus, sink?: EnumWarningSink): string {
	return PROJECT_STATUS_MAPPING.fromUnified(value, sink);
}

/** 里程碑状态：线上码 → 统一名（未命中 ⇒ UPCOMING + 告警）。 */
export function milestoneStatusToUnified(
	value: string,
	sink?: EnumWarningSink,
): UnifiedMilestoneStatus {
	return MILESTONE_STATUS_MAPPING.toUnified(value, sink);
}

/** 里程碑状态：统一名 → 线上码。 */
export function milestoneStatusFromUnified(
	value: UnifiedMilestoneStatus,
	sink?: EnumWarningSink,
): string {
	return MILESTONE_STATUS_MAPPING.fromUnified(value, sink);
}

/** 风险状态：线上码 → 统一名（未命中 ⇒ IDENTIFIED + 告警）。 */
export function riskStatusToUnified(value: string, sink?: EnumWarningSink): UnifiedRiskStatus {
	return RISK_STATUS_MAPPING.toUnified(value, sink);
}

/** 风险状态：统一名 → 线上码。 */
export function riskStatusFromUnified(value: UnifiedRiskStatus, sink?: EnumWarningSink): string {
	return RISK_STATUS_MAPPING.fromUnified(value, sink);
}

/** 风险分类：线上码 → 统一名（未命中 ⇒ SCHEDULE + 告警）。 */
export function riskCategoryToUnified(value: string, sink?: EnumWarningSink): UnifiedRiskCategory {
	return RISK_CATEGORY_MAPPING.toUnified(value, sink);
}

/** 风险分类：统一名 → 线上码。 */
export function riskCategoryFromUnified(value: UnifiedRiskCategory, sink?: EnumWarningSink): string {
	return RISK_CATEGORY_MAPPING.fromUnified(value, sink);
}

/** 任务创建来源：线上码 → 统一名（未命中 ⇒ MANUAL + 告警）。 */
export function taskSourceToUnified(value: string, sink?: EnumWarningSink): UnifiedTaskSource {
	return TASK_SOURCE_MAPPING.toUnified(value, sink);
}

/** 任务创建来源：统一名 → 线上码。 */
export function taskSourceFromUnified(value: UnifiedTaskSource, sink?: EnumWarningSink): string {
	return TASK_SOURCE_MAPPING.fromUnified(value, sink);
}
