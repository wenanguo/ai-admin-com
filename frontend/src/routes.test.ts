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
  component?: string;
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

  /**
   * 根路径 ⇒ **默认首页**。
   *
   * ## 为什么要有这条
   *
   * 登录页登录成功后 `window.location.href = '/'`
   * （`getSafeRedirectUrl` 在没有 `redirect` 参数时返回 `'/'`）
   * ⇒ **这一行就是「登录后落在哪」的唯一决定点**。
   *
   * ⚠️ 别改回 `/dashboard/analysis`：那个演示看板的数据接口不存在，
   *    打开就是「Not Found」⇒ 登录后第一屏报错。
   */
  it('/ 重定向到默认首页(/app/home)', () => {
    const root = (routes as RouteNode[]).find((r) => r.path === '/');

    expect(root?.redirect).toBe('/app/home');
    // ⚠️ 父路由带 redirect **又有**子路由 ⇒ 无限重定向（React error #185）
    expect(root?.routes ?? []).toHaveLength(0);
    // 默认首页本身得存在（在 `/app` 这一组里）
    const app = (routes as RouteNode[]).find((r) => r.path === '/app');
    expect(app?.routes?.some((r) => r.path === '/app/home')).toBe(true);
  });

  /**
   * 后端菜单的「首页」⇒ 前端必须有 `/app/home` 这条路由。
   *
   * ## 为什么
   *
   * 菜单适配器的规则：菜单(type=2)的路径必须已在前端路由表里注册，
   * 否则**整条跳过**并告警 ⇒ 没有这条路由，侧边栏里就**看不到「首页」**。
   *
   * ⚠️ 后端 `platform_menu` 里「首页」的 route_path 是 `/app/home`
   *    （顶层菜单项，component_path 为空 —— 适配器只看 route_path）。
   */
  it('后端菜单「首页」的 /app/home 有对应的前端路由', () => {
    const app = (routes as RouteNode[]).find((r) => r.path === '/app');
    const home = app?.routes?.find((r) => r.path === '/app/home');

    expect(home).toBeDefined();
    // 挂的是看板页（它已经改成用演示数据，不发请求）
    expect(home?.component).toBe('./dashboard/analysis');
  });

  /**
   * 后端 AI 菜单的源码路径 → 前端 AI 工作台全屏页。
   *
   * 后端 `platform_menu` 里「AI智能助手」的 route_path 是 'chat'
   * （拼在父目录 `/ai` 下 ⇒ `/ai/chat`）⇒ 前端必须注册这条路径，
   * 否则菜单适配器会判定「前端缺少路由」把它整条跳过，
   * 「AI管理」这一组菜单就**根本不会出现**在侧边栏。
   */
  it('AI 菜单的源码路径 /ai/chat 指向 AI 工作台全屏页', () => {
    const ai = (routes as RouteNode[]).find((r) => r.path === '/ai');
    const chat = ai?.routes?.find((r) => r.path === '/ai/chat');

    expect(chat).toBeDefined();
    expect(chat?.redirect).toBe('/ai/workspace');
    // 全屏页本身也在同一组里（菜单点进去的落点）
    expect(
      ai?.routes?.some((r) => r.path === '/ai/workspace' && !r.redirect),
    ).toBe(true);
  });
});
