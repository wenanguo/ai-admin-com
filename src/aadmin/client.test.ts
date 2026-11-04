import { describe, expect, it, vi } from "vitest";
import { AadminClient } from "./client";
import { AdapterErrorException, isRetryable } from "./errors";
import { PM_PATHS } from "./types";

/**
 * 假 token：只允许出现在请求头里。
 * 任何错误消息、日志、返回值里都不该出现它。
 */
const TOKEN = "test-token-must-not-leak";

/** 线上 base（含 `/api/v1`），与 env.AIADMIN_BASE_URL 同形。 */
const BASE_URL = "https://www.pmdict.cn/api/v1";

interface FetchCall {
	url: string;
	init: RequestInit;
}

/** 造一个按队列吐响应的假 fetch，并记录每一次调用。 */
function makeClient(responses: Array<Response | Error>): { client: AadminClient; calls: FetchCall[] } {
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

/** 取第一次请求；没有请求就说明断言写错了。 */
function firstCall(calls: FetchCall[]): FetchCall {
	const call = calls[0];
	if (!call) {
		throw new Error("没有捕获到任何请求");
	}
	return call;
}

/** 断言 promise 以 AdapterErrorException 失败，并把它捞出来。 */
async function captureError(promise: Promise<unknown>): Promise<AdapterErrorException> {
	try {
		await promise;
	} catch (err) {
		if (err instanceof AdapterErrorException) {
			return err;
		}
		throw err;
	}
	throw new Error("本该抛出 AdapterErrorException，但没有抛");
}

describe("AadminClient · 成功路径", () => {
	it("业务码 0 时返回 data", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 0, msg: "成功", data: { id: 7, title: "写文档" } }),
		]);

		const data = await client.get<{ id: number; title: string }>(PM_PATHS.task.list, TOKEN);

		expect(data).toEqual({ id: 7, title: "写文档" });
	});

	it("业务码 200 也算成功", async () => {
		const { client } = makeClient([jsonResponse({ code: 200, msg: "操作成功", data: [1, 2] })]);

		await expect(client.get(PM_PATHS.task.list, TOKEN)).resolves.toEqual([1, 2]);
	});

	it("URL 是 base + path（base 里已含 /api/v1，不再重复拼）", async () => {
		const { client, calls } = makeClient([jsonResponse({ code: 0, msg: "成功", data: null })]);

		await client.get(PM_PATHS.task.list, TOKEN);

		expect(firstCall(calls).url).toBe(`${BASE_URL}/pm_project/pm_task/list`);
	});

	it("查询参数：undefined 的跳过，其余原样编码", async () => {
		const { client, calls } = makeClient([jsonResponse({ code: 0, msg: "成功", data: [] })]);

		await client.get(PM_PATHS.task.list, TOKEN, {
			page_no: 1,
			page_size: 20,
			title: undefined,
			name: "接口 文档",
		});

		const url = new URL(firstCall(calls).url);
		expect(url.pathname).toBe("/api/v1/pm_project/pm_task/list");
		expect(url.searchParams.get("page_no")).toBe("1");
		expect(url.searchParams.get("page_size")).toBe("20");
		expect(url.searchParams.get("name")).toBe("接口 文档");
		expect(url.searchParams.has("title")).toBe(false);
	});

	it("token 原样放进 Authorization 头", async () => {
		const { client, calls } = makeClient([jsonResponse({ code: 0, msg: "成功", data: null })]);

		await client.get(PM_PATHS.task.list, TOKEN);

		const headers = firstCall(calls).init.headers;
		expect(headers).toBeDefined();
		expect(new Headers(headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
	});

	it("写操作带 JSON 体：DELETE 的体是裸数组", async () => {
		const { client, calls } = makeClient([jsonResponse({ code: 0, msg: "成功", data: null })]);

		await client.delete(PM_PATHS.task.remove, TOKEN, [1, 2]);

		const call = firstCall(calls);
		expect(call.init.method).toBe("DELETE");
		expect(call.init.body).toBe("[1,2]");
		expect(new Headers(call.init.headers).get("Content-Type")).toBe("application/json");
	});

	it("没有体时不发 body", async () => {
		const { client, calls } = makeClient([jsonResponse({ code: 0, msg: "成功", data: null })]);

		await client.delete(PM_PATHS.task.remove, TOKEN);

		expect(firstCall(calls).init.body).toBeUndefined();
	});
});

