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
  Drawer,
  Dropdown,
  Space,
  Tabs,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type React from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { listAiConversations } from '@/services/api/ai/client';
import type { AiConversation } from '@/services/api/ai/types';
import { AuditPanel } from './AuditPanel';
import { DiscussionBar } from './DiscussionBar';
import { IntentGallery } from './IntentGallery';
import { AI_INTENTS } from './intents';
import { PendingPanel } from './PendingPanel';
import { RuleSplit } from './RuleSplit';
import { SkillList } from './SkillList';
import { useAiLists } from './useAiLists';
import type { Workspace } from './useWorkspace';
import { WideChat } from './WideChat';

/** 工作台视图（页签）。 */
type WorkspaceView = 'pending' | 'audit' | 'rules';

/** 右侧栏的宽度（px）：并排时是常驻窄栏，抽屉时是抽屉的宽度。 */
const SIDEBAR_WIDTH = 360;

/**
 * 内容区窄于它（px）⇒ 右侧栏改成**抽屉**。
 *
 * ## 为什么是这个数
 *
 * 并排形态下侧栏是**固定 360px** 且 `flexShrink: 0` ⇒ 内容区一窄，
 * 侧栏就把对话区挤到没法用（窄到 376px 以下时侧栏还会被
 * 根容器的 `overflowX: hidden` **裁掉**，用户根本够不着）。
 * ⇒ 900px 以下干脆**不并排**：对话区占满整宽，侧栏改成右侧抽屉。
 */
const NARROW_CONTENT_WIDTH = 900;

/**
 * 抽屉宽度的**下限**（px）。
 *
 * ⚠️ 抽屉太窄的话，侧栏里的「同意 / 拒绝」按钮会被挤得很难点。
 * ⇒ 宽度算出来是 0（内容区还没布局好就被量到）时，至少给这么多。
 */
