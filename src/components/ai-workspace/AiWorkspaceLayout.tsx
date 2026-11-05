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
 * ## 为什么单独一个组件
 *
 * `src/app.tsx` 的 `childrenRender` 只负责「把它挂上去」，
 * 折叠、快捷键、持久化这些逻辑都在这里 —— 于是它们可以被单测钉住。
 */
import { RightOutlined, RobotOutlined } from '@ant-design/icons';
import { Button, Layout, theme } from 'antd';
import type React from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AiWorkspace } from './index';
import { readWorkspaceStorage, writeWorkspaceStorage } from './storage';

const { Sider } = Layout;

/** 展开时的宽度（规格 §3.1：宽 400）。 */
export const AI_WORKSPACE_WIDTH = 400;

/** 折叠后的宽度（规格 §3.1：40px 的竖条）。 */
export const AI_WORKSPACE_COLLAPSED_WIDTH = 40;

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
  const [collapsed, setCollapsed] = useState<boolean>(
    () => readWorkspaceStorage().collapsed === true,
  );
  /** 内容区顶边离视口顶边的距离（侧栏要钉在固定头部下面）。 */
  const [stickyTop, setStickyTop] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);

  /** 折叠 / 展开，并把状态写进 localStorage。 */
  const toggle = useCallback((): void => {
    setCollapsed((previous) => {
      const next = !previous;
      writeWorkspaceStorage({ collapsed: next });
      return next;
    });
  }, []);

  // 侧栏钉在**固定头部**下面：量出内容区顶边离视口顶边有多远。
  //
  // ⚠️ 用文档坐标（rect.top + scrollY）而不是视口坐标 ——
  // 页面滚动过时视口坐标会变成负数，侧栏就会钻到头部上面去。
  useLayoutEffect(() => {
    const update = (): void => {
      const node = rowRef.current;
      if (!node) {
        return;
      }
      const top = node.getBoundingClientRect().top + window.scrollY;
      setStickyTop(Math.max(0, Math.round(top)));
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
    };
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

  return (
    <div
      ref={rowRef}
      style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}
    >
      {/*
        主内容：侧栏收窄时这一列跟着窄。

        ⚠️ `overflowX: 'auto'`：表格比这一列宽时（列很多的老页面），
        在**这一列里**横向滚动 —— 不能让它溢出到 AI 侧栏底下，
        那样「操作」列的按钮就点不到了。
      */}
      <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>{children}</div>
      <Sider
        data-testid="ai-workspace-sider"
        width={AI_WORKSPACE_WIDTH}
        collapsedWidth={AI_WORKSPACE_COLLAPSED_WIDTH}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        theme="light"
        style={{
          // 常驻的一列：跟着页面滚，但自己钉在固定头部下面，
          // 高度取「视口高 - 顶边距离」⇒ 输入区永远落在视口内。
          position: 'sticky',
          top: stickyTop,
          height: `calc(100vh - ${stickyTop}px)`,
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
    </div>
  );
}
