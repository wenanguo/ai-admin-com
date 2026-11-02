import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

const mockReplace = vi.fn();
const mockHistory = {
  location: {
    pathname: '/welcome',
    search: '',
    hash: '',
  },
  replace: mockReplace,
};

const mockFetchCurrentUser = vi.fn();

vi.mock('@umijs/max', () => ({
  history: mockHistory,
  Link: ({ children }: any) => children,
  getIntl: vi.fn(() => ({
    formatMessage: vi.fn(
      ({ defaultMessage }: { defaultMessage: string }) => defaultMessage,
    ),
  })),
}));

vi.mock('@/auth/session', () => ({
  fetchCurrentUser: (...args: unknown[]) => mockFetchCurrentUser(...args),
}));

vi.mock('@/components', () => ({
  AppMessageBridge: () => null,
  AvatarDropdown: () => null,
  ErrorBoundary: ({ children }: any) => children,
  Footer: () => null,
  LangDropdown: () => null,
  OfflineBanner: () => null,
  VersionDropdown: () => null,
}));

vi.mock('@ant-design/pro-components', () => ({
  SettingDrawer: () => null,
}));

vi.mock('@ant-design/icons', () => ({
  LinkOutlined: () => null,
}));

vi.mock('./requestErrorConfig', () => ({
  errorConfig: {},
}));

vi.mock('../config/defaultSettings', () => ({
  default: { navTheme: 'light' },
}));

const backendUser = {
  id: 1,
  username: 'admin',
  name: '管理员',
  is_superuser: true,
  menus: [
    {
      id: 10,
      name: 'system',
      type: 1,
      route_path: '/system',
      route_name: 'system',
      title: '系统管理',
      status: '0',
      order: 1,
      children: [
        {
          id: 11,
          name: 'user',
          type: 2,
          route_path: 'user',
          route_name: 'user',
          title: '用户管理',
          status: '0',
          order: 1,
          permission: 'module_system:user:query',
        },
      ],
    },
  ],
};

describe('app getInitialState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHistory.location = {
      pathname: '/welcome',
      search: '',
      hash: '',
    };
  });

  it('fetches the current user when not on the login page', async () => {
    const { getInitialState } = await import('./app');
    mockFetchCurrentUser.mockResolvedValue(backendUser);

    const state = await getInitialState();

    expect(mockFetchCurrentUser).toHaveBeenCalled();
    expect(state.currentUser).toEqual(backendUser);
    expect(state.menus).toEqual(backendUser.menus);
    expect(state.permissions).toEqual(['module_system:user:query']);
    expect(state.settingDrawerOpen).toBe(false);
    expect(state.fetchUserInfo).toBeDefined();
  });

  it('redirects to login when fetching the current user fails', async () => {
    const { getInitialState } = await import('./app');
    mockFetchCurrentUser.mockRejectedValue(new Error('401 Unauthorized'));

    const state = await getInitialState();

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('/user/login?redirect='),
    );
    expect(state.currentUser).toBeUndefined();
  });

  it('does not fetch the current user on the login page', async () => {
    const { getInitialState } = await import('./app');
    mockHistory.location = {
      pathname: '/user/login',
      search: '',
      hash: '',
    };

    const state = await getInitialState();

    expect(mockFetchCurrentUser).not.toHaveBeenCalled();
    expect(state.currentUser).toBeUndefined();
    expect(state.fetchUserInfo).toBeDefined();
  });

  it('does not fetch the current user on the register pages', async () => {
    const { getInitialState } = await import('./app');

    mockHistory.location = {
      pathname: '/user/register',
      search: '',
      hash: '',
    };
    await getInitialState();

    mockHistory.location = {
      pathname: '/user/register-result',
      search: '',
      hash: '',
    };
    await getInitialState();

    expect(mockFetchCurrentUser).not.toHaveBeenCalled();
  });

  it('encodes the redirect path correctly', async () => {
    const { getInitialState } = await import('./app');
    mockHistory.location = {
      pathname: '/admin/users',
      search: '?page=2',
      hash: '#section',
    };
    mockFetchCurrentUser.mockRejectedValue(new Error('401'));

    await getInitialState();

    expect(mockReplace).toHaveBeenCalledWith(
      `/user/login?redirect=${encodeURIComponent('/admin/users?page=2#section')}`,
    );
  });

  it('does not nest the redirect parameter when already on the login page', async () => {
    const { getInitialState } = await import('./app');
    mockHistory.location = {
      pathname: '/user/login',
      search: '?redirect=%2Fsystem%2Fuser',
      hash: '',
    };
    mockFetchCurrentUser.mockRejectedValue(new Error('401'));

    // 登录页自己也会调 fetchUserInfo(登录成功后拉当前用户),
    // 这时已经在登录页了,再套一层 redirect 就成了
    // /user/login?redirect=%2Fuser%2Flogin%3Fredirect%3D…
    const state = await getInitialState();
    await state.fetchUserInfo?.();

    expect(mockReplace).toHaveBeenCalledWith('/user/login');
  });

  it('includes the default settings in the initial state', async () => {
    const { getInitialState } = await import('./app');
    mockFetchCurrentUser.mockResolvedValue(backendUser);

    const state = await getInitialState();

    expect(state.settings).toEqual({ navTheme: 'light' });
  });

  it('fetchUserInfo returns the user state patch', async () => {
    const { getInitialState } = await import('./app');
    mockFetchCurrentUser.mockResolvedValue(backendUser);

    const state = await getInitialState();
    const userState = await state.fetchUserInfo?.();

    expect(userState).toEqual({
      currentUser: backendUser,
      menus: backendUser.menus,
      permissions: ['module_system:user:query'],
    });
  });
});

