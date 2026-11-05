import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  PM_PROJECT_PREFIX,
  PM_RISK_PREFIX,
} from '../src/services/api/pm/paths';
import {
  gotoModulePage,
  mainContent,
  modalFormItem,
  pickInModal,
  pickToday,
  setupModulePage,
  tableRows,
} from './helpers';

/**
 * 风险登记册页(/pm/risk)的前端闭环,接口全部拦截。
 *
 * 覆盖七件事(brief 逐条):
 * - 列表渲染:标题/分类字典标签/状态字典标签/分数/等级(本地派生)/负责人/所属项目
 * - 新增提交的是**线上码**(category_code='schedule' / status_code='identified')
 * - 新增提交的**分数 = 概率 × 影响**(3 × 5 = 15)—— 后端只存不算
 * - 新增带上**创建方式 manual**(库里 NOT NULL,后端 create 不兜底)
 * - 表单里**没有**分数输入框(用户填的是概率与影响)
 * - 热力图按格子显示**风险数**,点格子过滤下面的列表
 * - 编辑**直接用列表行填表**:不发详情请求,PUT 带全九个必填列,
 *   分数跟着新的概率走、创建方式原样回传行里的值
 *
 * 菜单树:PM 模块挂在「/pm」目录下(helpers.buildCurrentUserResponse 的
 * MenuParent 参数),子菜单的相对 route_path 'risk' 会被拼到 /pm 下,
 * 必须与前端路由表对齐。
 */

const RISK_PAGE_PATH = '/pm/risk';
const RISK_LIST_URL = `**/api/v1${PM_RISK_PREFIX}/list**`;
const RISK_DETAIL_URL = `**/api/v1${PM_RISK_PREFIX}/detail/**`;
const RISK_CREATE_URL = `**/api/v1${PM_RISK_PREFIX}/create**`;
const RISK_UPDATE_URL = `**/api/v1${PM_RISK_PREFIX}/update/**`;
/** 侧载的项目列表(风险响应里没有 project_by,名字从这里来) */
const PROJECT_LIST_URL = `**/api/v1${PM_PROJECT_PREFIX}/list**`;
/** 用户列表(负责人的远程搜索候选) */
const USER_LIST_URL = '**/api/v1/system/user/list**';
/** 字典选项接口(分类/状态的下拉与标签共用) */
const dictDataUrl = (dictType: string) =>
  `**/api/v1/system/dict/data/info/${dictType}**`;

/**
 * PM 菜单树里的风险菜单(type=2)+ 三个按钮权限节点(type=3)。
 *
 * 权限码与后端 controller 一致:
 * list=query / create=create / update=update / delete=delete,
 * 全部前缀 module_pm_risk:pm_risk:。
 */
const riskMenu = {
  title: '风险登记册',
  routePath: 'risk',
  permission: 'module_pm_risk:pm_risk:query',
  buttons: [
    {
      title: '新增风险',
      permission: 'module_pm_risk:pm_risk:create',
    },
    {
      title: '编辑风险',
      permission: 'module_pm_risk:pm_risk:update',
    },
    {
      title: '删除风险',
      permission: 'module_pm_risk:pm_risk:delete',
    },
  ],
};

