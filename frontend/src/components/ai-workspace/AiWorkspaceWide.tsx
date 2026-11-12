/**
 * AI 工作台**宽版内容**（规格 §4）。
 *
 * ## 它有两个宿主
 *
 * 1. **浮层**（常态）：从 400px 的小浮层点「全宽页」⇒ 变成盖住**内容区**的宽浮层。
 *    原页面**不卸载** ⇒ 滚动位置、筛选条件、表格状态全都在。
 * 2. **路由页** `/ai/workspace`：后端菜单「AI智能助手」指的就是它。
 *
 * ⇒ 内容抽到这个组件里，两个宿主共用同一份实现（免得改一处漏一处）。
 *
 * ## 为什么宽版和窄版共用一个 `useWorkspace`
 *
 * ⚠️ 两个 `useWorkspace` 实例会**各建一个会话**（还会互相覆盖存储里的会话 id）。
 * ⇒ 宿主（`AiWorkspace`）只建**一个**实例，宽窄切换时把它传下来 ⇒
 *   会话不变、SSE 不断、流式输出不断。
 *
 * ## 这一页只说服务端给得出的话
 *
 * - **不画配额条**：服务端没有配额端点 ⇒ 没有数据源就不画假数字（规格 §4.3）。
 * - **ETA 只写 burndown**：后端没有依赖图接口 ⇒ 没有关键路径、没有 P50/P90。
 * - **意图卡片标「暂未开放」**：AI 服务当前只有 `create_task` 一条命令。
 */
import { useModel } from '@umijs/max';
import { Alert, Button, Dropdown, Space, Tabs, Typography, theme } from 'antd';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { listAiConversations } from '@/services/api/ai/client';
import type { AiConversation } from '@/services/api/ai/types';
import { AuditPanel } from './AuditPanel';
import { DiscussionBar } from './DiscussionBar';
import { IntentGallery } from './IntentGallery';
import { PendingPanel } from './PendingPanel';
import { RuleSplit } from './RuleSplit';
import { useAiLists } from './useAiLists';
import type { Workspace } from './useWorkspace';
import { WideChat } from './WideChat';

/** 工作台视图（页签）。 */
type WorkspaceView = 'pending' | 'audit' | 'rules';

/** 未知错误转成一句话。 */
function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '读取失败';
}

/** 宽版内容的 props。 */
export interface AiWorkspaceWideProps {
  /**
   * 工作台状态（会话 + 事件流）。
   *
   * ⚠️ **由宿主给**，不要自己 `useWorkspace()` —— 两个实例会各建一个会话。
   */
  workspace: Workspace;
  /**
   * 「返回」的回调。
   *
   * - 浮层宿主 ⇒ 收回小浮层；
   * - 路由页宿主 ⇒ `history.back()`。
   */
  onBack: () => void;
}

/**
 * AI 工作台的宽版内容。
 *
 * @param props 工作台状态与「返回」回调。
 */
