/**
 * 智能体**注册表** —— 运行时按 id 取智能体配置。
 *
 * ## 为什么有这一层
 *
 * 配置在**文件**里（`agents/<id>/agent.yaml`），运行时却要「按 id 取一个智能体」
 * ⇒ 需要一个把文件变成「可查的东西」的地方。
 *
 * ⚠️ **装载在构造时做一次**（不是每次取都读盘）：
 *    ① 非法配置 ⇒ **启动即报错**（见 `loader.ts`）；
 *    ② 会话创建时不用等磁盘。
 *    ⇒ 改配置要**重启服务**才生效（与「配置文件由人编辑」的口径一致）。
 *
 * ## 会话 ↔ 智能体的绑定
 *
 * **会话 id 里带着智能体 id**：`<agentId>_<uid>`。
 *
 * ⚠️ 为什么不用「另存一张映射表」：那要动数据模型（`ai_conversation` 加列）⇒
 *    那是另一条 issue 的活（#81）⇒ 本条**不动数据模型**。
 * ⚠️ 为什么不用内存映射：那会**进程重启就丢** ⇒ 「同一会话重建后仍是同一个
 *    智能体」就不成立（重建常常发生在重启之后）。
 * ⇒ 把智能体 id 编进会话 id ⇒ 绑定**跟着会话走**（会话 id 存在库里 ⇒ 重启也在）。
 *
 * ⚠️ **老会话**（本条之前建的，id 里没有 `_`）⇒ 认不出智能体 ⇒ **回落到默认智能体**
 *    ⇒ 老会话继续能用（行为不变）。
 */

import { randomUUID } from "node:crypto";
import { loadAgentConfigs } from "./loader.ts";
import type { AgentConfig } from "./types.ts";

/** 智能体来源（运行时靠它拿配置；测试可以注入假的）。 */
export interface AgentProvider {
  /** 默认智能体 id（调用方没指定时用它）。 */
  readonly defaultAgentId: string;
  /** 取某个智能体的配置；没有 ⇒ `undefined`。 */
  get(agentId: string): AgentConfig | undefined;
  /** 列出全部智能体（清单用）。 */
  list(): AgentConfig[];
}

/**
 * 文件来源的智能体（读 `agents/<id>/agent.yaml`）。
 *
 * ⚠️ **装载在构造时做** ⇒ 配置坏了这里就抛（启动即失败）。
 *
 * @param rootDir 智能体配置根目录（通常是 `<cwd>/agents`）。
 * @param defaultAgentId 默认智能体 id。
 */
export function createFileAgentProvider(
  rootDir: string,
  defaultAgentId: string,
): AgentProvider {
  const configs = loadAgentConfigs(rootDir);
  const byId = new Map(configs.map((config) => [config.id, config]));
  return {
    defaultAgentId,
    get: (agentId: string): AgentConfig | undefined => byId.get(agentId),
    list: (): AgentConfig[] => [...configs],
  };
}

/** 会话 id 与智能体 id 之间的分隔符（智能体 id 里不许有它 ⇒ 解析不会歧义）。 */
export const AGENT_ID_SEPARATOR = "_";

/** 智能体 id 的合法形态（小写字母 / 数字 / 连字符）。 */
const AGENT_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * 造一个**绑定了智能体**的会话 id。
 *
 * @param agentId 智能体 id。
 */
export function conversationIdFor(agentId: string): string {
  // ⚠️ uuid 去掉连字符 ⇒ 32 位 ⇒ 加智能体 id 也不超过 `ai_conversation.id` 的 64 位
  return `${agentId}${AGENT_ID_SEPARATOR}${randomUUID().replace(/-/g, "")}`;
}

/**
 * 从会话 id 里读出智能体 id。
 *
 * @param conversationId 会话 id。
 * @returns 认得出来就返回；**老会话**（id 里没有分隔符）⇒ `undefined`（调用方回落默认智能体）。
 */
export function agentIdOfConversation(
  conversationId: string,
): string | undefined {
  const index = conversationId.lastIndexOf(AGENT_ID_SEPARATOR);
  if (index <= 0) {
    return undefined;
  }
  const agentId = conversationId.slice(0, index);
  return AGENT_ID_PATTERN.test(agentId) ? agentId : undefined;
}
