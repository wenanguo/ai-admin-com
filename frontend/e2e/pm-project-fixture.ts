import type { Page } from '@playwright/test';
import { PM_PROJECT_PREFIX } from '../src/services/api/pm/paths';
import { seedAuthState } from './helpers';

/**
 * **项目清单页的共享 e2e 夹具。**
 *
 * ## 为什么单独一个文件
 *
 * Playwright 只把 `*.spec.ts` 当测试文件；但**测试文件之间互相 import**
 * 会把被 import 的 `test(...)` **再注册一遍** ⇒ 那份用例会跑两次。
 *
 * ⇒ 共用的夹具必须放在**不是测试文件**的模块里（这个文件名不带 `.spec`）。
 *
 * ## 谁在用
 *
 * - `pm-project.spec.ts` —— 项目清单页 / 项目详情页的用例；
 * - `project-workspace.spec.ts` —— 项目工作台（列表 / 卡片两视图）的守卫。
 *
 * 两边共用同一份菜单树与字典 ⇒ 「e2e 拦的 URL」与「代码请求的 URL」逐字一致。
 */

/** 项目清单页的路径（两个视图共用这一个路径，视图状态在 `?view=` 上） */
export const PROJECT_PAGE_PATH = '/pm/project';

export const CURRENT_INFO_URL = '**/api/v1/system/user/current/info';
export const PROJECT_LIST_URL = `**/api/v1${PM_PROJECT_PREFIX}/list**`;
export const PROJECT_CREATE_URL = `**/api/v1${PM_PROJECT_PREFIX}/create**`;
export const PROJECT_UPDATE_URL = `**/api/v1${PM_PROJECT_PREFIX}/update/**`;
export const PROJECT_DELETE_URL = `**/api/v1${PM_PROJECT_PREFIX}/delete**`;
export const USER_LIST_URL = '**/api/v1/system/user/list**';
/** 字典选项接口(状态/优先级/可见性三个下拉与标签共用) */
export const dictDataUrl = (dictType: string) =>
  `**/api/v1/system/dict/data/info/${dictType}**`;

/**
 * 后端 current/info 下发的 PM 菜单树。
 *
 * 结构:目录 /pm(type=1)→ 项目菜单(type=2)→ 按钮权限节点(type=3)。
 * type=3 节点授予权限但不出现在侧边栏(collectPermissions 收集、buildMenuItems 剔除)。
 */
export const pmCurrentUserResponse = {
  code: 0,
  msg: '获取当前用户信息成功',
  data: {
    id: 1,
    username: 'pmuser',
    name: '项目管理员',
    status: 0,
    is_superuser: false,
    role_ids: [2],
    roles: [],
    menus: [
      {
        id: 2,
        parent_id: null,
        name: '项目管理',
        type: 1,
        order: 2,
        route_path: '/pm',
        title: '项目管理',
        status: 0,
        hidden: false,
        children: [
          {
            id: 3,
            parent_id: 2,
            name: '项目列表',
            type: 2,
            order: 1,
            route_path: 'project',
            title: '项目列表',
            permission: 'module_pm_project:pm_project:query',
            status: 0,
            hidden: false,
            children: [
              {
                id: 30,
                parent_id: 3,
                name: '新增项目',
                type: 3,
                order: 1,
                route_path: '',
                title: '新增项目',
                permission: 'module_pm_project:pm_project:create',
                status: 0,
                hidden: false,
                children: null,
              },
              {
                id: 31,
                parent_id: 3,
                name: '编辑项目',
                type: 3,
                order: 2,
                route_path: '',
                title: '编辑项目',
                permission: 'module_pm_project:pm_project:update',
                status: 0,
                hidden: false,
                children: null,
              },
              {
                id: 32,
                parent_id: 3,
                name: '删除项目',
                type: 3,
                order: 3,
                route_path: '',
                title: '删除项目',
                permission: 'module_pm_project:pm_project:delete',
                status: 0,
                hidden: false,
                children: null,
              },
            ],
          },
        ],
      },
    ],
  },
  status_code: 200,
  success: true,
};

