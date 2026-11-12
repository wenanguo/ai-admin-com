import { describe, expect, it, vi } from 'vitest';
import {
  type BackendMenu,
  buildHomeMenuItem,
  buildMenuItems,
  collectPaths,
  collectPermissions,
  collectRouteIcons,
  HOME_MENU_PATH,
  joinAbsolutePath,
} from './adapter';

const menu = (over: Partial<BackendMenu>): BackendMenu => ({
  id: 1,
  parent_id: null,
  name: '节点',
  type: 2,
  order: 1,
  permission: null,
  icon: null,
  route_name: null,
  route_path: '/x',
  component_path: null,
  hidden: false,
  status: 0,
  children: null,
  ...over,
});

describe('joinAbsolutePath', () => {
  it('joins a relative segment onto the parent', () => {
    expect(joinAbsolutePath('/system', 'user')).toBe('/system/user');
  });

  it('strips leading slashes from the segment', () => {
    expect(joinAbsolutePath('/system', '/user')).toBe('/system/user');
  });

  it('returns the parent when the segment is empty', () => {
    expect(joinAbsolutePath('/system', '')).toBe('/system');
  });

  it('does not double the separator', () => {
    expect(joinAbsolutePath('/system/', 'user')).toBe('/system/user');
  });
});

describe('collectPermissions', () => {
  it('collects permission codes from the whole tree', () => {
    const perms = collectPermissions([
      menu({
        id: 1,
        type: 1,
        permission: 'module_system:user:query',
        children: [
          menu({ id: 2, type: 2, permission: 'module_system:user:create' }),
        ],
      }),
    ]);

    expect(perms.sort()).toEqual([
      'module_system:user:create',
      'module_system:user:query',
    ]);
  });

  it('includes permissions carried by roles', () => {
    const perms = collectPermissions(
      [menu({ id: 1, permission: 'a:query' })],
      [{ menus: [menu({ id: 9, permission: 'b:create' })] }],
    );

    expect(perms.sort()).toEqual(['a:query', 'b:create']);
  });

  it('deduplicates repeated permission codes', () => {
    const perms = collectPermissions([
      menu({ id: 1, permission: 'same' }),
      menu({ id: 2, permission: 'same' }),
    ]);

    expect(perms).toEqual(['same']);
  });

  it('ignores null permissions', () => {
    expect(collectPermissions([menu({ id: 1, permission: null })])).toEqual([]);
  });
});

describe('collectPaths', () => {
  it('collects paths including nested children', () => {
    const paths = collectPaths([
      { path: '/system', children: [{ path: '/system/user' }] },
    ]);

    expect([...paths].sort()).toEqual(['/system', '/system/user']);
  });
});

describe('collectRouteIcons', () => {
  it('collects the route icons by path', () => {
    const icons = collectRouteIcons([
      { path: '/system', icon: 'SettingOutlined' },
      { path: '/system/user', icon: 'UserOutlined' },
    ]);

    expect(icons.get('/system')).toBe('SettingOutlined');
    expect(icons.get('/system/user')).toBe('UserOutlined');
  });
});

