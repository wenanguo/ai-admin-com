/**
 * 统一领域模型 —— 上层（agent 的工具定义、前端视图）**只认这一套**。
 *
 * 形状照 AIPM 02 §2；字段名与语义不变，只把「后端的数字 id」换成
 * `<实体>:<id>` 形式的 key（见 `keys.ts`）。
 *
 * ⚠️ 与 AIPM 02 §2 的两处偏差（以后端字典为准，详见 task-4-report.md）：
 * - 任务类型是 FEATURE/BUG/**OPS/RESEARCH/SPIKE**（不是 TASK/CHORE）；
 * - 创建来源是 MANUAL/NL_CHAT/IMPORT/API（不是 MANUAL/AI/IMPORT）。
 */

import type {
	UnifiedMilestoneStatus,
	UnifiedPriority,
	UnifiedProjectStatus,
	UnifiedRiskCategory,
	UnifiedRiskStatus,
	UnifiedTaskSource,
	UnifiedTaskStatus,
	UnifiedTaskType,
} from "./enums.ts";

/**
 * 写操作的快照 —— **撤销层的插槽**。
 *
 * 本任务（适配层）不做撤销，但把形状留好：
 * 以后补上「写前先 GET 一次」时，只要把旧实体填进 `before`，
 * 审计层（`ai_audit_log.before_snapshot` / `after_snapshot`）直接读它，
 * 不必回头改适配层的接口。
 */
export interface WriteSnapshot<T> {
	/** 写操作类型。 */
	op: "create" | "update" | "delete";
	/** 写之前的实体；新建时为 null（此前不存在）。 */
	before: T | null;
	/** 写之后的实体；删除时为 null（之后不存在）。 */
	after: T | null;
}

/** 用户引用（后端的 `assignee_by` / `reporter_by` 是 `{id, name, username}`）。 */
export interface UnifiedUserRef {
	/** 统一 key（`user:<id>`）。 */
	key: string;
	/** 后端 `sys_user.id`。 */
	id: number;
	name?: string;
	username?: string;
}

/** 项目（AIPM 02 §2）。 */
export interface UnifiedProject {
	/** 统一 key（`project:<id>`）。 */
	key: string;
	/** 项目编码（租户内唯一，形如 `PRJ-2026-Q3-001`）。 */
	code: string;
	name: string;
	description?: string;
	owner?: UnifiedUserRef;
	status: UnifiedProjectStatus;
	priority: UnifiedPriority;
	start_date: string;
	due_date: string;
	/** 标签数组（后端是 JSON 列）。 */
	tags: string[];
	/** 自定义字段（后端 `extra_fields`，JSON 列）。 */
	extra: Record<string, unknown>;
	/** 写快照（只有经过写路径的实体才有）。 */
	snapshot?: WriteSnapshot<UnifiedProject>;
}

/** 里程碑（AIPM 02 §2）。 */
export interface UnifiedMilestone {
	key: string;
	project_key: string;
	name: string;
	description?: string;
	start_date: string;
	due_date: string;
	actual_start_date?: string;
	actual_end_date?: string;
	status: UnifiedMilestoneStatus;
	/** 交付物清单（后端是 JSON 列）。 */
	deliverables: Record<string, unknown>;
	/** 显示排序（后端是整数列）。 */
	sort_order: number;
}

/** 任务（AIPM 02 §2）。 */
export interface UnifiedTask {
	/** 统一 key（`task:<id>`）。 */
	key: string;
	/** 所属项目（`project:<id>`）。 */
	project_key: string;
	/** 所属里程碑（`milestone:<id>`）。 */
	milestone_key?: string;
	/** 父任务（`task:<id>`）。 */
	parent_key?: string;
	title: string;
	description?: string;
	type: UnifiedTaskType;
	status: UnifiedTaskStatus;
	priority: UnifiedPriority;
	/** 预估工时 —— 后端是 `Decimal`，JSON 上是**字符串**，这里保持字符串。 */
	estimate_hours?: string;
	/** 实际工时 —— 同上，保持字符串。 */
	actual_hours?: string;
	assignee?: UnifiedUserRef;
	reporter?: UnifiedUserRef;
	/** 评审人 id 列表。 */
	reviewers: string[];
	/** 标签数组。 */
	labels: string[];
	start_date?: string;
	due_date?: string;
	actual_start_date?: string;
	actual_end_date?: string;
	/** 看板排序 —— 后端是 `Decimal`，保持字符串。 */
	sort_order: string;
	/** 创建来源（字典 `module_pm_task_created_via`）。 */
	source: UnifiedTaskSource;
	/** 写快照（只有经过写路径的实体才有）。 */
	snapshot?: WriteSnapshot<UnifiedTask>;
}

/** 风险（AIPM 02 §2）。 */
export interface UnifiedRisk {
	key: string;
	project_key: string;
	title: string;
	description?: string;
	category: UnifiedRiskCategory;
	probability: number;
	impact: number;
	score: number;
	status: UnifiedRiskStatus;
	owner?: UnifiedUserRef;
	mitigation_plan?: string;
	contingency_plan?: string;
	due_date?: string;
	trigger_date?: string;
}
