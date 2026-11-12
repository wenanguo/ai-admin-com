/**
 * AI 工作台的**应用外壳**：右下角一个按钮，点开后浮出一个 AI 工作台面板。
 *
 * ## 为什么从「常驻右栏」改成「浮层」
 *
 * 原来是 `<Layout>` 右边一列 `Sider`（400px，常驻）。它有两个问题：
 *
 * 1. **白占 400px**：ProTable 的表格被挤到 944px，右边几列要横向滚才能看到；
 * 2. **它一直在**：用户不想用 AI 的时候也占着位置。
 *
 * ⇒ 改成浮层：面板**默认关**，右下角一个按钮点开。开着的时候浮在页面内容**之上**
 * （`position: fixed`，不占布局宽度）⇒ 主内容宽度**始终不变**，表格不再被挤窄。
 *
 * ⚠️ 代价：打开面板时，页面右侧的内容会被**遮住**（参考图就是这个效果）。
 *   这是用户主动打开的，不是「一直挡着」。
 *
 * ## 开关状态
 *
 * - `⌘B` / `Ctrl+B` 切换（原型已有的约定，保留）；
 * - 状态存在 `localStorage['aipm.workspace']` 的 `open` 字段（见 `storage.ts`）；
 * - 输入框里**不劫持**快捷键（那里 `Ctrl+B` 是加粗）。
 *
 * ## 窄屏（规格 §3.1 的「不能让面板把内容挤没了」）
 *
 * 浮层不占布局宽度 ⇒ 它**不会**把主内容挤到断点以下。
 * 但 400px 的浮层在手机上会盖住几乎整个屏幕 ⇒ 窄屏时宽度取 `100vw`（全屏），
 * 宽屏时取 400px。
 */

import { RobotOutlined } from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import { Button, theme } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiWorkspace } from './index';
import { AI_WORKSPACE_PAGE_PATH } from './paths';
import { readWorkspaceStorage, writeWorkspaceStorage } from './storage';

/** 浮层面板的宽度（宽屏时）。 */
export const AI_WORKSPACE_WIDTH = 400;

/**
 * 窄屏断点（px）：视口窄于它时浮层占满整宽。
 *
 * ⚠️ 原来是 antd 的栅格断点 `xl`（1200px）。那是为**常驻栏**定的
 * （常驻栏要把主内容压到 576px 的搜索表单断点以下）⇒ 浮层不占宽度，
 * 不用再为「挤内容」设断点；这里只留一个「浮层别把整屏盖死」的兜底。
 */
export const AI_WORKSPACE_NARROW_WIDTH = 768;

/**
 * 量不出顶栏高度时用的**兜底值**（px）。
 *
 * ProLayout 的默认顶栏就是 56px ⇒ 量不到时用它，结果几乎一样。
 */
const FALLBACK_HEADER_HEIGHT = 56;

/**
 * 内容区自己的内边距（上下 / 左右）。
 *
 * ⚠️ 为什么内边距在**这一层**而不是内容区上：
 *    以前内容区右边坐着一个 `Sider` ⇒ 内边距留在内容区上会把侧栏挤开、
 *    贴不到视口右边缘 ⇒ 才挪到这里。
 *    现在 AI 工作台是浮层（不占布局位置）⇒ 这个理由已经**不成立**了，
 *    但内边距挪过来有另一个好处：**宽版浮层正好盖住内容区**，
 *    不会在浮层四周留下一圈空白（见 `contentBox` 的测量）。
 *
 * ⚠️ 值：上下 16px、左右 18px。以前是 `32px 40px` ⇒ 离菜单与顶栏太远，
 *    表格右边几列要多滚一段才看得到。
 */
const CONTENT_PADDING = '16px 18px';

/**
 * 量一下 ProLayout 的顶栏有多高（px）。
 *
 * ⚠️ 浮层的顶边要**正好压在顶栏下面** ⇒ 顶栏高度是布局给的，不是我们定的
 *    （ProLayout 的主题可以改它）⇒ 这里**量**而不是写死 56。
 */
