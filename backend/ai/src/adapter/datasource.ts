/**
 * 适配层的数据源 —— AiAdmin 的线上格式 ⇄ 统一领域模型。
 *
 * 三件事：
 * 1. **枚举归一**：`type_code`/`status_code`/… 从线上码变成统一模型名（见 `enums.ts`）；
 * 2. **key 化**：实体身份从后端的数字 id 变成 `task:123` 形式的统一 key（见 `keys.ts`）；
 * 3. **写路径**：把统一模型写回 AiAdmin，并把后端那些「必须由调用方给」的列补齐
 *    （`reporter_id` / `sort_order` / `created_via_code` —— 后端的 `create_service`
 *    **没有**实现 schema 注释里承诺的兜底，不给就是 INSERT NULL ⇒ 500）。
 *
 * ⚠️ 路径一律取自 `PM_PATHS`（两段插件前缀），**不要在这里手写路径字符串**。
 */

import { createHash } from "node:crypto";
import type { AadminClient } from "../aadmin/client.ts";
import { AdapterErrorException, isAdapterErrorException } from "../aadmin/errors.ts";
import {
	PM_PATHS,
	type AadminPageResult,
	type PmProjectOut,
	type PmTaskCreate,
	type PmTaskOut,
} from "../aadmin/types.ts";
import {
	priorityFromUnified,
	priorityToUnified,
	PROJECT_STATUS_MAPPING,
	projectStatusToUnified,
	TASK_STATUS_MAPPING,
	taskSourceToUnified,
	taskStatusFromUnified,
	taskStatusToUnified,
	taskTypeFromUnified,
	taskTypeToUnified,
	type EnumMapping,
	type EnumWarningSink,
} from "./enums.ts";
import { entityKey, parseEntityKey, tryParseEntityKey, tryParseNumericId } from "./keys.ts";
import type { UnifiedProject, UnifiedTask, UnifiedUserRef } from "./model.ts";

/* ------------------------------------------------------------ 构造参数 */

/** 数据源的构造参数。 */
export interface AadminDataSourceOptions {
	/** AiAdmin 的 HTTP 客户端（Task 3 的 `AadminClient`）。 */
	client: AadminClient;
	/**
	 * 调用方的 token（按请求透传）。
	 *
	 * 本服务**不持有任何长期凭据** —— token 由每个请求的调用方给，
	 * 数据源只在本实例的生命周期内转手它。
	 */
	token: string;
	/** 枚举归一的告警去处（不传就走 `enums.ts` 的全局 sink）。 */
	onWarning?: EnumWarningSink;
}

/** 建任务的入参（统一模型的说法）。 */
export interface CreateTaskInput {
	/**
	 * 所属项目。
	 *
	 * 三种写法都认：
	 * - `project:45`（统一 key）—— **零额外请求**；
	 * - `45`（纯数字 id）—— 零额外请求；
	 * - `PRJ-2026-Q3-001`（项目编码）—— 查一次项目（结果有缓存，不会每次都查）。
	 */
	project_key: string;
	/** 任务标题。 */
	title: string;
	/**
	 * 当前用户 id。
	 *
	 * ⚠️ **必填**：后端 `module_pm_task.reporter_id` 是 NOT NULL，
	 * 而 `create_service` 直接把 schema 丢给 CRUD、**不做任何回填**
	 * （schema 注释里「为 None 时 service 用当前登录用户填充」是没实现的承诺）⇒ 不给就是 500。
	 */
	reporter_id: number;
	/** 类型（统一名 `FEATURE` 或线上码 `feature` 都行；缺省用字典默认值 feature）。 */
	type?: string;
	/** 状态（缺省 backlog —— 与 AIPM 02 §4.3「新建 ⇒ BACKLOG」一致）。 */
	status?: string;
	/** 优先级（缺省 P2 —— 字典里 is_default=1 的那一个）。 */
	priority?: string;
	/** 任务描述（Markdown）。 */
	description?: string;
	/** 负责人：`user:9`（或纯数字 9）。 */
	assignee_key?: string;
	/** 所属里程碑：`milestone:12`。 */
	milestone_key?: string;
	/** 父任务：`task:11`。 */
	parent_key?: string;
	/** 计划开始日期（`YYYY-MM-DD`）。 */
	start_date?: string;
	/** 计划截止日期（`YYYY-MM-DD`）。 */
	due_date?: string;
	/** 预估工时（后端是 `Decimal`，线上是字符串；number / string 都收）。 */
	estimate_hours?: number | string;
}

