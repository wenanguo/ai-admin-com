/**
 * AiAdmin 后端的 PM 相关类型 —— **字段逐字照抄后端 schema**，不改名、不造中间类型。
 *
 * 字段来源（只读参考，未做任何修改）：
 * - 公共出参：`D:/project/AiAdmin/backend/app/core/base_schema.py`
 *   （`BaseSchema` + `UserBySchema` + `TenantBySchema`）
 * - 项目：`.../app/plugin/module_pm_project/pm_project/schema.py`
 * - 里程碑：`.../app/plugin/module_pm_project/pm_milestone/schema.py`
 * - 任务：`.../app/plugin/module_pm_project/pm_task/schema.py`
 * - 风险：`.../app/plugin/module_pm_risk/pm_risk/schema.py`
 * - 字典：`.../app/api/v1/module_system/dict/schema.py`
 *
 * 序列化形态也照抄后端：
 * - `date` → `"YYYY-MM-DD"`（`DATE_DISPLAY_FMT`）
 * - `datetime` → `"YYYY-MM-DD HH:MM:SS"`（`DATETIME_DISPLAY_FMT`）
 * - `Decimal` → 字符串（后端 `Decimal` 序列化成字符串，见 openapi 的
 *   `estimate_hours` / `actual_hours` / `sort_order`）
 */

/** 后端 `CommonSchema`：`{id, name}`。 */
export interface AadminCommonRef {
	id: number;
	name: string;
}

/** 后端 `BaseSchema` + `UserBySchema` + `TenantBySchema`（所有出参的公共部分）。 */
export interface AadminBaseOut {
	id: number | null;
	uuid: string | null;
	created_time: string | null;
	updated_time: string | null;
	is_deleted: boolean;
	deleted_time: string | null;
	created_id: number | null;
	created_by: AadminCommonRef | null;
	updated_id: number | null;
	updated_by: AadminCommonRef | null;
	deleted_id: number | null;
	deleted_by: AadminCommonRef | null;
	tenant_id: number | null;
	tenant_by: AadminCommonRef | null;
}

/** 后端 `PageResultSchema[T]`：分页查询结果。 */
export interface AadminPageResult<T> {
	page_no: number | null;
	page_size: number | null;
	total: number;
	has_next: boolean | null;
	items: T[];
}

/* ------------------------------------------------------------------ 项目 */

/** 后端 `ModulePmProjectCreateSchema`。 */
export interface PmProjectCreate {
	code: string;
	name: string;
	description: string | null;
	owner_id: number;
	template_id: number | null;
	status_code: string;
	priority_code: string;
	start_date: string;
	due_date: string;
	visibility_code: string;
	tags: string | null;
	extra_fields: string | null;
}

/** 后端 `ModulePmProjectUpdateSchema` 直接继承 Create，没有新字段。 */
export type PmProjectUpdate = PmProjectCreate;

/** 后端 `ModulePmProjectOutSchema`。 */
export interface PmProjectOut extends PmProjectCreate, AadminBaseOut {
	/** 后端是 `dict | None`，注释写的是 `{id, name, username}`。 */
	owner_by: Record<string, unknown> | null;
}

/* --------------------------------------------------------------- 里程碑 */

/** 后端 `ModulePmMilestoneCreateSchema`。 */
export interface PmMilestoneCreate {
	project_id: number;
	name: string;
	description: string | null;
	start_date: string;
	due_date: string;
	actual_start_date: string | null;
	actual_end_date: string | null;
	status_code: string;
	/** 后端是 `dict[str, Any] | None`（交付物清单）。 */
	deliverables: Record<string, unknown> | null;
	sort_order: number;
	health_score: number | null;
}

/** 后端 `ModulePmMilestoneUpdateSchema` 直接继承 Create，没有新字段。 */
export type PmMilestoneUpdate = PmMilestoneCreate;

