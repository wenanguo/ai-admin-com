/**
 * AI 工作台侧栏（规格 §3.1–§3.3）。
 *
 * 这一层是**容器**：头部 + 三个页签（对话 / 待确认 / 审计）。
 *
 * - **对话**页签的数据在 `useWorkspace` 里（会话 + 事件流）；
 * - **待确认**与**审计**两个页签的数据在 `useAiLists` 里（两个只读端点）。
 *
 * ⚠️ 侧栏**不是 Drawer**（规格 §3.1 明确否决了抽屉）——
 * 挂进布局是下一刀的事（`Layout.Sider`，宽 400，可折叠到 40）。
 */
import { FullscreenOutlined, RightOutlined } from '@ant-design/icons';
import { Link, useModel } from '@umijs/max';
import { Button, Tabs, Tag, theme } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  pendingChangedFields,
  pendingTaskId,
} from '@/services/api/ai/pendingArgs';
import { AuditPanel } from './AuditPanel';
import { ChatPanel } from './ChatPanel';
import { PendingPanel } from './PendingPanel';
import { AI_WORKSPACE_PAGE_PATH } from './paths';
import { readWorkspaceStorage, writeWorkspaceStorage } from './storage';
import { useAiLists } from './useAiLists';
import { useWorkspace } from './useWorkspace';

/** 页签。 */
export type WorkspaceTab = 'chat' | 'pending' | 'audit';

/**
 * 批准之后**多久**通知任务页刷新（毫秒）。
 *
 * ⚠️ 不能是 0 —— 批准只是唤醒闸门，工具随后才执行、才落库
 *    ⇒ 立刻查列表会读到**旧值**。
 */
const APPROVE_REFRESH_DELAY_MS = 800;

/** 侧栏的 props。 */
export interface AiWorkspaceProps {
  /**
   * 默认选中的页签。
   *
   * ⚠️ 不传 ⇒ 用**存储里那个**（规格 §3.1 / U2：页签要持久化）。
   */
  defaultTab?: WorkspaceTab;
  /**
   * 「收起面板」的回调（外壳传进来）。
   *
   * 给 ⇒ 头部右上角出那个「收起」按钮。
   */
  onCollapse?: () => void;
}

/**
 * 读存储里的页签。
 *
 * 不认识的值（老版本留下的、被人改过的）⇒ 当「对话」，
 * 不能让一个坏值把侧栏弄成空白。
 */
function readStoredTab(): WorkspaceTab {
  const stored = readWorkspaceStorage().tab;
  return stored === 'pending' || stored === 'audit' ? stored : 'chat';
}

/**
 * AI 工作台侧栏。
 */
