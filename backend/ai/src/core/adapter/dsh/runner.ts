/**
 * dsh runner —— **配置 + 工厂**（双跑的「另一半」）。
 *
 * ## 双跑怎么切
 *
 * `AI_RUNNER=pi`（**缺省**）⇒ 走今天的 pi 会话；`AI_RUNNER=dsh` ⇒ 走 dsh。
 * ⇒ **切回 pi 不用改代码**（issue #120 的验收项）。
 *
 * ## 配置（全走环境变量 ⇒ 凭据不落盘）
 *
 * | 变量 | 缺省 | 干什么 |
 * | ---- | ---- | ------ |
 * | `AI_DSH_PROFILE` | `sdk` | dsh 的具名 profile |
 * | `AI_DSH_HOME` | `<cwd>/.dsh-home` | dsh 的 home（profile / 日志 / 会话） |
 * | `AI_DSH_BIN` | SDK 自带的运行时 | dsh 可执行文件 |
 * | `AI_DSH_PROVIDER` | `deepseek-direct` | **我们自己的** provider 路由名 |
 * | `AI_DSH_MODEL` | `deepseek-chat` | 模型 id |
 * | `AI_DSH_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容的根地址 |
 * | `AI_DSH_API_KEY_ENV` | `DEEPSEEK_API_KEY` | key 放在哪个环境变量里 |
 * | `AI_DSH_CONTEXT_WINDOW` | `131072` | 上下文窗口（token） |
 * | `AI_DSH_MAX_TOKENS` | `8192` | 单次输出上限 |
 * | `AI_DSH_BRIDGE_URL` | 与服务同端口 | 命令桥的地址 |
 *
 * ## ⚠️ 为什么**我们自己的**变量不能叫 `DSH_*`（issue #124 阶段三的**真 bug**）
 *
 * dsh 的 app-boot 里 `BOOTSTRAP_PREFIXES = ['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']`
 * ⇒ **任何 `.env` 文件里写 `DSH_*`，dsh 都会拒绝启动**：
 * `dsh: …/.env sets "DSH_BASE_URL", which only the launching environment may set`。
 * 而 dsh **会读它启动目录的 `.env`**（`backend/ai/.env` 正是那个位置）
 * ⇒ 我们的 `.env.example` 教用户写 `DSH_BASE_URL` ⇒ **照着配就炸**。
 *
 * ⇒ 口径（本文件 + `.env.example` + 插件一起遵守）：
 * ① **用户可配的**变量一律叫 `AI_DSH_*`（不撞 dsh 的保留前缀）；
 * ② **传给 dsh 子进程**的变量（`DSH_HOME` 等 dsh 自己认的名字、插件读的 `AI_DSH_*`）
 *    只出现在**进程环境**里 —— 那里 dsh 是允许的（它禁的是 `.env` **文件**）。
 */

import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DshSession } from "./session.ts";
import type { DshTracer } from "./persistence.ts";
import { buildToolCatalog } from "./tools.ts";
import { ensureDshProfile } from "./profile.ts";
import type { DshGateContext } from "./approvals.ts";
import type { AgentSessionLike } from "../../session/session-registry.ts";
import type { CommandTool } from "../../tools/types.ts";
import { buildDshMcpClientConfigs, type McpServerSpec } from "../../mcp/mcp.ts";

/** ESM 里的 `require.resolve`（用来找 SDK 自带的 dsh 运行时）。 */
const requireFromHere = createRequire(import.meta.url);

/** 我们插件包的目录（**仓里的源码** ⇒ 装进 dsh 的 profile）。 */
const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../dsh-plugin");

/** profile 补丁（把我们的插件插进 profile 的**补丁层**）。 */
const PROFILE_PATCH = join(PLUGIN_DIR, "profile.patch.yml");

