/**
 * AI 工作台**全宽页**（规格 §4）。
 *
 * 路由 `/ai/workspace`。
 *
 * ## 为什么要有这一页
 *
 * 侧栏只有 400px —— 「规则与 AI 的分工」的双栏说明、10 类意图卡片墙
 * 与宽一点的对话都塞不下（规格 §4 的原话）。
 *
 * ## 这一页的会话与侧栏是**同一个**
 *
 * 会话 id 存在 `localStorage['aipm.workspace']` 里 ⇒ 两边共用一个会话。
 * ⚠️ 侧栏在**这一页上不挂**（见 `AiWorkspaceLayout`）——
 * 两个 `useWorkspace` 实例会各建一个会话（还会互相覆盖存储里的会话 id）。
 *
 * ## 页面只说服务端给得出的话
 *
 * - **不画配额条**：服务端没有配额端点 ⇒ 没有数据源就不画假数字（规格 §4.3）。
 * - **ETA 只写 burndown**：后端没有依赖图接口 ⇒ 没有关键路径、没有 P50/P90。
 * - **意图卡片标「暂未开放」**：AI 服务当前只有 `create_task` 一条命令。
 */
import { history } from '@umijs/max';
import { Alert, Button, Dropdown, Space, Tabs, Typography, theme } from 'antd';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { AuditPanel } from '@/components/ai-workspace/AuditPanel';
import { PendingPanel } from '@/components/ai-workspace/PendingPanel';
import { useAiLists } from '@/components/ai-workspace/useAiLists';
import { useWorkspace } from '@/components/ai-workspace/useWorkspace';
import { listAiConversations } from '@/services/api/ai/client';
import type { AiConversation } from '@/services/api/ai/types';
import { IntentGallery } from './IntentGallery';
import { RuleSplit } from './RuleSplit';
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

/**
 * AI 工作台全宽页。
 */
export default function AiWorkspacePage(): React.ReactElement {
  const { token } = theme.useToken();
  const workspace = useWorkspace();
  const [view, setView] = useState<WorkspaceView>('rules');
  /**
   * ⚠️ **按需读**：待确认与审计都是只读端点，页签没打开就不读
   * （跟侧栏一个规矩，见 `useAiLists` 的注释）。
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
            这一页上侧栏是让开的 ⇒ 得给用户一条回去的路。
          */}
          <Button
            data-role="ai-back-button"
            onClick={() => {
              history.back();
            }}
          >
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
          message={`AI 服务未连接：${workspace.connectionError}`}
          action={
            <Button size="small" onClick={workspace.reconnect}>
              重试连接
            </Button>
          }
        />
      ) : null}

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

      {/* 宽版对话 */}
      <div ref={chatRef}>
        <WideChat
          messages={workspace.messages}
          draft={draft}
          onDraftChange={setDraft}
          onSend={handleSend}
          streaming={workspace.streaming}
          sending={workspace.sending}
          sendError={workspace.sendError}
          onRetry={() => {
            void workspace.retry();
          }}
        />
      </div>
    </div>
  );
}