const MIN_DRAWER_WIDTH = 240;

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

  /**
   * **自己量宽度**（不靠宿主传 prop）。
   *
   * ⚠️ 宽版有**两个宿主**：最大化浮层与路由页 `/ai/workspace`。
   *    浮层那边拿得到「内容区宽度」，路由页那边**没有**这个值
   *    ⇒ 从宿主传 prop 只能覆盖一半宿主。
   * ⇒ 这里在**自己的根容器**上挂 `ResizeObserver` ⇒ 两个宿主行为一致。
   */
  const rootRef = useRef<HTMLDivElement>(null);
  /** 根容器有多宽（px）；还没量到时是 `undefined`。 */
  const [contentWidth, setContentWidth] = useState<number | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    const measure = (): void => {
      setContentWidth(element.getBoundingClientRect().width);
    };
    // ⚠️ 用 `useLayoutEffect`：**首帧就量** ⇒ 不会出现「先并排、下一帧变抽屉」
    //    的闪一下（那是 `useEffect` 才有的问题）。
    measure();
    // 内容区变宽变窄（收起菜单、改窗口大小）⇒ 形态跟着换。
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  /**
   * 内容区窄 ⇒ 右侧栏改成抽屉。
   *
   * ⚠️ 还没量到宽度时**按宽的算**（并排）：先给一个能用的布局，
   *    量到真实宽度后再纠正（`useLayoutEffect` 在首帧就跑完了，
   *    所以实际上看不到中间态）。
   */
  const collapsed =
    contentWidth !== undefined && contentWidth < NARROW_CONTENT_WIDTH;
  /** 抽屉开着没有（窄形态下侧栏在抽屉里）。 */
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /**
   * ⚠️ **离开窄形态时把抽屉状态复位**（真 bug 的修复）。
   *
   * ## 原来的症状
   *
   * 窄形态下打开抽屉 ⇒ 把窗口拉宽到 900px 以上 ⇒ 抽屉**卸载**了，
   * 但 `sidebarOpen` 还是 `true` ⇒ 再变窄时抽屉**自己弹出来**，
   * 盖住对话区（用户莫名其妙被遮住）。
   *
   * ⇒ 形态一变回并排（`collapsed` 变 false）就把 `sidebarOpen` 置回 false。
   */
  useEffect(() => {
    if (!collapsed) {
      setSidebarOpen(false);
    }
  }, [collapsed]);

  /**
   * 抽屉的宽度（px）。
   *
   * ⚠️ **不能固定 360px**：内容区比它还窄时，靠右的抽屉会**伸出左边**
   *    （超出视口）⇒ 侧栏左侧的东西（例如「待确认」的同意 / 拒绝按钮）
   *    够不着。
   * ⇒ 取「360px」与「内容区宽度 - 左右内边距」的**小者** ⇒ 窄内容区下自动收窄。
   *
   * ⚠️ **左右内边距用 `token.padding * 2`**（不是写死的 32）：
   *    那个 32 就是根容器的 `padding: token.padding` × 2（16 × 2）
   *    ⇒ 写死的话，主题一改内边距就跟不上了。
   *
   * ⚠️ **有正的下限**（{@link MIN_DRAWER_WIDTH}）：原来写的是 `Math.max(0, …)`
   *    ⇒ 内容区宽度**量到 0** 时（还没布局好就被量到）会算出 **0 宽抽屉**
   *    ⇒ 侧栏彻底看不见（用户连页签都点不到）。
   */
  const drawerWidth =
    contentWidth !== undefined
      ? Math.min(
          SIDEBAR_WIDTH,
          Math.max(MIN_DRAWER_WIDTH, contentWidth - token.padding * 2),
        )
      : SIDEBAR_WIDTH;

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

  /**
   * 右侧栏（待确认 / 审计 / 规则与 AI 的分工）。
   *
   * ⚠️ **两种形态共用这一份**：
   * - 内容区够宽 ⇒ 它是**并排**的常驻窄栏（360px）；
   * - 内容区窄 ⇒ 它被放进**右侧抽屉**（对话区占满整宽）。
   *
   * ⚠️ 为什么提成变量：它是同一个 React 元素，宿主换地方渲染它
   *    （行内 ↔ 抽屉的 portal）⇒ 不用把这份标记抄两遍。
   */
  const sidebar = (
    <aside
      data-role="ai-wide-sidebar"
      style={{
        // ⚠️ **两种形态的父容器方向不同**（并排时是**行**，抽屉里是**列**）
        //    ⇒ `flex` 只能给其中一种 ⇒ 这里按形态给。
        ...(collapsed
          ? { width: '100%', flex: '1 1 0%', minWidth: 0 }
          : { width: SIDEBAR_WIDTH, flexShrink: 0 }),
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
            ⚠️ 页签条要**自己留左右内边距**（与窄面板那套一样，
            见 `index.tsx` 里同名的那段注释）：
            antd 的 Tabs 根节点没有内边距 ⇒ `.ant-tabs-nav` 的 padding-left = 0
            ⇒ 第一个页签的标题（「待确认」）会**紧贴**这一列的左边缘，
            看上去像没渲染完。
            `header` 落到的就是 `.ant-tabs-nav`。
          */
          header: { paddingInline: token.paddingSM },
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
  );

  return (
    <div
      ref={rootRef}
      data-testid="ai-workspace-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.size,
        padding: token.padding,
        // ⚠️ **高度链**：它是 `AiWorkspace` 根（flex 列）的子项
        //    ⇒ 靠 `flex: 1 1 auto` 吃满，比只写 `height: 100%` 更稳。
        //    `height: 100%` 也留着（路由页那条链靠它）。
        // ⚠️ **`flex-basis` 用 `auto`（不是 `0%`）**：高度链万一塌了
        //    （某个宿主没给出确定高度），`0%` 会让这一项塌成 0 高
        //    ⇒ 整页什么都看不见；`auto` 则退回**内容高度** ⇒ 还能看。
        height: '100%',
        flex: '1 1 auto',
        // ⚠️ **不设 `minHeight`**：以前这里是 `minHeight: 320`（高度链塌了的兜底），
        //    但它有个更糟的后果 —— 宿主比 320px 还矮时（横屏手机），
        //    根容器比宿主**高** ⇒ 多出来的那截落在**视口外** ⇒ 发送按钮够不着。
        //    ⇒ 兜底挪到**对话区**（`ai-wide-chat-column` 的 `minHeight: 320`）：
        //    对话区不会缩成一条，而根容器**留在宿主的高度里** ⇒ 矮宿主时
        //    根容器自己滚（下面那句 `overflowY: auto`），输入框滚得到。
        // ⚠️ **滚动**：意图卡片墙已经折进抽屉（不在文档流里），对话区又吃满了
        //    剩余高度 ⇒ 内容**装得下** ⇒ `auto` **不会**出现滚动条 ⇒ 整页不用滚。
        //    （中间那一行、对话区、侧栏各自内部滚。）
        // ⚠️ 这里保留 `auto` 而不是 `hidden`：**只有宿主足够高**时内容才装得下；
        //    宿主很矮时对话区有 320px 的下限 ⇒ 内容比容器高 ⇒ 靠这个 `auto`
        //    把输入框**滚进视野**（`hidden` 的话就直接裁没了）。
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
          {/*
            「侧栏」：**只在内容区窄的时候出现**。
            ⇒ 窄的时候侧栏在**抽屉**里（常驻的 360px 会把对话区挤没），
              这个按钮是抽屉的开关。
            ⚠️ 宽的时候不出现（那时候侧栏本来就在右边）。
          */}
          {collapsed ? (
            <Button
              data-role="ai-wide-sidebar-toggle"
              aria-expanded={sidebarOpen}
              onClick={() => {
                setSidebarOpen(true);
              }}
            >
              侧栏
            </Button>
          ) : null}
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
        {/* ⚠️ **放在这一行**（水平排列）⇒ 零纵向占用：
            宽屏页是「一屏铺满」布局，对话区要吃满剩余高度（e2e 有断言）
            ⇒ 纵向加任何常驻内容都会把对话区挤矮。 */}
        <SkillList />
        <span style={{ fontFamily: token.fontFamilyCode }}>
          {workspace.model ?? '未知'}
        </span>
        <Tooltip
          title="（服务端没有模型列表端点，也没有配额端点 ⇒ 只显示当前模型；没有数据源就不画配额条）"
          mouseEnterDelay={0.1}
          // ⚠️ 触发器是**可聚焦**的（原生 <button>）⇒ tooltip 必须同时响应
          //    `focus` ⇒ 否则键盘用户聚焦到它却打不开 tooltip，也听不到那句解释。
          trigger={['hover', 'focus']}
          // ⚠️ 模型条就在「AI 工作台」标题**正下方** ⇒ 默认的 `top` 会盖住标题。
          placement="bottom"
        >
          {/*
            ⚠️ 触发器是**原生 `<button>`**（不是裸 `<span>`）：
               - `<span>` 没有 `tabIndex` ⇒ 键盘用户永远聚焦不到它，
                 `aria-label` 承诺的却是个**操作不了**的控件；
               - 原生 `<button>` 天生可聚焦 ⇒ 键盘可达（Tab 能到），
                 `trigger` 含 `focus` ⇒ 聚焦时 tooltip 自动打开。
               - ⚠️ Biome 的 `a11y/noNoninteractiveTabindex` 不许给
                 非交互元素加 `tabIndex`，`a11y/useSemanticElements` 又要求
                 扮演 button 角色时用真 `<button>` ⇒ 这里用原生按钮。
          */}
          <button
            type="button"
            data-role="ai-model-note"
            aria-label="为什么只显示当前模型"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: 0,
              border: 'none',
              background: 'transparent',
              lineHeight: 1,
              cursor: 'help',
              color: token.colorTextTertiary,
            }}
          >
            <InfoCircleOutlined />
          </button>
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
            /*
              ⚠️ **对话区的下限 320px**（规格 §2 的兜底）。

              ## 为什么在这儿，而不是在根容器上

              根容器原来写的是 `minHeight: 320` ⇒ 宿主（内容区）比 320px 还矮时
              （横屏手机、很矮的窗口），根容器比宿主**高** ⇒ 多出来的那截
              落在**视口外** ⇒ 输入框（发送按钮）够不着。

              ⇒ 挪到**对话区**：根容器留在宿主的高度里（自己滚），
              对话区保持 320px ⇒ 输入区**不会被裁掉**，根容器滚一下就看得见。

              ⚠️ 这也是「高度链塌了」的兜底：对话区不会缩成一条。
            */
            minHeight: 320,
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
            /*
              ⚠️ 窄形态下「待确认」在**抽屉**里（要点「侧栏」才出来）
              ⇒ 提示语要告诉用户**去哪找**（宽形态就不用说了）。
            */
            sidebarInDrawer={collapsed}
          />
        </div>

        {/*
        右侧栏：工作台视图（待确认 / 审计 / 规则与 AI 的分工）。

        ⚠️ **并排形态**：固定 **360px** 窄栏（`flexShrink: 0`）⇒ 对话区不会被挤没。
        ⚠️ **窄形态**（内容区 < 900px）：侧栏**不并排**（它在抽屉里）
           ⇒ 否则 360px 的常驻窄栏会把对话区挤成一条
           （窄到 376px 以下还会被根容器的 `overflowX: hidden` 裁掉）。
        */}
        {collapsed ? null : sidebar}
      </div>

      {/*
        **窄形态的右侧栏**：一个**右侧抽屉**。

        ⚠️ 抽屉是**浮层**（portal + 遮罩）⇒ 不占布局宽度
           ⇒ 对话区真的占满了整个内容区。
        ⚠️ `size` 而不是 `width`（antd v6 里 `width` 已废弃）。
        ⚠️ 宽度是 `drawerWidth`（不是固定的 360px）⇒ 内容区比它窄时自动收窄，
           不会伸出屏幕左边。
      */}
      {collapsed ? (
        <Drawer
          open={sidebarOpen}
          onClose={() => {
            setSidebarOpen(false);
          }}
          placement="right"
          size={drawerWidth}
          title="工作台视图"
          styles={{
            body: {
              // ⇒ 抽屉里的侧栏要**吃满抽屉高度**（页签面板各自滚）。
              display: 'flex',
              flexDirection: 'column',
              // ⚠️ 抽屉**自己别再滚一层**（里面的页签面板自己滚）。
              overflow: 'hidden',
              padding: token.paddingSM,
            },
          }}
        >
          {sidebar}
        </Drawer>
      ) : null}
    </div>
  );
}
