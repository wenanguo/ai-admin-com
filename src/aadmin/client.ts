import { isSuccess } from "../types/api";
import { AdapterErrorException, isRetryable } from "./errors";

/**
 * 查询参数。值为 `undefined` 的键**不拼进 URL**；其余值按字符串编码。
 */
export type QueryParams = Record<string, string | number | undefined>;

export interface AadminClientOptions {
	/** AiAdmin 的 base 地址，**已含 `/api/v1`**（见 `env.AIADMIN_BASE_URL`）。 */
	baseUrl: string;
	/** 注入用的 fetch（测试用）；不传就走全局 fetch。 */
	fetchImpl?: typeof fetch;
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestSpec {
	method: HttpMethod;
	/** 相对 base 的路径（如 `/pm_project/pm_task/list`）。 */
	path: string;
	/** 调用方的 token —— 按次传入，客户端不持有、也不缓存任何长期凭据。 */
	token: string;
	query?: QueryParams;
	body?: unknown;
	/** 只有读操作才允许自动重试。 */
	isRead: boolean;
}

/** 后端 `RET.EXCEPTION` 的业务码（`backend/app/common/constant.py`）。 */
const BUSINESS_EXCEPTION_CODE = -1;

/**
 * AiAdmin 的 HTTP 客户端。
 *
 * 只做三件事：**拼 URL / 带 token / 把结果与异常归一**。
 * 不做字段映射、不做枚举归一、不做能力判断 —— 那些是适配层（Task 4）的事。
 *
 * 路径是**相对 base** 的：`AIADMIN_BASE_URL` 里已经含 `/api/v1`。
 */
export class AadminClient {
	readonly #baseUrl: string;
	readonly #fetchImpl: typeof fetch;

	constructor(options: AadminClientOptions) {
		this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.#fetchImpl =
			options.fetchImpl ??
			((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
	}

	/** 读。可重试的失败会重试一次。 */
	async get<T>(path: string, token: string, query?: QueryParams): Promise<T> {
		return this.#request<T>({ method: "GET", path, token, query, isRead: true });
	}

	/** 写（新增）。不重试。 */
	async post<T>(path: string, token: string, body: unknown): Promise<T> {
		return this.#request<T>({ method: "POST", path, token, body, isRead: false });
	}

	/** 写（整体修改）。不重试。 */
	async put<T>(path: string, token: string, body: unknown): Promise<T> {
		return this.#request<T>({ method: "PUT", path, token, body, isRead: false });
	}

	/** 写（局部修改，如批量改状态）。不重试。 */
	async patch<T>(path: string, token: string, body: unknown): Promise<T> {
		return this.#request<T>({ method: "PATCH", path, token, body, isRead: false });
	}

	/**
	 * 写（删除）。不重试。
	 *
	 * ⚠️ AiAdmin 的 delete 接口收的是**裸数组** `[1, 2]`
	 * （后端 `ids: Annotated[list[int], Body(...)]`），不是 `{ ids: [...] }`。
	 */
	async delete<T>(path: string, token: string, body?: unknown): Promise<T> {
		return this.#request<T>({ method: "DELETE", path, token, body, isRead: false });
	}

	async #request<T>(spec: RequestSpec): Promise<T> {
		const url = this.#buildUrl(spec.path, spec.query);
		const headers: Record<string, string> = {
			Accept: "application/json",
			// token 由调用方按次传入 —— 客户端不持有任何长期凭据
			Authorization: `Bearer ${spec.token}`,
		};
		let payload: string | undefined;
		if (spec.body !== undefined) {
			headers["Content-Type"] = "application/json";
			payload = JSON.stringify(spec.body);
		}

		// 读操作最多试两次（重试一次）；写操作只试一次 ——
		// 写请求可能已经在后端生效了，重放就变成「建了两条任务」。
		const maxAttempts = spec.isRead ? 2 : 1;

		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			try {
				const response = await this.#fetchImpl(url, { method: spec.method, headers, body: payload });
				return await this.#readEnvelope<T>(response, spec);
			} catch (err) {
				const error = redactError(
					err instanceof AdapterErrorException ? err : networkError(err, spec),
					spec.token,
				);
				const canRetry = attempt < maxAttempts && isRetryable(error);
				if (!canRetry) {
					throw error;
				}
			}
		}

		// 循环里必然抛出（最后一次尝试一定不重试）；这里只是为了满足类型检查。
		throw new AdapterErrorException("UPSTREAM", `请求 ${spec.method} ${spec.path} 失败`);
	}