function measureHeaderHeight(): number {
  const header = document.querySelector<HTMLElement>('.ant-pro-layout-header');
  const height = header?.getBoundingClientRect().height ?? 0;
  return height > 0 ? height : FALLBACK_HEADER_HEIGHT;
}

/**
 * 事件目标是不是可编辑元素。
 *
 * 输入框里按 `Ctrl+B` 是「加粗」，不该顺手把面板关了。
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
 * 应用外壳：主内容占满整个宽度，AI 工作台是右下角按钮点开的浮层。
 *
 * @param props 主应用与页脚。
 */
export function AiWorkspaceShell({
  children,
  footer,
}: AiWorkspaceShellProps): React.ReactElement {
  const { token } = theme.useToken();
  /**
   * 面板是不是**最大化**（宽版）。
   *
   * ⚠️ **不是路由跳转**（以前「全宽页」是个 `<Link to="/ai/workspace">`）
   * ⇒ 跳转会把原页面**卸载**，返回时重新挂载 ⇒ 用户看到「原界面刷新了」。
   * ⇒ 改成状态切换：宽版也是浮层 ⇒ **原页面始终不卸载**。
   *
   * ⚠️ **不持久化**：刷新页面回到窄版（小浮层）比较安全。
   */
  const [wide, setWide] = useState(false);
  /**
   * 全宽页上**不挂浮层**。
   *
   * ## 为什么
   *
   * 1. **宽度**：这一页要放「规则与 AI 的分工」的双栏、意图卡片墙与宽版对话，
   *    400px 的浮层盖在上面会把它们遮掉（规格 §4 的落点就是「浮层装不下」）。
   * 2. **会话不打架**：浮层与页面各挂一个 `useWorkspace` 时，两个实例会**各建一个会话**
   *    （两边界面各说各话，还会在 `localStorage` 里互相覆盖）。
   *    浮层让开 ⇒ 这一页上只有一个会话实例。
   *
   * ⚠️ 会话**仍然是同一个**：页面用的也是 `aipm.workspace` 这个存储键 ⇒
   * 在别的页面用浮层聊的会话，切到这一页还在（反之亦然）。
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
      // ⚠️ **换页了就回到窄版**。
      //    否则「在宽版状态下跳到全宽页」再返回时，会突然盖出一个大浮层。
      setWide(false);
    });
    return () => {
      unlisten();
    };
  }, []);
  const isFullWidthPage = pathname === AI_WORKSPACE_PAGE_PATH;

  /**
   * 浮层开着吗。
   *
   * ⚠️ 读不到存储（隐私模式）时**当关闭**（`=== true` 才算开）⇒
   *    不会因为存不上就永远开着挡着内容。
   */
  const [open, setOpen] = useState<boolean>(
    () => readWorkspaceStorage().open === true,
  );

  /** 打开 / 关闭浮层，并把状态写进 localStorage。 */
  const toggle = useCallback((): void => {
    setOpen((previous) => {
      const next = !previous;
      writeWorkspaceStorage({ open: next });
      return next;
    });
  }, []);

  /** 只开不关（任务页点「与 AI 讨论」时用）。 */
  const openPanel = useCallback((): void => {
    setOpen((previous) => {
      if (!previous) {
        writeWorkspaceStorage({ open: true });
      }
      return true;
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

  // 「请打开 AI 工作台」的信号（任务页点「与 AI 讨论」时发的）
  const aiBridge = useModel('ai-bridge');
  useEffect(() => {
    if (aiBridge.expandSignal === 0) {
      return;
    }
    openPanel();
  }, [aiBridge.expandSignal, openPanel]);

  /** 视口是不是窄屏（浮层要占满整宽）。 */
  const [narrow, setNarrow] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      window.innerWidth < AI_WORKSPACE_NARROW_WIDTH,
  );
  /** 顶栏有多高（浮层的顶边要压在它下面）。 */
  const [headerHeight, setHeaderHeight] = useState<number>(
    FALLBACK_HEADER_HEIGHT,
  );
  /**
   * 内容区（在视口里）的盒子。
   *
   * ⚠️ 宽版浮层要**正好盖住内容区**（用户选的方案 B）：
   *    顶栏与左侧菜单**留着**，AI 工作台浮在内容区上面。
   *
   * ⚠️ 内容区的左边缘**不等于 0**（左边有 ProLayout 的菜单，且它能收起）
   *    ⇒ 这里**量**而不是写死。
   */
  const [contentBox, setContentBox] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const measure = (): void => {
      const element = contentRef.current;
      if (!element) {
        return;
      }
      const box = element.getBoundingClientRect();
      setContentBox({
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      });
    };
    measure();
    // ⚠️ 内容区变宽变窄（收起菜单、改窗口大小）⇒ 浮层要跟着变
    const observer = new ResizeObserver(measure);
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  useEffect(() => {
    const onResize = (): void => {
      setNarrow(window.innerWidth < AI_WORKSPACE_NARROW_WIDTH);
      setHeaderHeight(measureHeaderHeight());
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <>
      {/*
        ⚠️ **主内容占满整个宽度**：浮层是 `position: fixed` 的，**不占布局宽度**
        ⇒ 这里不需要再给右边留 400px ⇒ 表格不再被挤窄。
      */}
      <div
        ref={contentRef}
        data-testid="ai-workspace-content"
        style={{
          width: '100%',
          height: '100%',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          /*
            ⚠️ 内容区自己的内边距（见 `CONTENT_PADDING` 的注释）。
          */
          padding: CONTENT_PADDING,
        }}
      >
        {children}
        {/*
          页脚。

          ⚠️ 为什么在这里而不用 ProLayout 的 `footerRender`：
          `footerRender` 渲染出来的东西是**内容区的另一个 flex 子项** ⇒
          在「内容区 = 纵向 flex 列」的结构里，它会被挤到内容下面去。
          ⇒ 放回主内容那一格，跟着内容一起滚（位置和以前一样：在页面内容下面）。
        */}
        {footer}
      </div>

      {isFullWidthPage ? null : (
        <>
          {/*
            ⚠️ **窄版**：贴视口右边缘、顶栏之下的 400px 浮层。
            ⚠️ **宽版（最大化）**：盖住**内容区**的浮层（顶栏与左侧菜单留着）。

            ⚠️ **两个版本共用同一个 `<AiWorkspace>` 组件实例**
            （只是外层盒子的样式变了）⇒ 切换时它**不卸载**
            ⇒ 里面的 `useWorkspace` 实例存活 ⇒ 会话不变、SSE 不断、流式输出不断。
          */}
          {open ? (
            <div
              data-testid={
                wide ? 'ai-workspace-wide-overlay' : 'ai-workspace-panel'
              }
              role="dialog"
              aria-label="AI 工作台"
              style={
                wide && contentBox
                  ? {
                      position: 'fixed',
                      top: contentBox.top,
                      left: contentBox.left,
                      width: contentBox.width,
                      height: contentBox.height,
                      zIndex: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      background: token.colorBgContainer,
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
                    }
                  : {
                      position: 'fixed',
                      top: headerHeight,
                      right: 0,
                      bottom: 0,
                      width: narrow ? '100vw' : AI_WORKSPACE_WIDTH,
                      zIndex: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      background: token.colorBgContainer,
                      boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.12)',
                      borderLeft: `1px solid ${token.colorBorder}`,
                    }
              }
            >
              <AiWorkspace
                variant={wide ? 'wide' : 'narrow'}
                onCollapse={toggle}
                onExpandWide={() => {
                  setWide(true);
                }}
                onBack={() => {
                  setWide(false);
                }}
              />
            </div>
          ) : null}

          {/*
            右下角的**悬浮按钮**：点开浮层。

            ⚠️ 浮层开着的时候**不显示**这个按钮（面板右上角已经有 X 了），
            免得同一个位置有两个「开关」在打架。
          */}
          {open ? null : (
            <Button
              type="primary"
              shape="circle"
              size="large"
              data-testid="ai-workspace-launcher"
              title="打开 AI 工作台（⌘B）"
              aria-label="打开 AI 工作台"
              onClick={openPanel}
              icon={<RobotOutlined />}
              style={{
                position: 'fixed',
                right: 24,
                bottom: 24,
                zIndex: 99,
                width: 48,
                height: 48,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
              }}
            />
          )}
        </>
      )}
    </>
  );
}
