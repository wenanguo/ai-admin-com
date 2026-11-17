/**
 * **契约表** —— 9 个 JSON 端点的行为规格。
 *
 * ## 为什么有这张表
 *
 * HTTP 层要从 Next.js 换到 Express。换框架最怕的是「**行为悄悄变了**」——
 * 路径没变、状态码变了、错误文案变了，前端就会以奇怪的方式坏掉。
 *
 * ⇒ 这张表是**唯一的行为出处**：
 * 1. 先对着**现在的 Next 实现**跑一遍（`src/app/api/contract.test.ts`）⇒ 把现状钉死；
 * 2. 再让**新的 Express 实现**跑同一张表（`src/routes/contract.test.ts`）⇒ 两边必须一致。
 *
 * ## 表里有什么
 *
 * 每个用例说清：怎么打这个端点、期望什么 HTTP 状态码、期望信封长什么样。
 * 只写**外部能看见**的东西（状态码 / 信封 / 文案 / data 形状），
 * 不写内部实现 ⇒ 实现怎么改都不算违约。
 *
 * ⚠️ **文案一字不动**：前端把 `msg` 直接显示给用户，改字就是改产品。
 */

/** 缺 token 时的统一说法（10 个端点共用）。 */
export const MISSING_TOKEN_MESSAGE =
	"缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** 一个契约用例。 */
export interface ContractCase {
	/** 用例名（测试失败时靠它定位）。 */
	name: string;
	/** HTTP 方法。 */
	method: "GET" | "POST" | "OPTIONS";
	/** 路径（相对服务根，含 `/api` 前缀）。 */
	path: string;
	/** 额外的请求头；缺省带 `Authorization: Bearer test-token`。 */
	headers?: Record<string, string>;
	/** 请求体：对象 ⇒ JSON 序列化；字符串 ⇒ 原样当 body（用来测「不是合法 JSON」）。 */
	body?: unknown;
	/** 期望的 HTTP 状态码。 */
	status: number;
	/** 期望的信封业务码（成功 0；预检没有 body ⇒ 省略）。 */
	code?: number;
	/** 期望的 `msg`（精确匹配；省略则不检查）。 */
	msg?: string;
	/** 对 `data` 的额外断言（省略则只检查它存在）。 */
	checkData?: (data: unknown) => void;
}

/** 约定的「坏 token」：mock 见到它就抛 AUTH_EXPIRED。 */
export const BAD_TOKEN = "bad-token";
/** 约定的「不存在的会话」：mock 见到它就抛 NOT_FOUND。 */
export const MISSING_CONVERSATION = "missing-conv";
/** 约定的「已处理过的待确认」：mock 见到它就返回「没处理成功」。 */
export const ALREADY_HANDLED = "already-handled";

/** 一条「缺 token」的用例。 */
function missingToken(name: string, method: "GET" | "POST", path: string): ContractCase {
	return {
		name: `${name}：缺 token ⇒ 401`,
		method,
		path,
		headers: { authorization: "" },
		status: 401,
		code: 401,
		msg: MISSING_TOKEN_MESSAGE,
	};
}