/** 字典选项的信封(label 给人看,value 是线上码,list_class 决定标签颜色) */
function dictDataResponse(
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

/** 风险分类(后端种子 SQL 的五类) */
const riskCategoryDictResponse = dictDataResponse([
  { dict_label: '进度', dict_value: 'schedule', list_class: 'primary' },
  { dict_label: '范围', dict_value: 'scope', list_class: 'info' },
  { dict_label: '质量', dict_value: 'quality', list_class: 'warning' },
  { dict_label: '资源', dict_value: 'resource', list_class: 'warning' },
  { dict_label: '合规', dict_value: 'compliance', list_class: 'danger' },
]);

/** 风险状态(后端种子 SQL 的五态) */
const riskStatusDictResponse = dictDataResponse([
  { dict_label: '已识别', dict_value: 'identified', list_class: 'info' },
  { dict_label: '分析中', dict_value: 'analyzing', list_class: 'primary' },
  { dict_label: '缓解中', dict_value: 'mitigating', list_class: 'warning' },
  { dict_label: '已发生', dict_value: 'realized', list_class: 'danger' },
  { dict_label: '已关闭', dict_value: 'closed', list_class: 'success' },
]);

/**
 * 列表里的第一行(形状对齐 RiskOut)。
 *
 * probability=3 / impact=5 ⇒ score=15 ⇒ 等级 HIGH(9-15,阈值见共享件 riskLevel)。
 * ⚠️ 响应里**没有** project_by —— 后端只随行返回 owner_by,
 * 项目名要靠侧载的项目列表在户端映射。
 */
const riskRow = {
  id: 31,
  project_id: 1,
  title: '第三方接口交付延期',
  description: '供应商反馈需要额外两周',
  category_code: 'schedule',
  probability: 3,
  impact: 5,
  score: 15,
  status_code: 'identified',
  owner_id: 1,
  mitigation_plan: '每周跟一次进度',
  contingency_plan: '启用备用供应商',
  due_date: '2026-11-20',
  trigger_date: '2026-11-15 09:00:00',
  created_via_code: 'manual',
  ai_suggestion: null,
  owner_by: { id: 1, name: '张三', username: 'zhangsan' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-06 09:00:00',
};

/**
 * 第二行:AI 建议登记的风险(created_via_code='ai_suggested'),分数 4 ⇒ 等级 MEDIUM。
 * 编辑它时要能证明「创建方式原样回传行里的值」,而不是硬编码 'manual'。
 */
const aiRiskRow = {
  id: 32,
  project_id: 2,
  title: '合规审计不通过',
  description: null,
  category_code: 'compliance',
  probability: 2,
  impact: 2,
  score: 4,
  status_code: 'mitigating',
  owner_id: 2,
  mitigation_plan: null,
  contingency_plan: null,
  due_date: null,
  trigger_date: null,
  created_via_code: 'ai_suggested',
  ai_suggestion: { source: 'rule-engine' },
  owner_by: { id: 2, name: '李四', username: 'lisi' },
  created_time: '2026-11-02 09:00:00',
  updated_time: '2026-11-03 09:00:00',
};

const riskRows = [riskRow, aiRiskRow];

/** 侧载的项目列表(风险响应里没有项目名,名字从这里来) */
const projectListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      {
        id: 1,
        code: 'AIPM-CORE',
        name: 'AIPM 核心项目',
        status_code: 'planning',
        priority_code: 'P1',
        start_date: '2026-11-01',
        due_date: '2026-12-31',
        owner_id: 1,
        owner_by: { id: 1, name: '张三', username: 'zhangsan' },
        tags: null,
      },
      {
        id: 2,
        code: 'AIPM-EXT',
        name: 'AIPM 扩展项目',
        status_code: 'planning',
        priority_code: 'P1',
        start_date: '2026-12-01',
        due_date: '2027-01-31',
        owner_id: 1,
        owner_by: { id: 1, name: '张三', username: 'zhangsan' },
        tags: null,
      },
    ],
    total: 2,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 负责人的远程搜索候选 */
const userListResponse = {
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

/** 写操作成功后的信封(提示文案由请求层统一弹,这里只让 promise 落地) */
const okResponse = {
  code: 0,
  msg: '操作成功',
  data: null,
  status_code: 200,
  success: true,
};

/**
 * 在弹窗的下拉里选一个候选,并**核对**值真的进去了。
 *
 * 为什么不用 helpers.pickInModal 就完事:它只点一次选项、不核对结果。
 * 实测(6 个 worker 并行时)会偶发「点空」—— 下拉还开着,值却是空的,
 * 于是必填项校验不过、请求发不出去,用例以「没等到请求」的形式挂掉,
 * 而且是偶发的,极难定位(与任务页同一个坑,本轮不改共享夹具)。
 */
async function pickChecked(
  page: Page,
  label: string,
  optionText: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await pickInModal(page, label, optionText);
    try {
      // 选中后表单项里会出现这个文案
      await expect(modalFormItem(page, label)).toContainText(optionText, {
        timeout: 3000,
      });
      return;
    } catch {
      // 没进去:可能下拉还开着(卡住的 portal),先关掉再重选
      await page.keyboard.press('Escape');
    }
  }
  throw new Error(`下拉「${label}」没能选中「${optionText}」`);
}

/**
 * 在弹窗的**日期时间**表单项里选「今天」。
 *
 * 与 helpers.pickToday 的区别:日期时间面板选完日期**不会自动关闭**
 * (antd 的 showTime 面板要按「确定」才把值交给表单)—— 不点确定,
 * 表单里的值是空的(提交出去是 null)。
 */
async function pickTodayDateTime(page: Page, label: string): Promise<void> {
  await expect(page.locator('.ant-picker-dropdown:visible')).toHaveCount(0);
  await modalFormItem(page, label).locator('.ant-picker input').click();
  const todayCell = page.locator(
    '.ant-picker-dropdown:visible .ant-picker-cell-today',
  );
  await expect(todayCell).toBeVisible();
  await todayCell.click();
  // 面板里的「确定」(antd 面板是 portal,按钮文案随 locale 变,按 class 找)
  await page
    .locator('.ant-picker-dropdown:visible .ant-picker-ok button')
    .click();
}

/**
 * 装好受控页面:登录态 + PM 菜单树 + 列表 + 字典 + 侧载列表。
 *
 * 列表路由**自己注册**(不走 setupModulePage 的固定响应):
 * 热力图点格子会带上 probability/impact 过滤,响应得随查询参数变。
 */
async function setupRiskPage(page: Page): Promise<{ listRequests: string[] }> {
  const listRequests: string[] = [];

  await setupModulePage(page, {
    menus: [riskMenu],
    parent: { routePath: '/pm', title: '项目管理' },
    // 列表路由在下面自己注册(响应随查询参数变),这里给一个不匹配的 glob
    listUrl: `**/api/v1${PM_RISK_PREFIX}/__not_used__**`,
    listBody: riskListResponse,
  });

  // 风险列表:按后端的查询参数过滤(标题模糊/分类/状态/概率/影响…)
  await page.route(RISK_LIST_URL, (route) => {
    const url = new URL(route.request().url());
    listRequests.push(url.toString());

    const probability = url.searchParams.get('probability');
    const impact = url.searchParams.get('impact');
    const pageNo = Number(url.searchParams.get('page_no') ?? '1');
    const pageSize = Number(url.searchParams.get('page_size') ?? '10');

    let items = riskRows;
    if (probability) {
      items = items.filter((row) => row.probability === Number(probability));
    }
    if (impact) {
      items = items.filter((row) => row.impact === Number(impact));
    }
    const start = (pageNo - 1) * pageSize;

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: '查询成功',
        data: {
          items: items.slice(start, start + pageSize),
          total: items.length,
          page_no: pageNo,
          page_size: pageSize,
          has_next: false,
        },
        status_code: 200,
        success: true,
      }),
    });
  });

  // 侧载的项目列表:页面在列的 render 里查表映射成名字;
  // 表单的「所属项目」下拉也是远程搜它(带 name 参数)
  await page.route(PROJECT_LIST_URL, (route) => {
    const url = new URL(route.request().url());
    const name = url.searchParams.get('name');
    const all = projectListResponse.data.items;
    const items = name
      ? all.filter((project) => project.name.includes(name))
      : all;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...projectListResponse,
        data: { ...projectListResponse.data, items, total: items.length },
      }),
    });
  });

  // 负责人的远程搜索候选
  await page.route(USER_LIST_URL, (route) => {
    const url = new URL(route.request().url());
    const name = url.searchParams.get('name');
    const all = userListResponse.data.items;
    const items = name ? all.filter((user) => user.name.includes(name)) : all;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...userListResponse,
        data: { ...userListResponse.data, items, total: items.length },
      }),
    });
  });

  await page.route(dictDataUrl('module_pm_risk_category'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(riskCategoryDictResponse),
    }),
  );

  await page.route(dictDataUrl('module_pm_risk_status'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(riskStatusDictResponse),
    }),
  );

  return { listRequests };
}