	/** 读响应信封 `{code, msg, data}`：`code` 为 0 / 200 时把 `data` 交出去。 */
	async #readEnvelope<T>(response: Response, spec: RequestSpec): Promise<T> {
		const text = await response.text();
		let body: unknown;
		if (text.length > 0) {
			try {
				body = JSON.parse(text);
			} catch {
				// 不是 JSON（多半是网关返回的 HTML 错误页）—— 当作「没有信封」处理
				body = undefined;
			}
		}

		const envelope = readEnvelope(body);
		if (response.status === 204) {
			// 204 本来就没有响应体（后端目前的删除接口仍返回 200 + 信封，这里只是不留后患）
			return undefined as T;
		}
		if (response.ok && envelope.code !== undefined && isSuccessCode(envelope.code)) {
			// T 的形状由调用方（适配层）按后端 schema 声明；客户端只管传输，不校验字段
			return envelope.data as T;
		}
		throw classify(response, envelope, spec);
	}

	/** 拼 URL：base + path + 查询串（`undefined` 的参数跳过）。 */
	#buildUrl(path: string, query?: QueryParams): string {
		const suffix = path.startsWith("/") ? path : `/${path}`;
		const search = new URLSearchParams();
		if (query !== undefined) {
			for (const [key, value] of Object.entries(query)) {
				if (value === undefined) {
					continue;
				}
				search.append(key, String(value));
			}
		}
		const queryString = search.toString();
		return queryString.length > 0
			? `${this.#baseUrl}${suffix}?${queryString}`
			: `${this.#baseUrl}${suffix}`;
	}
}

/* -------------------------------------------------------------- 信封读取 */

