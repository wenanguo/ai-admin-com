/**
 * 上下文锚点 —— **内核的通用机制**（不含任何业务字段）。
 *
 * ## 为什么要有它
 *
 * 用户在列表/看板里点「与 AI 讨论」⇒ AI 必须先知道**当前讨论的是哪条东西**，
 * 否则它只能靠猜（或者反问用户）。
 * ⇒ 这个上下文由**前端**发过来（前端手上就有那行数据），本服务不自己查。
 *
 * ## core 不认识「任务 / 项目」
 *
 * 那些是**业务**概念 ⇒ 归插件（`plugins/pm/**`）。
 * ⇒ core 只认三样：
 *
 * - **作用域**（`scope`）：插件自己定义 type 与 id 的形状；
 * - **锚点上的键值**（`values`）：插件放什么，core **不解释**；
 * - **可写字段白名单**（`writableFields`）：**由插件注入** ⇒ core 不写死任何字段名。
 *
 * ## core 负责的**唯一**一件事
 *
 * **按白名单收窄写操作**（提交时把不在白名单里的字段剔掉）⇒
 * 「限定回填字段」是**代码保证**的，不靠提示词。
 *
 * ## 写规则（`WriteToolRule`）也是插件给的
 *
 * core 不写死「哪个工具、哪些必填字段、哪个工具在这个 scope 里不许用」⇒
 * 那些都是**业务**知识 ⇒ 由插件用 `WriteToolRule` 描述，core 只负责**按数据算**。
 */

/** 作用域（通用）：插件自己定义 type 与 id 的形状。 */
export interface ContextScope {
	/** 作用域类型（**插件自己定义**；core 不解释）。 */
	type: string;
	/** 作用域 id（插件自己解释成什么类型 ⇒ 这里统一用字符串）。 */
	id: string;
}

/** 上下文锚点 —— core 只认这个形状，不解释里面的内容。 */
export interface ContextAnchor {
	/** 作用域。 */
	scope: ContextScope;
	/**
	 * **基线**（整对象 PUT 的底稿）：这个 scope 要改的那条记录。
	 *
	 * ⚠️ 没有基线的 scope（例如「整个项目」）⇒ 没有它 ⇒
	 *    收窄时**不传**没填的字段（后端 `exclude_unset` ⇒ 原值保持不变）。
	 */
	baseline?: Record<string, unknown>;
	/** 锚点上的键值（通用）：插件放什么，core 不解释（渲染时插件自己读）。 */
	values: Record<string, unknown>;
	/** **可写字段白名单**（插件注入 ⇒ core 不写死任何字段名）。 */
	writableFields: readonly string[];
}

/**
 * 一个工具的**写规则**（**插件注入**；core 不写死任何字段名/工具名）。
 *
 * 两种形状：
 *
 * | 形状 | 怎么造最终载荷 |
 * | ---- | -------------- |
 * | **整对象 PUT**（`wholeObject: true`） | 基线 + 白名单字段（没有基线时 = 模型给的必填字段 + 白名单字段） |
 * | **自己拼**（不写 `wholeObject`） | 锚点给的字段 + 从模型收下的字段（其余**都算「被改」**） |
 */
export interface WriteToolRule {
	/** 裸工具名（不带 `mcp__<server>__` 前缀）。 */
	tool: string;
	/** 「整对象 PUT」型（见上表）。 */
	wholeObject?: boolean;
	/** 基线（整对象 PUT 的底稿）；没有 ⇒ 这个 scope 没有底稿。 */
	baseline?: (anchor: ContextAnchor) => Record<string, unknown> | undefined;
	/** 必填字段（整对象 PUT 缺一个就 422 ⇒ 缺了就**报错**，不放一个会 422 的 PUT 出去）。 */
	requiredFields?: readonly string[];
	/** 「由锚点决定」的字段：模型给的会被**丢掉**（且**不算「被改」**）。 */
	anchorFields?: readonly string[];
	/** 由锚点决定的字段的**值**（怎么从锚点算）。 */
	anchorValues?: (anchor: ContextAnchor) => Record<string, unknown>;
	/** 「从模型收下」的字段（白名单之外的额外允许项；**自己拼**型用）。 */
	fromModel?: readonly string[];
	/**
	 * 「这个工具在这个 scope 里不许用」⇒ 拦住并说明（**插件给文案** ⇒ core 不写业务词）。
	 *
	 * ⚠️ 有锚点（= 用户在讨论某条东西）时才拦 ⇒ 别的场景照旧。
	 */
	blocked?: { reason: string };
	/** 这次写操作动的是哪条实体（前端据此刷新 + 高亮）；没有 ⇒ undefined。 */
	targetId?: (anchor: ContextAnchor) => number | undefined;
	/** 缺必填字段时的报错文案（插件给 ⇒ core 不写业务词）。 */
	missingFieldMessage?: (field: string) => string;
}

