import type {
  GanttLocale,
  GanttLocaleLabels,
  MonthLabelList,
  WeekDayLabelList,
} from 'dhtmlx-gantt';

/**
 * dhtmlx 甘特的**中文本地化**。
 *
 * ## 为什么需要它
 *
 * dhtmlx 是英文产品:时间轴的月份/星期刻度、弹窗按钮、各种提示语都是英文
 * (`January`、`Mon`、`Add task`、`Confirm deleting?`)⇒ 夹在中文后台里
 * 非常突兀。社区版没有内置的中文语言包(语言包是 PRO 的能力),但它留了
 * `setLocale()` 这个口子 ⇒ 我们自己把中文词表喂进去。
 *
 * ## 两部分
 *
 * - `date`:月份名与星期名 ⇒ 决定时间轴刻度上显示的文字
 *   (`%F` 取 month_full,`%a` 取 day_short);
 * - `labels`:dhtmlx 自己弹出的那些文案(表单区段标题、列头、确认语)。
 *   本项目**不用** dhtmlx 的内联编辑表单(编辑走我们自己的 antd 弹窗),
 *   所以 labels 大多用不上 —— 但仍然填满,避免哪天打开某个 dhtmlx 自带
 *   弹窗时蹦出英文。
 *
 * ## 装配方式
 *
 * `gantt.setLocale(locale)` 会**整体替换**当前语言包 ⇒ 每次都要把
 * date + labels 一起给全(只给一半会把另一半清空)。
 */
export const GANTT_LOCALE_ZH: GanttLocale = {
  date: {
    // 「一月」这种中文月份名:刻度上是 "一月 2026"
    month_full: [
      '一月',
      '二月',
      '三月',
      '四月',
      '五月',
      '六月',
      '七月',
      '八月',
      '九月',
      '十月',
      '十一月',
      '十二月',
    ] as MonthLabelList,
    // 短月份名:"1月"(dhtmlx 的 %M)
    month_short: [
      '1月',
      '2月',
      '3月',
      '4月',
      '5月',
      '6月',
      '7月',
      '8月',
      '9月',
      '10月',
      '11月',
      '12月',
    ] as MonthLabelList,
    // 「星期日」…
    day_full: [
      '星期日',
      '星期一',
      '星期二',
      '星期三',
      '星期四',
      '星期五',
      '星期六',
    ] as WeekDayLabelList,
    // 「日 一 二 三 四 五 六」(dhtmlx 的 %a)
    day_short: ['日', '一', '二', '三', '四', '五', '六'] as WeekDayLabelList,
  },
  labels: {
    new_task: '新建任务',
    icon_save: '保存',
    icon_cancel: '取消',
    icon_details: '详情',
    icon_edit: '编辑',
    icon_delete: '删除',
    confirm_deleting: '确认删除?',
    section_description: '描述',
    section_time: '时间',
    section_type: '类型',
    section_deadline: '截止日期',
    section_baselines: '基线',
    column_wbs: '编号',
    column_text: '任务名称',
    column_start_date: '开始日期',
    column_duration: '工期',
    column_add: '添加',
    link: '依赖',
    confirm_link_deleting: '确认删除依赖关系?',
    link_start: '开始',
    link_end: '结束',
    type_task: '任务',
    type_project: '项目',
    type_milestone: '里程碑',
    minutes: '分钟',
    hours: '小时',
    days: '天',
    weeks: '周',
    months: '月',
    years: '年',
    message_ok: '确定',
    message_cancel: '取消',
    section_constraint: '约束',
    constraint_type: '约束类型',
    constraint_date: '约束日期',
    asap: '尽快开始',
    alap: '尽快结束',
    snet: '开始不早于',
    snlt: '开始不晚于',
    fnet: '结束不早于',
    fnlt: '结束不晚于',
    mso: '最早开始',
    mfo: '最早结束',
    resources_filter_placeholder: '筛选资源',
    resources_filter_label: '资源',
  } as GanttLocaleLabels,
};
