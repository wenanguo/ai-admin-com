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
  /** 中止当前这一轮（点「停止生成」）。 */
  onStop?: () => void;
  /** 正在中止。 */
  stopping?: boolean;
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
  onStop,
  stopping,
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
        // ⚠️ 侧栏是**固定高度的一列** ⇒ 这里填满它。
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        ref={listRef}
        className="ai-workspace-scroll"
        style={{
          // 消息区在**列内**滚（侧栏固定高度 ⇒ 滚不动就得在列内滚）
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
      {/*
        输入区：固定在**列底**。

        侧栏是固定高度的一列（`AiWorkspaceLayout` 里 `calc(100vh - 顶边)`），
        消息区在列内滚 ⇒ 输入区自然就在列底，**永远在视口里**，
        不用先滚一屏才找得到发送按钮。

        失败提示也放进来：它说的是「刚才那次发送失败了」，得跟发送按钮待在一处，
        滚走了就没人看见了。
      */}
      <div
        style={{
          flexShrink: 0,
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
          onStop={onStop}
          stopping={stopping}
        />
      </div>
    </div>
  );
}