interface EnvelopeFacts {
	/** 信封里的业务码；不是信封就没有。 */
	code: number | undefined;
	/** 信封里的 msg。 */
	msg: string | undefined;
	/** 信封里的 data。 */
	data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从响应体里读出 `{code, msg, data}`；不是信封就三项全空。 */
function readEnvelope(body: unknown): EnvelopeFacts {
	if (!isRecord(body)) {
		return { code: undefined, msg: undefined, data: undefined };
	}
	const code = body["code"];
	const msg = body["msg"];
	return {
		code: typeof code === "number" ? code : undefined,
		msg: typeof msg === "string" ? msg : undefined,
		data: body["data"],
	};
}

/** 业务码是不是成功码（0 / 200）—— 复用 `src/types/api.ts` 里的同一套判定。 */
function isSuccessCode(code: number): boolean {
	return isSuccess({ code });
}

/* -------------------------------------------------------------- 错误归一 */

interface ResponseFacts {
	httpStatus: number;
	code: number | undefined;
	msg: string | undefined;
	data: unknown;
	retryAfterMs: number | undefined;
}

/** 错误消息里的定位信息：方法 · 路径 · HTTP 状态 · 业务码。 */
function describeFacts(facts: ResponseFacts, spec: RequestSpec): string {
	const parts = [`${spec.method} ${spec.path}`, `HTTP ${facts.httpStatus}`];
	if (facts.code !== undefined) {
		parts.push(`业务码 ${facts.code}`);
	}
	return parts.join(" · ");
}

/**
 * 把一次失败的响应归一成 `AdapterErrorException`。
 *
 * 判定顺序（先看 HTTP 状态，再看业务码）：
 * 1. 凭证失效：HTTP 401/403，或业务码 401 / 10401
 *    （后端「认证已失效」用的就是 10401，见 `backend/app/core/dependencies.py`）
 * 2. HTTP 状态定性：404 → NOT_FOUND、409 → CONFLICT、429 → RATE_LIMIT、
 *    400/422 → VALIDATION
 * 3. 业务码不是成功码 → 业务码归类（`code=-1` 与 4000+ 归 VALIDATION；
 *    400~600 的业务码按 HTTP 语义归一，偏差说明见 `classifyByCode`）
 * 4. 5xx → UPSTREAM（读可重试 / 写不可重试）；其余 4xx → VALIDATION
 * 5. 2xx 但不是合法信封 → UPSTREAM（读可重试 / 写不可重试）
 */
function classify(
	response: Response,
	envelope: EnvelopeFacts,
	spec: RequestSpec,
): AdapterErrorException {
	const facts: ResponseFacts = {
		httpStatus: response.status,
		code: envelope.code,
		msg: envelope.msg,
		data: envelope.data,
		retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
	};
	const where = describeFacts(facts, spec);
	const detail = facts.msg === undefined ? "" : `：${facts.msg}`;

	if (facts.httpStatus === 401 || facts.httpStatus === 403 || facts.code === 401 || facts.code === 10401) {
		return new AdapterErrorException("AUTH_EXPIRED", `AiAdmin 凭证已失效（${where}）${detail}`);
	}

	if (facts.httpStatus === 404) {
		return new AdapterErrorException("NOT_FOUND", `AiAdmin 里找不到该资源（${where}）${detail}`);
	}

	if (facts.httpStatus === 409) {
		return new AdapterErrorException("CONFLICT", `AiAdmin 里该资源与现有数据冲突（${where}）${detail}`);
	}

	if (facts.httpStatus === 429) {
		return new AdapterErrorException("RATE_LIMIT", `AiAdmin 触发了限流（${where}）${detail}`, {
			retryAfterMs: facts.retryAfterMs,
		});
	}

	if (facts.httpStatus === 400 || facts.httpStatus === 422) {
		return validationError(where, detail, facts.data);
	}

	if (facts.code !== undefined && !isSuccessCode(facts.code)) {
		// 后端把「项目编码已存在」这类确定性业务错误用 CustomException 抛出：
		// 默认 status_code=500 + code=-1（RET.EXCEPTION，见 backend/app/common/constant.py）。
		// 这类错误重试没有意义 —— 归成 VALIDATION，而不是「上游抖动」。
		if (facts.code === BUSINESS_EXCEPTION_CODE) {
			return validationError(where, detail, facts.data);
		}
		// 5xx 上的其它业务码（如后端未捕获异常的 code=1）按上游抖动处理
		if (facts.httpStatus >= 500) {
			return upstreamError(`AiAdmin 服务异常（${where}）${detail}`, spec);
		}
		// 业务码本身落在 HTTP 语义区间（400~600）时，按 HTTP 语义解释
		// （与派单表的偏差见 `classifyByCode` 的注释）
		if (facts.code >= 400 && facts.code <= 600) {
			return classifyByCode(facts.code, facts, where, detail, spec);
		}
		// 其余自定义业务码（4000+）
		return validationError(where, detail, facts.data);
	}

	if (facts.httpStatus >= 500) {
		return upstreamError(`AiAdmin 服务异常（${where}）${detail}`, spec);
	}

	if (facts.httpStatus >= 400) {
		return validationError(where, detail, facts.data);
	}

	return upstreamError(`AiAdmin 响应不是合法的业务信封（${where}）`, spec);
}

/**
 * UPSTREAM 错误：**读**的上游故障可以重试，**写**的一律不可重试。
 *
 * 写请求可能已经在后端生效了（后端提交了、响应没回来），
 * 这时候重放就变成「建了两条任务」—— 所以写路径必须标成不可重试，
 * 由调用方（适配层）自己决定要不要人工重试。
 */
function upstreamError(message: string, spec: RequestSpec): AdapterErrorException {
	return new AdapterErrorException("UPSTREAM", message, { retryable: spec.isRead });
}

/**
 * 业务码落在 HTTP 语义区间（400~600）时，按 HTTP 状态那样归一。
 *
 * ⚠️ **与派单表的已声明偏差**：派单表写的是「业务码非 0 → VALIDATION」，
 * 但本实现对 400~600 的业务码按 HTTP 语义归一：
 * - 409 → CONFLICT（而不是 VALIDATION）—— 冲突不是「参数没校验过」，
 *   把它归成 VALIDATION 会让上层提示用户「改改参数」，而实际该提示「换个名字」；
 * - 404 → NOT_FOUND、429 → RATE_LIMIT、401/403 → AUTH_EXPIRED；
 * - 500+ → UPSTREAM（读可重试 / 写不可重试）。
 *
 * 理由：后端 `RET` 枚举里 400~600 本就是 HTTP 标准错误码
 * （`backend/app/common/constant.py`），按 HTTP 语义解释才能把
 * 「重复键」「找不到」这类确定性错误讲清楚。4000+ 的自定义业务码
 * 与后端 `CustomException` 的 `code=-1` 仍归 VALIDATION。
 */
function classifyByCode(
	code: number,
	facts: ResponseFacts,
	where: string,
	detail: string,
	spec: RequestSpec,
): AdapterErrorException {
	if (code === 401 || code === 403) {
		return new AdapterErrorException("AUTH_EXPIRED", `AiAdmin 凭证已失效（${where}）${detail}`);
	}
	if (code === 404) {
		return new AdapterErrorException("NOT_FOUND", `AiAdmin 里找不到该资源（${where}）${detail}`);
	}
	if (code === 409) {
		return new AdapterErrorException("CONFLICT", `AiAdmin 里该资源与现有数据冲突（${where}）${detail}`);
	}
	if (code === 429) {
		return new AdapterErrorException("RATE_LIMIT", `AiAdmin 触发了限流（${where}）${detail}`, {
			retryAfterMs: facts.retryAfterMs,
		});
	}
	if (code >= 500) {
		return upstreamError(`AiAdmin 服务异常（${where}）${detail}`, spec);
	}
	return validationError(where, detail, facts.data);
}

/** 校验类错误：把 `data` 里的字段级说明带出来（形状不匹配就不带）。 */
function validationError(where: string, detail: string, data: unknown): AdapterErrorException {
	const fields = extractFields(data);
	return new AdapterErrorException(
		"VALIDATION",
		`AiAdmin 拒绝了这次请求（${where}）${detail}`,
		fields === undefined ? {} : { fields },
	);
}

/** 从 `body.data` 里提取「字段名 → 错误说明」；形状不匹配就返回 undefined。 */
function extractFields(data: unknown): Record<string, string> | undefined {
	if (!isRecord(data)) {
		return undefined;
	}
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(data)) {
		const text = fieldMessage(value);
		if (text !== undefined) {
			fields[key] = text;
		}
	}
	return Object.keys(fields).length > 0 ? fields : undefined;
}

