import routes from '@root/config/routes';
import { describe, expect, it } from 'vitest';

/**
 * 路由配置的约定。
 *
 * 踩过的坑:父路由同时带 `redirect` 和子路由时,父路由的 redirect 会作用到
 * **所有子路径**上 —— /system/user 被重定向到 /system/user 自己,
 * React Router 无限重定向(React error #185),整页变成 ErrorBoundary 的错误页。
 *
 * 模板里 /dashboard、/form、/profile 都是把 redirect 挂在**子路由**上的写法,
 * /system 之前挂错了位置,这里用测试钉住。
 */

interface RouteNode {
  path?: string;
  redirect?: string;
  routes?: RouteNode[];
}

describe('路由重定向约定', () => {
  const walk = (
    list: RouteNode[],
    visit: (route: RouteNode, parentPath: string) => void,
    parentPath = '',
  ) => {
    for (const route of list ?? []) {
      visit(route, parentPath);
      walk(route.routes ?? [], visit, `${parentPath}${route.path ?? ''}`);
    }
  };

  it('没有父路由同时带 redirect 和子路由', () => {
    const offenders: string[] = [];

    walk(routes as RouteNode[], (route, parentPath) => {
      if (route.redirect && (route.routes?.length ?? 0) > 0) {
        offenders.push(`${parentPath}${route.path}`);
      }
    });

    expect(offenders).toEqual([]);
  });

  it('/system 的重定向挂在子路由上', () => {
    const system = (routes as RouteNode[]).find((r) => r.path === '/system');

    expect(system?.redirect).toBeUndefined();
    expect(system?.routes?.some((r) => r.redirect === '/system/user')).toBe(
      true,
    );
    expect(system?.routes?.some((r) => r.path === '/system/user')).toBe(true);
  });
});