/** 上下文提供器（**插件注入**；core 只认这个形状）。 */
export interface ContextProvider {
	/** 解析前端发来的上下文 ⇒ 锚点（不合法 ⇒ `null`，**不是抛错**）。 */
	parse(input: unknown): ContextAnchor | null;
	/** 渲染成给模型看的段落（**插件的语义**）。 */
	render(anchor: ContextAnchor): string;
	/** 写操作的规则（哪些工具、必填字段、白名单……）。 */
	writeRules: readonly WriteToolRule[];
}

/** 一次「写」的结果：最终载荷 + 被丢掉的字段。 */
export interface NarrowedWrite {
	/** 最终要发出去的参数。 */
	args: Record<string, unknown>;
	/** 被丢掉的字段名（模型给了但不在允许范围里）。 */
	stripped: string[];
}

/** 剥掉工具名上的 `mcp__<server>__` 前缀。 */
function bareToolName(toolName: string): string {
	return toolName.replace(/^mcp__[^_]+__/, "");
}

/**
 * 把 `null` / `undefined` 的键**整个去掉**。
 *
 * ## 为什么必须删
 *
 * 后端 MCP 的入参 schema 是 fastapi-mcp 从 OpenAPI 生成的 ⇒ 可空字段会变成
 * 「`anyOf: [类型, null]` **外加**一个顶层 `type: 类型`」。
 * ⇒ 用 jsonschema 校验时，顶层那个 `type` 说了算 ⇒ **传 null 会直接被拒**：
 *
 * ```
 * Input validation error: None is not of type 'string'
 * ```
 *
 * ⇒ 基线里的空值（没填的描述、没填的工时……）**必须整个键去掉**，不能传 null。
 *
 * ## 去掉会不会把原来的值抹掉
 *
 * 不会：后端更新走 `model_dump(exclude_unset=True)` ⇒ **没传的字段根本不进 update**
 * ⇒ 原值保持不变（这正是我们要的：没填的字段别动）。
 */
