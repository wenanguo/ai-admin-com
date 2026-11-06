/**
 * AI 工作台的**布局外壳**（规格 §3.1）。
 *
 * ## 为什么不是抽屉
 *
 * 规格 §3.1 明确否决了 `Drawer`：抽屉盖住主内容，而且「任务栏宽度不可控」。
 * ⇒ 这里用 antd 的 `Layout.Sider`：**常驻的一列**。
 * 折叠时收成 40px 的竖条，**主内容跟着收窄**（不是盖一块上去）。
 *
 * ## 折叠状态
 *
 * - `⌘B` / `Ctrl+B` 切换（原型已有的约定，保留）；
 * - 状态存在 `localStorage['aipm.workspace']` 的 `collapsed` 字段（见 `storage.ts`）；
 * - 输入框里**不劫持**快捷键（那里 `Ctrl+B` 是加粗）。
 *
 * ## 窄屏自动收起（规格 §3.1 的「不能让侧栏把内容挤没了」）
 *
 * 400px 的常驻右栏在窄屏上会把主内容压到 ProTable 搜索表单的断点（576px）以下。
 * ⇒ 用 antd 自己的 `Layout.Sider` 的 `breakpoint`（`xl` = 1200px）：
 * 视口窄于 1200px 时**自动收成 40px 的竖条**，主内容不被挤扁；
 * 用户仍然可以随时点竖条把它展开（展开只是这一次的内容被挤扁）。
 *
 * ## 为什么单独一个组件
 *
 * `src/app.tsx` 的 `childrenRender` 只负责「把它挂上去」，
 * 折叠、快捷键、持久化这些逻辑都在这里 —— 于是它们可以被单测钉住。
 */
import { RightOutlined, RobotOutlined } from '@ant-design/icons';
import { useLocation } from '@umijs/max';
import { Button, Layout, theme } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiWorkspace } from './index';
import { AI_WORKSPACE_PAGE_PATH } from './paths';
import { readWorkspaceStorage, writeWorkspaceStorage } from './storage';

const { Sider } = Layout;

/** 展开时的宽度（规格 §3.1：宽 400）。 */
export const AI_WORKSPACE_WIDTH = 400;

/** 折叠后的宽度（规格 §3.1：40px 的竖条）。 */
export const AI_WORKSPACE_COLLAPSED_WIDTH = 40;

/**
 * 窄屏自动收起的断点（antd 的栅格断点）。
 *
 * `xl` = 1200px：视口窄于它时侧栏自动收成竖条（antd 的 `Sider.breakpoint`）。
 */
export const AI_WORKSPACE_BREAKPOINT = 'xl';

/**
 * antd `Layout.Sider` 回调折叠时的原因（与 antd 的 `CollapseType` 一致）。
 *
 * `responsive` = 视口跨过断点时 antd 自己改的；`clickTrigger` = 用户点了触发器。
 */
type SiderCollapseReason = 'clickTrigger' | 'responsive';

/**
 * 事件目标是不是可编辑元素。
 *
 * 输入框里按 `Ctrl+B` 是「加粗」，不该顺手把侧栏折了。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/** 折叠后的竖条（图标 + 竖排「AI 工作台」）。 */
interface CollapsedStripProps {
  /** 点一下展开。 */
  onExpand: () => void;
}

/**
 * 折叠后的 40px 竖条。
 *
 * 整条就是一个按钮 —— 竖条只有 40px 宽，再塞一个按钮会挤。
 */
function CollapsedStrip({ onExpand }: CollapsedStripProps): React.ReactElement {
  const { token } = theme.useToken();
  return (
    <button
      type="button"
      data-testid="ai-workspace-strip"
      title="展开 AI 工作台（⌘B）"
      onClick={onExpand}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: token.sizeSM,
        padding: `${token.paddingSM}px 0`,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <RobotOutlined style={{ fontSize: 16, color: token.colorPrimary }} />
      <span
        style={{
          writingMode: 'vertical-rl',
          letterSpacing: 2,
          fontSize: token.fontSizeSM,
          color: token.colorTextSecondary,
        }}
      >
        AI 工作台
      </span>
    </button>
  );
}

/** 布局外壳的 props。 */
export interface AiWorkspaceLayoutProps {
  /** 主内容（页面）。 */
  children?: React.ReactNode;
}

/**
 * AI 工作台的布局外壳：主内容左边，AI 工作台常驻右边。
 *
 * @param props 主内容。
 */
