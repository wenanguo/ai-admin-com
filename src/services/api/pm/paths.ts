/**
 * PM 模块的后端路由前缀 —— **前端唯一的出处**。
 *
 * 为什么前缀是重复的两段(不要「顺手简化」回去):
 * 后端 `app/core/discover.py` 扫描 `app/plugin/module_xxx/<各层子目录>/controller.py`,
 * 先按**插件目录名**给容器路由加一段前缀(`module_pm_project` → `/pm_project`),
 * 再把 controller.py 里自己声明的 router(`prefix="/pm_project"`)挂进容器 ——
 * 最终路径是两段拼接:`/pm_project` + `/pm_project`。
 * 里程碑与任务在同一个插件目录 `module_pm_project` 下,所以是
 * `/pm_project/pm_milestone`、`/pm_project/pm_task`;
 * 风险在 `module_pm_risk` 下,所以是 `/pm_risk/pm_risk`。
 *
 * 下面四个常量与已部署后端的路径逐字对应
 * (对照 `https://www.pmdict.cn/api/v1/openapi.json` 的 paths 段),
 * 改之前先对着 openapi.json 核一遍。
 *
 * service 层与 e2e 用例都从这里拼 URL。
 * 这个 bug 的成因正是「两边各写一份字面量」:e2e 拦截的和代码请求的
 * 是同一个错 URL,于是测试全绿而线上全 404。前缀写错时,现在只可能错在
 * 这一处 —— service 层与 e2e 会一起跟着错,不会各错各的。
 */

/** 项目管理:`/pm_project/pm_project` */
export const PM_PROJECT_PREFIX = '/pm_project/pm_project';

/** 里程碑:`/pm_project/pm_milestone` */
export const PM_MILESTONE_PREFIX = '/pm_project/pm_milestone';

/** 任务:`/pm_project/pm_task` */
export const PM_TASK_PREFIX = '/pm_project/pm_task';

/** 风险:`/pm_risk/pm_risk` */
export const PM_RISK_PREFIX = '/pm_risk/pm_risk';