export function AiWorkspace({
  defaultTab,
  onCollapse,
}: AiWorkspaceProps): React.ReactElement {
  const { token } = theme.useToken();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    () => defaultTab ?? readStoredTab(),
  );
  const workspace = useWorkspace();
  // 当前讨论的上下文（任务页点「与 AI 讨论」时设的）
  const aiContext = useModel('ai-bridge');
  // ⚠️ **按需读**：页签没打开就不读那两个列表 ——
  // 侧栏挂在整个布局上（Task 4），一挂上就发请求会让 AI 服务不可达时
  // 用户在别的页面上莫名其妙看到报错。
  const lists = useAiLists({
    pending: activeTab === 'pending',
    audit: activeTab === 'audit',
  });

  /**
   * **新的待确认到达 ⇒ 列表要重读**。
   *
   * ⚠️ 待确认列表是「页签打开时读一次」⇒ 页签一直开着时，AI 新挂起的
   *   那一条**不会自己出现** ⇒ 用户看不到「等待你确认」。
   * ⇒ SSE 推来 pending 事件时（pendingItems 变了）就重读一次。
   */
  const pendingCount = workspace.pendingItems.length;
  useEffect(() => {
    if (pendingCount === 0) {
      return;
    }
    lists.reload();
  }, [pendingCount, lists.reload]);

  /**
   * 批准一条挂起的修改 ⇒ **确定**要刷新哪一行。
   *
   * ## 为什么不能只靠服务端的 `entity_updated`
   *
   * 那个事件走 SSE ⇒ 断线重连时**不会重放** ⇒ 可能丢
   * ⇒ 用户看到的是「AI 说改好了，左边却没动」。
   * ⇒ 而「用户点了确认执行」这件事是**确定**的 ⇒ 由前端自己发刷新信号。
   *
   * ## 为什么还要延迟一下
   *
   * 批准只是**唤醒**闸门里的等待者 ⇒ 工具随后才真正执行 ⇒ 写还没落库
   * ⇒ 立刻查列表会读到旧值 ⇒ 延迟 {@link APPROVE_REFRESH_DELAY_MS} 再通知。
   */
  const refreshAfterApprove = useCallback(
    (id: string) => {
      const item = lists.pending.find((row) => row.id === id);
      const args = item?.args as Record<string, unknown> | undefined;
      const taskId = pendingTaskId({ command: item?.command, args });
      if (taskId === undefined) {
        return;
      }
      const fields = pendingChangedFields(
        { command: item?.command, args },
        aiContext.context?.task,
      );
      setTimeout(() => {
        aiContext.notifyUpdate({
          entityType: 'task',
          entityId: taskId,
          fields,
        });
      }, APPROVE_REFRESH_DELAY_MS);
    },
    [aiContext, lists.pending],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // ⚠️ 侧栏是**固定高度的一列**（`AiWorkspaceLayout` 里 `calc(100vh - 顶边)`），
        // 这里填满它 ⇒ 消息区在**列内**滚，输入区固定在列底。
        height: '100%',
        minHeight: 0,
        background: token.colorBgContainer,
      }}
    >
      <div
        style={{
          padding: `${token.paddingSM}px ${token.padding}px`,
          background: token.colorPrimary,
          color: token.colorTextLightSolid,
        }}
      >
        {/*
          ⚠️ 头部只留**两个按钮**：左边「全宽页」、右边「收起」。

          之前这里还有一行副标题（「对话 · 待确认 · 审计 ｜ 命令层受控写入」）
          ⇒ 白占一条高度，把消息区挤没了。功能一样，只是不写了。
        */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: token.sizeXS,
          }}
        >
          {/*
            进全宽页的入口（规格 §4）：侧栏只有 400px，
            「规则与 AI 的分工」的双栏与意图卡片墙在那边放不下。
          */}
          <Link
            to={AI_WORKSPACE_PAGE_PATH}
            data-role="ai-workspace-full-page-link"
            title="全宽页"
            aria-label="全宽页"
            style={{ display: 'inline-flex', color: token.colorTextLightSolid }}
          >
            <Button
              type="text"
              size="small"
              icon={<FullscreenOutlined />}
              style={{ color: token.colorTextLightSolid }}
            />
          </Link>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: token.sizeXS,
              fontWeight: 600,
            }}
          >
            AI 工作台
            {/*
              ⚠️ **AI 服务不可用**要看得见（规格 §3.10 / U6）：
              事件流断了（比如 token 过期）时，对话会**静默死掉**，
              用户只会以为「AI 不理我了」。
              这个标签就是那句「它坏了，而且我们知道了」。
            */}
            {workspace.aiUnavailable ? (
              <Tag
                color="error"
                data-role="ai-unavailable-tag"
                style={{ marginInlineEnd: 0 }}
              >
                AI 服务不可用
              </Tag>
            ) : null}
          </span>
          {onCollapse ? (
            <Button
              type="text"
              size="small"
              aria-label="收起 AI 工作台"
              title="收起 AI 工作台（⌘B）"
              icon={<RightOutlined />}
              onClick={onCollapse}
              style={{ color: token.colorTextLightSolid }}
            />
          ) : null}
        </div>
      </div>
      {/*
        会话建不起来（AI 服务不可达）——**显示在这里**，不弹全局提示：
        侧栏常驻在每个页面上，全局提示会在每个页面上重复出现。
      */}
      {workspace.connectionError ? (
        <div
          data-role="ai-connection-error"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: token.sizeXS,
            padding: `${token.paddingSM}px ${token.padding}px`,
            fontSize: token.fontSizeSM,
            color: token.colorWarning,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <span>AI 服务未连接：{workspace.connectionError}</span>
          {/*
            重试入口：只提示不给出路是不行的（用户没法自己恢复）。
            重连 = 重跑一遍「建会话」的流程；会话 id 建出来后事件流会自动订阅。
          */}
          <Button
            size="small"
            type="link"
            onClick={() => {
              workspace.reconnect();
            }}
          >
            重试连接
          </Button>
        </div>
      ) : null}
      <Tabs
        size="small"
        activeKey={activeTab}
        onChange={(key) => {
          const tab = key as WorkspaceTab;
          setActiveTab(tab);
          // ⚠️ 页签要**持久化**（规格 §3.1 / U2）：
          //    刷新页面后还停在刚才那个页签，不要每次都跳回「对话」。
          writeWorkspaceStorage({ tab });
        }}
        style={{ flex: 1, minHeight: 0 }}
        styles={{
          /*
            ⚠️ 页签条要**自己留左右内边距**。
            antd 的 Tabs 根节点没有内边距 ⇒ 实测 `.ant-tabs-nav` 的
            padding-left = 0，三个页签的标题会**贴着 Sider 的左边缘**，
            看上去像没渲染完（实测三个页签的 x 分别是 1458 / 1518 / 1592，
            而 Sider 的 x = 1457 —— 第一个页签正好压在线上）。
            `header` 落到的就是 `.ant-tabs-nav`。
          */
          header: { paddingInline: token.paddingSM },
          /*
            高度链（实测出来的）：
              .ant-tabs → .ant-tabs-body-holder → .ant-tabs-body → .ant-tabs-content
            侧栏是固定高度的一列 ⇒ 这里要**给一个确定的高度**并**藏掉溢出**，
            否则内容会把面板撑破、溢出到列外（消息就从「列内滚」变成了「溢出到页面」）。
            `body` 给 `.ant-tabs-body`、`content` 给 `.ant-tabs-content`。
          */
          content: { height: '100%', overflow: 'hidden' },
          body: { height: '100%' },
        }}
        items={[
          {
            key: 'chat',
            label: '对话',
            children: (
              <ChatPanel
                messages={workspace.messages}
                context={aiContext.context}
                onClearContext={aiContext.clearContext}
                thinking={workspace.thinking}
                pendingItems={workspace.pendingItems}
                streaming={workspace.streaming}
                sending={workspace.sending}
                sendError={workspace.sendError}
                onSend={(text) => {
                  void workspace.send(text);
                }}
                onRetry={() => {
                  void workspace.retry();
                }}
                onStop={() => {
                  void workspace.abort();
                }}
                stopping={workspace.aborting}
              />
            ),
          },
          {
            key: 'pending',
            label: '待确认',
            children: (
              <PendingPanel
                items={lists.pending}
                loading={lists.pendingLoading}
                error={lists.pendingError}
                onApprove={(id) => {
                  void workspace.approvePending(id).then(() => {
                    lists.reload();
                    refreshAfterApprove(id);
                  });
                }}
                onReject={(id) => {
                  void workspace.rejectPending(id).then(() => {
                    lists.reload();
                  });
                }}
              />
            ),
          },
          {
            key: 'audit',
            label: '审计',
            children: (
              <AuditPanel
                items={lists.audit}
                loading={lists.auditLoading}
                error={lists.auditError}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
