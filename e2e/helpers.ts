import { expect, type Locator, type Page } from '@playwright/test';

/**
 * e2e 共享夹具。
 *
 * 设计原则:**零模块耦合** —— 这里不认识任何具体模块,
 * 菜单树、路径、文案、错误信息全部由调用方传进来。
 * 于是新增一个模块的 spec 只需要几行就能起一个完整的受控页面。
 */

/**
 * 等应用真正挂载。
 *
 * umi dev server 首次编译时,页面先显示「正在加载资源」这一屏,
 * 此时应用还没跑起来 —— 断言会全部落空(接口都还没发出去)。
 * CI 上没有预热的 dev server,尤其容易踩。
 *
 * 判断条件与页面形态无关:登录页走的是 UserLayout,没有 ProLayout。
 *
 * 另外还要挡掉打包器的「正在编译」提示:
 * dev server 是**按需编译**的,首屏加载完之后,路由对应的 chunk 可能还在编译,
 * 页面会停在「Utoopack is compiling...」。此时 #root 已经有内容(Skeleton),
 * 但真正的页面还没渲染 —— 只判断 #root 有子节点会过早放行,断言随即失败。
 *
 * 现在 e2e 默认跑生产构建(见 playwright.config.ts),这条分支只在
 * 有人手动对着 dev server 跑 `e2e:only` 时才会命中。
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root');
      const loading = document.body.textContent?.includes('正在加载资源');
      const compiling = document.body.textContent?.includes('compiling');
      return !!root && root.childElementCount > 0 && !loading && !compiling;
    },
    undefined,
    { timeout: 120_000 },
  );
}

/* -------------------------------------------------------------------------- */
/* 菜单树                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 菜单树里的按钮节点(type=3)。
 *
 * 机制(前端 src/menu/adapter.ts):
 * - collectPermissions 遍历**原始**菜单树,把带 permission 的节点全收进权限集合
 * - buildMenuItems 渲染侧边栏时把 type=3 的节点剔掉
 *
 * 所以 type=3 节点 = 「授予权限,但不出现在菜单里」。
 */
export type MenuButton = {
  /** 按钮标题(仅作可读性,前端不展示) */
  title: string;
  /** 权限码,例如 module_system:position:create */
  permission: string;
};

/** 菜单树里的一个模块子菜单(type=2) */
export type ModuleMenu = {
  /** 侧边栏显示的标题,例如「岗位管理」 */
  title: string;
  /** 相对 route_path,例如 'position'(父目录 /system 会拼成 /system/position) */
  routePath: string;
  /** 菜单自身的权限码,例如 module_system:position:query */
  permission?: string;
  /** type=3 按钮节点 */
  buttons?: MenuButton[];
};

/** 后端 current/info 下发的菜单节点 */
export type MenuNode = {
  id: number;
  parent_id: number | null;
  name: string;
  /** 1=目录 2=菜单 3=按钮 */
  type: 1 | 2 | 3;
  order: number;
  route_path: string;
  title: string;
  permission: string | null;
  status: number;
  hidden: boolean;
  children: MenuNode[] | null;
};

/** 角色(后端把菜单挂在角色下,collectPermissions 会一起遍历) */
export type RoleNode = {
  menus?: MenuNode[] | null;
};

/** 后端 current/info 的成功信封 */
export type CurrentUserEnvelope = {
  code: number;
  msg: string;
  data: {
    id: number;
    username: string;
    name: string;
    status: number;
    is_superuser: boolean;
    role_ids: number[];
    roles: RoleNode[];
    menus: MenuNode[];
  };
  status_code: number;
  success: boolean;
};

/**
 * 造 current/info 的菜单树信封。
 *
 * 结构固定为「/system 目录 → 模块菜单(type=2) → 按钮节点(type=3)」,
 * 与后端适配器的拼接方式一致:子菜单的 route_path 是相对的
 * ('position' → /system/position),必须和前端路由表逐字对齐。
 */
