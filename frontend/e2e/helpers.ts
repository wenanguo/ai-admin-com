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
 * 菜单树的父目录(type=1)。
 *
 * 后端把模块菜单挂在一个目录下:系统管理的模块挂在 '/system' 下,
 * PM 的模块挂在 '/pm' 下。子菜单的 route_path 是**相对**的
 * ('position' → /system/position,'milestone' → /pm/milestone),
 * 必须和前端路由表逐字对齐。
 */
export type MenuParent = {
  /** 父目录的绝对路由路径(如 /system、/pm) */
  routePath: string;
  /** 侧边栏显示的标题(如 系统管理、项目管理) */
  title: string;
  /** 父目录的菜单 id;默认 2 */
  id?: number;
};

/** 默认父目录:系统管理。既有模块(/system/*)的 spec 全部走这个默认值。 */
const DEFAULT_MENU_PARENT: MenuParent = {
  routePath: '/system',
  title: '系统管理',
};

/**
 * 造 current/info 的菜单树信封。
 *
 * 结构固定为「父目录(type=1) → 模块菜单(type=2) → 按钮节点(type=3)」,
 * 与后端适配器的拼接方式一致。
 *
 * @param menus 模块子菜单(任意多个)
 * @param parent 父目录;默认 /system 系统管理 —— PM 模块传 {routePath:'/pm'}
 */