describe("AadminClient · 错误归一", () => {
	it("HTTP 401 → AUTH_EXPIRED", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 10401, msg: "认证已失效", data: null }, { status: 401 }),
		]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(err.kind).toBe("AUTH_EXPIRED");
	});

	it("HTTP 403 → AUTH_EXPIRED", async () => {
		const { client } = makeClient([jsonResponse({ code: 403, msg: "访问受限", data: null }, { status: 403 })]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(err.kind).toBe("AUTH_EXPIRED");
	});

	it("HTTP 200 + 业务码 401 → AUTH_EXPIRED", async () => {
		const { client } = makeClient([jsonResponse({ code: 401, msg: "未授权", data: null })]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(err.kind).toBe("AUTH_EXPIRED");
	});

	it("HTTP 200 + 业务码 10401 → AUTH_EXPIRED", async () => {
		const { client } = makeClient([jsonResponse({ code: 10401, msg: "认证已失效", data: null })]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(err.kind).toBe("AUTH_EXPIRED");
	});

	it("HTTP 404 → NOT_FOUND", async () => {
		const { client } = makeClient([jsonResponse({ code: 404, msg: "资源不存在", data: null }, { status: 404 })]);

		const err = await captureError(client.get(PM_PATHS.task.detail(9), TOKEN));
		expect(err.kind).toBe("NOT_FOUND");
	});

	it("HTTP 409 → CONFLICT", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 409, msg: "资源冲突", data: null }, { status: 409 }),
		]);

		const err = await captureError(client.post(PM_PATHS.project.create, TOKEN, {}));
		expect(err.kind).toBe("CONFLICT");
	});

	it("HTTP 429 → RATE_LIMIT，并带上 Retry-After 换算出的毫秒数", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 429, msg: "请求过于频繁", data: null }, { status: 429, headers: { "Retry-After": "2" } }),
		]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(err.kind).toBe("RATE_LIMIT");
		expect(err.retryAfterMs).toBe(2000);
	});

	it("HTTP 429 没有 Retry-After 头时 retryAfterMs 缺省", async () => {
		const { client } = makeClient([jsonResponse({ code: 429, msg: "请求过于频繁", data: null }, { status: 429 })]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(err.kind).toBe("RATE_LIMIT");
		expect(err.retryAfterMs).toBeUndefined();
	});

	it("HTTP 400 → VALIDATION", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 400, msg: "参数错误", data: null }, { status: 400 }),
		]);

		const err = await captureError(client.post(PM_PATHS.task.create, TOKEN, {}));
		expect(err.kind).toBe("VALIDATION");
	});

	it("HTTP 422 → VALIDATION，并把 data 里的字段错误带出来", async () => {
		const { client } = makeClient([
			jsonResponse(
				{ code: 422, msg: "无法处理的实体", data: { title: "标题不能为空" } },
				{ status: 422 },
			),
		]);

		const err = await captureError(client.post(PM_PATHS.task.create, TOKEN, {}));
		expect(err.kind).toBe("VALIDATION");
		expect(err.fields).toEqual({ title: "标题不能为空" });
	});

	it("HTTP 200 + 非成功业务码 → VALIDATION", async () => {
		const { client } = makeClient([jsonResponse({ code: 40001, msg: "项目编码已存在", data: null })]);

		const err = await captureError(client.post(PM_PATHS.project.create, TOKEN, {}));
		expect(err.kind).toBe("VALIDATION");
	});

	it("HTTP 200 + 非成功业务码，data 是字段表时带出 fields", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 40001, msg: "参数不合法", data: { code: "编码不合法" } }),
		]);

		const err = await captureError(client.post(PM_PATHS.project.create, TOKEN, {}));
		expect(err.kind).toBe("VALIDATION");
		expect(err.fields).toEqual({ code: "编码不合法" });
	});

	it("HTTP 500 → UPSTREAM 且可重试", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
		]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(err.kind).toBe("UPSTREAM");
		expect(err.retryable).toBe(true);
	});

	it("HTTP 200 但不是合法信封 → UPSTREAM", async () => {
		const { client } = makeClient([new Response("不是 JSON", { status: 200 })]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(err.kind).toBe("UPSTREAM");
	});

	it("HTTP 204（无响应体）算成功，不报错", async () => {
		const { client } = makeClient([new Response(null, { status: 204 })]);

		await expect(client.delete(PM_PATHS.task.remove, TOKEN, [1])).resolves.toBeUndefined();
	});
});

describe("AadminClient · 重试策略", () => {
	it("读操作遇到可重试错误时重试一次（共两次请求）", async () => {
		const { client, calls } = makeClient([
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
		]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));

		expect(calls).toHaveLength(2);
		expect(err.kind).toBe("UPSTREAM");
	});

	it("读操作第二次成功就返回数据", async () => {
		const { client, calls } = makeClient([
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
			jsonResponse({ code: 0, msg: "成功", data: { id: 3 } }),
		]);

		await expect(client.get(PM_PATHS.task.list, TOKEN)).resolves.toEqual({ id: 3 });
		expect(calls).toHaveLength(2);
	});

	it("读操作遇到不可重试的错误（404）不重试", async () => {
		const { client, calls } = makeClient([
			jsonResponse({ code: 404, msg: "资源不存在", data: null }, { status: 404 }),
		]);

		await captureError(client.get(PM_PATHS.task.detail(9), TOKEN));
		expect(calls).toHaveLength(1);
	});

	it("网络错误：读操作重试一次", async () => {
		const { client, calls } = makeClient([
			new Error("fetch failed"),
			new Error("fetch failed"),
		]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));

		expect(calls).toHaveLength(2);
		expect(err.kind).toBe("UPSTREAM");
		expect(err.retryable).toBe(true);
	});

	it("网络错误：写操作只发一次请求，且标成不可重试", async () => {
		const { client, calls } = makeClient([new Error("fetch failed")]);

		const err = await captureError(client.post(PM_PATHS.task.create, TOKEN, { title: "x" }));

		expect(calls).toHaveLength(1);
		expect(err.kind).toBe("UPSTREAM");
		expect(err.retryable).toBe(false);
	});

	it("写操作遇到 5xx 也不重试", async () => {
		const { client, calls } = makeClient([
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
		]);

		await captureError(client.post(PM_PATHS.task.create, TOKEN, { title: "x" }));
		expect(calls).toHaveLength(1);
	});
});