/** 列项目的过滤条件。 */
export interface ListProjectsQuery {
	/** 状态（统一名或线上码都行）。 */
	status?: string;
	/** 项目编码（后端是 like 匹配）。 */
	code?: string;
	page_no?: number;
	page_size?: number;
}

/** 列任务的过滤条件。 */
export interface ListTasksQuery {
	/** 项目过滤（`project:45` 或项目编码；与 `project_id` 二选一，这个优先）。 */
	project_key?: string;
	/** 项目 id（后端数字 id）。 */
	project_id?: number;
	/** 状态（统一名或线上码都行）。 */
	status?: string;
	page_no?: number;
	page_size?: number;
}

/* ------------------------------------------------------------ 项目 id 缓存 */

/** 项目 code → id 的缓存存活时间（毫秒）。 */
const PROJECT_ID_CACHE_TTL_MS = 30_000;

/** 缓存里最多保留多少条（防止长跑进程把内存吃满）。 */
const PROJECT_ID_CACHE_MAX_ENTRIES = 512;

/** 缓存里的一条：项目 id + 写入时间。 */
interface ProjectIdCacheEntry {
	/** 项目 id（后端的主键）。 */
	id: number;
	/** 写入时间（毫秒；用来算 TTL）。 */
	at: number;
}

/**
 * 项目 code → id 的缓存（**进程级**，但**按身份隔离**）。
 *
 * ⚠️ **为什么必须按身份隔离**：项目编码只保证**租户内**唯一 ——
 * 两个租户可以有同名编码。若只用「编码」做 key，A 租户查到的 id 会被
 * 发给 B 租户 ⇒ **任务建到别人的项目里**（跨租户污染）。
 * 所以 key 是 `<身份指纹>:<项目编码大写>`：只有在**同一个身份**下，
 * code → id 这个映射才成立。
 *
 * 为什么作用域用 token 的**指纹**（sha256）而不是 token 本身：
 * 缓存是进程级的 ⇒ 用明文 token 做 key 等于把凭据长期留在内存里。
 * 指纹稳定、不可逆，且不泄露凭据。
 *
 * 为什么还是进程级而不是每个数据源一份：数据源是**按请求**建的
 * （token 按请求透传），放实例里等于每次都重新查 —— 而「建任务」是高频动作。
 */
const projectIdCache = new Map<string, ProjectIdCacheEntry>();