/** 列表里那一行项目(线上的值 + owner_by 冗余字段,形状对齐 ProjectOut) */
export const projectRow = {
  id: 1,
  code: 'AIPM-CORE',
  name: 'AIPM 核心项目',
  description: 'v1 交付',
  owner_id: 1,
  template_id: null,
  status_code: 'planning',
  priority_code: 'P1',
  start_date: '2026-11-01',
  due_date: '2026-12-31',
  visibility_code: 'public',
  tags: '["财务","合规"]',
  extra_fields: null,
  owner_by: { id: 1, name: '张三', username: 'zhangsan' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-01 09:00:00',
};

/**
 * 项目列表的信封。
 *
 * ⚠️ `page_size` 是 **100**：共享数据集一次就取 100 条
 *    （表格的分页是**本地**切片，不再问后端要第 2 页）。
 */
export const projectListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [projectRow],
    total: 1,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 负责人远程搜索的候选(列表页搜索项与表单的下拉共用这个接口) */
export const userListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      { id: 1, username: 'zhangsan', name: '张三' },
      { id: 2, username: 'lisi', name: '李四' },
    ],
    total: 2,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 字典选项的信封(label 给人看,value 是线上码,list_class 决定标签颜色) */
export function dictDataResponse(
  items: { dict_label: string; dict_value: string; list_class: string }[],
) {
  return {
    code: 0,
    msg: '查询成功',
    data: items,
    status_code: 200,
    success: true,
  };
}

/** 项目状态(后端种子 SQL 的 6 态) */
export const statusDictResponse = dictDataResponse([
  { dict_label: '规划中', dict_value: 'planning', list_class: 'info' },
  { dict_label: '进行中', dict_value: 'active', list_class: 'primary' },
  { dict_label: '挂起', dict_value: 'on_hold', list_class: 'warning' },
  { dict_label: '已完成', dict_value: 'completed', list_class: 'success' },
  { dict_label: '已归档', dict_value: 'archived', list_class: 'default' },
  { dict_label: '已取消', dict_value: 'cancelled', list_class: 'danger' },
]);

/** 优先级(P0–P3) */
export const priorityDictResponse = dictDataResponse([
  { dict_label: '紧急', dict_value: 'P0', list_class: 'danger' },
  { dict_label: '高', dict_value: 'P1', list_class: 'warning' },
  { dict_label: '中', dict_value: 'P2', list_class: 'info' },
  { dict_label: '低', dict_value: 'P3', list_class: 'default' },
]);

/** 可见性(公开/内部/私有) */
export const visibilityDictResponse = dictDataResponse([
  { dict_label: '公开', dict_value: 'public', list_class: 'success' },
  { dict_label: '内部', dict_value: 'internal', list_class: 'primary' },
  { dict_label: '私有', dict_value: 'private', list_class: 'warning' },
]);

/** 写操作成功后的信封(提示文案由请求层统一弹,这里只让 promise 落地) */
export const okResponse = {
  code: 0,
  msg: '操作成功',
  data: null,
  status_code: 200,
  success: true,
};

/**
 * 装好受控页面:登录态 + current/info 菜单树 + 项目列表 + 三个字典 + 用户列表。
 * 返回收集到的列表请求 URL(断言分页参数用,读之前先 expect.poll)。
 */
export async function setupProjectPage(page: Page): Promise<string[]> {
  const listRequests: string[] = [];

  await page.route(CURRENT_INFO_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pmCurrentUserResponse),
    }),
  );

  await page.route(PROJECT_LIST_URL, (route) => {
    listRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectListResponse),
    });
  });

  await page.route(dictDataUrl('module_pm_project_status'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statusDictResponse),
    }),
  );
  await page.route(dictDataUrl('module_pm_priority'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(priorityDictResponse),
    }),
  );
  await page.route(dictDataUrl('module_pm_visibility'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(visibilityDictResponse),
    }),
  );

  // 负责人下拉(listUsers):列表页搜索项与表单都会来取
  await page.route(USER_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userListResponse),
    }),
  );

  await seedAuthState(page);

  return listRequests;
}
