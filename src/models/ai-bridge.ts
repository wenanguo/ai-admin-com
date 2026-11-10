import { useCallback, useState } from 'react';
import type { AiTaskContext } from '@/services/api/ai/types';

/**
 * AI 工作台 ↔ 主工作区的**桥**（全局 model）。
 *
 * ## 它解决什么
 *
 * 「与 AI 讨论」这个交互要跨两个区域通信：
 *
 * - **任务页**（列表/看板/甘特）点「与 AI 讨论」⇒ 告诉 AI「现在聊这条」；
 * - **右侧 AI 工作台**发消息时把这条带上去 ⇒ AI 知道在聊什么；
 * - AI **写回成功** ⇒ 任务页要刷新并高亮那一行；
 * - 点「与 AI 讨论」时，面板可能是收着的 ⇒ 得把它**展开**。
 *
 * ⇒ 这几件事都不是「组件内部的局部状态」⇒ 必须有个**跨页面**的地方放
 *   ⇒ 就是这个 model（`useModel('ai-bridge')`）。
 *
 * ## 为什么「当前上下文」放全局而不是放会话里
 *
 * - 它是**此刻**的状态：用户随时可能换一条任务继续聊 ⇒ 它属于 UI，不属于会话。
 * - 放会话里的话，切任务就得换会话 ⇒ 聊天记录被切碎。
 *
 * ⇒ 服务端那边也一样：**每条消息都带一次**上下文（见 `sendAiCommand`）。
 *
 * ## 写回信号为什么也放这里
 *
 * SSE 事件只有 AI 工作台收到，任务页收不到 ⇒ 得有个共享的地方广播出去
 * ⇒ `lastUpdate` 就是那个广播（带 `at` 时间戳 ⇒ 页面靠它判断「是不是新的一条」）。
 *
 * ## 展开信号为什么只是「计数器」
 *
 * 侧栏的折叠状态住在 `AiWorkspaceShell` 里（还持久化到 localStorage）⇒
 * 把它搬进 model 会把「持久化」也搬进来 ⇒ ⇒ 这里只发一个**递增的计数器**：
 * 外壳看到它变了就展开一次 ⇒ 职责清晰，页面也不用管面板怎么存状态。
 */

/** 一次写回成功的信号。 */
export interface AiEntityUpdate {
  /** 实体类型（现在只有任务）。 */
  entityType: 'task';
  /** 实体的 id（页面靠它高亮那一行）。 */
  entityId: number;
  /** 被改的字段名（页面上可以顺带提示「状态已改为完成」）。 */
  fields: string[];
  /** 什么时候发生的（毫秒时间戳）⇒ 页面靠它判断新旧。 */
  at: number;
}

/** model 的返回值。 */
export interface AiContextModel {
  /** 当前讨论的上下文（null = 没有在讨论某条任务）。 */
  context: AiTaskContext | null;
  /** 设置当前讨论的上下文（传 null 等于清除）。 */
  setContext: (context: AiTaskContext | null) => void;
  /** 清除当前上下文。 */
  clearContext: () => void;
  /** 最近一次写回成功的信号（null = 还没发生过）。 */
  lastUpdate: AiEntityUpdate | null;
  /** 广播一次写回成功。 */
  notifyUpdate: (update: Omit<AiEntityUpdate, 'at'>) => void;
  /** 「请把侧栏展开」的信号（每次 +1 ⇒ 外壳看到变化就展开一次）。 */
  expandSignal: number;
  /** 请求展开右侧 AI 工作台（点「与 AI 讨论」时调）。 */
  requestExpand: () => void;
}

export default function useAiBridgeModel(): AiContextModel {
  const [context, setContext] = useState<AiTaskContext | null>(null);
  const [lastUpdate, setLastUpdate] = useState<AiEntityUpdate | null>(null);
  const [expandSignal, setExpandSignal] = useState(0);

  const clearContext = useCallback(() => {
    setContext(null);
  }, []);

  const notifyUpdate = useCallback((update: Omit<AiEntityUpdate, 'at'>) => {
    setLastUpdate({ ...update, at: Date.now() });
  }, []);

  const requestExpand = useCallback(() => {
    setExpandSignal((value) => value + 1);
  }, []);

  return {
    context,
    setContext,
    clearContext,
    lastUpdate,
    notifyUpdate,
    expandSignal,
    requestExpand,
  };
}
