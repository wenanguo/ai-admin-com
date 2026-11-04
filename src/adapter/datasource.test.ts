import { afterEach, describe, expect, it, vi } from "vitest";
import { AadminClient } from "../aadmin/client";
import { AdapterErrorException } from "../aadmin/errors";
import { AadminDataSource, clearProjectIdCache } from "./datasource";
import type { EnumWarning } from "./enums";

const TOKEN = "test-token-must-not-leak";
const BASE_URL = "https://www.pmdict.cn/api/v1";

interface FetchCall {
	url: string;
	init: RequestInit;
}

/** 造一个按队列吐响应的假 fetch，并记录每一次调用。 */
function makeClient(responses: Array<Response | Error>): {
	client: AadminClient;
	calls: FetchCall[];
} {
	const calls: FetchCall[] = [];
	let index = 0;

	const fetchImpl: typeof fetch = async (input, init) => {
		calls.push({ url: String(input), init: init ?? {} });
		const next = responses[index];
		index += 1;
		if (next === undefined) {
			throw new Error("客户端多发了一次请求（响应队列已空）");
		}
		if (next instanceof Error) {
			throw next;
		}
		return next;
	};

	return { client: new AadminClient({ baseUrl: BASE_URL, fetchImpl }), calls };
}

/** 造一个 JSON 信封响应。 */
function jsonResponse(
	body: unknown,
	init: { status?: number; headers?: Record<string, string> } = {},
): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
	});
}

/** 后端的任务出参（字段照抄 `ModulePmTaskOutSchema`）。 */
function taskOut(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 123,
		uuid: "u-1",
		created_time: "2026-11-04 10:00:00",
		updated_time: "2026-11-04 10:00:00",
		is_deleted: false,
		deleted_time: null,
		created_id: 7,
		created_by: { id: 7, name: "张三" },
		updated_id: null,
		updated_by: null,
		deleted_id: null,
		deleted_by: null,
		tenant_id: 1,
		tenant_by: null,
		project_id: 45,
		milestone_id: null,
		parent_id: null,
		title: "写文档",
		description: null,
		type_code: "feature",
		status_code: "todo",
		priority_code: "P1",
		estimate_hours: "2.50",
		actual_hours: null,
		assignee_id: null,
		reporter_id: 7,
		reviewers: null,
		labels: null,
		start_date: null,
		due_date: null,
		actual_start_date: null,
		actual_end_date: null,
		sort_order: "0.0000",
		created_via_code: "manual",
		blocked_reason: null,
		assignee_by: null,
		reporter_by: { id: 7, name: "张三", username: "zhangsan" },
		...overrides,
	};
}

/** 后端的项目出参。 */
function projectOut(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 45,
		uuid: "p-1",
		created_time: "2026-11-04 10:00:00",
		updated_time: "2026-11-04 10:00:00",
		is_deleted: false,
		deleted_time: null,
		created_id: 7,
		created_by: null,
		updated_id: null,
		updated_by: null,
		deleted_id: null,
		deleted_by: null,
		tenant_id: 1,
		tenant_by: null,
		code: "PRJ-2026-Q3-001",
		name: "2026 Q3",
		description: null,
		owner_id: 7,
		template_id: null,
		status_code: "active",
		priority_code: "P1",
		start_date: "2026-07-01",
		due_date: "2026-09-30",
		visibility_code: "public",
		tags: null,
		extra_fields: null,
		owner_by: null,
		...overrides,
	};
}

/** 取请求体（JSON.parse 之后的对象）。 */
function bodyOf(call: FetchCall): Record<string, unknown> {
	const raw = call.init.body;
	if (typeof raw !== "string") {
		throw new Error("这次请求没有 body");
	}
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed)) {
		throw new Error("请求体不是 JSON 对象");
	}
	return parsed;
}

/** 是不是一个普通对象（类型守卫，不用 `as`）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 造一个**按 token 分租户**的假 fetch：同一个项目编码在两个 token 下是两个不同的项目。
 *
 * 这正是线上的样子 —— 项目编码只在**租户内**唯一 ⇒ 缓存若跨身份复用，
 * 就会把 A 租户的项目 id 发给 B 租户（任务建到别人的项目里）。
 */
