import type { ReactNode } from 'react';

/** 后端菜单节点(后端 backend/app/api/v1/module_system/menu/schema.py 的 MenuOutSchema) */
export interface BackendMenu {
  id?: number | null;
  parent_id?: number | null;
  name?: string | null;
  /** 1=目录 2=菜单 3=按钮 4=外链 */
  type?: number | null;
  order?: number | null;
  permission?: string | null;
  icon?: string | null;
  route_name?: string | null;
  route_path?: string | null;
  component_path?: string | null;
  hidden?: boolean | null;
  /** 后端是字符串("0" 启用 / "1" 停用),不是数字 */
  status?: number | string | null;
  title?: string | null;
  children?: BackendMenu[] | null;
}

/** 角色(后端 UserOutSchema.roles),菜单挂在角色下 */
export interface RoleLike {
  menus?: BackendMenu[] | null;
}

/** ProLayout 菜单项 */
export interface MenuItem {
  path: string;
  name: string;
  icon?: ReactNode;
  locale: false;
  children?: MenuItem[];
}

/** 前端路由派生的菜单节点(ProLayout 的 menuData) */
export interface RouteLike {
  path?: string;
  icon?: ReactNode;
  redirect?: string;
  children?: RouteLike[];
  /**
   * umi 路由配置里的子路由字段。
   *
   * ⚠️ `config/routes.ts` 用的是 `routes`，ProLayout 的 menuData 用的是
   *    `children` ⇒ 两个都得认。
   */
  routes?: RouteLike[];
}

/**
 * 前端自有的「首页」菜单项。
 *
 * ## 为什么需要它
 *
 * 后端 `platform_menu` 里**确实有**一个叫「首页」的菜单行，
 * 但它的 `client` 是 **`app`** —— 那是**移动端 APP** 的首页
 * （描述写着「APP 移动端-首页」）。
 *
 * ⚠️ Web 端的 `current/info` 只下发 `client = 'pc'` 的菜单
 *    ⇒ **Web 侧边栏里本来就没有「首页」**，前端注册多少路由都没用。
 *
 * ⇒ 所以这条菜单项由**前端自己加**（不是后端下发的）。
 *
 * ⚠️ 它指向 `/app/home` —— 那条路由挂的是**看板页**（用演示数据，不发请求）。
 */
export const HOME_MENU_PATH = '/app/home';

/**
 * 造一个前端自有的「首页」菜单项。
 *
 * @param routeIcons 前端路由派生的图标（按 path 查）
 * @returns 菜单项；没有图标时 `icon` 为 undefined
 */
export function buildHomeMenuItem(
  routeIcons?: Map<string, ReactNode>,
): MenuItem {
  return {
    path: HOME_MENU_PATH,
    name: '首页',
    icon: routeIcons?.get(HOME_MENU_PATH),
    locale: false,
  };
}

const MENU_TYPE_DIRECTORY = 1;
const MENU_TYPE_BUTTON = 3;
const MENU_TYPE_EXTERNAL = 4;

/** 已经警告过的路径,避免每次渲染都刷屏 */
const warnedPaths = new Set<string>();

/** 同一条路径只提醒一次(menuDataRender 每次渲染都会重跑) */
function warnOnce(path: string, text: string): void {
  if (warnedPaths.has(path)) return;
  warnedPaths.add(path);
  console.warn(text);
}

/** 拼接绝对路径:parentAbs + 相对段 */
export function joinAbsolutePath(parentAbs: string, segment: string): string {
  const seg = segment.replace(/^\/+/, '');
  const base = parentAbs.replace(/\/$/, '');
  if (!seg) return base;
  return `${base}/${seg}`;
}

/** 递归收集权限码:菜单树 + 各角色携带的菜单 */
export function collectPermissions(
  menus: BackendMenu[],
  roles?: RoleLike[],
): string[] {
  const set = new Set<string>();

  const walk = (items: BackendMenu[] | null | undefined) => {
    for (const item of items ?? []) {
      if (item.permission) set.add(item.permission);
      if (item.children?.length) walk(item.children);
    }
  };

  walk(menus);
  for (const role of roles ?? []) walk(role.menus);

  return [...set];
}

/** 从前端路由派生的菜单中收集全部 path */
export function collectPaths(items: RouteLike[]): Set<string> {
  const paths = new Set<string>();

  const walk = (list: RouteLike[]) => {
    for (const item of list ?? []) {
      if (item.path) paths.add(item.path);
      if (item.children?.length) walk(item.children);
    }
  };

  walk(items);
  return paths;
}

/**
 * 收集前端路由里的**重定向**：`path → 重定向目标`。
 *
 * ## 为什么需要
 *
 * 后端菜单用的路径与前端的「正式地址」**不总是同一个**：
 * 后端下发的 `route_path` 是插件的源码路径（`/module_pm_project/pm_task`），
 * 前端把它重定向到 `/pm/task`。
 *
 * ⚠️ 菜单项若链接到**重定向的起点**：
 * - 点完以后地址会变成 `/pm/task` ⇒ ProLayout 用 pathname 匹配菜单路径
 *   ⇒ **匹配不上** ⇒ 菜单组自动折叠、菜单项也不高亮（看着像刷新了一遍）。
 *
 * ⇒ 菜单项应该链接到**最终会去的那个地址**（`/pm/task`）：
 * 链接与落地地址一致 ⇒ 匹配得上 ⇒ 菜单组保持展开、菜单项保持高亮。
 */