export function buildCurrentUserResponse(
  menus: ModuleMenu[],
): CurrentUserEnvelope {
  let nextButtonId = 30;

  const children: MenuNode[] = menus.map((menu, index) => {
    const id = 3 + index;
    const buttons = menu.buttons ?? [];

    return {
      id,
      parent_id: 2,
      name: menu.title,
      type: 2,
      order: index + 1,
      route_path: menu.routePath,
      title: menu.title,
      permission: menu.permission ?? null,
      status: 0,
      hidden: false,
      children: buttons.length
        ? buttons.map((button, buttonIndex) => ({
            id: nextButtonId++,
            parent_id: id,
            name: button.title,
            type: 3,
            order: buttonIndex + 1,
            route_path: '',
            title: button.title,
            permission: button.permission,
            status: 0,
            hidden: false,
            children: null,
          }))
        : null,
    };
  });

  return {
    code: 0,
    msg: '获取当前用户信息成功',
    data: {
      id: 1,
      username: 'admin',
      name: '管理员',
      status: 0,
      is_superuser: true,
      role_ids: [1],
      roles: [],
      menus: [
        {
          id: 2,
          parent_id: null,
          name: '系统管理',
          type: 1,
          order: 2,
          route_path: '/system',
          title: '系统管理',
          permission: null,
          status: 0,
          hidden: false,
          children,
        },
      ],
    },
    status_code: 200,
    success: true,
  };
}

/* -------------------------------------------------------------------------- */
/* 业务错误信封                                                                */
/* -------------------------------------------------------------------------- */

/** 业务错误:HTTP 500 + 信封(后端业务异常的固定形态) */
export type BusinessErrorBody = {
  code: -1;
  msg: string;
  data: null;
  status_code: 500;
  success: false;
};

/**
 * 业务错误响应体。
 *
 * 后端抛 CustomException 时就是这个形态:HTTP 500 + {code:-1, msg, ...}。
 * 请求层会把它转成 BizError,errorHandler 弹的是信封里的 msg(后端文案),
 * 而不是 axios 的 "Request failed with status code 500"。
 */
export function businessErrorBody(msg: string): BusinessErrorBody {
  return {
    code: -1,
    msg,
    data: null,
    status_code: 500,
    success: false,
  };
}

/* -------------------------------------------------------------------------- */
/* 受控页面                                                                    */
/* -------------------------------------------------------------------------- */

/** 装受控页面时的配置 */
export type ModulePageFixture = {
  /** 菜单树里的模块子菜单(可以多个) */
  menus: ModuleMenu[];
  /** 列表接口的 URL glob(能匹配到 /api/v1/system/position/list 的请求) */
  listUrl: string;
  /** 列表接口的响应体 */
  listBody: unknown;
  /** 列表接口的 HTTP 状态码,默认 200(业务错误给 500) */
  listStatus?: number;
};

/**
 * 装好登录态:前端认为已登录,请求拦截器会带上这个 Bearer。
 *
 * 必须在 goto 之前调用(addInitScript 只对之后的导航生效)。
 */
export async function seedAuthState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('remember_me', 'true');
    localStorage.setItem('access_token', 'e2e-mock-access-token');
    localStorage.setItem('refresh_token', 'e2e-mock-refresh-token');
  });
}

/**
 * 装好受控页面:菜单树 + 列表接口 + 登录态。
 *
 * 返回收集到的列表请求 URL —— 调用方用 expect.poll 断言分页参数,
 * 不要直接读数组(请求可能还没发出)。
 */
export async function setupModulePage(
  page: Page,
  fixture: ModulePageFixture,
): Promise<string[]> {
  const { menus, listUrl, listBody, listStatus = 200 } = fixture;

  const listRequests: string[] = [];

  await page.route('**/api/v1/system/user/current/info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCurrentUserResponse(menus)),
    }),
  );

  await page.route(listUrl, (route) => {
    listRequests.push(route.request().url());
    return route.fulfill({
      status: listStatus,
      contentType: 'application/json',
      body: JSON.stringify(listBody),
    });
  });

  await seedAuthState(page);

  return listRequests;
}

