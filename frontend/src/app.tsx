import {
  CloseOutlined,
  LinkOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { getIntl, history, Link } from '@umijs/max';
import { App, Button } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import React from 'react';

import { fetchCurrentUser } from '@/auth/session';
import {
  AppMessageBridge,
  AvatarDropdown,
  ErrorBoundary,
  Footer,
  LangDropdown,
  OfflineBanner,
  VersionDropdown,
} from '@/components';
import { AiWorkspaceShell } from '@/components/ai-workspace/AiWorkspaceShell';
import type { BackendMenu } from '@/menu/adapter';
import {
  buildHomeMenuItem,
  buildMenuItems,
  collectPaths,
  collectPermissions,
  collectRedirects,
  collectRouteIcons,
  HOME_MENU_PATH,
} from '@/menu/adapter';
import type { UserOut } from '@/services/api/system/types';
import { API_BASE_URL } from '@/services/http';
import defaultSettings from '../config/defaultSettings';
import routes from '../config/routes';
import { errorConfig } from './requestErrorConfig';

// Initialize dayjs plugins globally
dayjs.extend(relativeTime);

const isDev = process.env.NODE_ENV === 'development';
const loginPath = '/user/login';
/**
 * 不需要登录态的**前端路由**(不是接口路径)。
 * 免鉴权的接口清单在 `@/services/http` 的 `AUTH_FREE_API_PATHS`。
 */
const authFreePaths = [loginPath, '/user/register', '/user/register-result'];

/** 与后端用户信息绑定的初始状态片段 */
export interface UserState {
  currentUser?: UserOut;
  menus?: BackendMenu[];
  permissions?: string[];
}

/**
 * @see https://umijs.org/docs/api/runtime-config#getinitialstate
 */
export async function getInitialState(): Promise<
  UserState & {
    settings?: Partial<LayoutSettings>;
    fetchUserInfo?: () => Promise<UserState | undefined>;
    settingDrawerOpen?: boolean;
  }
> {
  const loadUserInfo = async (): Promise<UserState | undefined> => {
    try {
      // fetchCurrentUser() 在没有 data 时就抛异常,info 一定非空
      const info = await fetchCurrentUser();
      return {
        currentUser: info,
        menus: info.menus ?? [],
        permissions: collectPermissions(info.menus ?? [], info.roles ?? []),
      };
    } catch (_error) {
      const { pathname, search, hash } = history.location;
      // 已经在登录页就别再套一层 redirect —— 否则会越套越深
      // (/user/login?redirect=%2Fuser%2Flogin%3Fredirect%3D…)
      history.replace(
        pathname === loginPath
          ? loginPath
          : `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
      );
    }
    return undefined;
  };

  const { location } = history;

  const base = {
    fetchUserInfo: loadUserInfo,
    settings: defaultSettings as Partial<LayoutSettings>,
    settingDrawerOpen: false,
  };

  if (authFreePaths.includes(location.pathname)) {
    return base;
  }

  const userState = await loadUserInfo();
  return { ...base, ...userState };
}

/**
 * 顶栏里的「设置」按钮（界面布局 / 主题）。
 *
 * ⚠️ 为什么不用 ProLayout 自带的浮动齿轮：
 * 那个把手是 `SettingDrawer` 内部渲染的 `position: fixed` 元素，
 * **贴视口右边缘** ⇒ 会被右侧常驻的 AI 工作台面板盖住 ⇒ 用户开不了设置。
 * 而且那个抽屉 `closable: false`，**唯一的关闭入口就是那个把手**
 * ⇒ 所以这个按钮必须是**切换**，不能只“开”。
 */
function SettingToggleButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    /*
      ⚠️ 用**原生 `title`** 而不是 antd 的 `Tooltip`：
      `Tooltip` 会在按钮上方浮一个覆盖层，鼠标一移上去它就挡住按钮自己
      ⇒ 第一次点击被它吃掉（e2e 里表现为 click 超时）。
      原生 `title` 不产生覆盖层，行为正常。
    */
    <Button
      type="text"
      aria-label={open ? '关闭设置' : '界面布局与主题'}
      title={open ? '关闭设置' : '界面布局与主题'}
      data-testid="app-setting-toggle"
      icon={open ? <CloseOutlined /> : <SettingOutlined />}
      onClick={onToggle}
    />
  );
}

// ProLayout 支持的api https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => {
  return {
    /**
     * 左侧菜单栏更窄一点。
     *
     * ⚠️ umi 的插件把 `siderWidth={256}` **写死**在 `<ProLayout>` 上，
     *    但 `{...runtimeConfig}` 在它**后面**展开 ⇒ 这里能覆盖掉。
     */
    siderWidth: 200,
    /**
     * 菜单**默认是收缩的**。
     *
     * ⚠️ 这个状态**不持久化** ⇒ 刷新页面又回到收缩（就是「默认收缩」的意思）。
     *    想记住用户的选择的话得自己存 localStorage 再用 `collapsed` 受控
     *    （⚠️ 但 `collapsed` 被 ProLayout 的类型 `Omit` 掉了，只能绕）。
     */
    defaultCollapsed: true,
    /**
     * 关掉 antd `Sider` 自带的**响应式折叠**。
     *
     * ## 为什么必须关
     *
     * `Sider` 带 `breakpoint` 时会在**挂载时立刻**跑一次响应式处理：
     * 视口宽于断点 ⇒ `mql.matches === false` ⇒ 强制 `collapsed = false`
     * ⇒ **`defaultCollapsed` 当场被推翻**（菜单自己弹开）。
     *
     * 实测（1600px 视口）：t≈2.1s 时菜单是收缩的（64px），
     * t≈2.6s 就自己展开成 200px 了。
     *
     * ## 关掉之后窄屏怎么办
     *
     * - 手机（<576px）：ProLayout 自己会换成**抽屉**（`isMobile`）⇒ 不受影响；
     * - 平板（576–992px）：菜单保持**默认收缩**（64px）
     *   ⇒ 内容区反而更宽（比自动折叠更宽松）。
     */
    breakpoint: false,
    menuItemRender: (item, dom) => {
      if (item.path) {
        return (
          <Link to={item.path} prefetch>
            {dom}
          </Link>
        );
      }
      return dom;
    },
    /**
     * 菜单由后端下发:后端决定「显示哪些」,前端路由表决定「能点开什么」。
     * menuData 是 ProLayout 从 config/routes.ts 派生的菜单,用它做前端路由存在性校验,
     * 顺便取前端路由表的图标(后端的 icon 是 Remix Icon 名,ProLayout 渲染不出来)。
     */
    menuDataRender: (menuData) => {
      const knownPaths = collectPaths(menuData);
      const routeIcons = collectRouteIcons(menuData);
      const redirects = collectRedirects(
        routes as unknown as Parameters<typeof collectRedirects>[0],
      );
      const items = buildMenuItems(
        initialState?.menus ?? [],
        knownPaths,
        routeIcons,
        redirects,
      );
      /*
       * 前端自有的「首页」放在**最上面**。
       *
       * ⚠️ 后端 `platform_menu` 里那个叫「首页」的行是 `client='app'`
       *    （移动端 APP 的首页）⇒ Web 端的下发菜单里**没有**首页
       *    ⇒ 这条得前端自己加。
       *
       * ⚠️ 后端**将来**若补了一条 `client='pc'` 的首页，
       *    就会出现两个「首页」⇒ 所以先查一下后端菜单里有没有。
       */
      const hasHome = items.some((item) => item.path === HOME_MENU_PATH);
      return hasHome ? items : [buildHomeMenuItem(routeIcons), ...items];
    },
    actionsRender: () => {
      // `locale: false` opts out of the language switcher. ProLayout's own
      // `locale` prop is a locale string, so narrow to the boolean toggle here.
      const localeEnabled =
        (initialState?.settings as { locale?: boolean })?.locale !== false;
      return [
        <VersionDropdown key="version" />,
        localeEnabled && <LangDropdown key="lang" />,
        /*
          设置（界面布局 / 主题）。

          ⚠️ 为什么不用 ProLayout 自带的那个浮动齿轮：
          它是 `SettingDrawer` 内部渲染的一个 `position: fixed` 的把手，
          **贴视口右边缘**（实测 48×48，x=1872、y=240）⇒ 会被右侧常驻的
          AI 工作台面板（400px 宽，也是 `position: fixed`）**整个盖住**，
          用户就再也开不了「布局与主题」了。

          ⇒ 隐藏那个浮动把手（见 `global.less`），改成顶栏里的这个按钮。
          抽屉本身 `closable: false`，**唯一的关闭入口就是那个把手**
          ⇒ 所以这个按钮必须是**切换**（开着就关、关着就开），不能只开。
        */
        <SettingToggleButton
          key="setting"
          open={initialState?.settingDrawerOpen === true}
          onToggle={() => {
            setInitialState((s) => ({
              ...s,
              settingDrawerOpen: !s?.settingDrawerOpen,
            }));
          }}
        />,
      ].filter(Boolean);
    },
    avatarProps: {
      // UserOut.avatar 是 string | null,ProLayout 的 src 只接受 string | undefined
      src: initialState?.currentUser?.avatar ?? undefined,
      title:
        initialState?.currentUser?.name ??
        initialState?.currentUser?.username ??
        getIntl().formatMessage({
          id: 'app.settings.defaultUserName',
          defaultMessage: '用户',
        }),
      render: (_, avatarChildren) => (
        <AvatarDropdown>{avatarChildren}</AvatarDropdown>
      ),
    },
    // waterMarkProps: {
    //   content: initialState?.currentUser?.name,
    // },
    /*
      ⚠️ 页脚**不在这里**渲染。

      内容区是 `display: flex` 的**一列**（里面只有主内容那一格）
      ⇒ `footerRender` 渲染出来的东西会变成内容区的另一个 flex 子项，
      被挤到主内容下面去（而不是跟在内容后面）。
      ⇒ 页脚改由 AI 工作台那个外壳渲染在**主内容那一格里面**
      （见 `AiWorkspaceShell`）—— 跟着内容一起滚，位置和以前一样。
    */
    footerRender: () => null,
    onPageChange: () => {
      const { location } = history;
      // 如果没有登录，重定向到 login
      if (!initialState?.currentUser && location.pathname !== loginPath) {
        history.replace(
          `${loginPath}?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`,
        );
      }
    },
    bgLayoutImgList: [
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/D2LWSqNny4sAAAAAAAAAAAAAFl94AQBr',
        left: 85,
        bottom: 100,
        height: '303px',
      },
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/C2TWRpJpiC0AAAAAAAAAAAAAFl94AQBr',
        bottom: -68,
        right: -45,
        height: '303px',
      },
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/F6vSTbj8KpYAAAAAAAAAAAAAFl94AQBr',
        bottom: 0,
        left: 0,
        width: '331px',
      },
    ],
    links: isDev
      ? [
          <a
            key="swagger"
            href="https://www.pmdict.cn/api/v1/docs"
            target="_blank"
            rel="noreferrer"
          >
            <LinkOutlined />
            <span>接口文档</span>
          </a>,
        ]
      : [],
    // Replace ProLayout's default ErrorBoundary with our offline-aware version,
    // so chunk load errors show friendly messages instead of "Something went wrong."
    ErrorBoundary,
    menuHeaderRender: undefined,
    // 自定义 403 页面
    // unAccessible: <div>unAccessible</div>,
    // 增加一个 loading 的状态
    childrenRender: (children) => {
      // if (initialState?.loading) return <PageLoading />;
      return (
        <>
          {/*
            AI 工作台：右下角一个按钮，点开是**浮在内容之上**的面板。

            ⚠️ 不是内容区里的固定列（那样它会变成「贴在中间内容上的一块浮板」，
            还会把主内容挤掉 400px）⇒ 浮层是 `position: fixed`，
            **不占布局宽度** ⇒ 表格不再被挤窄。
          */}
          <AiWorkspaceShell footer={<Footer />}>{children}</AiWorkspaceShell>
          <SettingDrawer
            disableUrlParams
            enableDarkTheme
            collapse={initialState?.settingDrawerOpen}
            onCollapseChange={(open) => {
              setInitialState((s) => ({
                ...s,
                settingDrawerOpen: open,
              }));
            }}
            settings={initialState?.settings}
            onSettingChange={(settings) => {
              setInitialState((s) => ({
                ...s,
                settings,
              }));
            }}
          />
        </>
      );
    },
    ...initialState?.settings,
  };
};

/**
 * @name request 配置，可以配置错误处理
 * 它基于 axios 提供了一套统一的网络请求和错误处理方案。
 * @doc https://umijs.org/docs/max/request#配置
 */
export const request: RequestConfig = {
  baseURL: API_BASE_URL,
  ...errorConfig,
};

export function rootContainer(container: React.ReactNode) {
  return (
    // <App> 让页面上的提示(message / notification)走 App.useApp() 的实例:
    // 静态 message API 不消费 ConfigProvider 的上下文,提示不吃主题。
    // AppMessageBridge 把这个实例发布到模块级,请求层(errorHandler)才能用上。
    <App>
      <AppMessageBridge />
      <OfflineBanner />
      <ErrorBoundary>{container}</ErrorBoundary>
    </App>
  );
}
