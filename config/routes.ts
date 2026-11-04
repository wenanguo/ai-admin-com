/**
 * @name umi 的路由配置
 * @description 只支持 path,component,routes,redirect,wrappers,name,icon 的配置
 * @param path  path 只支持两种占位符配置，第一种是动态参数 :id 的形式，第二种是 * 通配符，通配符只能出现路由字符串的最后。
 * @param component 配置 location 和 path 匹配后用于渲染的 React 组件路径。可以是绝对路径，也可以是相对路径，如果是相对路径，会从 src/pages 开始找起。
 * @param routes 配置子路由，通常在需要为多个路径增加 layout 组件时使用。
 * @param redirect 配置路由跳转
 * @param wrappers 配置路由组件的包装组件，通过包装组件可以为当前的路由组件组合进更多的功能。 比如，可以用于路由级别的权限校验
 * @param name 配置路由的标题，默认读取国际化文件 menu.ts 中 menu.xxxx 的值，如配置 name 为 login，则读取 menu.ts 中 menu.login 的取值作为标题
 * @param icon 配置路由的图标，取值参考 https://ant.design/components/icon-cn， 注意去除风格后缀和大小写，如想要配置图标为 <StepBackwardOutlined /> 则取值应为 stepBackward 或 StepBackward，如想要配置图标为 <UserOutlined /> 则取值应为 user 或者 User
 * @doc https://umijs.org/docs/guides/routes
 */
