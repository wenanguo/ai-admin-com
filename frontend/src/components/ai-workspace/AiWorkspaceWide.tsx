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
 *
 * ## 骨架：两栏
 *
 * - **左边**：对话（这一页的主用途）；
 * - **右边**：360px 的侧栏（待确认 / 审计 / 规则与 AI 的分工）。
 *
 * ⚠️ **意图卡片不在页面底部了**（它在输入框上方的抽屉里，见 `WideChat`
 *    的 `intentSlot`）⇒ 页面内容不再比视口高 ⇒ 整页不用滚。
 */
import { InfoCircleOutlined } from '@ant-design/icons';
import { useModel } from '@umijs/max';
import {
  Alert,
  Button,
  Dropdown,
  Space,
  Tabs,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type React from 'react';
import { useCallback, useState } from 'react';
import { listAiConversations } from '@/services/api/ai/client';
import type { AiConversation } from '@/services/api/ai/types';
import { AuditPanel } from './AuditPanel';
import { DiscussionBar } from './DiscussionBar';
import { IntentGallery } from './IntentGallery';
import { AI_INTENTS } from './intents';
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

  /** 点意图卡片：只把问句填进输入框，**不发送**；并把抽屉收起来。 */
  const handlePickIntent = useCallback(
    (example: string, close: () => void): void => {
      setDraft(example);
      // 抽屉就在输入框上方 ⇒ 不用滚，填完直接收起就行
      close();
    },
    [],
  );

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
        // ⚠️ **高度链**：它是 `AiWorkspace` 根（flex 列）的子项
        //    ⇒ 靠 `flex: 1 1 0%` 吃满，比只写 `height: 100%` 更稳。
        //    `height: 100%` 也留着（路由页那条链靠它）。
        height: '100%',
        flex: '1 1 0%',
        // ⚠️ **兜底**：高度链万一塌了（某个宿主没给出确定高度），
        //    整页不至于塌成一条 ⇒ 至少 320px 高。
        minHeight: 320,
        // ⚠️ **滚动**：意图卡片墙已经折进抽屉（不在文档流里），对话区又吃满了
        //    剩余高度 ⇒ 内容**装得下** ⇒ `auto` **不会**出现滚动条 ⇒ 整页不用滚。
        //    （中间那一行、对话区、侧栏各自内部滚。）
        // ⚠️ 这里保留 `auto` 而不是 `hidden`：根容器还有 `minHeight: 320` 兜底 ⇒
        //    宿主比 320px 还矮时，根容器比宿主高 ⇒ 用 `hidden` 会把内容**裁掉**、
        //    连滚动条都没有 ⇒ 发送按钮够不着。用 `auto` 则仍能滚到输入框。
        overflowY: 'auto',
        overflowX: 'hidden',
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

        ⚠️ 那句解释**收进 tooltip**：它是写给开发者看的（解释为什么不画配额条）
        ⇒ 不该在页面上占一整行 ⇒ 想看的人 hover 一下 ⓘ 就看到。
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
        <Tooltip
          title="（服务端没有模型列表端点，也没有配额端点 ⇒ 只显示当前模型；没有数据源就不画配额条）"
          mouseEnterDelay={0.1}
        >
          <span
            data-role="ai-model-note"
            role="img"
            aria-label="为什么只显示当前模型"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'help',
              color: token.colorTextTertiary,
            }}
          >
            <InfoCircleOutlined />
          </span>
        </Tooltip>
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
        **两栏**：左边对话，右边 360px 的侧栏（待确认 / 审计 / 规则分工）。

        ⚠️ 这一行**吃满剩余高度**（`flex: 1 1 0%`）⇒ 整页不滚：
           意图卡片墙已经折进输入框上方的抽屉（不在文档流里了），
           剩下的内容（头部 + 模型条 + 这一行）正好是视口高度。
        ⚠️ 对话区也**吃满这一行**（`WideChat` 里的 `flex: 1 1 0%`）
           ⇒ 它的底边**贴着内容区底边** ⇒ 「一屏铺满」。
      */}
      <div
        style={{
          display: 'flex',
          gap: token.size,
          flex: '1 1 0%',
          minHeight: 0,
        }}
      >
        {/*
        宽版对话（左边这一栏）。

        ⚠️ **对话区是主页面的主用途**：左边整列都留给它，
        右边那 360px 才是参考用的三视图（待确认 / 审计 / 规则分工）。
        ⚠️ 左列是**纵向 flex** ⇒ 「当前讨论」条（`flexShrink: 0`）
        与对话区（`flex: 1 1 0%`）上下排 ⇒ 对话区吃满剩下的高度。
      */}
        <div
          data-role="ai-wide-chat-column"
          style={{
            flex: '1 1 0%',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/*
            ⚠️ 「当前讨论」条：宽版也要看得见在聊哪条任务。

            ⚠️ 包一层 `flexShrink: 0`：它是对话区**上面**的一块
            ⇒ 对话区吃满剩余高度时，**不能把它压扁**。
          */}
          <div style={{ flexShrink: 0 }}>
            <DiscussionBar
              context={aiBridge.context ?? null}
              onClear={() => {
                aiBridge.clearContext();
              }}
            />
          </div>
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
            /*
              意图卡片折进**输入框上方的抽屉**（不再是页面底部铺开的一片）。

              ⚠️ render prop：`WideChat` 掌握抽屉的开合 ⇒ 收起动作由它给。
            */
            intentSlot={(close) => (
              <IntentGallery
                onPick={(example) => {
                  handlePickIntent(example, close);
                }}
              />
            )}
            intentCount={AI_INTENTS.length}
          />
        </div>

        {/*
        右侧栏：工作台视图（待确认 / 审计 / 规则与 AI 的分工）。

        ⚠️ 固定 **360px** 窄栏 ⇒ 对话区不会被挤没（内容区窄时怎么办，
        见 Task 5：那时候侧栏改成抽屉）。
        */}
        <aside
          data-role="ai-wide-sidebar"
          style={{
            width: 360,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Tabs
            activeKey={view}
            onChange={(key) => {
              setView(key as WorkspaceView);
            }}
            style={{ flex: '1 1 0%', minHeight: 0 }}
            styles={{
              /*
            ⚠️ 高度链（与窄面板那套一样）：
              .ant-tabs → .ant-tabs-body-holder → .ant-tabs-body → .ant-tabs-content
            侧栏是**确定高度**的 ⇒ 这里给一个确定的高度并藏掉溢出，
            否则内容会溢出到侧栏外面。
            `body` 给 `.ant-tabs-body`、`content` 给页签面板。
          */
              body: { height: '100%' },
              content: {
                height: '100%',
                overflow: 'hidden',
                // ⇒ 页签面板是 flex 列 ⇒ 里面的内容能吃满面板高度。
                display: 'flex',
                flexDirection: 'column',
              },
            }}
            items={[
              {
                key: 'pending',
                label: '待确认',
                children: (
                  <div
                    style={{
                      flex: '1 1 0%',
                      minHeight: 0,
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
                      flex: '1 1 0%',
                      minHeight: 0,
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
                children: (
                  <div
                    style={{
                      flex: '1 1 0%',
                      minHeight: 0,
                      // ⚠️ 这一块**自己滚**：`RuleSplit` 内部没有滚动区
                      //    ⇒ 不给它滚动区的话，360px 窄栏里下半截看不到。
                      // ⚠️ `overflowX` 也写上：只写 `overflowY: auto` 时，
                      //    CSS 会把 `overflowX` 算成 `auto` ⇒ 一段长的不可断字符串
                      //    会多出一条横向滚动条。
                      overflowY: 'auto',
                      overflowX: 'hidden',
                    }}
                  >
                    {/* 侧栏窄 ⇒ 两栏并排放不下 ⇒ 上下堆叠 */}
                    <RuleSplit stacked />
                  </div>
                ),
              },
            ]}
          />
        </aside>
      </div>
    </div>
  );
}
