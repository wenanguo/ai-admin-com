/**
 * **智能体选择器**（issue #101）—— 工作台上挑「新会话用哪个智能体」。
 *
 * ## 它是**窄版 + 宽版共用**的一个组件
 *
 * ⚠️ 宽窄两版**共用同一个 `<AiWorkspace>` 实例**（切形态不卸载 ⇒ 会话/SSE 不断）
 * ⇒ 选择器**只有这一个实现**（宽窄只是把它放在不同的位置）
 * ⇒ 改一处两边都跟着改（抄第二份必然漏）。
 *
 * ## 它挑的是「**新会话**用哪个智能体」
 *
 * ⚠️ **已经建好的会话不受影响**：会话的智能体在建会话时就定了
 *    （落库到 `ai_conversation.agent_id`）⇒ 打开一个旧会话，它仍用它自己的智能体。
 * ⇒ 换智能体 = **另起一个会话**（`useWorkspace` 的 `selectAgent` 干这件事）。
 *
 * ## 三态（一个都不能少）
 *
 * - **加载中**：清单还没读到 ⇒ 不显示选择器（免得用户选了个空的）；
 * - **加载失败**：AI 服务不可达 / 令牌过期 ⇒ **降级**（一句话 + 重试），
 *   ⚠️ **不许白屏**：工作台照样能用（只是不能挑智能体）；
 * - **只有一个智能体**：**只显示名字**，不显示选择器（没得选就别装个下拉框）。
 */
import { Button, Select, Spin, theme } from 'antd';
import type React from 'react';
import type { AiAgentSummary } from '@/services/api/ai/types';

/** 选择器的 props。 */
export interface AgentSelectorProps {
  /** 读到的智能体清单。 */
  agents: AiAgentSummary[];
  /** 清单还在读。 */
  loading: boolean;
  /** 读不到的原因（没有就是好的）。 */
  error?: string;
  /** 再读一次（失败时的「重试」用）。 */
  onReload: () => void;
  /**
   * 当前选中的智能体 id。
   *
   * ⚠️ `undefined` = **没挑过** ⇒ 建会话时不传 `agentId` ⇒ 服务端用默认智能体。
   */
  value?: string;
  /** 挑了一个（= 接下来的新会话用它）。 */
  onChange: (agentId: string) => void;
  /** 尺寸（窄版的头部矮 ⇒ 用 `small`）。 */
  size?: 'small' | 'middle';
  /**
   * 选择器的宽度（px）。
   *
   * ⚠️ **固定宽度**（不是自适应）：智能体名可能很长（配置里自己写的）
   *    ⇒ 自适应会把窄版（400px）的头部**撑破** ⇒ 名字太长时 antd 自己截断加省略号。
   */
  width?: number;
}

/**
 * 智能体选择器。
 *
 * @param props 清单状态、当前选择与回调。
 */
export function AgentSelector({
  agents,
  loading,
  error,
  onReload,
  value,
  onChange,
  size = 'small',
  width = 180,
}: AgentSelectorProps): React.ReactElement {
  const { token } = theme.useToken();

  /** 加载中（还没读到清单）。 */
  if (loading && agents.length === 0) {
    return (
      <span
        data-role="ai-agent-loading"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: token.sizeXS,
          fontSize: token.fontSizeSM,
          color: token.colorTextSecondary,
        }}
      >
        <Spin size="small" />
        智能体加载中…
      </span>
    );
  }

  /**
   * 读不到清单 ⇒ **降级**，不许白屏。
   *
   * ⚠️ 必须能**重试**：只提示不给出路，用户就只能干瞪眼。
   */
  if (error !== undefined) {
    return (
      <span
        data-role="ai-agent-error"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: token.sizeXS,
          fontSize: token.fontSizeSM,
          color: token.colorTextSecondary,
        }}
      >
        <span>智能体清单读不到：{error}</span>
        <Button size="small" data-role="ai-agent-retry" onClick={onReload}>
          重试
        </Button>
      </span>
    );
  }

  /** 一个智能体都没配 ⇒ 说清楚（不是 bug，是没配置）。 */
  if (agents.length === 0) {
    return (
      <span
        data-role="ai-agent-empty"
        style={{
          fontSize: token.fontSizeSM,
          color: token.colorTextSecondary,
        }}
      >
        没有可用智能体
      </span>
    );
  }

  /**
   * **只有一个智能体** ⇒ 只显示名字。
   *
   * ⚠️ 没得选就别装个下拉框（点开只有一项 ⇒ 白占地方）。
   */
  if (agents.length === 1) {
    const only = agents[0];
    return (
      <span
        data-role="ai-agent-single"
        title={only.name}
        style={{
          display: 'inline-block',
          maxWidth: width,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: token.fontSizeSM,
          color: token.colorText,
        }}
      >
        {only.name}
      </span>
    );
  }

  return (
    <Select
      data-role="ai-agent-select"
      size={size}
      // ⚠️ **固定宽度**：名字太长时 antd 自己截断（加省略号）⇒ 窄版撑不破。
      style={{ width }}
      // ⚠️ 挑的那个智能体**已经不在清单里**了（配置被删了）⇒ 当没挑过
      //    （不然下拉框里会显示一个不存在的裸 id）。
      value={
        value !== undefined && agents.some((agent) => agent.id === value)
          ? value
          : undefined
      }
      placeholder="默认智能体"
      onChange={(next: string) => {
        onChange(next);
      }}
      // ⚠️ antd v6：`optionFilterProp` 挂在 `showSearch` 对象里
      //    （写在 Select 上是**废弃**的写法）。
      showSearch={{ optionFilterProp: 'label' }}
      options={agents.map((agent) => ({
        value: agent.id,
        label: agent.name,
      }))}
    />
  );
}