describe('buildMenuItems', () => {
  it('builds nested items and resolves relative child paths', () => {
    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 1,
          name: '系统管理',
          route_path: '/system',
          children: [
            menu({
              id: 2,
              type: 2,
              name: '用户管理',
              route_path: 'user',
              permission: 'module_system:user:query',
            }),
          ],
        }),
      ],
      new Set(['/system', '/system/user']),
    );

    expect(items).toHaveLength(1);
    expect(items[0].path).toBe('/system');
    expect(items[0].children?.[0].path).toBe('/system/user');
    expect(items[0].children?.[0].name).toBe('用户管理');
  });

  it('skips button type menus', () => {
    const items = buildMenuItems(
      [menu({ id: 1, type: 3, name: '新增', route_path: '' })],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(0);
  });

  it('skips disabled and hidden menus', () => {
    const items = buildMenuItems(
      [
        menu({ id: 1, type: 2, route_path: '/a', status: 1 }),
        menu({ id: 2, type: 2, route_path: '/b', hidden: true }),
      ],
      new Set(['/a', '/b']),
    );

    expect(items).toHaveLength(0);
  });

  it('skips disabled menus whose status arrives as a string', () => {
    // 后端 status 是字符串列("0"/"1"),线上负载就是 "1"
    const items = buildMenuItems(
      [
        menu({ id: 1, type: 2, route_path: '/a', status: '1' }),
        menu({ id: 2, type: 2, route_path: '/b', status: '0' }),
      ],
      new Set(['/a', '/b']),
    );

    expect(items).toHaveLength(1);
    expect(items[0].path).toBe('/b');
  });

  it('skips menus whose route is not registered in the frontend and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = buildMenuItems(
      [menu({ id: 1, type: 2, route_path: '/system/nope' })],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[menu] 前端缺少路由: /system/nope');
    warn.mockRestore();
  });

  it('warns about the same missing route only once', () => {
    // menuDataRender 每次渲染都会重跑,不去重的话一次渲染能刷几百条
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    buildMenuItems(
      [menu({ id: 1, type: 2, route_path: '/system/warn-once' })],
      new Set(['/system/user']),
    );
    buildMenuItems(
      [menu({ id: 1, type: 2, route_path: '/system/warn-once' })],
      new Set(['/system/user']),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[menu] 前端缺少路由: /system/warn-once');
    warn.mockRestore();
  });

  it('skips external links with a dedicated warning', () => {
    // type=4 是外链,本轮不渲染 —— 这是已知且有意的行为,不是「前端缺路由」。
    // 但要单独告警:否则「这条菜单为什么不见了」没人知道,
    // 而且告警文案混进「前端缺少路由」会把两种问题搅在一起。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = buildMenuItems(
      [menu({ id: 1, type: 4, name: 'swagger', route_path: '/swagger' })],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[menu] 外链菜单暂不支持渲染: /swagger');
    // 不能与「前端缺少路由」混为一谈
    expect(warn).not.toHaveBeenCalledWith('[menu] 前端缺少路由: /swagger');
    warn.mockRestore();
  });

  it('warns about the same external link only once', () => {
    // menuDataRender 每次渲染都会重跑,不去重的话一次渲染能刷几百条
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    buildMenuItems(
      [menu({ id: 1, type: 4, name: 'docs', route_path: '/docs' })],
      new Set(['/system/user']),
    );
    buildMenuItems(
      [menu({ id: 1, type: 4, name: 'docs', route_path: '/docs' })],
      new Set(['/system/user']),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[menu] 外链菜单暂不支持渲染: /docs');
    warn.mockRestore();
  });

  it('does not warn about an external link that is disabled or hidden', () => {
    // 停用(status=1)/隐藏(hidden)的外链是被「有意跳过」的,原因不是「它是外链」。
    // 这时再补一句「外链菜单暂不支持渲染」就是把两种原因搅在一起:
    // 运维看日志会以为「外链不受支持」才是它没出现的原因。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = buildMenuItems(
      [
        menu({ id: 1, type: 4, route_path: '/ext-disabled', status: 1 }),
        menu({ id: 2, type: 4, route_path: '/ext-hidden', hidden: true }),
      ],
      new Set(['/ext-disabled', '/ext-hidden']),
    );

    expect(items).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops a directory without children whose path is not a frontend route', () => {
    // 空目录没有子项,自身路径也没注册 ⇒ 留着就是一条点进去 404 的死链
    const items = buildMenuItems(
      [menu({ id: 1, type: 1, name: '空目录', route_path: '/empty-dir' })],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(0);
  });

  it('keeps a directory without children whose path is a frontend route', () => {
    const items = buildMenuItems(
      [menu({ id: 1, type: 1, name: '系统管理', route_path: '/system' })],
      new Set(['/system']),
    );

    expect(items).toHaveLength(1);
    expect(items[0].path).toBe('/system');
  });

  it('does not reorder the backend menu array', () => {
    const input = [
      menu({ id: 1, type: 2, name: 'B', route_path: '/b', order: 2 }),
      menu({ id: 2, type: 2, name: 'A', route_path: '/a', order: 1 }),
    ];

    buildMenuItems(input, new Set(['/a', '/b']));

    expect(input.map((item) => item.name)).toEqual(['B', 'A']);
  });

  it('keeps a directory even when its path is not a frontend route', () => {
    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 1,
          route_path: '/system',
          children: [menu({ id: 2, type: 2, route_path: '/system/user' })],
        }),
      ],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(1);
    expect(items[0].children?.[0].path).toBe('/system/user');
  });

  it('drops a directory whose children were all skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 1,
          route_path: '/system',
          children: [menu({ id: 2, type: 2, route_path: '/system/missing' })],
        }),
      ],
      new Set(['/system/user']),
    );

    expect(items).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[menu] 前端缺少路由: /system/missing');
    warn.mockRestore();
  });

  it('keeps a menu whose children were all skipped', () => {
    // type=2 的父菜单自身路径已注册 → 父菜单保留,只是没有子项
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 2,
          name: '系统管理',
          route_path: '/system',
          children: [menu({ id: 2, type: 2, route_path: '/system/missing' })],
        }),
      ],
      new Set(['/system']),
    );

    expect(items).toHaveLength(1);
    expect(items[0].path).toBe('/system');
    expect(items[0].children).toBeUndefined();
    warn.mockRestore();
  });

  it('uses the backend title as the menu label', () => {
    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 2,
          name: 'user',
          title: '用户管理',
          route_path: '/system/user',
        }),
      ],
      new Set(['/system/user']),
    );

    expect(items[0].name).toBe('用户管理');
  });

  it('falls back to route_name when title and name are absent', () => {
    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 2,
          name: null,
          title: null,
          route_name: 'system-user',
          route_path: '/system/user',
        }),
      ],
      new Set(['/system/user']),
    );

    expect(items[0].name).toBe('system-user');
  });

  it('falls back to the path when title, name and route_name are absent', () => {
    const items = buildMenuItems(
      [
        menu({
          id: 1,
          type: 2,
          name: null,
          title: null,
          route_name: null,
          route_path: '/system/user',
        }),
      ],
      new Set(['/system/user']),
    );

    expect(items[0].name).toBe('/system/user');
  });

  it('uses the frontend route icon instead of the backend icon', () => {
    const items = buildMenuItems(
      [menu({ route_path: '/system/user', icon: 'ri:user-line' })],
      new Set(['/system/user']),
      new Map([['/system/user', 'UserOutlined']]),
    );

    expect(items[0].icon).toBe('UserOutlined');
  });

  it('sorts siblings by order ascending', () => {
    const items = buildMenuItems(
      [
        menu({ id: 1, type: 2, name: 'B', route_path: '/b', order: 2 }),
        menu({ id: 2, type: 2, name: 'A', route_path: '/a', order: 1 }),
      ],
      new Set(['/a', '/b']),
    );

    expect(items.map((i) => i.name)).toEqual(['A', 'B']);
  });

  it('sorts a node without order last', () => {
    // 后端 order 列默认 999:缺 order 的节点排在最后,而不是最前
    const items = buildMenuItems(
      [
        menu({ id: 1, type: 2, name: 'A', route_path: '/a', order: 1 }),
        menu({ id: 2, type: 2, name: 'Z', route_path: '/z', order: null }),
      ],
      new Set(['/a', '/z']),
    );

    expect(items.map((i) => i.name)).toEqual(['A', 'Z']);
  });
});

/**
 * 前端自有的「首页」菜单项。
 *
 * ⚠️ 后端 `platform_menu` 里那个叫「首页」的行是 `client='app'`
 *    （**移动端 APP** 的首页）⇒ Web 端的下发菜单里**没有**首页
 *    ⇒ 这条菜单项由前端自己加。
 */
describe('前端自有的「首页」菜单项', () => {
  it('指向 /app/home,标题是「首页」', () => {
    const item = buildHomeMenuItem();

    expect(item.path).toBe(HOME_MENU_PATH);
    expect(HOME_MENU_PATH).toBe('/app/home');
    expect(item.name).toBe('首页');
    expect(item.locale).toBe(false);
  });

  it('图标取自前端路由表(按 path 查)', () => {
    const icons = new Map([['/app/home', 'HomeOutlined']]);

    expect(buildHomeMenuItem(icons).icon).toBe('HomeOutlined');
    // 路由表里没有 ⇒ 就没有图标(而不是报错)
    expect(buildHomeMenuItem(new Map()).icon).toBeUndefined();
    expect(buildHomeMenuItem().icon).toBeUndefined();
  });
});