/** dsh runner 的配置。 */
export interface DshRunnerConfig {
	/** dsh 的具名 profile。 */
	profile: string;
	/** dsh 的 home。 */
	dshHome: string;
	/** dsh 可执行文件。 */
	dshBin: string;
	/** profile 补丁（把我们的插件插进 profile）。 */
	patches: string[];
	/** provider 路由名（**我们自己的**）。 */
	provider: string;
	/** 模型 id。 */
	model: string;
	/** OpenAI 兼容的根地址。 */
	baseURL: string;
	/** key 放在哪个环境变量里。 */
	apiKeyEnv: string;
	/** 上下文窗口（token）。 */
	contextWindow: number;
	/** 单次输出上限。 */
	maxTokens: number;
	/** 命令桥的地址（**loopback**）。 */
	bridgeUrl: string;
}

/**
 * 读 dsh runner 的配置。
 *
 * @param source 环境变量来源（测试可注入假值）。
 */
export function dshRunnerConfig(source: NodeJS.ProcessEnv = process.env): DshRunnerConfig {
	const port = source.PORT ?? "3100";
	return {
		profile: source.AI_DSH_PROFILE ?? "sdk",
		dshHome: source.AI_DSH_HOME ?? join(process.cwd(), ".dsh-home"),
		// ⚠️ SDK 自带的运行时（与 SDK 同版本）—— 用 `require.resolve` 找它。
		dshBin: source.AI_DSH_BIN ?? resolveDshBin(),
		patches: [PROFILE_PATCH],
		provider: source.AI_DSH_PROVIDER ?? "deepseek-direct",
		model: source.AI_DSH_MODEL ?? "deepseek-chat",
		baseURL: source.AI_DSH_BASE_URL ?? "https://api.deepseek.com/v1",
		apiKeyEnv: source.AI_DSH_API_KEY_ENV ?? "DEEPSEEK_API_KEY",
		contextWindow: numberOf(source.AI_DSH_CONTEXT_WINDOW, 131072),
		maxTokens: numberOf(source.AI_DSH_MAX_TOKENS, 8192),
		bridgeUrl: source.AI_DSH_BRIDGE_URL ?? `http://127.0.0.1:${port}/internal/dsh/commands`,
	};
}

/** 造 dsh 会话需要的参数（在 `AgentSessionLike` 之上多几个 dsh 专属的）。 */
export interface CreateDshSessionOptions {
	/** 会话 id。 */
	conversationId: string;
	/** 我们的命令工具（**已按白名单过滤**）。 */
	tools: readonly CommandTool[];
	/** 系统提示词（**含技能段**）。 */
	systemPrompt: string;
	/** 模型 id（智能体配置可以覆盖全局默认）。 */
	model?: string | undefined;
	/** 工作目录。 */
	cwd?: string | undefined;
	/** MCP 工具名前缀（用来归一化工具名）。 */
	mcpPrefixes?: readonly string[];
	/**
	 * 要挂的 MCP 服务器（**可以 0 / 1 / N 个**；不给 ⇒ 不挂）。
	 *
	 * ⚠️ **每个会话一份**（token 是**当次调用方**的）⇒ 算好了塞进子进程的环境变量
	 *    ⇒ **凭据不落盘**。
	 */
	mcpServers?: readonly McpServerSpec[];
	/** 闸门上下文（**每次调用时取** ⇒ 锚点变了也能用）。 */
	gate: () => Omit<DshGateContext, "argsOf">;
	/** 留痕层（**不给 ⇒ 不留痕**）。 */
	tracer?: DshTracer | undefined;
	/** 配置（不给 ⇒ 从环境变量读）。 */
	config?: DshRunnerConfig | undefined;
	/** 环境变量来源（不给 ⇒ `process.env`）。 */
	env?: NodeJS.ProcessEnv | undefined;
}

/**
 * 造一个 dsh 会话（**懒起进程**：第一次说话时才起 dsh 运行时）。
 *
 * @param options 会话参数。
 */
