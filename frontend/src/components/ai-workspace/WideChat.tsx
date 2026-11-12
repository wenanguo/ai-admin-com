/**
 * 宽版对话（规格 §4.1 的「对话演示（宽版）」）。
 *
 * 与侧栏的 `ChatPanel` 的差别只有两处：
 * - **输入框是外部受控的**（`draft` / `onDraftChange`）——
 *   意图卡片要能把示例问句填进来（侧栏那个输入框的 value 在 `ChatPanel` 内部）；
 * - 更宽、更矮（侧栏是竖着的一列，这里是横着的一块）。
 *
 * ## 意图卡片：抽屉，不是页面底部的一片卡片
 *
 * 卡片墙原本铺在页面底部 ⇒ 页面得滚一屏才看得到输入框。
 * 现在它折进**输入框上方的抽屉**（`intentSlot` 给内容）：
 * - 抽屉是**绝对定位**的浮层 ⇒ **不占高度**；
 * - 打开时点外面或按 `Esc` 收起；点一张卡片后由宿主调用 `close` 收起。
 *
 * 气泡与命令卡片直接复用侧栏那套（`MessageBubble`），不重画一遍。
 */
import { Alert, Button, theme } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  /**
   * 意图卡片抽屉的**内容**（render prop）。
   *
   * - **不给就没有那个按钮**（抽屉是可选的）；
   * - 参数 `close` 是「收起抽屉」的动作 ⇒ 宿主在用户点了一张卡片后调用它
   *   （收起这件事只有 `WideChat` 知道怎么做 ⇒ 所以是 render prop，不是节点）。
   */
  intentSlot?: (close: () => void) => React.ReactNode;
  /** 抽屉里有多少张意图卡片（只用来在按钮上写个计数）。 */
  intentCount?: number;
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
  intentSlot,
  intentCount,
}: WideChatProps): React.ReactElement {
  const { token } = theme.useToken();
  const listRef = useRef<HTMLDivElement>(null);
  /** 意图卡片抽屉开着没有。 */
  const [intentOpen, setIntentOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const busy = streaming === true || sending === true;

  /** 收起抽屉。 */
  const closeIntent = useCallback((): void => {
    setIntentOpen(false);
  }, []);

  /*
    抽屉开着的时候：**点外面**或按 **Esc** ⇒ 收起。

    ⚠️ 监听 `mousedown` 而不是 `click`：点外面时先按下去 ⇒ 立刻收起，
       不用等鼠标松开（那一下点击也照常落到外面的元素上）。
  */
  useEffect(() => {
    if (!intentOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      // 抽屉里、按钮上 ⇒ 不算「外面」
      if (drawerRef.current?.contains(target)) {
        return;
      }
      if (toggleRef.current?.contains(target)) {
        return;
      }
      setIntentOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIntentOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [intentOpen]);

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
            ⇒ **面板里只有一个滚动条**（页面那个滚动条是给下一段的侧栏/卡片用的）。
            ⚠️ 这里是**固定高度**；「对话区吃满剩余高度」是下一个任务的事。
          */
          display: 'flex',
          flexDirection: 'column',
          height: 'min(560px, 55vh)',
        }}
      >
        {/*
          消息区（**抽屉的定位基准**）。

          ⚠️ 抽屉是**绝对定位**在这个盒子里的 ⇒ 它**浮在消息上方、不占高度**
             ⇒ 消息区该多高还是多高（页面不用为它让出空间）。
        */}
        <div
          style={{
            position: 'relative',
            flex: '1 1 0%',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
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
          {/*
            意图卡片抽屉。

            ⚠️ **底部贴着消息区的下边** ⇒ 抽屉从下往上长，
               底边停在**按钮行与输入区的上方** ⇒ 永远挡不住输入框。
            ⚠️ `maxHeight: min(320px, 100%)`：既限死 320px，
               又不会超过消息区自己的高度（窗口很矮时也不会被裁掉一半）。
          */}
          {intentSlot && intentOpen ? (
            <div
              ref={drawerRef}
              data-role="ai-intent-drawer"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                maxHeight: 'min(320px, 100%)',
                overflowY: 'auto',
                zIndex: 10,
                padding: token.paddingSM,
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                boxShadow: `0 -4px 12px ${token.colorBgMask}`,
              }}
            >
              {intentSlot(closeIntent)}
            </div>
          ) : null}
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
          {/*
            意图卡片的入口（**只有宿主给了抽屉才有这一行**）。

            ⚠️ 它在**输入区的上面** ⇒ 抽屉从它上方长出来，
               底边正好停在它上面 ⇒ 抽屉既不挡按钮，也不挡输入框。
          */}
          {intentSlot ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.sizeXS,
                marginBottom: token.sizeSM,
              }}
            >
              <Button
                ref={toggleRef}
                size="small"
                data-role="ai-intent-toggle"
                aria-expanded={intentOpen}
                /*
                  ⚠️ **箭头用字符，不用图标组件**：
                     新引入一个 `@ant-design/icons` 的图标会让 vitest 浏览器模式
                     的依赖预打包（optimizeDeps）在运行中少导出那个图标
                     ⇒ 整个 `app.test.tsx` 挂在 "does not provide an export named ..."。
                     字符箭头没有这个坑。
                */
                icon={intentOpen ? '▴' : '▾'}
                onClick={() => {
                  setIntentOpen((open) => !open);
                }}
              >
                {intentCount === undefined
                  ? '意图卡片'
                  : `意图卡片（${intentCount}）`}
              </Button>
              <span
                style={{
                  fontSize: token.fontSizeSM,
                  color: token.colorTextTertiary,
                }}
              >
                点一下只填输入框，不自动发送
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