/**
 * 打开模块页并等到「页面真的可用」。
 *
 * **不用 networkidle**:它等的是「网络静默 500ms」,页面里有预取/长连接时
 * 永远等不到;并发跑构建时也最容易假失败(第一轮报告里已经踩过一次)。
 * 这里的判据是确定性的内容信号:
 * - waitForApp:应用挂载完成(#root 有内容、不是「正在加载资源」)
 * - ready:该用例关心的那个元素(侧边栏菜单项 / 表格行 / 空状态 …)
 */
export async function gotoModulePage(
  page: Page,
  path: string,
  ready?: Locator,
): Promise<void> {
  await page.goto(path);
  await waitForApp(page);

  if (ready) {
    await ready.first().waitFor({ state: 'visible', timeout: 30_000 });
  }
}

/* -------------------------------------------------------------------------- */
/* 权限门控                                                                    */
/* -------------------------------------------------------------------------- */

/** 权限门控用例的入参 */
export type PermissionGatedButtonOptions = {
  /** 按钮在页面上的可访问名(例如「新增」「删除」) */
  buttonName: string;
  /** 按钮的权限码(会被挂成菜单树里的 type=3 节点) */
  permission: string;
  /**
   * 菜单树里**是否**挂这条按钮节点:
   * - false:不挂 ⇒ 按钮应当被禁用
   * - true:挂 ⇒ 按钮应当可用
   */
  granted: boolean;
  /** type=3 按钮节点的标题,默认与 buttonName 相同 */
  buttonTitle?: string;
  /** 模块菜单(type=2)。同权限的按钮节点由断言自己增删 */
  menu: ModuleMenu;
  /** 页面路径 */
  path: string;
  /** 列表接口的 URL glob */
  listUrl: string;
  /** 列表接口的响应体 */
  listBody: unknown;
  /** 应用就绪的内容信号(通常是侧边栏菜单项) */
  ready?: Locator;
  /**
   * 可选:断言前的准备工作。
   *
   * 双 tab 的只读页要断言**第二个 tab** 的按钮,得先把 tab 切过去
   * (并把那个 tab 的列表接口拦下来)—— 这里给调用方一个口子。
   * 助手本身仍然不认识任何具体模块。
   */
  prepare?: (page: Page) => Promise<void>;
};

/**
 * 断言「按钮是否被权限码门控」。
 *
 * 机制:后端菜单树里的 type=3 节点带 permission ——
 * collectPermissions 会把它们收进权限集合(但 buildMenuItems 把它们从侧边栏剔掉),
 * 所以按钮能不能点,取决于菜单树里有没有那条节点。
 *
 * 这里**不写死**模块路径 / 菜单 / 文案:全部由调用方传进来,
 * 于是每个模块 spec 的权限用例只剩几行。
 */
export async function assertPermissionGatedButton(
  page: Page,
  options: PermissionGatedButtonOptions,
): Promise<void> {
  const {
    buttonName,
    permission,
    granted,
    buttonTitle,
    menu,
    path,
    listUrl,
    listBody,
    ready,
    prepare,
  } = options;

  // 同权限的节点先摘掉,再按 granted 决定要不要挂上 —— 避免调用方的菜单里
  // 已经带了这条节点,导致「不挂」的用例其实挂上了
  const otherButtons = (menu.buttons ?? []).filter(
    (button) => button.permission !== permission,
  );
  const buttons = granted
    ? [...otherButtons, { title: buttonTitle ?? buttonName, permission }]
    : otherButtons;

  await setupModulePage(page, {
    menus: [{ ...menu, buttons }],
    listUrl,
    listBody,
  });
  await gotoModulePage(page, path, ready);

  // 准备工作(切 tab、额外拦截接口 …)在断言之前跑
  if (prepare) {
    await prepare(page);
  }

  const button = page.getByRole('button', { name: buttonName }).first();
  if (granted) {
    await expect(button).toBeEnabled();
  } else {
    await expect(button).toBeDisabled();
  }
}