describe("AadminClient · 可重试性按读写区分", () => {
	it("读操作遇 5xx → UPSTREAM 且 retryable 为 true", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
		]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));

		expect(err.kind).toBe("UPSTREAM");
		expect(err.retryable).toBe(true);
		expect(err.details.retryable).toBe(true);
		expect(isRetryable(err)).toBe(true);
	});

	it("写操作遇 5xx → UPSTREAM 但 retryable 为 false（写请求可能已生效，不能重放）", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
		]);

		const err = await captureError(client.post(PM_PATHS.task.create, TOKEN, { title: "x" }));

		expect(err.kind).toBe("UPSTREAM");
		expect(err.retryable).toBe(false);
		expect(err.details.retryable).toBe(false);
		expect(isRetryable(err)).toBe(false);
	});

	it("写操作遇 5xx（HTTP 200 + 业务码 500）→ 同样不可重试", async () => {
		const { client } = makeClient([jsonResponse({ code: 500, msg: "服务器内部错误", data: null })]);

		const err = await captureError(client.put(PM_PATHS.task.update(3), TOKEN, { title: "x" }));

		expect(err.kind).toBe("UPSTREAM");
		expect(err.retryable).toBe(false);
		expect(isRetryable(err)).toBe(false);
	});

	it("写操作遇 2xx 但不是合法信封 → 不可重试（写可能已经生效）", async () => {
		const { client } = makeClient([new Response("不是 JSON", { status: 200 })]);

		const err = await captureError(client.delete(PM_PATHS.task.remove, TOKEN, [1]));

		expect(err.kind).toBe("UPSTREAM");
		expect(err.retryable).toBe(false);
		expect(isRetryable(err)).toBe(false);
	});

	it("isRetryable 与错误自带的 details.retryable 一致（details 说 false 就不算可重试）", () => {
		const err = new AdapterErrorException("UPSTREAM", "上游炸了", { retryable: false });

		expect(err.details.retryable).toBe(false);
		expect(isRetryable(err)).toBe(false);
	});
});

describe("AadminClient · token 不外泄", () => {
	it("错误消息里没有 token", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
		]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));

		expect(err.message).not.toContain(TOKEN);
	});

	it("底层错误消息里带 token 时也会被抹掉", async () => {
		const { client } = makeClient([new Error(`fetch failed: token=${TOKEN}`)]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));

		expect(err.message).not.toContain(TOKEN);
	});

	it("出错时不会把 token 打到 console 里", async () => {
		const spies = [
			vi.spyOn(console, "log"),
			vi.spyOn(console, "error"),
			vi.spyOn(console, "warn"),
		];
		try {
			const { client } = makeClient([
				jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
			]);
			await captureError(client.get(PM_PATHS.task.list, TOKEN));
			for (const spy of spies) {
				for (const call of spy.mock.calls) {
					expect(JSON.stringify(call)).not.toContain(TOKEN);
				}
			}
		} finally {
			for (const spy of spies) {
				spy.mockRestore();
			}
		}
	});

	it("客户端实例上不存 token", async () => {
		const { client } = makeClient([jsonResponse({ code: 0, msg: "成功", data: null })]);

		await client.get(PM_PATHS.task.list, TOKEN);

		expect(JSON.stringify(client)).not.toContain(TOKEN);
	});

	it("堆栈里也不带 token", async () => {
		const { client } = makeClient([new Error(`fetch failed: token=${TOKEN}`)]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));

		expect(err.stack ?? "").not.toContain(TOKEN);
	});
});

describe("isRetryable", () => {
	it("只有可重试的 UPSTREAM 才算可重试", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 500, msg: "服务器内部错误", data: null }, { status: 500 }),
		]);

		const err = await captureError(client.get(PM_PATHS.task.list, TOKEN));
		expect(isRetryable(err)).toBe(true);
	});

	it("VALIDATION / NOT_FOUND 之类不可重试", async () => {
		const { client } = makeClient([
			jsonResponse({ code: 404, msg: "资源不存在", data: null }, { status: 404 }),
		]);

		const err = await captureError(client.get(PM_PATHS.task.detail(9), TOKEN));
		expect(isRetryable(err)).toBe(false);
	});
});
