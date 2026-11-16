/**
 * AI 工作台的「历史对话」—— **宽窄两种形态共用这一份实现**。
 *
 * ## 为什么抽到这个文件
 *
 * 以前「历史对话」只在**宽版**（最大化）里有（`AiWorkspaceWide` 里一段
 * `handleHistoryOpen` + 一个 `Dropdown`），
 * **窄版**（常驻右侧 400px 的小浮层）没有 ⇒ 换话题后没法回看，AI 显得「失忆」。
 *
 * ⇒ 把宽版那一段抽成这里的组件，**窄版接上同一个组件**：
 * - 数据怎么来（`listAiConversations()`）、三种状态（加载中 / 空 / 失败）
 * - 列表项长什么样（标题 + 时间，窄处**截断**）
 * - 点一条怎么切会话（`workspace.switchConversation` ⇒ `getAiState` 拉历史）
 *
 * 这些**只有一份** ⇒ 改一处两边都跟着改（抄第二份必然漏）。
 *
 * ## 三态
 *
 * - **加载中**：刚打开时正在读列表；
 * - **空**：这个用户一个会话都没有；
 * - **失败**：读不到（AI 服务没起来 / 令牌过期）⇒ 给一句原因 + 一个「重试」。
 *
 * ⚠️ 失败**必须能重试** —— 只提示不给出路，用户就只能干瞪眼。
 *
 * ## 不打断流式输出
 *
 * 打开这个弹层**只读一次列表** ⇒ 不碰 `workspace` 的会话与事件流
 * ⇒ 正在生成的回答**不会被打断**。
 *（真的切会话时才会换订阅 —— 那是用户自己的选择。）
 */
import { Button, Popover, Spin, theme } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { listAiConversations } from '@/services/api/ai/client';
import type { AiConversation } from '@/services/api/ai/types';
import { fromNow } from './time';
import type { Workspace } from './useWorkspace';

/**
 * 弹层里列表的宽度（px）。
 *
 * ⚠️ **窄版面板只有 400px** ⇒ 列表再宽就顶到屏幕右边了。
 * ⇒ 320px：够放下标题 + 时间，又不会溢出。
 */
export const CONVERSATION_HISTORY_WIDTH = 320;

/** 列表最多能看到多高（px）—— 再多就自己滚。 */
const LIST_MAX_HEIGHT = 360;

/** 未知错误转成一句话。 */
function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '读取失败';
}

/** 历史对话列表的状态。 */
export interface ConversationHistoryState {
  /** 会话列表（服务端按「最近更新」排的）。 */
  items: AiConversation[];
  /** 正在读列表。 */
  loading: boolean;
  /** 读不到的原因（没有就是好的）。 */
  error?: string;
  /** 再读一次（失败时的「重试」用）。 */
  reload: () => void;
}

/**
 * 打开时才去读会话列表。
 *
 * ⚠️ **按需读**（跟 `useAiLists` 一个规矩）：面板是浮层（点开才挂载），
 * 一挂上就发请求 ⇒ AI 服务不可达时，用户在别的页面上也会莫名其妙看到报错。
 *
 * @param open 弹层开着没有。
 * @returns 列表状态。
 */
export function useConversationHistory(open: boolean): ConversationHistoryState {
  const [items, setItems] = useState<AiConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const rows = await listAiConversations();
      setItems(Array.isArray(rows) ? rows : []);
    } catch (loadError) {
      setError(toMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void load();
  }, [open, load]);

  const reload = useCallback((): void => {
    void load();
  }, [load]);

  return { items, loading, error, reload };
}

/** 列表（弹层里的那一列）的 props。 */
export interface ConversationHistoryListProps {
  /** 列表状态。 */
  state: ConversationHistoryState;
  /** 点了一条 ⇒ 切到那个会话。 */
  onSelect: (conversationId: string) => void;
  /** 列表宽度（px）。 */
  width?: number;
}

/**
 * 历史对话的列表：**三态齐全** + 标题/时间**不溢出**。
 *
 * @param props 列表状态与选择回调。
 */