function makeTenantClient(): { client: AadminClient; calls: FetchCall[] } {
	const calls: FetchCall[] = [];

	const fetchImpl: typeof fetch = async (input, init) => {
		calls.push({ url: String(input), init: init ?? {} });
		const headers = new Headers(init?.headers);
		const projectId = headers.get("Authorization")?.includes("tenant-a") ? 45 : 99;
		const url = new URL(String(input));
		if (url.pathname.endsWith("/pm_task/create")) {
			return jsonResponse({ code: 0, msg: "成功", data: taskOut({ project_id: projectId }) });
		}
		return jsonResponse({
			code: 0,
			msg: "成功",
			data: {
				page_no: 1,
				page_size: 100,
				total: 1,
				has_next: false,
				items: [projectOut({ id: projectId, code: "PRJ-2026-Q3-001" })],
			},
		});
	};

	return { client: new AadminClient({ baseUrl: BASE_URL, fetchImpl }), calls };
}

/** 造一个数据源（假 client + 假 token）。 */
function makeSource(
	responses: Array<Response | Error>,
): {
	source: AadminDataSource;
	calls: FetchCall[];
	warnings: EnumWarning[];
} {
	const { client, calls } = makeClient(responses);
	const warnings: EnumWarning[] = [];
	const source = new AadminDataSource({
		client,
		token: TOKEN,
		onWarning: (warning) => void warnings.push(warning),
	});
	return { source, calls, warnings };
}

/**
 * 取一次调用的失败（类型守卫，不用 `as`）；没失败就抛错（测试据此失败）。
 */
async function rejectionOf(promise: Promise<unknown>): Promise<AdapterErrorException> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof AdapterErrorException) {
			return error;
		}
		throw error;
	}
	throw new Error("这次调用没有抛错（期望它失败）");
}

afterEach(() => {
	clearProjectIdCache();
});

describe("AadminDataSource · createTask 的请求体", () => {
	it("路径是**两段**插件前缀 /pm_project/pm_task/create", async () => {
		const { source, calls } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "project:45",
			title: "写文档",
			reporter_id: 7,
		});

		expect(calls).toHaveLength(1);
		expect(new URL(calls[0].url).pathname).toBe("/api/v1/pm_project/pm_task/create");
		expect(calls[0]?.init.method).toBe("POST");
	});

	it("九个必填字段一个不少，且用的是**线上码**", async () => {
		const { source, calls } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "project:45",
			title: "写文档",
			reporter_id: 7,
			type: "bug",
			status: "in_progress",
			priority: "P0",
		});

		const body = bodyOf(calls[0]);
		expect(body["project_id"]).toBe(45);
		expect(body["title"]).toBe("写文档");
		// 线上码，不是统一名
		expect(body["type_code"]).toBe("bug");
		expect(body["status_code"]).toBe("in_progress");
		expect(body["priority_code"]).toBe("P0");
		// 三列 NOT NULL
		expect(body["reporter_id"]).toBe(7);
		expect(body["sort_order"]).toBe("0");
		expect(Number(body["sort_order"])).toBe(0);
		// 创建来源：字典 module_pm_task_created_via 里真实存在的 'nl_chat'（自然语言对话建的）
		expect(body["created_via_code"]).toBe("nl_chat");
	});

	it("没给类型/状态/优先级时用后端字典的默认值", async () => {
		const { source, calls } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({ project_key: "project:45", title: "写文档", reporter_id: 7 });

		const body = bodyOf(calls[0]);
		expect(body["type_code"]).toBe("feature");
		expect(body["status_code"]).toBe("backlog");
		expect(body["priority_code"]).toBe("P2");
	});

	it("认统一名，也认线上码", async () => {
		const { source, calls } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "project:45",
			title: "写文档",
			reporter_id: 7,
			type: "FEATURE",
			status: "IN_PROGRESS",
			priority: "p1",
		});

		const body = bodyOf(calls[0]);
		expect(body["type_code"]).toBe("feature");
		expect(body["status_code"]).toBe("in_progress");
		expect(body["priority_code"]).toBe("P1");
	});

	it("不认识的值归一为默认，并且有告警（不猜语义）", async () => {
		const { source, calls, warnings } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "project:45",
			title: "写文档",
			reporter_id: 7,
			status: "瞎写的状态",
		});

		const body = bodyOf(calls[0]);
		expect(body["status_code"]).toBe("backlog");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.field).toBe("task_status");
		expect(warnings[0]?.raw).toBe("瞎写的状态");
	});

	it("估时按字符串上送（后端是 Decimal），负责人用 user key 解出 id", async () => {
		const { source, calls } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "project:45",
			title: "写文档",
			reporter_id: 7,
			assignee_key: "user:9",
			estimate_hours: 2.5,
		});

		const body = bodyOf(calls[0]);
		expect(body["assignee_id"]).toBe(9);
		expect(body["estimate_hours"]).toBe("2.5");
	});

	it("估时传字符串时原样保留（不丢精度）", async () => {
		const { source, calls } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "project:45",
			title: "写文档",
			reporter_id: 7,
			estimate_hours: "2.50",
		});

		expect(bodyOf(calls[0])["estimate_hours"]).toBe("2.50");
	});
});

