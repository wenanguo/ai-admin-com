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
import { Tabs, theme } from 'antd';
import type React from 'react';
import { useState } from 'react';
import { AuditPanel } from './AuditPanel';
import { ChatPanel } from './ChatPanel';
import { PendingPanel } from './PendingPanel';
import { useAiLists } from './useAiLists';
import { useWorkspace } from './useWorkspace';

/** 页签。 */
export type WorkspaceTab = 'chat' | 'pending' | 'audit';

/** 侧栏的 props。 */
export interface AiWorkspaceProps {
  /** 默认选中的页签。 */
  defaultTab?: WorkspaceTab;
}

/**
 * AI 工作台侧栏。
 */
export function AiWorkspace({
  defaultTab = 'chat',
}: AiWorkspaceProps): React.ReactElement {
  const { token } = theme.useToken();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(defaultTab);
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
        <div style={{ fontWeight: 600 }}>AI 工作台</div>
        <div style={{ fontSize: token.fontSizeSM, opacity: 0.85 }}>
          对话 · 待确认 · 审计 ｜ 命令层受控写入
        </div>
      </div>
      <Tabs
        size="small"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as WorkspaceTab)}
        style={{ flex: 1, minHeight: 0 }}
        styles={{
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