export async function createDshSession(
	options: CreateDshSessionOptions,
): Promise<AgentSessionLike> {
	const config = options.config ?? dshRunnerConfig(options.env);
	const source = options.env ?? process.env;
	const apiKey = source[config.apiKeyEnv];
	if (apiKey === undefined || apiKey.length === 0) {
		throw new Error(
			`没有 ${config.apiKeyEnv} ⇒ dsh runner 起不来（那个环境变量里放模型服务的 key）`,
		);
	}
	// ⚠️ **profile 必须先准备好**（我们的插件要装进去 ⇒ 工具与 provider 才在）。
	//    （每个进程只做一次 ⇒ 这里 await 的是那个缓存的 promise。）
	await ensureDshProfile({
		dshHome: config.dshHome,
		profile: config.profile,
		dshBin: config.dshBin,
		pluginPath: PLUGIN_DIR,
	});

	const childEnv = buildChildEnv({ options, config, source, apiKey });

	return new DshSession({
		conversationId: options.conversationId,
		tools: options.tools,
		systemPrompt: options.systemPrompt,
		provider: config.provider,
		model: options.model ?? config.model,
		cwd: options.cwd ?? process.cwd(),
		dshHome: config.dshHome,
		profile: config.profile,
		patches: config.patches,
		dshBin: config.dshBin,
		env: childEnv,
		gate: options.gate,
		bridgeUrl: config.bridgeUrl,
		bridgeSecret: bridgeSecret(),
		tracer: options.tracer,
	});
}

/**
 * 组网的**子进程环境变量**（**凭据只走这里**。
 *
 * ⚠️ **凭据不落盘**（只在子进程的环境变量里）。
 * ⚠️ 多行文本（提示词 / 工具目录 / MCP 清单）⇒ **base64**（免得换行问题）。
 *
 * @param input 会话参数、配置、环境变量来源、模型 key。
 */
export function buildChildEnv(input: {
	options: CreateDshSessionOptions;
	config: DshRunnerConfig;
	source: NodeJS.ProcessEnv;
	apiKey: string;
}): NodeJS.ProcessEnv {
	const { options, config, source, apiKey } = input;
	const catalog = buildToolCatalog(options.tools, options.mcpPrefixes ?? []);
	// ⚠️ **MCP 服务器**（dsh 形状）⇒ 交给 dsh 侧插件挂上去。
	//    ⚠️ **token 只在子进程的环境变量里**（绝不落盘、绝不进日志）。
	const mcpConfigs = buildDshMcpClientConfigs(options.mcpServers ?? []);
	return {
		...source,
		DSH_HOME: config.dshHome,
		AI_DSH_PROVIDER: config.provider,
		AI_DSH_MODEL: options.model ?? config.model,
		AI_DSH_BASE_URL: config.baseURL,
		AI_DSH_API_KEY: apiKey,
		AI_DSH_CONTEXT_WINDOW: String(config.contextWindow),
		AI_DSH_MAX_TOKENS: String(config.maxTokens),
		AI_DSH_SYSTEM_PROMPT: encode(options.systemPrompt),
		AI_DSH_TOOLS: encode(JSON.stringify(catalog)),
		AI_DSH_MCP_SERVERS: encode(JSON.stringify(mcpConfigs)),
		AI_DSH_BRIDGE_URL: config.bridgeUrl,
		AI_DSH_BRIDGE_SECRET: bridgeSecret(),
		AI_DSH_CONVERSATION_ID: options.conversationId,
	};
}

/**
 * 命令桥的密钥（**进程内随机** ⇒ 不落盘、不进 git）。
 *
 * ⚠️ 每次进程启动都换 ⇒ 旧的 dsh 进程（如果还活着）会失效 ⇒ 那是好事。
 */
export function bridgeSecret(): string {
	const holder = globalThis as unknown as { __dshBridgeSecret?: string };
	holder.__dshBridgeSecret ??= randomBytes(24).toString("hex");
	return holder.__dshBridgeSecret;
}

/** base64（**环境变量里放多行文本 ⇒ 用 base64 免得换行/编码出问题**）。 */
function encode(text: string): string {
	return Buffer.from(text, "utf8").toString("base64");
}

/** 环境变量里的数字（坏了就用缺省值）。 */
function numberOf(raw: string | undefined, fallback: number): number {
	if (raw === undefined) {
		return fallback;
	}
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 找 dsh 的可执行文件（**SDK 自带的那份同版本运行时**）。
 *
 * ⚠️ 找不到就报错（**不猜 PATH** ⇒ 免得起错版本）。
 */
function resolveDshBin(): string {
	try {
		return requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
	} catch {
		return join(process.cwd(), "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
	}
}