/** 后端 `ModulePmMilestoneOutSchema`。 */
export interface PmMilestoneOut extends PmMilestoneCreate, AadminBaseOut {
	/** 派生字段（任务完成率算出来的），不允许直接写。 */
	progress: number | null;
	/** 后端是 `dict | None`，注释写的是 `{id, name, code}`。 */
	project_by: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ 任务 */

/** 后端 `ModulePmTaskCreateSchema`。 */
export interface PmTaskCreate {
	project_id: number;
	milestone_id: number | null;
	parent_id: number | null;
	title: string;
	description: string | null;
	type_code: string;
	status_code: string;
	priority_code: string;
	/** 后端是 `Decimal | None`，序列化成字符串。 */
	estimate_hours: string | null;
	/** 后端是 `Decimal | None`，序列化成字符串。 */
	actual_hours: string | null;
	assignee_id: number | null;
	reporter_id: number | null;
	reviewers: string | null;
	labels: string | null;
	start_date: string | null;
	due_date: string | null;
	actual_start_date: string | null;
	actual_end_date: string | null;
	/** 后端是 `Decimal | None`（看板拖拽排序），序列化成字符串。 */
	sort_order: string | null;
	created_via_code: string | null;
	blocked_reason: string | null;
}

/** 后端 `ModulePmTaskUpdateSchema` 直接继承 Create，没有新字段。 */
export type PmTaskUpdate = PmTaskCreate;

/** 后端 `ModulePmTaskOutSchema`。 */
export interface PmTaskOut extends PmTaskCreate, AadminBaseOut {
	/** 后端是 `dict | None`，注释写的是 `{id, name, username}`。 */
	assignee_by: Record<string, unknown> | null;
	/** 后端是 `dict | None`，注释写的是 `{id, name, username}`。 */
	reporter_by: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ 风险 */

/** 后端 `ModulePmRiskCreateSchema`。 */
export interface PmRiskCreate {
	project_id: number;
	title: string;
	description: string | null;
	category_code: string;
	probability: number;
	impact: number;
	score: number;
	status_code: string;
	owner_id: number;
	mitigation_plan: string | null;
	contingency_plan: string | null;
	due_date: string | null;
	trigger_date: string | null;
	created_via_code: string;
	/** 后端是 `dict[str, Any] | None`（AI 原始建议）。 */
	ai_suggestion: Record<string, unknown> | null;
}

/** 后端 `ModulePmRiskUpdateSchema` 直接继承 Create，没有新字段。 */
export type PmRiskUpdate = PmRiskCreate;

/** 后端 `ModulePmRiskOutSchema`（只比 Create 多公共出参部分）。 */
export type PmRiskOut = PmRiskCreate & AadminBaseOut;

/* ------------------------------------------------------------------ 字典 */

/** 后端 `DictDataOutSchema`。 */
export interface DictDataOut extends AadminBaseOut {
	dict_sort: number;
	dict_label: string;
	dict_value: string;
	dict_type: string;
	dict_type_id: number;
	css_class: string | null;
	list_class: string | null;
	is_default: boolean;
	status: number;
	description: string | null;
}

/* ------------------------------------------------------------------ 路径 */

/**
 * AiAdmin 的接口路径。
 *
 * ⚠️ **插件路径是两段的**：后端把插件前缀拼了两次（插件目录名 + 路由自己的 `prefix=`），
 * 所以项目是 `/pm_project/pm_project/...`，任务是 `/pm_project/pm_task/...`，
 * 风险是 `/pm_risk/pm_risk/...`（注意插件目录叫 `module_pm_risk`，但前缀是 `pm_risk`）。
 * 写成 `/pm_project/list` 会 404 —— 前端踩过这个坑。
 *
 * 下面每条路径都取自线上后端的 `openapi.json`（2026-11-04 核对），
 * 不要凭记忆改；改动前先重新核对 openapi。
 *
 * 路径是**相对 base 的**：`AIADMIN_BASE_URL` 里已经含 `/api/v1`，
 * 所以这里是 `/pm_project/pm_task/list`，不是 `/api/v1/pm_project/pm_task/list`。
 */
export const PM_PATHS = {
	project: {
		list: "/pm_project/pm_project/list",
		detail: (id: number): string => `/pm_project/pm_project/detail/${id}`,
		create: "/pm_project/pm_project/create",
		update: (id: number): string => `/pm_project/pm_project/update/${id}`,
		/** 请求体是**裸数组** `[1, 2]`（后端 `ids: Annotated[list[int], Body(...)]`）。 */
		remove: "/pm_project/pm_project/delete",
		statusBatch: "/pm_project/pm_project/status/batch",
	},
	milestone: {
		list: "/pm_project/pm_milestone/list",
		detail: (id: number): string => `/pm_project/pm_milestone/detail/${id}`,
		create: "/pm_project/pm_milestone/create",
		update: (id: number): string => `/pm_project/pm_milestone/update/${id}`,
		/** 请求体是**裸数组** `[1, 2]`。 */
		remove: "/pm_project/pm_milestone/delete",
		statusBatch: "/pm_project/pm_milestone/status/batch",
	},
	task: {
		list: "/pm_project/pm_task/list",
		detail: (id: number): string => `/pm_project/pm_task/detail/${id}`,
		create: "/pm_project/pm_task/create",
		update: (id: number): string => `/pm_project/pm_task/update/${id}`,
		/** 请求体是**裸数组** `[1, 2]`。 */
		remove: "/pm_project/pm_task/delete",
		statusBatch: "/pm_project/pm_task/status/batch",
	},
	risk: {
		list: "/pm_risk/pm_risk/list",
		detail: (id: number): string => `/pm_risk/pm_risk/detail/${id}`,
		create: "/pm_risk/pm_risk/create",
		update: (id: number): string => `/pm_risk/pm_risk/update/${id}`,
		/** 请求体是**裸数组** `[1, 2]`。 */
		remove: "/pm_risk/pm_risk/delete",
		statusBatch: "/pm_risk/pm_risk/status/batch",
	},
	dict: {
		/** 字典项：传字典类型（如 `module_pm_task_status`），返回该类型下的全部字典项。 */
		dataInfo: (dictType: string): string => `/system/dict/data/info/${encodeURIComponent(dictType)}`,
	},
};
