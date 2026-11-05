/**
 * 对话页签（规格 §3.3）。
 *
 * 一条竖着的消息流 + 底部的输入区。
 * 这一层是**纯展示**的：会话与事件流都在 `useWorkspace` / `useAgentStream` 里，
 * 这里只负责把它们给的东西摆出来。
 */
import { Alert, Button, theme } from 'antd';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from './useAgentStream';

/** 对话页签的 props。 */
export interface ChatPanelProps {
  /** 气泡列表。 */
  messages: ChatMessage[];
  /** 本轮进行中（禁用输入）。 */
  streaming?: boolean;
  /** 命令还在发出去。 */
  sending?: boolean;
  /** 上一条命令发送失败的原因。 */
  sendError?: string;
  /** 发送一句话。 */
  onSend: (text: string) => void;
  /** 重试上一条失败的消息。 */
  onRetry?: () => void;
}

/**
 * 对话页签。
 */
export function ChatPanel({
  messages,
  streaming,
  sending,
  sendError,
  onSend,
  onRetry,
}: ChatPanelProps): React.ReactElement {
  const { token } = theme.useToken();
  const [value, setValue] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const busy = streaming === true || sending === true;

  // 新消息进来时滚到底
  useEffect(() => {
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages]);

  const handleSend = (): void => {
    const trimmed = value.trim();
    if (!trimmed || busy) {
      return;
    }
    onSend(trimmed);
    setValue('');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        ref={listRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: token.sizeSM,
          padding: token.sizeSM,
        }}
      >
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
      {sendError ? (
        <div style={{ marginBottom: token.sizeSM }}>
          <Alert
            type="error"
            showIcon
            message={sendError}
            action={
              onRetry ? (
                <Button size="small" onClick={onRetry}>
                  重试
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : null}
      <Composer
        value={value}
        onChange={setValue}
        onSend={handleSend}
        busy={busy}
        showChips={messages.length === 0}
      />
    </div>
  );
}