/** 契约表本体。 */
export const JSON_CONTRACT: ContractCase[] = [
	// ── 预检 ──────────────────────────────────────────────────────────────
	{
		name: "预检：回 204 + 具体源",
		method: "OPTIONS",
		path: "/api/pending",
		headers: { origin: "http://localhost:8000" },
		status: 204,
	},

	// ── 缺 token（10 个端点） ─────────────────────────────────────────────
	missingToken("会话列表", "GET", "/api/agent/conversations"),
	missingToken("新建会话", "POST", "/api/agent/conversations"),
	missingToken("发命令", "POST", "/api/agent/conv-1/command"),
	missingToken("读快照", "GET", "/api/agent/conv-1/state"),
	missingToken("中止", "POST", "/api/agent/conv-1/abort"),
	missingToken("待确认列表", "GET", "/api/pending"),
	missingToken("批准", "POST", "/api/agent/pending/p-1/approve"),
	missingToken("拒绝", "POST", "/api/agent/pending/p-1/reject"),
	missingToken("审计列表", "GET", "/api/audit"),

	// ── 命令：请求体校验（顺序与文案都不能变） ───────────────────────────
	{
		name: "命令：body 不是合法 JSON ⇒ 400",
		method: "POST",
		path: "/api/agent/conv-1/command",
		body: "{不是 json",
		status: 400,
		code: 400,
		msg: "请求体不是合法的 JSON",
	},
	{
		name: "命令：body 是数组 ⇒ 400（现状：数组也是 object ⇒ 落到 id 校验）",
		method: "POST",
		path: "/api/agent/conv-1/command",
		body: [1, 2],
		status: 400,
		code: 400,
		msg: "命令 id 不能为空",
	},
	{
		name: "命令：缺 id ⇒ 400",
		method: "POST",
		path: "/api/agent/conv-1/command",
		body: { type: "prompt", message: "你好" },
		status: 400,
		code: 400,
		msg: "命令 id 不能为空",
	},
	{
		name: "命令：缺 type ⇒ 400",
		method: "POST",
		path: "/api/agent/conv-1/command",
		body: { id: "cmd-1", message: "你好" },
		status: 400,
		code: 400,
		msg: "命令类型不能为空",
	},
	{
		name: "命令：type 不支持 ⇒ 400",
		method: "POST",
		path: "/api/agent/conv-1/command",
		body: { id: "cmd-1", type: "nope", message: "你好" },
		status: 400,
		code: 400,
		msg: "暂不支持的命令类型「nope」（支持：prompt / prompt-followup / prompt-steer）",
	},
	{
		name: "命令：message 为空 ⇒ 400",
		method: "POST",
		path: "/api/agent/conv-1/command",
		body: { id: "cmd-1", type: "prompt", message: "   " },
		status: 400,
		code: 400,
		msg: "消息不能为空",
	},

	// ── 命令：正常路径 ────────────────────────────────────────────────────
	{
		name: "命令：合法 ⇒ 200 且回执 id/type/success",
		method: "POST",
		path: "/api/agent/conv-1/command",
		body: { id: "cmd-1", type: "prompt", message: "你好" },
		status: 200,
		code: 0,
		checkData: (data) => {
			const record = data as Record<string, unknown>;
			if (record["id"] !== "cmd-1") {
				throw new Error(`回执 id 不对：${JSON.stringify(data)}`);
			}
			if (record["type"] !== "response") {
				throw new Error(`回执 type 不对：${JSON.stringify(data)}`);
			}
			if (record["success"] !== true) {
				throw new Error(`回执 success 不对：${JSON.stringify(data)}`);
			}
		},
	},

	// ── 会话 ──────────────────────────────────────────────────────────────
	{
		name: "会话列表：200 且回数组",
		method: "GET",
		path: "/api/agent/conversations",
		status: 200,
		code: 0,
		checkData: (data) => {
			if (!Array.isArray(data)) {
				throw new Error(`data 不是数组：${JSON.stringify(data)}`);
			}
			const first = data[0] as Record<string, unknown>;
			for (const key of ["conversationId", "title", "updatedAt"]) {
				if (!(key in first)) {
					throw new Error(`会话项缺字段 ${key}：${JSON.stringify(data)}`);
				}
			}
			if (typeof first["updatedAt"] !== "string") {
				throw new Error(`updatedAt 必须是字符串：${JSON.stringify(data)}`);
			}
		},
	},
	{
		name: "新建会话：200 且回 conversationId/title/createdAt",
		method: "POST",
		path: "/api/agent/conversations",
		body: { title: "  我的会话  " },
		status: 200,
		code: 0,
		checkData: (data) => {
			const record = data as Record<string, unknown>;
			if (record["conversationId"] !== "conv-new") {
				throw new Error(`conversationId 不对：${JSON.stringify(data)}`);
			}
			if (record["title"] !== "我的会话") {
				throw new Error(`title 没有 trim：${JSON.stringify(data)}`);
			}
			if (typeof record["createdAt"] !== "string") {
				throw new Error(`createdAt 必须是字符串：${JSON.stringify(data)}`);
			}
		},
	},

	// ── 快照 ──────────────────────────────────────────────────────────────
	{
		name: "快照：200 且 messages 的 createdAt 是字符串",
		method: "GET",
		path: "/api/agent/conv-1/state",
		status: 200,
		code: 0,
		checkData: (data) => {
			const record = data as Record<string, unknown>;
			if (record["conversationId"] !== "conv-1") {
				throw new Error(`conversationId 不对：${JSON.stringify(data)}`);
			}
			if (record["isStreaming"] !== false) {
				throw new Error(`isStreaming 不对：${JSON.stringify(data)}`);
			}
			const messages = record["messages"] as Array<Record<string, unknown>>;
			if (!Array.isArray(messages) || messages.length === 0) {
				throw new Error(`messages 不对：${JSON.stringify(data)}`);
			}
			if (typeof messages[0]?.["createdAt"] !== "string") {
				throw new Error(`createdAt 必须被转成字符串：${JSON.stringify(data)}`);
			}
		},
	},
	{
		name: "快照：会话不存在 ⇒ 404",
		method: "GET",
		path: `/api/agent/${MISSING_CONVERSATION}/state`,
		status: 404,
		code: 404,
	},

	// ── 中止 ──────────────────────────────────────────────────────────────
	{
		name: "中止：200 且 aborted=true",
		method: "POST",
		path: "/api/agent/conv-1/abort",
		status: 200,
		code: 0,
		checkData: (data) => {
			const record = data as Record<string, unknown>;
			if (record["aborted"] !== true || record["conversationId"] !== "conv-1") {
				throw new Error(`中止回执不对：${JSON.stringify(data)}`);
			}
		},
	},

	// ── 待确认 ────────────────────────────────────────────────────────────
	{
		name: "待确认列表：200 且回数组",
		method: "GET",
		path: "/api/pending",
		status: 200,
		code: 0,
		checkData: (data) => {
			if (!Array.isArray(data)) {
				throw new Error(`data 不是数组：${JSON.stringify(data)}`);
			}
		},
	},
	{
		name: "批准：200 且 status=CONFIRMED",
		method: "POST",
		path: "/api/agent/pending/p-1/approve",
		status: 200,
		code: 0,
		checkData: (data) => {
			const record = data as Record<string, unknown>;
			if (record["id"] !== "p-1" || record["status"] !== "CONFIRMED") {
				throw new Error(`批准回执不对：${JSON.stringify(data)}`);
			}
		},
	},
	{
		name: "批准：已处理过 ⇒ 409",
		method: "POST",
		path: `/api/agent/pending/${ALREADY_HANDLED}/approve`,
		status: 409,
		code: 409,
		msg: "这条待确认已经处理过了（或不存在）",
	},
	{
		name: "拒绝：200 且 status=REJECTED",
		method: "POST",
		path: "/api/agent/pending/p-1/reject",
		status: 200,
		code: 0,
		checkData: (data) => {
			const record = data as Record<string, unknown>;
			if (record["id"] !== "p-1" || record["status"] !== "REJECTED") {
				throw new Error(`拒绝回执不对：${JSON.stringify(data)}`);
			}
		},
	},
	{
		name: "拒绝：已处理过 ⇒ 409",
		method: "POST",
		path: `/api/agent/pending/${ALREADY_HANDLED}/reject`,
		status: 409,
		code: 409,
		msg: "这条待确认已经处理过了（或不存在）",
	},

	// ── 审计 ──────────────────────────────────────────────────────────────
	{
		name: "审计列表：200 且回 {total, items}",
		method: "GET",
		path: "/api/audit",
		status: 200,
		code: 0,
		checkData: (data) => {
			const record = data as Record<string, unknown>;
			if (typeof record["total"] !== "number" || !Array.isArray(record["items"])) {
				throw new Error(`审计分页形状不对：${JSON.stringify(data)}`);
			}
		},
	},

	// ── token 无效 ────────────────────────────────────────────────────────
	{
		name: "token 无效 ⇒ 401",
		method: "GET",
		path: "/api/agent/conversations",
		headers: { authorization: `Bearer ${BAD_TOKEN}` },
		status: 401,
		code: 401,
	},
];
