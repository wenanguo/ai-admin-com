/**
 * 命令卡片（规格 §3.4）。
 *
 * 头：命令名（等宽、紫色）+ 状态标签；
 * 体：模型写的自然语言摘要（`tool_result.summary`）；
 * 底：**留空** —— 服务端没有撤销端点，画一个撤销按钮就是骗人。
 *
 * ⚠️ 状态**由事件驱动，不由前端推断**：
 * 前端不做任何「这条命令危不危险」的判断（那是命令层与服务端的事）。
 */
import { Tag, theme } from 'antd';
import type React from 'react';
import type { ChatCommand, CommandStatus } from './useAgentStream';

/**
 * AI 身份色（紫）。
 *
 * ⚠️ antd 6 **没有** `colorPurple` 这个 token ——
 * 规格里说的紫色在 antd 里就是预设色 `purple`（`Tag color="purple"`），
 * 它的色值是 seed 里的 `#722ED1`。
 */
const AI_PURPLE = '#722ED1';

/** 状态标签的取值。 */
interface StatusTag {
  /** antd Tag 的预设色。 */
  color: 'processing' | 'success' | 'error';
  /** 给用户看的字。 */
  text: string;
}

/**
 * 命令状态 → 标签。
 *
 * 只有 `tool_call`（还没出结果）⇒ 执行中；
 * `tool_result.status === 'ok'` ⇒ 已执行；`'error'` ⇒ 失败。
 */
function statusTag(status: CommandStatus): StatusTag {
  switch (status) {
    case 'ok':
      return { color: 'success', text: '已执行' };
    case 'error':
      return { color: 'error', text: '失败' };
    default:
      return { color: 'processing', text: '执行中' };
  }
}

/** 命令卡片的 props。 */
export interface CommandCardProps {
  /** 要渲染的命令。 */
  command: ChatCommand;
}

/**
 * 一张命令卡片。
 */
export function CommandCard({ command }: CommandCardProps): React.ReactElement {
  const { token } = theme.useToken();
  const tag = statusTag(command.status);

  return (
    <div
      style={{
        marginTop: token.sizeSM,
        padding: token.sizeSM,
        border: `1px solid ${token.colorBgLayout}`,
        borderRadius: token.borderRadius,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: token.sizeSM,
        }}
      >
        <span
          style={{
            fontFamily: token.fontFamilyCode,
            fontSize: token.fontSizeSM,
            color: AI_PURPLE,
          }}
        >
          {command.toolName}
        </span>
        <Tag color={tag.color}>{tag.text}</Tag>
      </div>
      {command.summary ? (
        <div
          style={{
            marginTop: token.sizeXS,
            fontSize: token.fontSizeSM,
            color: token.colorTextSecondary,
          }}
        >
          {command.summary}
        </div>
      ) : null}
    </div>
  );
}