describe("AadminDataSource · project_key 的解析", () => {
	it("project:45 ⇒ 直接用 id，不发任何额外请求", async () => {
		const { source, calls } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({ project_key: "project:45", title: "写文档", reporter_id: 7 });

		expect(calls).toHaveLength(1);
		expect(bodyOf(calls[0])["project_id"]).toBe(45);
	});

	it("项目编码 ⇒ 先查项目（带缓存），第二次同样的编码不再查", async () => {
		const listResponse = jsonResponse({
			code: 0,
			msg: "成功",
			data: {
				page_no: 1,
				page_size: 100,
				total: 1,
				has_next: false,
				items: [projectOut()],
			},
		});
		const { source, calls } = makeSource([
			listResponse,
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "PRJ-2026-Q3-001",
			title: "写文档",
			reporter_id: 7,
		});
		await source.createTask({
			project_key: "PRJ-2026-Q3-001",
			title: "再写一份",
			reporter_id: 7,
		});

		// 第一次：查项目 + 建任务；第二次：只建任务（编码已缓存）
		expect(calls).toHaveLength(3);
		expect(new URL(calls[0].url).pathname).toBe("/api/v1/pm_project/pm_project/list");
		expect(new URL(calls[1].url).pathname).toBe("/api/v1/pm_project/pm_task/create");
		expect(new URL(calls[2].url).pathname).toBe("/api/v1/pm_project/pm_task/create");
		expect(bodyOf(calls[1])["project_id"]).toBe(45);
		expect(bodyOf(calls[2])["project_id"]).toBe(45);
	});

	it("查项目时带上 code 过滤（不整表拉）", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: { page_no: 1, page_size: 100, total: 1, has_next: false, items: [projectOut()] },
			}),
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "PRJ-2026-Q3-001",
			title: "写文档",
			reporter_id: 7,
		});

		const url = new URL(calls[0].url);
		expect(url.searchParams.get("code")).toBe("PRJ-2026-Q3-001");
	});

	it("编码查不到 ⇒ 明确报错，不静默建到别的项目上", async () => {
		const { source } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: { page_no: 1, page_size: 100, total: 0, has_next: false, items: [] },
			}),
		]);

		await expect(
			source.createTask({ project_key: "PRJ-不存在的编码", title: "写文档", reporter_id: 7 }),
		).rejects.toBeInstanceOf(AdapterErrorException);
	});

	it("同一个编码在两个 token 下必须解析成不同的项目 id（缓存按身份隔离）", async () => {
		const { client, calls } = makeTenantClient();

		const sourceA = new AadminDataSource({ client, token: "token-tenant-a" });
		const sourceB = new AadminDataSource({ client, token: "token-tenant-b" });

		await sourceA.createTask({
			project_key: "PRJ-2026-Q3-001",
			title: "写文档",
			reporter_id: 7,
		});
		await sourceB.createTask({
			project_key: "PRJ-2026-Q3-001",
			title: "写文档",
			reporter_id: 7,
		});

		// 两个身份各自查了一次项目（没有共用缓存）
		expect(calls).toHaveLength(4);
		expect(bodyOf(calls[1])["project_id"]).toBe(45);
		expect(bodyOf(calls[3])["project_id"]).toBe(99);
	});

	it("同一个 token 下重复用编码仍然命中缓存（隔离不该把缓存也一起废掉）", async () => {
		const { client, calls } = makeTenantClient();
		const source = new AadminDataSource({ client, token: "token-tenant-a" });

		await source.createTask({
			project_key: "PRJ-2026-Q3-001",
			title: "写文档",
			reporter_id: 7,
		});
		await source.createTask({
			project_key: "PRJ-2026-Q3-001",
			title: "再写一份",
			reporter_id: 7,
		});

		// 第一次查项目 + 建任务；第二次直接用缓存 ⇒ 不再查项目
		expect(calls).toHaveLength(3);
		expect(bodyOf(calls[2])["project_id"]).toBe(45);
	});

	it("编码大小写不同也能命中（项目编码的约定是大写）", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: {
					page_no: 1,
					page_size: 100,
					total: 1,
					has_next: false,
					items: [projectOut()],
				},
			}),
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		await source.createTask({
			project_key: "prj-2026-q3-001",
			title: "写文档",
			reporter_id: 7,
		});

		expect(bodyOf(calls[1])["project_id"]).toBe(45);
	});
});