export default [
  {
    path: '/user',
    layout: false,
    routes: [
      {
        path: '/user/login',
        name: 'login',
        component: './user/login',
      },
      {
        path: '/user',
        redirect: '/user/login',
      },
      {
        name: 'register-result',
        icon: 'checkCircle',
        path: '/user/register-result',
        component: './user/register-result',
      },
      {
        name: 'register',
        icon: 'userAdd',
        path: '/user/register',
        component: './user/register',
      },
      {
        name: '404',
        component: './exception/404',
        path: '/user/*',
      },
    ],
  },
  {
    path: '/welcome',
    name: 'welcome',
    icon: 'home',
    component: './Welcome',
  },
  {
    path: '/system',
    name: 'system',
    icon: 'setting',
    routes: [
      {
        // redirect 必须挂在**子路由**上:挂在父路由上时,父路由的 redirect
        // 会作用到所有子路径上,/system/user 被重定向到 /system/user 自己
        // ⇒ React Router 无限重定向(React error #185,页面直接白屏报错)
        // 模板里 /dashboard /form /profile 都是这个写法
        path: '/system',
        redirect: '/system/user',
      },
      {
        path: '/system/user',
        name: 'user',
        icon: 'user',
        component: './module_system/user',
      },
      {
        path: '/system/position',
        name: 'position',
        icon: 'team',
        component: './module_system/position',
      },
      {
        // path 用单数(跟后端菜单 route_path /system/param 对齐),
        // 目录用复数(跟后端 component_path module_system/params 对齐)
        path: '/system/param',
        name: 'param',
        icon: 'fileText',
        component: './module_system/params',
      },
      {
        path: '/system/log',
        name: 'log',
        icon: 'fileSearch',
        component: './module_system/log',
      },
      {
        path: '/system/dept',
        name: 'dept',
        icon: 'apartment',
        component: './module_system/dept',
      },
      {
        path: '/system/role',
        name: 'role',
        icon: 'safetyCertificate',
        component: './module_system/role',
      },
      {
        path: '/system/dict',
        name: 'dict',
        icon: 'book',
        component: './module_system/dict',
      },
      {
        path: '/system/notice',
        name: 'notice',
        icon: 'notification',
        component: './module_system/notice',
      },
      {
        path: '/system/ticket',
        name: 'ticket',
        icon: 'customerService',
        component: './module_system/ticket',
      },
    ],
  },
  {
    // PM 模块(项目管理):目录 /pm + 各业务页。菜单由后端下发(adapter),
    // 前端只注册路由 —— 后端下发的菜单路径是**插件源码路径**(module_pm_*),
    // 靠下面那两组重定向路由落到这些页面上
    path: '/pm',
    name: 'pm',
    icon: 'project',
    routes: [
      {
        // redirect 挂在子路由上(与 /system 同理):挂在父路由上会让
        // /pm/project 被重定向到自己 ⇒ React Router 无限重定向
        path: '/pm',
        redirect: '/pm/project',
      },
      {
        path: '/pm/project',
        name: 'project',
        icon: 'project',
        component: './module_pm/project',
      },
      {
        // 详情页只在路由里注册(菜单里没有这一项,入口在列表页的**项目名称**链接):
        // /pm/project/<id> 进;项目 id 是路径参数,页面里用 useParams 读
        path: '/pm/project/:id',
        name: 'pmProjectDetail',
        component: './module_pm/project/detail',
      },
      {
        // 里程碑管理页:竖排时间线(行按显示排序 → 计划开始日纵向读),不做甘特
        path: '/pm/milestone',
        name: 'milestone',
        icon: 'flag',
        component: './module_pm/milestone',
      },
      {
        // 任务管理页:任务响应里没有 project_by/milestone_by,
        // 项目名与里程碑名靠侧载列表在户端映射
        path: '/pm/task',
        name: 'task',
        icon: 'checkSquare',
        component: './module_pm/task',
      },
      {
        // 任务看板页:六列(待规划/待办/进行中/阻塞/评审/已完成),
        // 拖拽只改 status_code 一个维度
        path: '/pm/task/board',
        name: 'taskBoard',
        icon: 'appstore',
        component: './module_pm/task/board',
      },
      {
        // 风险登记册页:上面是 5×5 热力图(横轴影响、纵轴概率,点格子过滤),
        // 下面是风险列表;等级是派生量(后端只有 score)
        path: '/pm/risk',
        name: 'risk',
        icon: 'alert',
        component: './module_pm/risk',
      },
    ],
  },
  {
    /*
      后端 PM 菜单的**源码路径** → 前端真实页面的重定向。

      后端 `platform_menu` 里 PM 菜单的 route_path 是**插件的源码路径**
      (`module_pm_project/pm_project` 这种,后端按插件目录自动生成),
      不是前端的 /pm/*。前端菜单适配器只保留「已在前端路由表注册过」的菜单路径
      ⇒ 这四条路径不注册,整块 PM 菜单就会被跳过(控制台打印
      `[menu] 前端缺少路由: <path>`)。注册成重定向路由,侧边栏点「项目清单」
      就落到 /pm/project。

      为什么挂在**顶层**而不是 /pm 目录下面:React Router 要求子路由的绝对路径
      必须以父路由的路径开头 —— `/module_pm_*` 不以 `/pm` 开头,挂在 /pm 下面
      会抛 "Absolute route path ... nested under path \"/pm\" is not valid",
      整个应用白屏(生产构建同样抛)。所以这四条与 /pm 平级。

      redirect 挂在**子路由**上(与 /system 同理):挂在父路由上会让所有子路径
      都重定向到自己 ⇒ React 无限重定向(error #185,页面空白)。

      icon 是给侧边栏用的:菜单图标取前端路由表的(collectRouteIcons 按 path 取),
      后端下发的 icon 是 Remix Icon 类名,ProLayout 认不出来 —— 这四条路径
      各自要一份自己的图标。
    */
    path: '/module_pm_project',
    routes: [
      {
        // 目录「项目管理」与菜单「项目清单」共用这一条路径(后端就是这么种的)
        path: '/module_pm_project/pm_project',
        icon: 'project',
        redirect: '/pm/project',
      },
      {
        path: '/module_pm_project/pm_task',
        icon: 'checkSquare',
        redirect: '/pm/task',
      },
      {
        path: '/module_pm_project/pm_milestone',
        icon: 'flag',
        redirect: '/pm/milestone',
      },
    ],
  },
  {
    /*
      同上:风险模块的源码路径 → /pm/risk。
      目录「pm_risk」与菜单「风险」共用这一条路径。
    */
    path: '/module_pm_risk',
    routes: [
      {
        path: '/module_pm_risk/pm_risk',
        icon: 'alert',
        redirect: '/pm/risk',
      },
    ],
  },
  {
    path: '/admin',
    name: 'admin',
    icon: 'crown',
    access: 'canAdmin',
    routes: [
      {
        path: '/admin',
        redirect: '/admin/sub-page',
      },
      {
        path: '/admin/sub-page',
        name: 'sub-page',
        component: './Admin',
      },
    ],
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    icon: 'dashboard',
    routes: [
      {
        path: '/dashboard',
        redirect: '/dashboard/analysis',
      },
      {
        name: 'analysis',
        icon: 'barChart',
        path: '/dashboard/analysis',
        component: './dashboard/analysis',
      },
      {
        name: 'monitor',
        icon: 'monitor',
        path: '/dashboard/monitor',
        component: './dashboard/monitor',
      },
      {
        name: 'workplace',
        icon: 'desktop',
        path: '/dashboard/workplace',
        component: './dashboard/workplace',
      },
    ],
  },
  {
    path: '/form',
    icon: 'form',
    name: 'form',
    routes: [
      {
        path: '/form',
        redirect: '/form/basic-form',
      },
      {
        name: 'basic-form',
        icon: 'form',
        path: '/form/basic-form',
        component: './form/basic-form',
      },
      {
        name: 'step-form',
        icon: 'orderedList',
        path: '/form/step-form',
        component: './form/step-form',
      },
      {
        name: 'advanced-form',
        icon: 'profile',
        path: '/form/advanced-form',
        component: './form/advanced-form',
      },
    ],
  },
  {
    path: '/list',
    icon: 'table',
    name: 'list',
    routes: [
      {
        path: '/list/search',
        name: 'search-list',
        component: './list/search',
        routes: [
          {
            path: '/list/search',
            redirect: '/list/search/articles',
          },
          {
            name: 'articles',
            icon: 'read',
            path: '/list/search/articles',
            component: './list/search/articles',
          },
          {
            name: 'projects',
            icon: 'project',
            path: '/list/search/projects',
            component: './list/search/projects',
          },
          {
            name: 'applications',
            icon: 'appstore',
            path: '/list/search/applications',
            component: './list/search/applications',
          },
        ],
      },
      {
        path: '/list',
        redirect: '/list/table-list',
      },
      {
        name: 'table-list',
        icon: 'table',
        path: '/list/table-list',
        component: './table-list',
      },
      {
        name: 'basic-list',
        icon: 'unorderedList',
        path: '/list/basic-list',
        component: './list/basic-list',
      },
      {
        name: 'card-list',
        icon: 'creditCard',
        path: '/list/card-list',
        component: './list/card-list',
      },
    ],
  },
  {
    path: '/profile',
    name: 'profile',
    icon: 'profile',
    routes: [
      {
        path: '/profile',
        redirect: '/profile/basic',
      },
      {
        name: 'basic',
        icon: 'idcard',
        path: '/profile/basic',
        component: './profile/basic',
      },
      {
        name: 'advanced',
        icon: 'crown',
        path: '/profile/advanced',
        component: './profile/advanced',
      },
    ],
  },
  {
    name: 'result',
    icon: 'checkCircle',
    path: '/result',
    routes: [
      {
        path: '/result',
        redirect: '/result/success',
      },
      {
        name: 'success',
        icon: 'checkCircle',
        path: '/result/success',
        component: './result/success',
      },
      {
        name: 'fail',
        icon: 'closeCircle',
        path: '/result/fail',
        component: './result/fail',
      },
    ],
  },
  {
    name: 'exception',
    icon: 'warning',
    path: '/exception',
    routes: [
      {
        path: '/exception',
        redirect: '/exception/403',
      },
      {
        name: '403',
        icon: 'stop',
        path: '/exception/403',
        component: './exception/403',
      },
      {
        name: '404',
        icon: 'warning',
        path: '/exception/404',
        component: './exception/404',
      },
      {
        name: '500',
        icon: 'bug',
        path: '/exception/500',
        component: './exception/500',
      },
    ],
  },
  {
    name: 'account',
    icon: 'user',
    path: '/account',
    routes: [
      {
        path: '/account',
        redirect: '/account/center',
      },
      {
        name: 'center',
        icon: 'user',
        path: '/account/center',
        component: './account/center',
      },
      {
        name: 'settings',
        icon: 'setting',
        path: '/account/settings',
        component: './account/settings',
      },
    ],
  },
  {
    path: '/chatbot',
    name: 'chatbot',
    icon: 'robot',
    component: './chatbot',
  },
  {
    // 登录后的落地页。后端菜单里目前只有「系统管理 > 用户管理」,
    // 指向 antd-pro 的演示看板会让登录后第一屏就报 404
    path: '/',
    layout: false,
    redirect: '/system/user',
  },
  {
    component: './exception/404',
    path: '/*',
  },
];