export function stripNullishArgs(
	args: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		if (value !== null && value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * 把模型给的写参数**收窄**成允许改的那几个字段（**通用算法**）。
 *
 * ## 为什么在闸门里做（而不是提示词里交代）
 *
 * 提示词是「请求」，这里是「保证」：模型再怎么说「顺手把负责人也改了」，
 * 这一层也会把它丢掉 ⇒ 「限定回填字段」是**代码保证**的。
 *
 * ## 收窄规则（core 只按数据算 ⇒ 字段名/工具名都由插件给）
 *
 * - **整对象 PUT**：**基线（锚点里的那条记录）+ 模型给的白名单字段**。
 *   没有基线时 ⇒ 只留「必填字段 + 白名单字段」，其余**不传**
 *   （后端 `exclude_unset=True` ⇒ 原值保持不变）。
 * - **自己拼**：锚点给的字段 + 从模型收下的字段；其余**都算「被改」**。
 *
 * @param toolName 工具名（可能带 `mcp__<server>__` 前缀）
 * @param args 模型给的参数
 * @param anchor 当前锚点（**没有就原样放行** —— 那不是「讨论某条东西」的场景）
 * @param rules 写规则（插件给的）
 */
export function narrowWriteArgs(
	toolName: string,
	args: Record<string, unknown>,
	anchor: ContextAnchor | null,
	rules: readonly WriteToolRule[],
): NarrowedWrite {
	const bare = bareToolName(toolName);
	const rule = rules.find((item) => item.tool === bare);
	// ⚠️ 没有锚点 / 不是「写操作」的工具 ⇒ **原样放行**
	if (anchor === null || rule === undefined) {
		return { args, stripped: [] };
	}

	const stripped: string[] = [];

	// ── 「自己拼」型：锚点给的字段 + 从模型收下的字段 ──
	if (rule.wholeObject !== true) {
		const final: Record<string, unknown> = { ...(rule.anchorValues?.(anchor) ?? {}) };
		const fromModel = rule.fromModel ?? [];
		for (const key of fromModel) {
			final[key] = args[key];
		}
		for (const key of Object.keys(args)) {
			if (fromModel.includes(key)) {
				continue;
			}
			// ⚠️ 锚点给的字段（模型给的那份是错的）**也算「被改」**
			//    ⇒ 预览里看得见「模型想改的是哪条」。
			stripped.push(key);
		}
		return { args: final, stripped };
	}

	// ── 「整对象 PUT」型：基线 + 白名单字段 ──
	const baseline = rule.baseline?.(anchor);
	const merged: Record<string, unknown> = baseline === undefined ? {} : { ...baseline };
	for (const key of Object.keys(args)) {
		if (rule.anchorFields?.includes(key) === true) {
			// ⚠️ 由锚点决定 ⇒ 模型给的直接丢掉（且**不算「被改」**）
			continue;
		}
		if (anchor.writableFields.includes(key)) {
			merged[key] = args[key];
			continue;
		}
		if (baseline === undefined && rule.requiredFields?.includes(key) === true) {
			// ⚠️ 没有基线 ⇒ **必填字段**得用模型给的那份（那里没有底稿）
			//    （整对象 PUT 缺一个就 422）。
			merged[key] = args[key];
			continue;
		}
		// 其余字段：有基线 ⇒ **保持基线原值**（模型想改的也丢掉）；
		// 没有基线 ⇒ **不传** ⇒ 后端保持原值。
		stripped.push(key);
	}
	// ⚠️ 锚点给的字段**最后**放（⇒ 覆盖基线里的同名键）
	Object.assign(merged, rule.anchorValues?.(anchor) ?? {});
	// ⚠️ **空值要整个键去掉**（MCP 的入参校验不吃 null）
	//    ⇒ 基线里没填的字段就不传 ⇒ 后端 `exclude_unset=True` ⇒ 原值保持不变。
	const finalArgs = stripNullishArgs(merged);
	// ⚠️ 必填字段一个都不能少（少一个就 422）⇒ 缺了就**明确报错**
	//    （别把一个必填的 PUT 放出去）。
	for (const field of rule.requiredFields ?? []) {
		if (finalArgs[field] === undefined) {
			throw new Error(
				rule.missingFieldMessage?.(field) ?? `缺少必填字段 ${field}`,
			);
		}
	}
	return { args: finalArgs, stripped };
}

/**
 * 这个工具在这个锚点下**要不要拦住**（插件说「不许用」时就拦）。
 *
 * @returns 拦 ⇒ 给出人话原因；不拦 ⇒ undefined
 */
export function blockedWriteReason(
	toolName: string,
	anchor: ContextAnchor | null,
	rules: readonly WriteToolRule[],
): string | undefined {
	if (anchor === null) {
		return undefined;
	}
	const bare = bareToolName(toolName);
	const rule = rules.find((item) => item.tool === bare);
	return rule?.blocked?.reason;
}

/**
 * 这次写操作动的是哪条实体（前端据此刷新 + 高亮）。
 *
 * @returns 没有锚点、不是写操作、或这个写操作没有目标 ⇒ undefined
 */
export function writeTargetId(
	toolName: string,
	anchor: ContextAnchor | null,
	rules: readonly WriteToolRule[],
): number | undefined {
	if (anchor === null) {
		return undefined;
	}
	const bare = bareToolName(toolName);
	const rule = rules.find((item) => item.tool === bare);
	return rule?.targetId?.(anchor);
}

/**
 * 这一轮**实际改了哪几个字段**（与基线比出来的）。
 *
 * ⚠️ 不能只看「参数里有哪些可写字段」—— 整对象 PUT 的参数里**每个**可写字段都在
 *    （基线带的）⇒ 那样报出来会显得「全都改了」。
 * ⇒ 与基线逐个比：**值不同**才算改了。
 *
 * @param args 最终载荷（收窄后的）
 * @param baseline 基线（锚点里的那条记录）
 * @param writableFields 可写字段白名单（**插件给** ⇒ core 不写死字段名）
 */
export function changedFields(
	args: Record<string, unknown>,
	baseline: Record<string, unknown>,
	writableFields: readonly string[],
): string[] {
	const fields: string[] = [];
	for (const key of writableFields) {
		if (!(key in args)) {
			continue;
		}
		const before = baseline[key];
		const after = args[key];
		if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
			fields.push(key);
		}
	}
	return fields;
}