/** 身份的缓存作用域键（token 的 sha256 指纹；不落明文凭据）。 */
function identityScope(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** 清空项目 id 缓存（测试用；项目编码被改时也该调）。 */
export function clearProjectIdCache(): void {
	projectIdCache.clear();
}

/** 缓存里命中且没过期 ⇒ 返回 id。 */
function cachedProjectId(cacheKey: string): number | undefined {
	const hit = projectIdCache.get(cacheKey);
	if (hit === undefined) {
		return undefined;
	}
	if (Date.now() - hit.at > PROJECT_ID_CACHE_TTL_MS) {
		projectIdCache.delete(cacheKey);
		return undefined;
	}
	return hit.id;
}

/** 写缓存（顺手淘汰最老的一条 ⇒ 缓存有上限，不会把内存吃满）。 */
function storeProjectId(cacheKey: string, id: number): void {
	// 先删后插 ⇒ 这条变成「最新的一条」，淘汰时最后被淘汰
	projectIdCache.delete(cacheKey);
	projectIdCache.set(cacheKey, { id, at: Date.now() });
	while (projectIdCache.size > PROJECT_ID_CACHE_MAX_ENTRIES) {
		const oldest = projectIdCache.keys().next();
		if (oldest.done) {
			break;
		}
		projectIdCache.delete(oldest.value);
	}
}

/* ------------------------------------------------------------ 默认值 */

/** 字典默认值（后端 `sys_dict_data.is_default=1` 的那一个）。 */
const DEFAULT_TASK_TYPE = "FEATURE";
const DEFAULT_TASK_STATUS = "BACKLOG";
const DEFAULT_PRIORITY = "P2";

/* ------------------------------------------------------------ 数据源 */

/**
 * AiAdmin 的数据源（适配层的写入口）。
 *
 * 计划里的签名是 `constructor(client: AadminClient)`，这里多要一个 `token` ——
 * 因为 `AadminClient` 的每个方法都要**按次**传 token（客户端不持有凭据），
 * 数据源要替上层转手它，就必须在构造时拿到。
 */
export class AadminDataSource {
	readonly #client: AadminClient;
	readonly #token: string;
	readonly #onWarning: EnumWarningSink | undefined;
	/** 缓存作用域（token 的指纹）—— 项目 id 缓存按身份隔离，见上面的说明。 */
	readonly #scope: string;

	constructor(options: AadminDataSourceOptions) {
		this.#client = options.client;
		this.#token = options.token;
		this.#onWarning = options.onWarning;
		this.#scope = identityScope(options.token);
	}

	/** 列项目（返回统一模型）。 */
	async listProjects(query: ListProjectsQuery = {}): Promise<UnifiedProject[]> {
		// 先校状态（不认识的 ⇒ 直接失败，别白发请求）
		const statusCode =
			query.status === undefined
				? undefined
				: this.#statusFilter(query.status, PROJECT_STATUS_MAPPING, "项目状态");
		const page = await this.#client.get<AadminPageResult<PmProjectOut>>(
			PM_PATHS.project.list,
			this.#token,
			{
				page_no: query.page_no ?? 1,
				page_size: query.page_size ?? 100,
				code: query.code,
				status_code: statusCode,
			},
		);
		// ⚠️ 后端的 status_code 过滤是 **like**（`pm_project/schema.py` 的 `__post_init__`）
		// ⇒ 拉回来的结果里可能混着「状态码里包含这个字样」的行 ⇒ 必须再**精确比对**一遍。
		const items =
			statusCode === undefined
				? page.items
				: page.items.filter((item) => item.status_code === statusCode);
		return items.map((item) => toUnifiedProject(item, this.#onWarning));
	}

	/** 列任务（返回统一模型；分页参数原样透传给后端）。 */
	async listTasks(query: ListTasksQuery = {}): Promise<UnifiedTask[]> {
		// 先校状态（不认识的 ⇒ 直接失败，别白发请求）
		const statusCode =
			query.status === undefined
				? undefined
				: this.#statusFilter(query.status, TASK_STATUS_MAPPING, "任务状态");
		const projectId =
			query.project_key === undefined
				? query.project_id
				: await this.#resolveProjectId(query.project_key);
		const page = await this.#client.get<AadminPageResult<PmTaskOut>>(
			PM_PATHS.task.list,
			this.#token,
			{
				page_no: query.page_no ?? 1,
				page_size: query.page_size ?? 20,
				project_id: projectId,
				status_code: statusCode,
			},
		);
		// ⚠️ 后端的 status_code 过滤是 **like**（`pm_task/schema.py` 的 `__post_init__`）
		// ⇒ 拉回来的结果里可能混着「状态码里包含这个字样」的行 ⇒ 必须再**精确比对**一遍
		// （与项目编码那条路一样的做法）。
		const items =
			statusCode === undefined
				? page.items
				: page.items.filter((item) => item.status_code === statusCode);
		return items.map((item) => toUnifiedTask(item, this.#onWarning));
	}

	/** 按 key 取一条任务；找不到返回 null（不抛）。 */
	async getTask(key: string): Promise<UnifiedTask | null> {
		const { id } = parseEntityKey(key, "task");
		try {
			const wire = await this.#client.get<PmTaskOut>(PM_PATHS.task.detail(id), this.#token);
			return toUnifiedTask(wire, this.#onWarning);
		} catch (error) {
			if (isAdapterErrorException(error) && error.kind === "NOT_FOUND") {
				return null;
			}
			throw error;
		}
	}

	/**
	 * 建一条任务。
	 *
	 * 请求体是**后端的形状**（线上码 + 九个必填列），返回的是**统一模型**。
	 * 返回的实体带 `snapshot`（写前/写后快照）—— 撤销层将来直接读它，不用改这里的接口。
	 */
	async createTask(input: CreateTaskInput): Promise<UnifiedTask> {
		const projectId = await this.#resolveProjectId(input.project_key);
		const assigneeId =
			input.assignee_key === undefined ? null : resolveUserId(input.assignee_key);
		const milestoneId =
			input.milestone_key === undefined ? null : parseEntityKey(input.milestone_key, "milestone").id;
		const parentId = input.parent_key === undefined ? null : parseEntityKey(input.parent_key, "task").id;

		const type = taskTypeToUnified(input.type ?? DEFAULT_TASK_TYPE, this.#onWarning);
		const status = taskStatusToUnified(input.status ?? DEFAULT_TASK_STATUS, this.#onWarning);
		const priority = priorityToUnified(input.priority ?? DEFAULT_PRIORITY, this.#onWarning);

		const body: PmTaskCreate = {
			project_id: projectId,
			milestone_id: milestoneId,
			parent_id: parentId,
			title: input.title,
			description: input.description ?? null,
			// ⚠️ 上送的是**线上码**（不是统一名）
			type_code: taskTypeFromUnified(type, this.#onWarning),
			status_code: taskStatusFromUnified(status, this.#onWarning),
			priority_code: priorityFromUnified(priority, this.#onWarning),
			// ⚠️ Decimal 列：线上是字符串（`estimate_hours` / `sort_order`）
			estimate_hours:
				input.estimate_hours === undefined ? null : String(input.estimate_hours),
			actual_hours: null,
			assignee_id: assigneeId,
			// ⚠️ 三列 NOT NULL，后端**不回填** ⇒ 必须由调用方给
			reporter_id: input.reporter_id,
			reviewers: null,
			labels: null,
			start_date: input.start_date ?? null,
			due_date: input.due_date ?? null,
			actual_start_date: null,
			actual_end_date: null,
			sort_order: "0",
			// ⚠️ 字典 module_pm_task_created_via 里真实存在的值：manual / nl_chat / import / api
			//（schema 注释说的 'web' 兜底既不在字典里、service 里也没实现 ⇒ 不能用）
			// 'nl_chat' = 「自然语言对话建的」—— 这就是本服务建的任务的真相。
			created_via_code: "nl_chat",
			blocked_reason: null,
		};

		const wire = await this.#client.post<PmTaskOut>(PM_PATHS.task.create, this.#token, body);
		const entity = toUnifiedTask(wire, this.#onWarning);
		// 写快照：新建 ⇒ before 为 null（此前不存在），after 是落库后的实体
		return { ...entity, snapshot: { op: "create", before: null, after: entity } };
	}

	/* ------------------------------------------------------------ 内部 */

	/**
	 * 查询过滤用的状态：认识就转成**线上码**，不认识就抛 `VALIDATION`。
	 *
	 * ⚠️ **为什么这里不按「未命中 ⇒ 归一为默认值 + 告警」处理**：
	 * 那条规则是为**落库的值**准备的 —— 写路径必须给后端一个合法的码，
	 * 默认值是安全的兜底（顶多写错一个状态，能看出来、能改）。
	 * 但**查询过滤**是一次**筛选**：把「ARCHIVED」悄悄换成「backlog」，
	 * 调用方（尤其是 LLM）拿到的是一份**看起来对、其实答非所问**的结果 ——
	 * 它会把 backlog 的任务当成「已归档」报出去，而且**看上去很权威**。
	 * ⇒ 这里的规则是：**不认识 ⇒ 抛 VALIDATION**，错误里带上全部合法值，
	 * 让调用方（或 LLM）拿正确的状态重试。宁可直接失败，也不给假答案。
	 */
	#statusFilter(value: string, mapping: EnumMapping, label: string): string {
		if (!mapping.recognizes(value)) {
			const valid = [...mapping.toWire.keys()].join(" / ");
			throw new AdapterErrorException(
				"VALIDATION",
				`未知的${label}「${value}」；可用值：${valid}`,
			);
		}
		return mapping.fromUnified(mapping.toUnified(value, this.#onWarning), this.#onWarning);
	}

	/**
	 * 把 `project_key` 解成后端的项目 id。
	 *
	 * - `project:45` / `45` ⇒ 直接用 id，**不发请求**；
	 * - 项目编码 ⇒ 查一次（结果进进程级缓存，不会每次都查）。
	 */
	async #resolveProjectId(projectKey: string): Promise<number> {
		const trimmed = projectKey.trim();
		const parsed = tryParseEntityKey(trimmed);
		if (parsed !== undefined) {
			if (parsed.kind !== "project") {
				throw new AdapterErrorException(
					"VALIDATION",
					`「${projectKey}」不是项目的 key（项目应形如 project:45）`,
				);
			}
			return parsed.id;
		}
		const numeric = tryParseNumericId(trimmed);
		if (numeric !== undefined) {
			return numeric;
		}
		return this.#projectIdByCode(trimmed);
	}

	/** 按项目编码查 id（先查缓存；缓存**按身份隔离** ⇒ 不会串租户）。 */
	async #projectIdByCode(code: string): Promise<number> {
		// 缓存 key 带身份作用域 ⇒ 同一个编码在另一个身份下不会被命中
		const cacheKey = `${this.#scope}:${code.toUpperCase()}`;
		const cached = cachedProjectId(cacheKey);
		if (cached !== undefined) {
			return cached;
		}
		const id = await this.#queryProjectIdByCode(code);
		if (id === undefined) {
			throw new AdapterErrorException(
				"NOT_FOUND",
				`AiAdmin 里找不到项目「${code}」（既不是 project:<id>，也没有这个项目编码）`,
			);
		}
		storeProjectId(cacheKey, id);
		return id;
	}

	/** 按项目编码查 id（走后端的 like 过滤 —— 不是整表拉）。 */
	async #queryProjectIdByCode(code: string): Promise<number | undefined> {
		const page = await this.#client.get<AadminPageResult<PmProjectOut>>(
			PM_PATHS.project.list,
			this.#token,
			{ page_no: 1, page_size: 100, code },
		);
		// ⚠️ 后端的 code 过滤是 **like** ⇒ 可能匹配到别的编码（PRJ-1 命中 PRJ-10），
		// 所以必须**精确比对**一遍再认。
		const exact = page.items.find((item) => item.code === code);
		if (exact !== undefined && exact.id !== null) {
			return exact.id;
		}
		const insensitive = page.items.find(
			(item) => item.code.toLowerCase() === code.toLowerCase(),
		);
		return insensitive?.id ?? undefined;
	}
}

/* ------------------------------------------------------------ 映射工具 */

/** 负责人/报告人引用。 */
function toUserRef(
	id: number | null,
	by: Record<string, unknown> | null,
): UnifiedUserRef | undefined {
	if (id === null) {
		return undefined;
	}
	const ref: UnifiedUserRef = { key: entityKey("user", id), id };
	if (by !== null) {
		const name = by["name"];
		if (typeof name === "string") {
			ref.name = name;
		}
		const username = by["username"];
		if (typeof username === "string") {
			ref.username = username;
		}
	}
	return ref;
}

/**
 * 后端的 `reviewers` / `labels` 是 **JSON 列**（列类型 json，值可能是数组，
 * 也可能是「数组的字符串」——前端就是这么存的）⇒ 统一模型里给数组。
 */
function parseStringList(value: unknown): string[] {
	if (value === null || value === undefined) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return [];
		}
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed.filter((item): item is string => typeof item === "string");
			}
		} catch {
			// 不是 JSON ⇒ 当作逗号分隔的字符串
		}
		return trimmed
			.split(",")
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	return [];
}

/** 后端没给 id ⇒ 上游有问题，别猜。 */
function requireId(value: number | null, what: string): number {
	if (value === null) {
		throw new AdapterErrorException("UPSTREAM", `AiAdmin 返回的${what}没有 id`);
	}
	return value;
}

/** 线上任务 → 统一任务。 */
function toUnifiedTask(wire: PmTaskOut, sink: EnumWarningSink | undefined): UnifiedTask {
	const entity: UnifiedTask = {
		key: entityKey("task", requireId(wire.id, "任务")),
		project_key: entityKey("project", requireId(wire.project_id, "任务所属项目")),
		title: wire.title,
		type: taskTypeToUnified(wire.type_code, sink),
		status: taskStatusToUnified(wire.status_code, sink),
		priority: priorityToUnified(wire.priority_code, sink),
		reviewers: parseStringList(wire.reviewers),
		labels: parseStringList(wire.labels),
		sort_order: wire.sort_order ?? "0",
		source: taskSourceToUnified(wire.created_via_code ?? "manual", sink),
	};
	if (wire.milestone_id !== null) {
		entity.milestone_key = entityKey("milestone", wire.milestone_id);
	}
	if (wire.parent_id !== null) {
		entity.parent_key = entityKey("task", wire.parent_id);
	}
	if (wire.description !== null) {
		entity.description = wire.description;
	}
	// ⚠️ Decimal 列：JSON 上是字符串 ⇒ 这里保持字符串，不转成 number
	if (wire.estimate_hours !== null) {
		entity.estimate_hours = wire.estimate_hours;
	}
	if (wire.actual_hours !== null) {
		entity.actual_hours = wire.actual_hours;
	}
	if (wire.start_date !== null) {
		entity.start_date = wire.start_date;
	}
	if (wire.due_date !== null) {
		entity.due_date = wire.due_date;
	}
	if (wire.actual_start_date !== null) {
		entity.actual_start_date = wire.actual_start_date;
	}
	if (wire.actual_end_date !== null) {
		entity.actual_end_date = wire.actual_end_date;
	}
	const assignee = toUserRef(wire.assignee_id, wire.assignee_by);
	if (assignee !== undefined) {
		entity.assignee = assignee;
	}
	const reporter = toUserRef(wire.reporter_id, wire.reporter_by);
	if (reporter !== undefined) {
		entity.reporter = reporter;
	}
	return entity;
}

/** 线上项目 → 统一项目。 */
function toUnifiedProject(wire: PmProjectOut, sink: EnumWarningSink | undefined): UnifiedProject {
	const entity: UnifiedProject = {
		key: entityKey("project", requireId(wire.id, "项目")),
		code: wire.code,
		name: wire.name,
		status: projectStatusToUnified(wire.status_code, sink),
		priority: priorityToUnified(wire.priority_code, sink),
		start_date: wire.start_date,
		due_date: wire.due_date,
		tags: parseStringList(wire.tags),
		extra: parseJsonObject(wire.extra_fields),
	};
	if (wire.description !== null) {
		entity.description = wire.description;
	}
	const owner = toUserRef(wire.owner_id, wire.owner_by);
	if (owner !== undefined) {
		entity.owner = owner;
	}
	return entity;
}

/** 后端 JSON 列 → 对象（认不出来就当空对象，不猜）。 */
function parseJsonObject(value: unknown): Record<string, unknown> {
	if (value === null || value === undefined) {
		return {};
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		return { ...value };
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return {};
		}
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				return { ...parsed };
			}
		} catch {
			// 不是 JSON ⇒ 当空
		}
	}
	return {};
}

/** 用户 id：`user:9` 或纯数字 `9`。 */
function resolveUserId(value: string): number {
	const trimmed = value.trim();
	const parsed = tryParseEntityKey(trimmed);
	if (parsed !== undefined) {
		if (parsed.kind !== "user") {
			throw new AdapterErrorException(
				"VALIDATION",
				`「${value}」不是用户的 key（用户应形如 user:9）`,
			);
		}
		return parsed.id;
	}
	const numeric = tryParseNumericId(trimmed);
	if (numeric !== undefined) {
		return numeric;
	}
	throw new AdapterErrorException("VALIDATION", `「${value}」不是合法的用户 id（形如 user:9）`);
}
