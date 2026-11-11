/**
 * 一个气泡（规格 §3.3）。
 *
 * - 用户：右对齐，`colorPrimary` 底、白字；
 * - 助手：左对齐，白底 + `colorBgLayout` 边框 + 机器人头像。
 *
 * 助手气泡里的顺序是 **正文 → 命令卡片 → 失败提示**：
 * 正文是 `text_delta` 累积出来的，命令卡片是这一轮里跑过的命令，
 * 失败提示只在 `message_end.error` 有值时出现。
 */
import { RobotOutlined } from '@ant-design/icons';
import { Alert, Avatar, Tag, theme } from 'antd';
import type React from 'react';
import { CommandCard } from './CommandCard';
import type { ChatMessage } from './useAgentStream';

/** 气泡的 props。 */
export interface MessageBubbleProps {
  /** 要渲染的气泡。 */
  message: ChatMessage;
}

/**
 * 一个气泡。
 */
export function MessageBubble({
  message,
}: MessageBubbleProps): React.ReactElement {
  const { token } = theme.useToken();

  if (message.role === 'user') {
    return (
      <div
        data-role="user"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginLeft: 'auto',
        }}
      >
        <div
          style={{
            background: token.colorPrimary,
            color: token.colorTextLightSolid,
            borderRadius: token.borderRadiusLG,
            padding: `${token.paddingSM}px ${token.padding}px`,
            maxWidth: '85%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {/*
            ⚠️ **代用户发的上下文说明**（点了「与 AI 讨论」之后自动发的那句）：
                界面上要说得清楚「这句不是我打的」⇒ 顶上挂一个技能标签，
                底下补一句「已加入上下文」。
          */}
          {message.origin === 'context' ? (
            <div
              data-role="context-origin"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.sizeXS,
                marginBottom: token.sizeXS,
              }}
            >
              <Tag
                color="default"
                style={{
                  marginInlineEnd: 0,
                  color: token.colorTextLightSolid,
                  background: 'rgba(255,255,255,0.18)',
                  borderColor: 'transparent',
                }}
              >
                上下文
              </Tag>
              <span style={{ fontSize: token.fontSizeSM, opacity: 0.85 }}>
                已加入上下文
              </span>
            </div>
          ) : null}
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div
      data-role="assistant"
      style={{
        display: 'flex',
        gap: token.sizeSM,
        marginRight: 'auto',
      }}
    >
      <Avatar
        size="small"
        icon={<RobotOutlined />}
        style={{ background: token.colorPrimary, flexShrink: 0 }}
      />
      <div
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBgLayout}`,
          borderRadius: token.borderRadiusLG,
          padding: `${token.paddingSM}px ${token.padding}px`,
          maxWidth: '85%',
        }}
      >
        {message.text ? (
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message.text}
          </div>
        ) : null}
        {message.commands.map((command) => (
          <CommandCard key={command.id} command={command} />
        ))}
        {message.error ? (
          <div style={{ marginTop: token.sizeSM }}>
            <Alert type="error" showIcon title={message.error} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
