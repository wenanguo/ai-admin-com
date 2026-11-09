/**
 * 宽版对话（规格 §4.1 的「对话演示（宽版）」）。
 *
 * 与侧栏的 `ChatPanel` 的差别只有两处：
 * - **输入框是外部受控的**（`draft` / `onDraftChange`）——
 *   意图卡片要能把示例问句填进来（侧栏那个输入框的 value 在 `ChatPanel` 内部）；
 * - 更宽、更矮（侧栏是竖着的一列，这里是横着的一块）。
 *
 * 气泡与命令卡片直接复用侧栏那套（`MessageBubble`），不重画一遍。
 */
import { Alert, Button, theme } from 'antd';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { Composer } from '@/components/ai-workspace/Composer';
import { MessageBubble } from '@/components/ai-workspace/MessageBubble';
import type {
  AiPendingItem,
  ChatMessage,
} from '@/components/ai-workspace/useAgentStream';

/** 宽版对话的 props。 */
export interface WideChatProps {
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
  /** 输入框里的内容（外部受控）。 */
  draft: string;
  /** 输入内容变了。 */
  onDraftChange: (value: string) => void;
  /** 发送一句话。 */
  onSend: () => void;
  /** 本轮进行中（禁用输入）。 */
  streaming?: boolean;
  /** 命令还在发出去。 */
  sending?: boolean;
  /** 上一条命令发送失败的原因。 */
  sendError?: string;
  /** 重试上一条失败的消息。 */
  onRetry?: () => void;
  /** 中止当前这一轮（点「停止生成」）。 */
  onStop?: () => void;
  /** 正在中止。 */
  stopping?: boolean;
}

/**
 * 宽版对话。
 *
 * @param props 消息与输入框。
 */
export function WideChat({
  messages,
  thinking,
  pendingItems,
  draft,
  onDraftChange,
  onSend,
  streaming,
  sending,
  sendError,
  onRetry,
  onStop,
  stopping,
}: WideChatProps): React.ReactElement {
  const { token } = theme.useToken();
  const listRef = useRef<HTMLDivElement>(null);
  const busy = streaming === true || sending === true;

  // 新消息进来时滚到底
  useEffect(() => {
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages]);

  return (
    <section data-role="ai-wide-chat">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: token.sizeSM,
          marginBottom: token.sizeSM,
        }}
      >
        <span style={{ fontWeight: 600 }}>对话（宽版）</span>
        <span
          style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}
        >
          与侧栏是同一个会话（会话 id 存在浏览器本地）
        </span>
      </div>
      <div
        style={{
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          overflow: 'hidden',
          background: token.colorBgContainer,
          /*
            ⚠️ **对话区要有确定的高度**，否则它会跟着消息一起长高，
            把页面顶到很下面去 —— 于是每次都要先滚一屏才找得到输入框的发送按钮。
            `min(560px, 55vh)`：窗口矮时按视口比例收，窗口高时不超过 560px。
            里面的消息列表自己滚（`flex:1 + overflow-y:auto`），输入区固定在底部
            ⇒ **面板里只有一个滚动条**，页面那个是给下面的意图卡片墙用的。
          */
          display: 'flex',
          flexDirection: 'column',
          height: 'min(560px, 55vh)',
        }}
      >
        <div
          ref={listRef}
          style={{
            flex: '1 1 0%',
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: token.sizeSM,
            padding: token.padding,
            background: token.colorBgLayout,
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                margin: 'auto',
                color: token.colorTextTertiary,
                textAlign: 'center',
              }}
            >
              还没有对话 —— 点上面一张意图卡片，或直接说一句话
            </div>
          ) : null}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
        {sendError ? (
          <div
            style={{
              flexShrink: 0,
              padding: `${token.paddingSM}px ${token.padding}px 0`,
            }}
          >
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
        <div
          style={{
            flexShrink: 0,
            padding: token.padding,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {thinking ? (
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
            value={draft}
            onChange={onDraftChange}
            onSend={onSend}
            busy={busy}
            showChips={false}
            placeholder="问点什么…（也可以先点上面的意图卡片）"
            onStop={onStop}
            stopping={stopping}
          />
        </div>
      </div>
    </section>
  );
}