/** 列表的固定响应(给 setupModulePage 占位用,真正的路由自己注册) */
const riskListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: riskRows,
    total: 2,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

test.describe('风险登记册页', () => {
  test('渲染风险列表与等级标签', async ({ page }) => {
    await setupRiskPage(page);

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    // 侧边栏来自后端菜单:PM 目录挂在 /pm 下(不是 /system)
    await expect(page.locator('.ant-menu').getByText('项目管理')).toBeVisible();
    await expect(
      page.locator('.ant-menu').getByText('风险登记册'),
    ).toBeVisible();

    const rows = tableRows(page);
    await expect(rows).toHaveCount(2);

    const row = rows.filter({ hasText: '第三方接口交付延期' });
    await expect(row).toContainText('第三方接口交付延期');
    // 字典线上码渲染成中文标签(不是原始的 schedule / identified)
    await expect(row).toContainText('进度');
    await expect(row).toContainText('已识别');
    // 分数随行展示(等级的推导依据)
    await expect(row).toContainText('15');
    // 等级是**派生量**:后端没有 level 字段,前端按 score 算(15 ⇒ 高)
    await expect(row).toContainText('高');
    // 负责人读后端随行返回的 owner_by
    await expect(row).toContainText('张三');
    // 项目名来自侧载列表(风险响应里没有 project_by)
    await expect(row).toContainText('AIPM 核心项目');
    // 缓解措施截止
    await expect(row).toContainText('2026-11-20');
    // 创建方式没有字典(库里只有 manual / ai_suggested),显示原值
    await expect(row).toContainText('manual');

    // 第二行:分数 4 ⇒ 等级 中;创建方式是 AI 建议
    const aiRow = rows.filter({ hasText: '合规审计不通过' });
    await expect(aiRow).toContainText('合规');
    await expect(aiRow).toContainText('缓解中');
    await expect(aiRow).toContainText('中');
    await expect(aiRow).toContainText('李四');
    await expect(aiRow).toContainText('AIPM 扩展项目');
    await expect(aiRow).toContainText('ai_suggested');
  });

  test('项目侧载只覆盖最新的 100 个项目时给出提示', async ({ page }) => {
    await setupRiskPage(page);

    // 侧载的项目列表:后端一共 250 个,但只回了 2 条 ⇒ 侧载被截断了
    await page.unroute(PROJECT_LIST_URL);
    await page.route(PROJECT_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...projectListResponse,
          data: { ...projectListResponse.data, total: 250 },
        }),
      }),
    );

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    // 上限**不静默**:页面上有一条提示说清侧载盖了什么
    // (热力图那一条不在 —— 风险没截断)
    // ⚠️ 计数只算**主内容区**里的：AI 工作台的侧栏里也有自己的 Alert
    const alerts = mainContent(page).locator('.ant-alert');
    await expect(alerts).toHaveCount(1);
    await expect(alerts.first()).toContainText('后端一次最多给 100 个');
    await expect(alerts.first()).toContainText('250 个项目');
    // 描述说的是**实际拿到几个**,不是把上限当成实际值
    await expect(alerts.first()).toContainText('侧载只拿到最新的 2 个');
  });

  test('编辑时负责人显示名字,不是裸 id', async ({ page }) => {
    await setupRiskPage(page);

    // 用户列表里**没有**风险的负责人(张三):远程搜索只回一页,
    // 负责人不在候选里时编辑框里就只是个裸 id —— 行里的 owner_by 把它补上
    await page.unroute(USER_LIST_URL);
    await page.route(USER_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...userListResponse,
          data: {
            items: [userListResponse.data.items[1]],
            total: 1,
            page_no: 1,
            page_size: 100,
            has_next: false,
          },
        }),
      }),
    );

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    await tableRows(page)
      .filter({ hasText: '第三方接口交付延期' })
      .getByRole('button', { name: '编辑' })
      .click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 负责人显示的是名字(不是 id 1)
    const owner = modalFormItem(page, '负责人').locator('.ant-select-content');
    await expect(owner).toContainText('张三');
    await expect(owner).not.toContainText('1');
  });

  test('新增风险提交 score(概率 × 影响)', async ({ page }) => {
    const createRequests: { url: string; method: string; body: unknown }[] = [];

    await setupRiskPage(page);

    await page.route(RISK_CREATE_URL, (route) => {
      const request = route.request();
      createRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 所属项目:远程搜项目
    await pickChecked(page, '所属项目', 'AIPM 核心项目');
    await modalFormItem(page, '风险标题').locator('input').fill('E2E 风险');
    await pickChecked(page, '分类', '进度');
    // 概率 3 × 影响 5 ⇒ 分数 15
    await pickChecked(page, '概率', '3');
    await pickChecked(page, '影响', '5');
    await pickChecked(page, '状态', '已识别');
    await pickChecked(page, '负责人', '张三');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].method).toBe('POST');
    expect(createRequests[0].url).toContain(`${PM_RISK_PREFIX}/create`);

    const body = createRequests[0].body as Record<string, unknown>;
    // 分数由前端算好送进去(后端只存不算,少这一列就 422)
    expect(body.score).toBe(15);
    expect(body).toMatchObject({
      project_id: 1,
      title: 'E2E 风险',
      category_code: 'schedule',
      probability: 3,
      impact: 5,
      status_code: 'identified',
    });
    // 表单里看到的中文标签没有混进请求体
    expect(JSON.stringify(body)).not.toContain('进度');
    expect(JSON.stringify(body)).not.toContain('已识别');
  });

  test('表单提交 created_via_code=manual 与 owner_id', async ({ page }) => {
    const createRequests: { url: string; method: string; body: unknown }[] = [];

    await setupRiskPage(page);

    await page.route(RISK_CREATE_URL, (route) => {
      const request = route.request();
      createRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    await pickChecked(page, '所属项目', 'AIPM 核心项目');
    await modalFormItem(page, '风险标题').locator('input').fill('E2E 风险');
    await pickChecked(page, '分类', '进度');
    await pickChecked(page, '概率', '3');
    await pickChecked(page, '影响', '5');
    await pickChecked(page, '状态', '已识别');
    // 负责人是必填的(库里 NOT NULL)
    await pickChecked(page, '负责人', '张三');

    await modalFormItem(page, '缓解措施')
      .locator('textarea')
      .fill('每周跟一次进度');
    await modalFormItem(page, '应急计划')
      .locator('textarea')
      .fill('启用备用供应商');

    await pickToday(page, '缓解措施截止');
    await pickTodayDateTime(page, '升级触发时间');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    const body = createRequests[0].body as Record<string, unknown>;

    // 库里九个 NOT NULL 列一个都不能少
    for (const key of [
      'project_id',
      'title',
      'category_code',
      'probability',
      'impact',
      'score',
      'status_code',
      'owner_id',
      'created_via_code',
    ]) {
      expect(body).toHaveProperty(key);
    }
    expect(body).toMatchObject({
      owner_id: 1,
      // 人登记的风险:创建方式是「手动」(字典里的 manual / ai_suggested)
      created_via_code: 'manual',
      mitigation_plan: '每周跟一次进度',
      contingency_plan: '启用备用供应商',
    });
    // 截止日期是 YYYY-MM-DD;升级触发时间是 datetime
    expect(String(body.due_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(body.trigger_date)).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  test('表单不出现 score 输入框', async ({ page }) => {
    await setupRiskPage(page);

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 用户看到的是概率与影响,分数由前端算 —— 表单里没有分数这一项
    await expect(modalFormItem(page, '分数')).toHaveCount(0);
    await expect(page.locator('.ant-modal')).not.toContainText('score');
    // 概率与影响都在
    await expect(modalFormItem(page, '概率')).toHaveCount(1);
    await expect(modalFormItem(page, '影响')).toHaveCount(1);
  });

  test('热力图按格子显示风险数', async ({ page }) => {
    await setupRiskPage(page);

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    // 5×5 网格:概率 3 × 影响 5 那一格里有一条风险
    await expect(page.locator('[data-risk-cell="3-5"]')).toContainText('1');
    // 概率 2 × 影响 2 那一格也有一条
    await expect(page.locator('[data-risk-cell="2-2"]')).toContainText('1');
    // 没有风险的格子照样渲染(零)
    await expect(page.locator('[data-risk-cell="5-5"]')).toContainText('0');
    // 整张网格是 25 个格子
    await expect(page.locator('[data-risk-cell]')).toHaveCount(25);
  });

  test('点热力图格子过滤下面的列表', async ({ page }) => {
    const { listRequests } = await setupRiskPage(page);

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    await expect(tableRows(page)).toHaveCount(2);

    // 点「概率 3 × 影响 5」那一格
    await page.locator('[data-risk-cell="3-5"]').click();

    // 列表请求带上了概率与影响(后端就是按这两个字段等值过滤的)
    await expect
      .poll(() =>
        listRequests.some(
          (url) => url.includes('probability=3') && url.includes('impact=5'),
        ),
      )
      .toBe(true);

    // 下面只剩那一格里的风险
    await expect(tableRows(page)).toHaveCount(1);
    await expect(tableRows(page)).toContainText('第三方接口交付延期');

    // 再点一次取消过滤
    await page.locator('[data-risk-cell="3-5"]').click();
    await expect(tableRows(page)).toHaveCount(2);

    // 点**空格子**也一样过滤(不是什么也不做):过滤出空列表
    await page.locator('[data-risk-cell="5-5"]').click();
    await expect
      .poll(() =>
        listRequests.some(
          (url) => url.includes('probability=5') && url.includes('impact=5'),
        ),
      )
      .toBe(true);
    await expect(tableRows(page)).toHaveCount(0);
  });

  test('编辑用列表行填表:不发详情请求,PUT 带全九个必填列', async ({ page }) => {
    const detailRequests: string[] = [];
    const updateRequests: { url: string; method: string; body: unknown }[] = [];

    await setupRiskPage(page);

    // 详情接口**不该被调用**:行里的字段已经够填表了。
    // 这里仍然把它拦下来并记录 —— 实现一旦退回「读-改-写」就会被这条断言抓住。
    await page.route(RISK_DETAIL_URL, (route) => {
      detailRequests.push(route.request().url());
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: -1,
          msg: '没有风险详情权限',
          data: null,
          status_code: 403,
          success: false,
        }),
      });
    });

    await page.route(RISK_UPDATE_URL, (route) => {
      const request = route.request();
      updateRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(
      page,
      RISK_PAGE_PATH,
      page.locator('.ant-menu').getByText('风险登记册'),
    );

    await tableRows(page)
      .filter({ hasText: '合规审计不通过' })
      .getByRole('button', { name: '编辑' })
      .click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 表单是用**列表行**填的:标题、字典字段、概率与影响都回显
    await expect(modalFormItem(page, '风险标题').locator('input')).toHaveValue(
      '合规审计不通过',
    );
    await expect(
      modalFormItem(page, '分类').locator('.ant-select-content'),
    ).toContainText('合规');
    await expect(
      modalFormItem(page, '状态').locator('.ant-select-content'),
    ).toContainText('缓解中');
    await expect(
      modalFormItem(page, '概率').locator('.ant-select-content'),
    ).toContainText('2');

    // 没有详情请求:后端的详情接口要 `…:detail` 权限,编辑只要 `…:update`
    expect(detailRequests).toHaveLength(0);

    // 改概率(2 → 4):分数必须跟着走(4 × 2 = 8)
    await pickChecked(page, '概率', '4');
    await modalFormItem(page, '风险标题')
      .locator('input')
      .fill('合规审计不通过(已跟进)');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => updateRequests.length).toBe(1);
    expect(updateRequests[0].method).toBe('PUT');
    expect(updateRequests[0].url).toContain(`${PM_RISK_PREFIX}/update/32`);

    const body = updateRequests[0].body as Record<string, unknown>;

    // 整对象 PUT(后端 UpdateSchema 继承 CreateSchema):九个必填列一个都不能少
    for (const key of [
      'project_id',
      'title',
      'category_code',
      'probability',
      'impact',
      'score',
      'status_code',
      'owner_id',
      'created_via_code',
    ]) {
      expect(body).toHaveProperty(key);
    }
    expect(body).toMatchObject({
      project_id: 2,
      title: '合规审计不通过(已跟进)',
      category_code: 'compliance',
      probability: 4,
      impact: 2,
      // 分数跟着新的概率走(后端只存不算)
      score: 8,
      status_code: 'mitigating',
      owner_id: 2,
      // 创建方式不是用户可编辑的:原样回传行里的值(这一行是 AI 建议登记的)
      created_via_code: 'ai_suggested',
    });
  });
});
