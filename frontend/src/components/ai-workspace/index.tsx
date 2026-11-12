/**
 * AI 工作台面板（规格 §3.1–§3.3）。
 *
 * 这一层是**容器**：头部 + 三个页签（对话 / 待确认 / 审计）。
 *
 * - **对话**页签的数据在 `useWorkspace` 里（会话 + 事件流）；
 * - **待确认**与**审计**两个页签的数据在 `useAiLists` 里（两个只读端点）。
 *
 * ⚠️ 这一层**不管自己怎么摆在外壳里**（是常驻右栏还是浮层）——
 * 摆法在外壳 `AiWorkspaceShell` 里；这里只管内容。
 */
import { CloseOutlined, FullscreenOutlined } from '@ant-design/icons';
import { useModel } from '@umijs/max';
import { Button, Tabs, Tag, theme } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  pendingChangedFields,
  pendingTaskId,
} from '@/services/api/ai/pendingArgs';
import { AiWorkspaceWide } from './AiWorkspaceWide';
import { AuditPanel } from './AuditPanel';
import { ChatPanel } from './ChatPanel';
import { DiscussionBar } from './DiscussionBar';
import { PendingPanel } from './PendingPanel';
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

/** 面板的 props。 */
export interface AiWorkspaceProps {
  /**
   * 默认选中的页签。
   *
   * ⚠️ 不传 ⇒ 用**存储里那个**（规格 §3.1 / U2：页签要持久化）。
   */
  defaultTab?: WorkspaceTab;
  /**
   * 「关闭面板」的回调（外壳传进来）。
   *
   * 给 ⇒ 头部右上角出那个「关闭」按钮（X）。
   */
  onCollapse?: () => void;
  /**
   * 「最大化」的回调（外壳传进来）。
   *
   * 给 ⇒ 头部左边出那个「全宽页」按钮。
   *
   * ⚠️ 这是**状态切换**，不是路由跳转 ⇒ 原页面不卸载、不刷新。
   */
  onExpandWide?: () => void;
  /**
   * 宽版还是窄版。
   *
   * ⚠️ **默认窄版**。宽版（`wide`）是「盖住内容区」的浮层内容。
   *
   * ## 为什么宽窄切换时这个组件**不卸载**
   *
   * 宽版与窄版**共用同一个 `useWorkspace` 实例**（就是这个组件里的那个）⇒
   * 切换时：
   * - 会话不变（不会开出第二个会话）；
   * - SSE 不断（不会重连、不会丢消息）；
   * - 正在流式输出的那条回答**不中断**。
   *
   * ⚠️ 反过来（各自 `useWorkspace()`）就会在切换的瞬间重连一次 ⇒
   *   消息区会闪一下、正在生成的回答会断。
   */
  variant?: 'narrow' | 'wide';
  /**
   * 宽版的「返回」回调。
   *
   * - 浮层宿主 ⇒ 收回小浮层；
   * - 路由页宿主 ⇒ `history.back()`。
   */
  onBack?: () => void;
}

/**
 * 读存储里的页签。
 *
 * 不认识的值（老版本留下的、被人改过的）⇒ 当「对话」，
 * 不能让一个坏值把面板弄成空白。
 */
function readStoredTab(): WorkspaceTab {
  const stored = readWorkspaceStorage().tab;
  return stored === 'pending' || stored === 'audit' ? stored : 'chat';
}

/**
 * AI 工作台面板。
 */