export function buildCurrentUserResponse(
  menus: ModuleMenu[],
  parent: MenuParent = DEFAULT_MENU_PARENT,
): CurrentUserEnvelope {
  let nextButtonId = 30;

  const parentId = parent.id ?? 2;

  const children: MenuNode[] = menus.map((menu, index) => {
    const id = parentId + 1 + index;
    const buttons = menu.buttons ?? [];

    return {
      id,
      parent_id: parentId,
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
          id: parentId,
          parent_id: null,
          name: parent.title,
          type: 1,
          order: 2,
          route_path: parent.routePath,
          title: parent.title,
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
  /**
   * 菜单树的父目录;默认 /system 系统管理。
   * PM 模块的 spec 传 { routePath: '/pm', title: '项目管理' }
   */
  parent?: MenuParent;
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
  const { menus, parent, listUrl, listBody, listStatus = 200 } = fixture;

  const listRequests: string[] = [];

  await page.route('**/api/v1/system/user/current/info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCurrentUserResponse(menus, parent)),
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
 * 把 ProLayout 的左侧菜单**展开**。
 *
 * ## 为什么需要
 *
 * 菜单**默认是收缩的**（只剩一列图标，见 `app.tsx` 的 `defaultCollapsed`）
 * ⇒ 菜单项的**文字看不见** ⇒ 用例里「点某个菜单项」这个动作根本做不了
 * （`getByText('岗位管理')` 永远等不到可见）。
 *
 * ⇒ 所以统一在这里展开一次：菜单项的文字能点了，页面也回到「菜单展开」
 * 这个**绝大多数用例本来预期的样子**。
 */
export async function expandSider(page: Page): Promise<void> {
  /*
   * ⚠️ **必须先等侧栏出现**。
   *
   * `waitForApp` 等的是「`#root` 里有内容」⇒ 它会在 ProLayout 的侧栏
   * **还没渲染**的时候放行（实测：#root 有内容时 `.ant-pro-sider` 还不存在）。
   * ⇒ 侧栏后到、且带着 `collapsed` 类 ⇒ 菜单项的文字永远看不见。
   */
  await page
    .locator('.ant-pro-sider')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 });

  const collapsed = page.locator('.ant-pro-sider.ant-layout-sider-collapsed');
  if ((await collapsed.count()) === 0) {
    return;
  }
  // 收缩态下这个按钮就是「展开」的箭头（`.ant-pro-sider-collapsed-button`）
  await page.locator('.ant-pro-sider-collapsed-button').click();
  // 等它真的展开了（类名掉了）
  await page
    .locator('.ant-pro-sider:not(.ant-layout-sider-collapsed)')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  // ⚠️ 再等菜单项的**文字**可见（antd 收缩态不渲染标题 ⇒ 展开动画里才出现）
  await page
    .locator('.ant-menu-title-content')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  // ⚠️ **再等布局稳下来**。
  //
  // 展开菜单会让内容区**横向移动**（动画）⇒ 动画没结束就去量东西，
  // 量到的是一个「还在动」的位置（实测甘特条差了 23.6px）。
  await waitForStableWidth(page);
}

/**
 * 等内容区的宽度**不再变化**（布局稳了）。
 *
 * ⚠️ 菜单展开/收起有动画 ⇒ 动画期间量出来的位置是假的。
 */
export async function waitForStableWidth(page: Page): Promise<void> {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const width = await page.evaluate(
          () =>
            document
              .querySelector('.ant-pro-layout-content')
              ?.getBoundingClientRect().width ?? -1,
        );
        const stable = width === previous;
        previous = width;
        return stable;
      },
      { timeout: 15_000, intervals: [200, 200, 200, 200, 200, 200, 200, 200] },
    )
    .toBe(true);
}

/**
 * 打开模块页并等到「页面真的可用」。
 *
 * **不用 networkidle**:它等的是「网络静默 500ms」,页面里有预取/长连接时
 * 永远等不到;并发跑构建时也最容易假失败(第一轮报告里已经踩过一次)。
 * 这里的判据是确定性的内容信号:
 * - waitForApp:应用挂载完成(#root 有内容、不是「正在加载资源」)
 * - expandSider:菜单默认是收缩的 ⇒ 先展开,菜单项的文字才点得到
 * - ready:该用例关心的那个元素(侧边栏菜单项 / 表格行 / 空状态 …)
 */
export async function gotoModulePage(
  page: Page,
  path: string,
  ready?: Locator,
): Promise<void> {
  await page.goto(path);
  await waitForApp(page);
  await expandSider(page);

  if (ready) {
    await ready.first().waitFor({ state: 'visible', timeout: 30_000 });
  }
}

/* -------------------------------------------------------------------------- */
/* 弹窗与表格的定位器                                                          */
/* -------------------------------------------------------------------------- */

/** 弹窗里的表单项(按 label 文案找,不依赖 antd 的 id 生成规则) */
export function modalFormItem(page: Page, label: string) {
  return page.locator('.ant-modal .ant-form-item', { hasText: label });
}

/**
 * 在弹窗的下拉表单项里选一个候选(字典下拉 / 远程搜索下拉共用)。
 *
 * 选项来自接口(字典或远程搜索),点开后等选项出现即可 ——
 * Playwright 的点击会自动等元素可见。
 *
 * ⚠️ 选项按**整段文本精确匹配**,不是子串:
 * 子串匹配会让「AIPM 核心项目」同时命中「AIPM 核心项目二期」,
 * Playwright 的严格模式直接报 strict-mode violation(定位到多个元素)。
 * 正则的元字符要先转义,否则「(」「+」这类文案会被当成语法。
 */
export async function pickInModal(
  page: Page,
  label: string,
  optionText: string,
): Promise<void> {
  // 上一个下拉可能还在关闭动画里(仍 display:block):先等它关完。
  // 否则两个下拉同时「可见」,选项会点到马上要消失的那一个
  // (antd 的下拉是 portal,两个下拉同时可见时 Playwright 会报 strict-mode violation)
  await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
  await modalFormItem(page, label).locator('input[role="combobox"]').click();
  const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
    .first()
    .click();
}

/** 在弹窗的日期表单项里选「今天」(提交时序列化成 YYYY-MM-DD 字符串) */
export async function pickToday(page: Page, label: string): Promise<void> {
  // 日期面板开合有动画:上一个面板还没关完(仍 display:block)就点下一个
  // 输入框时,新面板尚未挂载,选择器会解析到正在关闭的旧面板的单元格 ——
  // 它随后 display:none,点击永远等不到可见。所以先等旧面板关完再开新的。
  await expect(page.locator('.ant-picker-dropdown:visible')).toHaveCount(0);
  await modalFormItem(page, label).locator('.ant-picker input').click();
  const todayCell = page.locator(
    '.ant-picker-dropdown:visible .ant-picker-cell-today',
  );
  await expect(todayCell).toBeVisible();
  await todayCell.click();
}

/**
 * 主内容区（AI 工作台左边那一列）。
 *
 * ⚠️ **页面级的计数不要用 `page.locator('.ant-alert')`**：
 *    AI 工作台的侧栏（`<aside>`）里也有自己的 `Alert`
 *    （ChatPanel 的错误提示）⇒ 页面级的计数会被侧栏污染，
 *    一个无关的侧栏提示就能让不相干的用例变红。
 *    数「页面上的提示条」时要把范围限定在主内容区里。
 *
 * @param page 页面。
 * @returns 主内容区的定位器。
 */
export function mainContent(page: Page): Locator {
  return page.getByTestId('ai-workspace-content');
}

/** 表格行 —— 用例关心的就绪信号(不用 networkidle) */
export function tableRows(page: Page) {
  return page.locator('.ant-table-tbody tr.ant-table-row');
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
