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
import { Link } from '@umijs/max';
import { Button, Tabs, Tag, theme } from 'antd';
import type React from 'react';
import { useState } from 'react';
import { AuditPanel } from './AuditPanel';
import { ChatPanel } from './ChatPanel';
import { PendingPanel } from './PendingPanel';
import { AI_WORKSPACE_PAGE_PATH } from './paths';
import { readWorkspaceStorage, writeWorkspaceStorage } from './storage';
import { useAiLists } from './useAiLists';
import { useWorkspace } from './useWorkspace';

/** 页签。 */
export type WorkspaceTab = 'chat' | 'pending' | 'audit';

/** 侧栏的 props。 */
export interface AiWorkspaceProps {
  /**
   * 默认选中的页签。
   *
   * ⚠️ 不传 ⇒ 用**存储里那个**（规格 §3.1 / U2：页签要持久化）。
   */
  defaultTab?: WorkspaceTab;
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
}: AiWorkspaceProps): React.ReactElement {
  const { token } = theme.useToken();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    () => defaultTab ?? readStoredTab(),
  );
  const workspace = useWorkspace();
  // ⚠️ **按需读**：页签没打开就不读那两个列表 ——
  // 侧栏挂在整个布局上（Task 4），一挂上就发请求会让 AI 服务不可达时
  // 用户在别的页面上莫名其妙看到报错。
  const lists = useAiLists({
    pending: activeTab === 'pending',
    audit: activeTab === 'audit',
  });

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
          // ⚠️ 右边留出 40px：折叠按钮（`AiWorkspaceLayout` 里那个绝对定位的按钮）
          // 就在这一块的右上角 ⇒ 不留白的话链接会被它压住。
          paddingRight: 40,
          background: token.colorPrimary,
          color: token.colorTextLightSolid,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: token.sizeXS,
          }}
        >
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
          {/*
            进全宽页的入口（规格 §4）：侧栏只有 400px，
            「规则与 AI 的分工」的双栏与意图卡片墙在那边放不下。
          */}
          <Link
            to={AI_WORKSPACE_PAGE_PATH}
            data-role="ai-workspace-full-page-link"
            style={{
              color: token.colorTextLightSolid,
              fontSize: token.fontSizeSM,
            }}
          >
            全宽页
          </Link>
        </div>
        <div style={{ fontSize: token.fontSizeSM, opacity: 0.85 }}>
          对话 · 待确认 · 审计 ｜ 命令层受控写入
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
                streaming={workspace.streaming}
                sending={workspace.sending}
                sendError={workspace.sendError}
                onSend={(text) => {
                  void workspace.send(text);
                }}
                onRetry={() => {
                  void workspace.retry();
                }}
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
