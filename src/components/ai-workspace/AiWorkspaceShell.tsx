/**
 * AI 工作台的**应用外壳**：整个应用的右边一列。
 *
 * ## 为什么是 `Layout` 的右 `Sider`，而不是内容区里的一个浮层
 *
 * 用户看得很准：**左侧菜单栏是「框架的一条边」，右边的 AI 工具栏却像贴在
 * 中间内容上的一块浮板**。差别不在样式，在**结构**：
 *
 * - 左侧菜单是 ProLayout 自己 `Layout` 里的一个 `Sider` ⇒ 它是布局的一列，
 *   天然贴着视口左边缘、与主内容并列；
 * - 之前 AI 工作台是塞在**内容区里面**的（`childrenRender` 里包一层），
 *   只能靠 `position: fixed` 硬凑 ⇒ 一旦内容变高就会和内容「粘」在一起。
 *
 * ⇒ 现在把它提到**应用壳**这一层：`<Layout>` 里左边是 ProLayout、右边是
 * 这个 `Sider`，两边**平级**。于是：
 *
 * - 它就是框架的右边，和左边菜单对称；
 * - 主内容滚在自己的容器里（见 `global.less` 的 app shell）⇒ 页面不滚
 *   ⇒ 屏幕上只有**一条**滚动条（主内容那条），不再是「页面一条 + 面板一条」；
 * - 不需要 `position: fixed`，也就不会盖住 ProLayout 挂在右边缘的浮动按钮。
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
 */
import { RobotOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import { Layout, theme } from 'antd';
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

/** 应用外壳的 props。 */
export interface AiWorkspaceShellProps {
  /** 整个应用（ProLayout 渲染出来的东西）。 */
  children?: React.ReactNode;
  /**
   * 页脚（渲染在主内容那一格里面，跟着内容一起滚）。
   *
   * ⚠️ 由调用方传进来，而不是外壳自己 import：
   *   页脚用了构建期的 `__APP_VERSION__`，外壳自己 import 会让单测挂掉。
   */
  footer?: React.ReactNode;
}

/**
 * 应用外壳：左边是主应用，右边是常驻的 AI 工作台。
 *
 * @param props 主应用与页脚。
 */
export function AiWorkspaceShell({
  children,
  footer,
}: AiWorkspaceShellProps): React.ReactElement {
  const { token } = theme.useToken();
  /**
   * 全宽页上**不挂侧栏**。
   *
   * ## 为什么
   *
   * 1. **宽度**：这一页要放「规则与 AI 的分工」的双栏、意图卡片墙与宽版对话，
   *    400px 的侧栏会把它们挤扁（规格 §4 的落点就是「侧栏装不下」）。
   * 2. **会话不打架**：侧栏是常驻在**整个应用**上的 ⇒ 侧栏与页面各挂一个
   *    `useWorkspace` 时，两个实例会**各建一个会话**（两边界面各说各话，
   *    还会在 `localStorage` 里互相覆盖）。
   *    侧栏让开 ⇒ 这一页上只有一个会话实例。
   *
   * ⚠️ 会话**仍然是同一个**：页面用的也是 `aipm.workspace` 这个存储键 ⇒
   * 在别的页面用侧栏聊的会话，切到这一页还在（反之亦然）。
   *
   * 用 `history.listen` 而不是 `useLocation`：这个外壳挂在 `rootContainer` 上，
   * 不在 React Router 的上下文里 ⇒ `useLocation` 那套 hook 用不了。
   */
  const [pathname, setPathname] = useState<string>(
    () => history.location?.pathname ?? '/',
  );
  useEffect(() => {
    const unlisten = history.listen(({ location }) => {
      setPathname(location.pathname);
    });
    return () => {
      unlisten();
    };
  }, []);
  const isFullWidthPage = pathname === AI_WORKSPACE_PAGE_PATH;

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
    /*
      ⚠️ **应用壳**：内容区是一个满高的 flex 行。

      - 左边是主内容（**自己滚**），右边是 AI 工作台那个 `Sider`（满高）；
      - 两侧都是 `Layout` 里的**并列一列** ⇒ 和左侧菜单栏对称，
        AI 工作台就是「框架的右边」，而不是贴在内容上的浮板。
    */
    <>
      <div
        data-testid="ai-workspace-content"
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          /*
            ⚠️ 内容区自己的内边距（ProLayout 的 `32px 40px`）挪到这里。

            因为内容区现在是一个**横向 flex 行**（右边是 AI 工作台那个 `Sider`）
            ⇒ 内边距留在内容区上，会把侧栏挤开、贴不到视口右边缘。
          */
          padding: '32px 40px',
        }}
      >
        {children}
        {/*
          页脚。

          ⚠️ 为什么在这里而不用 ProLayout 的 `footerRender`：
          `footerRender` 渲染出来的东西是**内容区的另一个 flex 子项** ⇒
          在「内容区 = 横向 flex 行」的新结构里，它会被挤到 AI 侧栏右边去。
          ⇒ 放回主内容那一格，跟着内容一起滚（位置和以前一样：在页面内容下面）。
        */}
        {footer}
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
              ⚠️ 这一列是**布局的一列**，不是 `position: fixed` 的浮层。

              所以它：
              - 高度就是内容区的高度（视口高 - 顶栏）⇒ 永远是「框架的右边」；
              - **不会盖住** ProLayout 挂在视口右边缘的浮动按钮；
              - 折叠/展开时**主内容跟着变宽**（flex 布局自动重排）。
            */
            height: '100%',
            overflow: 'hidden',
            // 左边框用 `colorBorder`（看得见的灰）而不是 `colorBorderSecondary`
            // （几乎透明的浅灰）⇒ 面板与内容之间有一道**明确的分界**，
            // 读起来像「框架的一条边」，而不是内容的一部分。
            borderInlineStart: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
          }}
        >
          {collapsed ? (
            <CollapsedStrip onExpand={toggle} />
          ) : (
            /*
              ⚠️ 「收起」按钮在**头部里面**（右上角）——
              之前它是一个绝对定位在面板右上角的浮层，会压住头部内容。
            */
            <AiWorkspace onCollapse={toggle} />
          )}
        </Sider>
      )}
    </>
  );
}
