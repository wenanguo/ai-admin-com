/** 后端菜单节点(后端 app/api/v1/module_platform/menu/schema.py 的 MenuOutSchema) */
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
  status?: number | null;
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
  icon?: string;
  locale: false;
  children?: MenuItem[];
}

/** 前端路由派生的菜单节点(ProLayout 的 menuData) */
export interface RouteLike {
  path?: string;
  children?: RouteLike[];
}

const MENU_TYPE_DIRECTORY = 1;
const MENU_TYPE_BUTTON = 3;

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
      order: item.order ?? 0,
    };
  });
}

/**
 * 后端菜单树 → ProLayout 菜单项。
 *
 * 规则:
 * - 按钮(type=3)不生成菜单项
 * - 停用(status=1)与隐藏(hidden)跳过
 * - 目录(type=1)允许路径不在前端路由表中(它只是分组);
 *   菜单(type=2)路径必须已在前端注册,否则跳过并告警
 * - 目录下所有子项都被跳过时,目录本身也不渲染
 */
export function buildMenuItems(
  backendMenus: BackendMenu[],
  knownPaths: Set<string>,
): MenuItem[] {
  const build = (nodes: InternalMenu[]): MenuItem[] => {
    const result: MenuItem[] = [];

    for (const node of nodes.sort((a, b) => a.order - b.order)) {
      const { item, path } = node;

      if (item.type === MENU_TYPE_BUTTON) continue;
      if (item.status === 1) continue;
      if (item.hidden) continue;

      const children = build(node.children);
      const isDirectory = item.type === MENU_TYPE_DIRECTORY;
      const hadChildren = node.children.length > 0;

      if (!isDirectory && !knownPaths.has(path)) {
        console.warn(`[menu] 前端缺少路由: ${path}`);
        continue;
      }

      if (hadChildren && children.length === 0) continue;
      if (!path && !isDirectory) continue;

      result.push({
        path,
        name: item.title || item.name || item.route_name || path,
        icon: item.icon || undefined,
        locale: false,
        ...(children.length > 0 ? { children } : {}),
      });
    }

    return result;
  };

  return build(toInternal(backendMenus));
}