export function collectRedirects(items: RouteLike[]): Map<string, string> {
  const redirects = new Map<string, string>();
  const walk = (list: RouteLike[]) => {
    for (const item of list ?? []) {
      if (item.path && item.redirect) {
        redirects.set(item.path, item.redirect);
      }
      // `routes` 是 umi 配置里的写法，`children` 是 ProLayout menuData 的写法
      if (item.children?.length) walk(item.children);
      if (item.routes?.length) walk(item.routes);
    }
  };
  walk(items);
  return redirects;
}

/**
 * 解析菜单项该链到哪：优先用重定向的**最终目标**。
 *
 * ⚠️ 只改**叶子菜单**（type=2）：目录(type=1)的路径与它的第一个子菜单
 *    **共用一条**（后端就是这么种的）⇒ 目录也改就会变成两个一样的 key。
 *
 * @param path 后端下发的路径
 * @param redirects 前端路由的重定向表
 * @param knownPaths 前端已注册的路径
 * @returns 该链到的路径
 */
function resolveMenuLink(
  path: string,
  redirects: Map<string, string> | undefined,
  knownPaths: Set<string>,
): string {
  let target = path;
  // 重定向可能链式（A → B → C）⇒ 最多解几层
  for (let i = 0; i < 5; i += 1) {
    const next = redirects?.get(target);
    if (!next || next === target || !knownPaths.has(next)) {
      break;
    }
    target = next;
  }
  return target;
}
export function collectRouteIcons(items: RouteLike[]): Map<string, ReactNode> {
  const icons = new Map<string, ReactNode>();

  const walk = (list: RouteLike[]) => {
    for (const item of list ?? []) {
      if (item.path && item.icon) icons.set(item.path, item.icon);
      if (item.children?.length) walk(item.children);
    }
  };

  walk(items);
  return icons;
}

/** 归一化后的菜单节点:绝对路径 + 排序用的 order */
interface InternalMenu {
  item: BackendMenu;
  path: string;
  children: InternalMenu[];
  order: number;
}

/** 把后端菜单的 route_path 归一为绝对路径(相对路径拼父级) */
function toInternal(items: BackendMenu[], parentAbs = ''): InternalMenu[] {
  return items.map((item) => {
    const raw = (item.route_path ?? '').trim();
    const path = raw
      ? raw.startsWith('/')
        ? raw
        : parentAbs
          ? joinAbsolutePath(parentAbs, raw)
          : `/${raw}`
      : parentAbs;

    return {
      item,
      path,
      children: item.children?.length ? toInternal(item.children, path) : [],
      // 后端 order 列 default=999:缺 order 的节点排在最后
      order: item.order ?? 999,
    };
  });
}

/**
 * 后端菜单树 → ProLayout 菜单项。
 *
 * 规则:
 * - 按钮(type=3)不生成菜单项
 * - 停用(status=1)与隐藏(hidden)跳过 —— 这是有意为之,不该再补任何告警
 * - 外链(type=4)本轮不渲染(跳过,并单独告警)
 *   告警放在停用/隐藏之后:停用或隐藏的外链根本轮不到「外链不支持」这一步,
 *   两种跳过原因不能混为一谈
 * - 目录(type=1)允许路径不在前端路由表中(它只是分组);
 *   菜单(type=2)路径必须已在前端注册,否则跳过并告警
 * - 目录只有在「还有可见子项」或「自身路径已在前端注册」时才保留;
 *   菜单(type=2)不受此规则影响 —— 自身路径已注册就保留,只是没有子项
 */
export function buildMenuItems(
  backendMenus: BackendMenu[],
  knownPaths: Set<string>,
  routeIcons?: Map<string, ReactNode>,
  redirects?: Map<string, string>,
): MenuItem[] {
  const build = (nodes: InternalMenu[]): MenuItem[] => {
    const result: MenuItem[] = [];

    for (const node of [...nodes].sort((a, b) => a.order - b.order)) {
      const { item, path } = node;

      if (item.type === MENU_TYPE_BUTTON) continue;
      // 后端 status 是字符串列,数字 1 与字符串 '1' 都要认
      if (String(item.status) === '1') continue;
      if (item.hidden) continue;
      // 外链本轮不渲染:跳过是已知且有意的行为,不是「前端缺路由」——
      // 但要单独告警,否则「这条菜单为什么不见了」没人知道。
      // 放在停用/隐藏之后:那两种是有意关掉的,不该再挂上「外链不支持」的告警。
      if (item.type === MENU_TYPE_EXTERNAL) {
        warnOnce(path, `[menu] 外链菜单暂不支持渲染: ${path}`);
        continue;
      }

      const children = build(node.children);
      const isDirectory = item.type === MENU_TYPE_DIRECTORY;

      if (!isDirectory && !knownPaths.has(path)) {
        warnOnce(path, `[menu] 前端缺少路由: ${path}`);
        continue;
      }

      // 目录只有在「还有可见子项」或「自身路径已在前端注册」时才保留,
      // 否则它就是一个点进去 404 的死链
      if (isDirectory && children.length === 0 && !knownPaths.has(path)) {
        continue;
      }
      if (!path && !isDirectory) continue;

      /*
       * 链接到**最终会去的那个地址**（见 `resolveMenuLink` 的注释）。
       *
       * ⚠️ 只改叶子菜单：目录(type=1)与它的第一个子菜单共用一条路径
       *    ⇒ 目录也改就会出现两个一样的 key。
       */
      const link = isDirectory
        ? path
        : resolveMenuLink(path, redirects, knownPaths);

      result.push({
        path: link,
        name: item.title || item.name || item.route_name || path,
        // 图标先按后端那条路径找，找不到再按最终地址找
        icon: routeIcons?.get(path) ?? routeIcons?.get(link),
        locale: false,
        ...(children.length > 0 ? { children } : {}),
      });
    }

    return result;
  };

  return build(toInternal(backendMenus));
}