describe('app layout menuDataRender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders backend menus and drops the ones without a frontend route', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { layout } = await import('./app');

    const config = layout({
      initialState: {
        menus: [
          {
            id: 10,
            name: 'system',
            type: 1,
            route_path: '/system',
            route_name: 'system',
            title: '系统管理',
            icon: 'ri:settings-2-line',
            status: '0',
            order: 1,
            children: [
              {
                id: 11,
                name: 'user',
                type: 2,
                route_path: 'user',
                route_name: 'user',
                title: '用户管理',
                icon: 'ri:user-line',
                status: '0',
                order: 1,
              },
              {
                id: 12,
                name: 'unknown',
                type: 2,
                route_path: 'unknown',
                route_name: 'unknown',
                title: '未注册页面',
                status: '0',
                order: 2,
              },
            ],
          },
        ],
      },
      setInitialState: vi.fn(),
    } as any);

    const items = config.menuDataRender?.([
      { path: '/system', icon: 'SettingOutlined' },
      { path: '/system/user', icon: 'UserOutlined' },
    ] as any);

    expect(items).toEqual([
      {
        path: '/system',
        name: '系统管理',
        // 图标取前端路由表的,不是后端的 ri:xxx
        icon: 'SettingOutlined',
        locale: false,
        children: [
          {
            path: '/system/user',
            name: '用户管理',
            icon: 'UserOutlined',
            locale: false,
          },
        ],
      },
    ]);
    expect(warn).toHaveBeenCalledWith('[menu] 前端缺少路由: /system/unknown');
    warn.mockRestore();
  });

  it('renders no menu items when the backend menus are missing', async () => {
    const { layout } = await import('./app');

    const config = layout({
      initialState: {},
      setInitialState: vi.fn(),
    } as any);

    expect(config.menuDataRender?.([])).toEqual([]);
  });

  it('keeps a ReactElement icon coming from the frontend routes', async () => {
    const { layout } = await import('./app');
    const icon = <span className="menu-icon" />;

    const config = layout({
      initialState: {
        menus: [
          {
            id: 11,
            name: 'user',
            type: 2,
            route_path: '/system/user',
            route_name: 'user',
            title: '用户管理',
            status: '0',
            order: 1,
          },
        ],
      },
      setInitialState: vi.fn(),
    } as any);

    const items = config.menuDataRender?.([
      { path: '/system/user', icon },
    ] as any);

    expect(items?.[0].icon).toBe(icon);
  });
});

describe('app rootContainer', () => {
  it('wraps the tree in antd App and keeps the content renderable', async () => {
    // <App> 让提示走 App.useApp() 的实例(不吃主题的静态 message 就被换掉了),
    // 代价是 DOM 多一层 .ant-app —— 内容必须照常渲染出来。
    const { rootContainer } = await import('./app');

    const { container } = await render(
      rootContainer(<div data-testid="app-content">内容</div>),
    );

    expect(container.querySelector('.ant-app')).toBeTruthy();
    expect(container.querySelector('[data-testid="app-content"]')).toBeTruthy();
  });

  it('takes the request base URL from the single source in services/http', async () => {
    // baseURL 只能有一个定义处:src/services/http.ts 的 API_BASE_URL。
    // 这里断言 app.tsx 用的是它,而不是自己又抄了一份 '/api/v1'。
    const { request } = await import('./app');
    const { API_BASE_URL } = await import('@/services/http');

    expect(request.baseURL).toBe(API_BASE_URL);
  });
});