describe("AadminDataSource · 读", () => {
	it("listTasks 把线上码归一成统一枚举", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: {
					page_no: 1,
					page_size: 10,
					total: 1,
					has_next: false,
					items: [taskOut({ status_code: "in_progress", type_code: "ops" })],
				},
			}),
		]);

		const tasks = await source.listTasks({ project_id: 45 });

		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("IN_PROGRESS");
		expect(tasks[0]?.type).toBe("OPS");
		expect(tasks[0]?.priority).toBe("P1");
		expect(tasks[0]?.key).toBe("task:123");
		expect(tasks[0]?.project_key).toBe("project:45");
		expect(tasks[0]?.estimate_hours).toBe("2.50");
		expect(tasks[0]?.sort_order).toBe("0.0000");
		expect(tasks[0]?.source).toBe("MANUAL");
		expect(tasks[0]?.reporter?.name).toBe("张三");
		const url = new URL(calls[0].url);
		expect(url.pathname).toBe("/api/v1/pm_project/pm_task/list");
		expect(url.searchParams.get("project_id")).toBe("45");
	});

	it("listTasks 的状态过滤用线上码", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: { page_no: 1, page_size: 10, total: 0, has_next: false, items: [] },
			}),
		]);

		await source.listTasks({ status: "IN_PROGRESS" });

		const url = new URL(calls[0].url);
		expect(url.searchParams.get("status_code")).toBe("in_progress");
	});

	it("listTasks 的状态过滤会**精确比对**（后端的 status_code 过滤是 like）", async () => {
		// 后端的过滤是 like ⇒ 'in_progress' 会把 'in_progress_x' 也捞回来
		const { source } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: {
					page_no: 1,
					page_size: 10,
					total: 2,
					has_next: false,
					items: [
						taskOut({ id: 1, status_code: "in_progress" }),
						taskOut({ id: 2, status_code: "in_progress_x" }),
					],
				},
			}),
		]);

		const tasks = await source.listTasks({ status: "IN_PROGRESS" });

		// 只留**真的**是 in_progress 的那一条
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.key).toBe("task:1");
	});

	it("listProjects 的状态过滤也会精确比对（后端的 status_code 过滤是 like）", async () => {
		const { source } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: {
					page_no: 1,
					page_size: 100,
					total: 2,
					has_next: false,
					items: [
						projectOut({ id: 45, status_code: "active" }),
						projectOut({ id: 46, status_code: "active_x" }),
					],
				},
			}),
		]);

		const projects = await source.listProjects({ status: "ACTIVE" });

		expect(projects).toHaveLength(1);
		expect(projects[0]?.key).toBe("project:45");
	});

	it("getTask 用 task:123 去查详情", async () => {
		const { source, calls } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		const task = await source.getTask("task:123");

		expect(new URL(calls[0].url).pathname).toBe("/api/v1/pm_project/pm_task/detail/123");
		expect(task?.key).toBe("task:123");
	});

	it("getTask 找不到 ⇒ null（不抛）", async () => {
		const { source } = makeSource([
			jsonResponse({ code: 404, msg: "该数据不存在", data: null }, { status: 404 }),
		]);

		await expect(source.getTask("task:999")).resolves.toBeNull();
	});

	it("listProjects 返回统一模型（key 与 code 都在）", async () => {
		const { source } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: {
					page_no: 1,
					page_size: 100,
					total: 1,
					has_next: false,
					items: [projectOut()],
				},
			}),
		]);

		const projects = await source.listProjects();

		expect(projects[0]?.key).toBe("project:45");
		expect(projects[0]?.code).toBe("PRJ-2026-Q3-001");
		expect(projects[0]?.status).toBe("ACTIVE");
		expect(projects[0]?.priority).toBe("P1");
	});

	it("listTasks 遇到未知的状态 ⇒ 抛 VALIDATION（不按默认状态过滤）", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: { page_no: 1, page_size: 10, total: 0, has_next: false, items: [] },
			}),
		]);

		const error = await rejectionOf(source.listTasks({ status: "ARCHIVED" }));

		expect(error.kind).toBe("VALIDATION");
		expect(error.message).toContain("ARCHIVED");
		// 没有发出任何请求 —— 更没有偷偷按 backlog 过滤
		expect(calls).toHaveLength(0);
	});

	it("listTasks 遇到未知的线上码状态 ⇒ 同样抛 VALIDATION", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: { page_no: 1, page_size: 10, total: 0, has_next: false, items: [] },
			}),
		]);

		const error = await rejectionOf(source.listTasks({ status: "瞎写的状态" }));

		expect(error.kind).toBe("VALIDATION");
		expect(calls).toHaveLength(0);
	});

	it("状态不认识时连项目都不用查（先校验后发请求）", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: {
					page_no: 1,
					page_size: 100,
					total: 1,
					has_next: false,
					items: [projectOut()],
				},
			}),
			jsonResponse({
				code: 0,
				msg: "成功",
				data: { page_no: 1, page_size: 10, total: 0, has_next: false, items: [] },
			}),
		]);

		const error = await rejectionOf(
			source.listTasks({ project_key: "PRJ-2026-Q3-001", status: "ARCHIVED" }),
		);

		expect(error.kind).toBe("VALIDATION");
		expect(calls).toHaveLength(0);
	});

	it("listProjects 遇到未知的状态 ⇒ 抛 VALIDATION（不按默认状态过滤）", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: { page_no: 1, page_size: 100, total: 0, has_next: false, items: [] },
			}),
		]);

		const error = await rejectionOf(source.listProjects({ status: "瞎写的状态" }));

		expect(error.kind).toBe("VALIDATION");
		expect(error.message).toContain("瞎写的状态");
		expect(calls).toHaveLength(0);
	});

	it("listProjects 的状态过滤用线上码", async () => {
		const { source, calls } = makeSource([
			jsonResponse({
				code: 0,
				msg: "成功",
				data: { page_no: 1, page_size: 100, total: 0, has_next: false, items: [] },
			}),
		]);

		await source.listProjects({ status: "ON_HOLD" });

		expect(new URL(calls[0].url).searchParams.get("status_code")).toBe("on_hold");
	});
});

describe("AadminDataSource · 写快照的插槽", () => {
	it("createTask 返回的实体带着 before/after 快照", async () => {
		const { source } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		const task = await source.createTask({
			project_key: "project:45",
			title: "写文档",
			reporter_id: 7,
		});

		expect(task.snapshot?.op).toBe("create");
		// 新建之前没有旧实体
		expect(task.snapshot?.before).toBeNull();
		expect(task.snapshot?.after?.key).toBe("task:123");
		expect(task.snapshot?.after?.snapshot).toBeUndefined();
	});

	it("token 不会出现在返回值里", async () => {
		const { source } = makeSource([
			jsonResponse({ code: 0, msg: "成功", data: taskOut() }),
		]);

		const task = await source.createTask({
			project_key: "project:45",
			title: "写文档",
			reporter_id: 7,
		});

		expect(JSON.stringify(task)).not.toContain(TOKEN);
	});
});