export function AiWorkspaceLayout({
  children,
}: AiWorkspaceLayoutProps): React.ReactElement {
  const { token } = theme.useToken();
  const location = useLocation();
  /**
   * 全宽页上**不挂侧栏**。
   *
   * ## 为什么
   *
   * 1. **宽度**：这一页要放「规则与 AI 的分工」的双栏、意图卡片墙与宽版对话，
   *    400px 的侧栏会把它们挤扁（规格 §4 的落点就是「侧栏装不下」）。
   * 2. **会话不打架**：侧栏是常驻在**整个布局**上的（`src/app.tsx` 的
   *    `childrenRender`）⇒ 侧栏与页面各挂一个 `useWorkspace` 时，
   *    两个实例会**各建一个会话**（两边界面各说各话，还会在
   *    `localStorage` 里互相覆盖）。
   *    侧栏让开 ⇒ 这一页上只有一个会话实例。
   *
   * ⚠️ 会话**仍然是同一个**：页面用的也是 `aipm.workspace` 这个存储键 ⇒
   * 在别的页面用侧栏聊的会话，切到这一页还在（反之亦然）。
   */
  const isFullWidthPage = location.pathname === AI_WORKSPACE_PAGE_PATH;
  const [collapsed, setCollapsed] = useState<boolean>(
    () => readWorkspaceStorage().collapsed === true,
  );
  /**
   * 组件挂载了吗（用来分辨 antd 的「挂载时对齐断点」与「真的跨过断点」）。
   *
   * ⚠️ 子组件的 effect 先于父组件的 effect 跑 ⇒ Sider 挂载时的那次
   * 响应式回调到达时，这个 ref 还是 false。
   */
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  /** 折叠 / 展开，并把状态写进 localStorage。 */
  const toggle = useCallback((): void => {
    setCollapsed((previous) => {
      const next = !previous;
      writeWorkspaceStorage({ collapsed: next });
      return next;
    });
  }, []);

  // ⌘B / Ctrl+B 切换
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'b') {
        return;
      }
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      // ⌘⇧B 是浏览器的「显示书签栏」，不抢
      if (event.shiftKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toggle]);

  // 窄屏（< 1200px）自动收成竖条：侧栏不能把主内容挤没了。
  //
  // ⚠️ antd 的 `Sider` 在**挂载时**就会把折叠状态对齐到断点
  // （`collapsed !== mql.matches` ⇒ 回调 `onCollapse(matches, 'responsive')`）。
  // 那会把「用户自己收起来的侧栏」在刷新后强行展开 ⇒ 挂载时**要展开**的那一次不照做；
  // **要收起**的那一次照做（窄屏上侧栏必须让开）。
  // 自动收起**不写进 localStorage** —— 那是响应式行为，不是用户的选择。
  const handleCollapse = useCallback(
    (next: boolean, reason: SiderCollapseReason): void => {
      if (reason === 'responsive' && !next && !mountedRef.current) {
        return;
      }
      setCollapsed(next);
    },
    [],
  );

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
      {/*
        主内容：侧栏收窄时这一列跟着窄。

        ⚠️ `overflowX: 'auto'`：表格比这一列宽时（列很多的老页面），
        在**这一列里**横向滚动 —— 不能让它溢出到 AI 侧栏底下，
        那样「操作」列的按钮就点不到了。
      */}
      <div
        data-testid="ai-workspace-content"
        style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}
      >
        {children}
      </div>
      {isFullWidthPage ? null : (
        <Sider
          data-testid="ai-workspace-sider"
          width={AI_WORKSPACE_WIDTH}
          collapsedWidth={AI_WORKSPACE_COLLAPSED_WIDTH}
          collapsible
          collapsed={collapsed}
          onCollapse={handleCollapse}
          trigger={null}
          theme="light"
          // 窄屏（< 1200px）自动收成竖条：侧栏不能把主内容挤没了。
          // ⚠️ 自动收起**不写进 localStorage** —— 那是响应式行为，不是用户的选择。
          breakpoint={AI_WORKSPACE_BREAKPOINT}
          style={{
            /*
              ⚠️ **不锁高度**。

              之前这里是 `height: calc(100vh - ${stickyTop}px)`：侧栏是**固定高度**的一列，
              消息区在里面自己滚 ⇒ 屏幕上有**两个滚动条**（页面滚主内容 + 侧栏滚消息），
              操作感受很差；而且消息一多，那个内层滚动条就变得很必要、很显眼。

              现在：侧栏**跟着内容长高**（消息多就长高），页面滚一次就够 ⇒ **只有一个滚动条**。
              输入区在侧栏内部 **sticky 在视口底部**（见 `ChatPanel` 的注释）⇒
              发送按钮永远在视口里，**不用先滚一屏才找得到它**。

              ⇒ 侧栏也不再 `position: sticky`：一个比视口高的 sticky 元素，底部是够不到的
              （经典的 sticky 陷阱），而且它的 sticky 会让内部那个 sticky-bottom 的参照系变复杂。
              侧栏就当一个普通的 flex 列：它在文档流里，跟主内容一起滚。
            */
            alignSelf: 'stretch',
            height: 'auto',
            borderInlineStart: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          }}
        >
          {collapsed ? (
            <CollapsedStrip onExpand={toggle} />
          ) : (
            <>
              <AiWorkspace />
              <Button
                type="text"
                size="small"
                aria-label="收起 AI 工作台"
                title="收起 AI 工作台（⌘B）"
                icon={<RightOutlined />}
                onClick={toggle}
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 8,
                  zIndex: 2,
                  color: token.colorTextLightSolid,
                }}
              />
            </>
          )}
        </Sider>
      )}
    </div>
  );
}
