/**
 * AI 工作台侧栏（规格 §3.1–§3.3）。
 *
 * 这一层是**容器**：头部 + 三个页签（对话 / 待确认 / 审计）。
 *
 * - **对话**页签这一刀做完了（`ChatPanel`）；
 * - **待确认**与**审计**两个页签是下一刀的事（服务端的只读端点已经就绪，
 *   这里先占个位，别画还没接上的按钮）。
 *
 * ⚠️ 侧栏**不是 Drawer**（规格 §3.1 明确否决了抽屉）——
 * 挂进布局是下一刀的事（`Layout.Sider`，宽 400，可折叠到 40）。
 */
import { Empty, Tabs, theme } from 'antd';
import type React from 'react';
import { useState } from 'react';
import { ChatPanel } from './ChatPanel';
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
              <Empty
                description="批量与破坏性操作会先在这里等你点头"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          },
          {
            key: 'audit',
            label: '审计',
            children: (
              <Empty
                description="AI 的每次写入都会记在这里"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