export function ConversationHistoryList({
  state,
  onSelect,
  width = CONVERSATION_HISTORY_WIDTH,
}: ConversationHistoryListProps): React.ReactElement {
  const { token } = theme.useToken();
  /** 只有「读到了、且读到的是空的」才算空态。 */
  const empty = !state.loading && state.error === undefined && state.items.length === 0;

  return (
    <div
      data-role="ai-history-list"
      style={{
        width,
        maxHeight: LIST_MAX_HEIGHT,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {state.loading ? (
        <div
          data-role="ai-history-loading"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: token.sizeXS,
            padding: `${token.paddingXS}px 0`,
            color: token.colorTextSecondary,
            fontSize: token.fontSizeSM,
          }}
        >
          <Spin size="small" />
          <span>加载中…</span>
        </div>
      ) : null}

      {state.error !== undefined ? (
        <div
          data-role="ai-history-error"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: token.sizeXS,
            padding: `${token.paddingXS}px 0`,
            color: token.colorTextSecondary,
            fontSize: token.fontSizeSM,
          }}
        >
          <span>历史对话读不到：{state.error}</span>
          {/* ⚠️ 只提示不给出路是不行的 ⇒ 给一个「重试」。 */}
          <Button
            size="small"
            data-role="ai-history-retry"
            onClick={() => {
              state.reload();
            }}
          >
            重试
          </Button>
        </div>
      ) : null}

      {empty ? (
        <div
          data-role="ai-history-empty"
          style={{
            padding: `${token.paddingXS}px 0`,
            color: token.colorTextSecondary,
            fontSize: token.fontSizeSM,
          }}
        >
          还没有历史对话
        </div>
      ) : null}

      {state.items.map((conversation) => (
        <button
          type="button"
          key={conversation.conversationId}
          data-role="ai-history-item"
          data-conversation-id={conversation.conversationId}
          onClick={() => {
            onSelect(conversation.conversationId);
          }}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: token.sizeXS,
            width: '100%',
            padding: `${token.paddingXS}px 0`,
            border: 'none',
            background: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
            color: token.colorText,
            fontSize: token.fontSizeSM,
          }}
        >
          {/* ⚠️ **标题要截断**：窄版只有 400px，一个长标题会把整行撑破。 */}
          <span
            data-role="ai-history-item-title"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {conversation.title || conversation.conversationId}
          </span>
          {/* 时间不参与伸缩（`flexShrink: 0`）⇒ 宁可截标题也不截时间。 */}
          <span
            data-role="ai-history-item-time"
            style={{
              flexShrink: 0,
              color: token.colorTextTertiary,
              fontSize: token.fontSizeSM,
              whiteSpace: 'nowrap',
            }}
          >
            {fromNow(conversation.updatedAt)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 「历史对话」组件的 props。 */
export interface ConversationHistoryProps {
  /**
   * 工作台状态（只用它的「切会话」）。
   *
   * ⚠️ **由宿主给**，不要自己 `useWorkspace()` —— 两个实例会各建一个会话。
   */
  workspace: Pick<Workspace, 'switchConversation'>;
  /** 弹层里列表的宽度（px）。 */
  width?: number;
  /** 按钮的尺寸（窄版的头部矮 ⇒ 用 `small`）。 */
  size?: 'small' | 'middle';
}

/**
 * 「历史对话」：按钮 + 弹层里的会话列表。
 *
 * ⚠️ **宽窄两种形态用的是同一个组件**（见文件头的说明）⇒ 行为一致。
 *
 * @param props 工作台状态与外观。
 */
export function ConversationHistory({
  workspace,
  width = CONVERSATION_HISTORY_WIDTH,
  size = 'middle',
}: ConversationHistoryProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const state = useConversationHistory(open);

  /** 点了一条：先收起弹层，再切会话（切会话要读快照，是异步的）。 */
  const handleSelect = useCallback(
    (conversationId: string): void => {
      setOpen(false);
      void workspace.switchConversation(conversationId);
    },
    [workspace],
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      // ⚠️ 默认是 hover ⇒ 触屏上点不开；这是个按钮，就该用 click。
      trigger={['click']}
      // ⚠️ 弹层在视口右边 ⇒ 靠右对齐（往左展开），不然会顶出屏幕。
      placement="bottomRight"
      content={
        <ConversationHistoryList
          state={state}
          onSelect={handleSelect}
          width={width}
        />
      }
    >
      <Button data-role="ai-history-button" size={size}>
        历史对话
      </Button>
    </Popover>
  );
}
