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
import type { AiTaskContext } from '@/services/api/ai/types';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import type { AiPendingItem, ChatMessage } from './useAgentStream';

/** 对话页签的 props。 */
export interface ChatPanelProps {
  /** 气泡列表。 */
  messages: ChatMessage[];
  /**
   * 模型当前的思考内容（思考级别开了才有）。
   *
   * ⚠️ **不是对话内容** ⇒ 显示在输入区上方，不进气泡。
   */
  thinking?: string;
  /**
   * 当前**挂起中**的修改（等用户点头）。
   *
   * ⚠️ 服务端在 `tool_call` hook 里同步挂起 ⇒ 那一轮在等 ⇒
   *    不显示的话，用户会以为卡死了。
   */
  pendingItems?: AiPendingItem[];
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
  /**
   * 当前讨论的上下文（用户点了「与 AI 讨论」）。
   *
   * ⚠️ 有它 ⇒ 每条消息都会带上它（服务端才知道 AI 在聊哪条任务）。
   */
  context?: AiTaskContext | null;
  /** 清除当前上下文（用户不想接着聊这条了）。 */
  onClearContext?: () => void;
}

/**
 * 对话页签。
 */
export function ChatPanel({
  messages,
  thinking,
  pendingItems,
  streaming,
  sending,
  sendError,
  onSend,
  onRetry,
  onStop,
  stopping,
  context,
  onClearContext,
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
        {/* 上下文条：正在跟 AI 聊哪条任务 */}
        {context ? (
          <div
            data-testid="ai-context-bar"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: token.sizeXS,
              flexShrink: 0,
              padding: `${token.sizeXS}px ${token.sizeSM}px`,
              borderRadius: token.borderRadius,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillQuaternary,
              fontSize: token.fontSizeSM,
            }}
          >
            <span style={{ color: token.colorTextSecondary, flexShrink: 0 }}>
              正在讨论
            </span>
            <span
              style={{
                color: token.colorText,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              #{context.task.id} {String(context.task.title ?? '（无标题）')}
            </span>
            {context.project ? (
              <span
                style={{
                  color: token.colorTextSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                · {context.project.name}
              </span>
            ) : null}
            {onClearContext ? (
              <Button
                size="small"
                type="link"
                onClick={onClearContext}
                style={{ marginLeft: 'auto', flexShrink: 0, padding: 0 }}
              >
                结束讨论
              </Button>
            ) : null}
          </div>
        ) : null}
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
        {thinking ? (
          /*
            ⚠️ **「思考中…」**：模型的思考不是对话内容 ⇒ 不进气泡，
            只在输入区上方显示一行（否则用户只看到界面卡住）。
          */
          <div
            data-role="ai-thinking"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: token.sizeXS,
              marginBottom: token.sizeSM,
              fontSize: token.fontSizeSM,
              color: token.colorTextTertiary,
            }}
          >
            <span style={{ flexShrink: 0 }}>思考中…</span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {thinking.slice(-200)}
            </span>
          </div>
        ) : null}
        {pendingItems && pendingItems.length > 0 ? (
          /*
            ⚠️ **「等待你确认」**：服务端把修改挂起了 ⇒ 那一轮在等
            ⇒ 不显示的话用户会以为卡死了。
          */
          <div
            data-role="ai-pending-hint"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: token.sizeXS,
              marginBottom: token.sizeSM,
              fontSize: token.fontSizeSM,
              color: token.colorWarning,
            }}
          >
            <span>⏳ 等待你确认</span>
            <span style={{ color: token.colorTextSecondary }}>
              {pendingItems.map((item) => item.command).join('、')}
              （去「待确认」页签点头）
            </span>
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