export function AiWorkspace({
  defaultTab,
  onCollapse,
  onExpandWide,
  variant = 'narrow',
  onBack,
}: AiWorkspaceProps): React.ReactElement {
  const { token } = theme.useToken();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    () => defaultTab ?? readStoredTab(),
  );
  const workspace = useWorkspace();
  // 当前讨论的上下文（任务页点「与 AI 讨论」时设的）
  const aiContext = useModel('ai-bridge');
  // ⚠️ **按需读**：页签没打开就不读那两个列表 ——
  // 面板是**浮层**（点开才挂载），一挂上就发请求会让 AI 服务不可达时
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
   * 「请切到对话页签」的信号（点「与 AI 讨论」时发）。
   *
   * ⚠️ 用户点完「讨论」就该**马上能说话** ⇒ 停在「待确认」「审计」页签上
   *    的话，输入框不在眼前 ⇒ 看起来像「点了没反应」。
   */
  useEffect(() => {
    if (aiContext.focusSignal === 0) {
      return;
    }
    setActiveTab('chat');
    writeWorkspaceStorage({ tab: 'chat' });
  }, [aiContext.focusSignal]);

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
        // ⚠️ 面板是**固定高度的浮层**（`AiWorkspaceShell` 里 `top: 56px; bottom: 0`），
        // 这里填满它 ⇒ 消息区在**面板内**滚，输入区固定在面板底。
        height: '100%',
        minHeight: 0,
        background: token.colorBgContainer,
      }}
    >
      {/*
        ⚠️ **宽版**（最大化）走另一套内容，但**共用上面那个 `workspace` 实例**
        ⇒ 切换时会话不变、SSE 不断、流式输出不断。
      */}
      {variant === 'wide' ? (
        <AiWorkspaceWide
          workspace={workspace}
          onBack={() => {
            onBack?.();
          }}
        />
      ) : (
        <>
          <div
            style={{
              padding: `${token.paddingSM}px ${token.padding}px`,
              // ⚠️ 头部**不铺蓝底**：面板整体已经是 `colorBgContainer`（白）
              //    ⇒ 头部跟内容同色，只靠下面那条分隔线区分层次（更安静，不抢内容的注意力）。
              background: token.colorBgContainer,
              color: token.colorText,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            {/*
          ⚠️ 头部只留**两个按钮**：左边「最大化」、右边「关闭」。

          之前这里还有一行副标题（「对话 · 待确认 · 审计 ｜ 命令层受控写入」）
          ⇒ 白占一条高度，把消息区挤没了。功能一样，只是不写了。

          ⚠️ 右边的按钮现在是**关闭**（面板是浮层，关掉就没了），
          以前是「收起」（常驻右栏收成 40px 竖条）。
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
            「最大化」的入口（规格 §4）：窄面板只有 400px，
            「规则与 AI 的分工」的双栏与意图卡片墙在那边放不下。

            ⚠️ **不是路由跳转**（以前是个 `<Link to="/ai/workspace">`）
            ⇒ 点它会**替换掉原页面**，再返回时原页面重新挂载 ⇒ 看着像「刷新」。
            ⇒ 改成**回调**：宿主把面板换成宽版浮层，**原页面不卸载**。
          */}
              {onExpandWide ? (
                <Button
                  type="text"
                  size="small"
                  data-role="ai-workspace-expand-button"
                  title="最大化"
                  aria-label="最大化"
                  icon={<FullscreenOutlined />}
                  onClick={onExpandWide}
                  style={{ color: token.colorText }}
                />
              ) : null}
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
                  aria-label="关闭 AI 工作台"
                  title="关闭 AI 工作台（⌘B）"
                  icon={<CloseOutlined />}
                  onClick={onCollapse}
                  style={{ color: token.colorText }}
                />
              ) : null}
            </div>
          </div>
          {/*
        「当前讨论」条：**常驻在头部下面**（三个页签都在）。

        ⚠️ 之前它只在**对话**页签里 ⇒ 用户停在「待确认」「审计」页签时
        完全看不到 ⇒ 表现为「点了讨论，AI 工作台一点反应都没有」。
      */}
          <DiscussionBar
            context={aiContext.context ?? null}
            onClear={() => {
              aiContext.clearContext();
            }}
          />
          {/*
        会话建不起来（AI 服务不可达）——**显示在这里**，不弹全局提示：
        面板是**浮层**（用户主动点开的），全局提示只会在他打开时出现一次。
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
            padding-left = 0，三个页签的标题会**贴着面板的左边缘**，
            看上去像没渲染完（实测三个页签的 x 分别是 1458 / 1518 / 1592，
            而面板的 x = 1457 —— 第一个页签正好压在线上）。
            `header` 落到的就是 `.ant-tabs-nav`。
          */
              header: { paddingInline: token.paddingSM },
              /*
            高度链（实测出来的）：
              .ant-tabs → .ant-tabs-body-holder → .ant-tabs-body → .ant-tabs-content
            面板是固定高度的浮层 ⇒ 这里要**给一个确定的高度**并**藏掉溢出**，
            否则内容会把面板撑破、溢出到面板外（消息就从「面板内滚」变成了「溢出到页面」）。
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
        </>
      )}
    </div>
  );
}
