/**
 * **智能体清单**（服务端 `GET /api/agents`）。
 *
 * ## 为什么单独一个 hook
 *
 * 智能体是**配置**（`backend/ai/agents/<agentId>/agent.yaml`）⇒ 清单读的是真文件
 * ⇒ 改完配置重启 AI 服务就能看到。
 *
 * ⚠️ 这个清单**不是会话**的一部分 ⇒ 它有自己的三态：
 * - **加载中**：刚挂载时正在读；
 * - **失败**：读不到（AI 服务不可达 / 令牌过期）⇒ 给一句原因 + 一个「重试」；
 * - **读到了**：可能是空清单（一个智能体都没配）。
 *
 * ## 失败**不许白屏**
 *
 * 智能体清单读不到时，工作台**照样能用**（只是不能挑智能体）
 * ⇒ 失败态只显示一句话 + 重试，不抛错、不挡住对话区。
 */
import { useCallback, useEffect, useState } from 'react';
import { listAiAgents } from '@/services/api/ai/client';
import type { AiAgentSummary } from '@/services/api/ai/types';

/** 未知错误转成一句话。 */
function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '读取失败';
}

/** 智能体清单的状态。 */
export interface AgentListState {
  /** 读到的智能体（还没读到时是空数组）。 */
  agents: AiAgentSummary[];
  /** 正在读。 */
  loading: boolean;
  /** 读不到的原因（没有就是好的）。 */
  error?: string;
  /** 再读一次（失败时的「重试」用）。 */
  reload: () => void;
}

/**
 * 读智能体清单。
 *
 * ⚠️ **挂载就读一次**：选择器一直摆在工作台上 ⇒ 用户随时可能要用它
 *    ⇒ 与「待确认 / 审计」那两个**按需读**的列表不一样（那两个是点开才读）。
 *
 * @returns 清单状态。
 */
export function useAgents(): AgentListState {
  const [agents, setAgents] = useState<AiAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const rows = await listAiAgents();
      setAgents(Array.isArray(rows) ? rows : []);
    } catch (loadError) {
      setError(toMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback((): void => {
    void load();
  }, [load]);

  return { agents, loading, error, reload };
}