/** 字段值 → 一行说明；不是「短文本」就放弃（宁可不给，也不给半截数据）。 */
function fieldMessage(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		return value.join("；");
	}
	return undefined;
}

/** 网络层故障（fetch 抛错）。读操作可重试，写操作不可重试。 */
function networkError(err: unknown, spec: RequestSpec): AdapterErrorException {
	const detail = err instanceof Error ? err.message : String(err);
	// 网络层故障对读操作可以重试；写操作可能已经在后端生效了，不能重放
	return upstreamError(`请求 ${spec.method} ${spec.path} 失败（网络层）：${detail}`, spec);
}

/** `Retry-After` 头 → 建议等待的毫秒数（秒数或 HTTP 日期都能认）。 */
function parseRetryAfterMs(header: string | null): number | undefined {
	if (header === null) {
		return undefined;
	}
	const value = header.trim();
	if (value.length === 0) {
		return undefined;
	}
	if (/^\d+$/.test(value)) {
		return Number(value) * 1000;
	}
	const at = Date.parse(value);
	if (Number.isNaN(at)) {
		return undefined;
	}
	return Math.max(0, at - Date.now());
}

/* -------------------------------------------------------------- token 脱敏 */

/** 把文本里可能出现的 token 抹掉 —— 客户端产出的任何字符串都不许带 token。 */
function redact(text: string, token: string): string {
	if (token.length === 0) {
		return text;
	}
	const masked = "***";
	let out = text.split(token).join(masked);
	const encoded = encodeURIComponent(token);
	if (encoded !== token) {
		out = out.split(encoded).join(masked);
	}
	return out;
}

/** 统一出口：抛出去之前把消息、字段说明与堆栈里的 token 抹掉。 */
function redactError(error: AdapterErrorException, token: string): AdapterErrorException {
	const fields =
		error.fields === undefined
			? undefined
			: Object.fromEntries(
					Object.entries(error.fields).map(([key, value]) => [key, redact(value, token)]),
				);
	const masked = new AdapterErrorException(error.kind, redact(error.message, token), {
		fields,
		retryAfterMs: error.retryAfterMs,
		capability: error.capability,
		retryable: error.retryable,
	});
	// 保留原来的堆栈（堆栈首行含消息，所以要一起脱敏）
	if (error.stack !== undefined) {
		masked.stack = redact(error.stack, token);
	}
	return masked;
}

export { isRetryable };