export function AiWorkspaceWide({
  workspace,
  onBack,
}: AiWorkspaceWideProps): React.ReactElement {
  const { token } = theme.useToken();
  // 全局 model（AI 工作台 ↔ 主工作区的桥）：当前讨论的任务
  const aiBridge = useModel('ai-bridge');
  const [view, setView] = useState<WorkspaceView>('rules');
  /**
   * ⚠️ **按需读**：待确认与审计都是只读端点，页签没打开就不读
   * （跟窄面板一个规矩，见 `useAiLists` 的注释）。
   */
  const lists = useAiLists({
    pending: view === 'pending',
    audit: view === 'audit',
  });
  /** 输入框里的内容（**外部受控** —— 意图卡片要能往里填）。 */
  const [draft, setDraft] = useState('');
  /** 历史对话（下拉里的那一列）。 */
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState<string | undefined>(
    undefined,
  );
  const [creating, setCreating] = useState(false);
  /** 输入区（点了意图卡片之后要滚过去）。 */
  const chatRef = useRef<HTMLDivElement>(null);

  /** 点意图卡片：只把问句填进输入框，**不发送**。 */
  const pickIntent = useCallback((example: string): void => {
    setDraft(example);
    // 输入区在页面下方 ⇒ 填完之后滚过去，让用户看见自己点了什么
    chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  /** 发送一句话。 */
  const handleSend = useCallback((): void => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    void workspace.send(trimmed);
    setDraft('');
  }, [draft, workspace]);

  /** 新对话：建一个新的会话并切过去。 */
  const handleNewConversation = useCallback((): void => {
    setCreating(true);
    void workspace.newConversation().finally(() => {
      setCreating(false);
    });
  }, [workspace]);

  /** 打开「历史对话」时才去读会话列表。 */
  const handleHistoryOpen = useCallback((open: boolean): void => {
    setHistoryOpen(open);
    if (!open) {
      return;
    }
    setHistoryError(undefined);
    void listAiConversations()
      .then((rows) => {
        setConversations(Array.isArray(rows) ? rows : []);
      })
      .catch((error: unknown) => {
        setHistoryError(toMessage(error));
      });
  }, []);

  return (
    <div
      data-testid="ai-workspace-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.size,
        padding: token.padding,
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: token.size,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            AI 工作台
          </Typography.Title>
          <Typography.Text type="secondary">
            命令层受控写入 · 实时引用
          </Typography.Text>
        </div>
        <Space wrap>
          <Dropdown
            open={historyOpen}
            onOpenChange={handleHistoryOpen}
            // ⚠️ 默认是 hover ⇒ 触屏上点不开；这是个**按钮**，就该用 click。
            trigger={['click']}
            menu={{
              items:
                historyError !== undefined
                  ? [
                      {
                        key: 'history-error',
                        label: `历史对话读不到：${historyError}`,
                        disabled: true,
                      },
                    ]
                  : conversations.length === 0
                    ? [
                        {
                          key: 'history-empty',
                          label: '还没有历史对话',
                          disabled: true,
                        },
                      ]
                    : conversations.map((conversation) => ({
                        key: conversation.conversationId,
                        label:
                          conversation.title || conversation.conversationId,
                      })),
              onClick: ({ key }) => {
                setHistoryOpen(false);
                void workspace.switchConversation(key);
              },
            }}
          >
            <Button data-role="ai-history-button">历史对话</Button>
          </Dropdown>
          <Button
            type="primary"
            data-role="ai-new-conversation-button"
            loading={creating}
            onClick={handleNewConversation}
          >
            新对话
          </Button>
          {/*
            「返回」：浮层宿主是「收回小浮层」，路由页宿主是 `history.back()`。
            ⚠️ 两种宿主都**不重载页面** ⇒ 原界面原样还在。
          */}
          <Button data-role="ai-back-button" onClick={onBack}>
            返回
          </Button>
        </Space>
      </div>

      {/*
        当前模型：只显示这一个。
        ⚠️ **不画配额条** —— 服务端没有配额端点（规格 §4.3 明确裁决），
        没有数据源的进度条就是编的数字。
      */}
      <div
        data-role="ai-model"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: token.sizeXS,
          flexWrap: 'wrap',
          padding: `${token.paddingSM}px ${token.padding}px`,
          borderRadius: token.borderRadiusLG,
          background: token.colorFillQuaternary,
        }}
      >
        <span>当前模型：</span>
        <span style={{ fontFamily: token.fontFamilyCode }}>
          {workspace.model ?? '未知'}
        </span>
        <span
          style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}
        >
          （服务端没有模型列表端点，也没有配额端点 ⇒
          只显示当前模型；没有数据源就不画配额条）
        </span>
      </div>

      {/* AI 服务连不上时在这里说一声（不弹全局提示） */}
      {workspace.connectionError ? (
        <Alert
          type="error"
          showIcon
          data-role="ai-connection-error"
          title={`AI 服务未连接：${workspace.connectionError}`}
          action={
            <Button size="small" onClick={workspace.reconnect}>
              重试连接
            </Button>
          }
        />
      ) : null}

      {/*
        宽版对话。

        ⚠️ **对话区放在三视图上面**：这一页的主用途是**聊天**，
        而三视图（待确认 / 审计 / 规则分工）只是参考。先把对话放在前面，
        **打开就能聊** —— 发送按钮不用先滚过一屏才能看到。
        对话区自己有个视口相对的高度（`min(560px, 55vh)`，见 `WideChat`），
        消息在里面滚，输入区固定在面板底部 ⇒ 面板里只有一个滚动条。
      */}
      <div ref={chatRef}>
        {/* ⚠️ 「当前讨论」条：宽版也要看得见在聊哪条任务 */}
        <DiscussionBar
          context={aiBridge.context ?? null}
          onClear={() => {
            aiBridge.clearContext();
          }}
        />
        <WideChat
          messages={workspace.messages}
          thinking={workspace.thinking}
          pendingItems={workspace.pendingItems}
          draft={draft}
          onDraftChange={setDraft}
          onSend={handleSend}
          streaming={workspace.streaming}
          sending={workspace.sending}
          sendError={workspace.sendError}
          onRetry={() => {
            void workspace.retry();
          }}
          onStop={() => {
            void workspace.abort();
          }}
          stopping={workspace.aborting}
        />
      </div>

      {/* 工作台视图：待确认 / 审计 / 规则与 AI 的分工 */}
      <Tabs
        activeKey={view}
        onChange={(key) => {
          setView(key as WorkspaceView);
        }}
        items={[
          {
            key: 'pending',
            label: '待确认',
            children: (
              <div
                style={{
                  height: 360,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  overflow: 'hidden',
                }}
              >
                <PendingPanel
                  items={lists.pending}
                  loading={lists.pendingLoading}
                  error={lists.pendingError}
                  onApprove={(id) => {
                    void workspace.approvePending(id).then(() => {
                      lists.reload();
                    });
                  }}
                  onReject={(id) => {
                    void workspace.rejectPending(id).then(() => {
                      lists.reload();
                    });
                  }}
                />
              </div>
            ),
          },
          {
            key: 'audit',
            label: '审计',
            children: (
              <div
                style={{
                  height: 360,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  overflow: 'hidden',
                }}
              >
                <AuditPanel
                  items={lists.audit}
                  loading={lists.auditLoading}
                  error={lists.auditError}
                />
              </div>
            ),
          },
          {
            key: 'rules',
            label: '规则与 AI 的分工',
            children: <RuleSplit />,
          },
        ]}
      />

      {/* 10 类意图 */}
      <IntentGallery onPick={pickIntent} />
    </div>
  );
}
