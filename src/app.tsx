import { LinkOutlined } from '@ant-design/icons';
import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { getIntl, history, Link } from '@umijs/max';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import React from 'react';

import { fetchCurrentUser } from '@/auth/session';
import {
  AvatarDropdown,
  ErrorBoundary,
  Footer,
  LangDropdown,
  OfflineBanner,
  VersionDropdown,
} from '@/components';
import type { BackendMenu } from '@/menu/adapter';
import {
  buildMenuItems,
  collectPaths,
  collectPermissions,
  collectRouteIcons,
} from '@/menu/adapter';
import type { UserOut } from '@/services/api/system/types';
import { API_BASE_URL } from '@/services/http';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

// Initialize dayjs plugins globally
dayjs.extend(relativeTime);

const isDev = process.env.NODE_ENV === 'development';
const loginPath = '/user/login';
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

// ProLayout 支持的api https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => {
  return {
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
      return buildMenuItems(initialState?.menus ?? [], knownPaths, routeIcons);
    },
    actionsRender: () => {
      // `locale: false` opts out of the language switcher. ProLayout's own
      // `locale` prop is a locale string, so narrow to the boolean toggle here.
      const localeEnabled =
        (initialState?.settings as { locale?: boolean })?.locale !== false;
      return [
        <VersionDropdown key="version" />,
        localeEnabled && <LangDropdown key="lang" />,
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
    footerRender: () => <Footer />,
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
          {children}
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
    <>
      <OfflineBanner />
      <ErrorBoundary>{container}</ErrorBoundary>
    </>
  );
}
