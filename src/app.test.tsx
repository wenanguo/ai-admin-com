import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

vi.mock('@/auth/session', () => ({
  fetchCurrentUser: (...args: unknown[]) => mockFetchCurrentUser(...args),
}));

vi.mock('@/components', () => ({
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
});
