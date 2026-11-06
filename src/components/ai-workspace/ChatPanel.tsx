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
        // ⚠️ **不锁高度**：消息区跟着内容长高，页面滚一次就够。
        // 之前这里锁成 `height: 100%` + 消息区 `flex:1 + overflow-y:auto`
        // ⇒ 侧栏里多出一层滚动条（页面一个、侧栏一个）。
        minHeight: 0,
      }}
    >
      <div
        ref={listRef}
        style={{
          // 消息区跟着内容长高（不自己滚）
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
      {/*
        ⚠️ **输入区粘在视口底部**。

        侧栏不再锁高度、消息区不再自己滚 ⇒ 页面滚一次就能看完全部消息。
        但那样输入框会跑到页面很下面去 ⇒ 每次要滚一屏才找得到发送按钮。
        ⇒ 把输入区 `sticky` 在视口底部：消息往上滚，输入框**一直挂在屏幕底部**。
        （`zIndex` 与不透明背景：否则消息会从输入框底下透出来。）

        失败提示也放进来：它说的是「刚才那次发送失败了」，得跟发送按钮待在一处，
        滚走了就没人看见了。
      */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 1,
          background: token.colorBgContainer,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: token.sizeSM,
        }}
      >
        {sendError ? (
          <div style={{ marginBottom: token.sizeSM }}>
            <Alert
              type="error"
              showIcon
              title={sendError}
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
    </div>
  );
}
