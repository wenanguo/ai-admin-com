/**
 * 「官方账户**没余额**」的判定（issue #124 阶段三 · D3 收尾）。
 *
 * ## 为什么要有它
 *
 * D3 验收**真打官方 DeepSeek** ⇒ 官方账户**没余额**时，官方回
 * **HTTP 402 `insufficient_balance`** ⇒ **那不是我们的 bug**
 * ⇒ 不该把验收判成红（也不该让人以为「改坏了」）。
 * ⇒ 判定成「没余额」就**跳过（exit 0）**；**其他错误照旧失败**。
 *
 * ⚠️ **为什么要单独一个模块**：判定口径要**可测**（不联网也能测）
 *    ⇒ 探针 + 判定 + 单测都在这里 ⇒ D3 脚本只管「跳过还是失败」。
 *
 * ## 认哪两种形态
 *
 * - **HTTP 402**（Payment Required）—— 官方在**生成之前**就拒了；
 * - 正文里带 **`insufficient_balance`** / **`insufficient balance`**
 *   —— DeepSeek 的 `error.code` 与 MiniMax 的错误文案。
 *
 * ⚠️ **别的形态一律不认**（401 key 失效 / 429 限流 / 500 服务端故障 …）
 *    ⇒ 那些是**真问题**，必须让验收红。
 */

/** 「官方路由还能不能花钱」的判定结果。 */
export type BalanceVerdict =
	/** **没余额**（402 / insufficient_balance）⇒ 该跳过。 */
	| "no-balance"
	/** 官方路由正常应答（200）⇒ 继续跑验收。 */
	| "ok"
	/** **看不出来**（网络不通 / 超时 / 别的状态码）⇒ **不许跳过后面的失败**。 */
	| "unknown";

/** 官方「Payment Required」的状态码（余额不足）。 */
export const NO_BALANCE_STATUS = 402;

/** 「余额不足」的两种写法（错误码 / 错误文案）。 */
const NO_BALANCE_TEXT = /insufficient[_ ]?balance/i;

/**
 * 一段文本（错误信息 / 响应正文）是不是在说「账户没余额」。
 *
 * @param text 待判定的文本。
 * @returns 是 ⇒ true。
 */
export function looksLikeNoBalance(text: string): boolean {
	return NO_BALANCE_TEXT.test(text);
}

/** 探针要什么。 */
export interface ProbeOptions {
	/** OpenAI 兼容的根地址（到 `/v1` 为止）。 */
	baseUrl: string;
	/** 鉴权用的 key（**不打印**）。 */
	apiKey: string;
	/** 模型 id（跟正式跑的那次一样 ⇒ 探到的就是真会遇到的账）。 */
	model: string;
	/** 超时（毫秒；缺省 15s）。 */
	timeoutMs?: number;
}

/**
 * 探针：**先问官方路由「这个 key 还能不能花钱」**。
 *
 * ## 它做什么
 *
 * 发一次**最小**的 chat-completions 请求（`max_tokens: 1` ⇒ 几乎不花钱）⇒
 * 看官方怎么答：
 *
 * - **402 / insufficient_balance** ⇒ **没余额** ⇒ 调用方该**跳过**（exit 0）；
 * - **2xx** ⇒ 官方路由正常 ⇒ 继续跑验收；
 * - **别的状态码 / 网络不通 / 超时** ⇒ **看不出来** ⇒
 *   ⚠️ **不许跳过**（那会把真错误藏起来 ⇒ 让后面的验收自己红）。
 *
 * @param options 探针参数。
 * @returns 判定结果。
 */
export async function probeOfficialRoute(options: ProbeOptions): Promise<BalanceVerdict> {
	const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${options.apiKey}`,
			},
			body: JSON.stringify({
				model: options.model,
				messages: [{ role: "user", content: "ping" }],
				max_tokens: 1,
				// ⚠️ **不流式**：探针只关心「官方答了什么」⇒ 一次读完整正文最省事。
				stream: false,
			}),
			signal: controller.signal,
		});
		const text = await response.text().catch(() => "");
		if (response.status === NO_BALANCE_STATUS) {
			return "no-balance";
		}
		if (looksLikeNoBalance(text)) {
			return "no-balance";
		}
		return response.ok ? "ok" : "unknown";
	} catch {
		// ⚠️ 探针自己跑不起来（网络不通 / 超时 / DNS 失败）⇒ **看不出来**
		//    ⇒ **不许跳过**（让真错误暴露）。
		return "unknown";
	} finally {
		clearTimeout(timer);
	}
}
