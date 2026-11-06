import { Link, useAccess } from '@umijs/max';
import { Alert, Button, Empty, Segmented, Select, Spin } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GanttChartHandle } from '@/components/pm/gantt/GanttChart';
import { GanttChart } from '@/components/pm/gantt/GanttChart';
import type { TaskDateChange } from '@/components/pm/gantt/payload';
import { useDictOptions } from '@/components/pm/useDictOptions';
import { useGanttTasks } from './useGanttTasks';
import { useProjectNames } from './useProjectNames';

/**
 * 任务甘特页 —— 路由 /pm/task/gantt。
 *
 * 甘特**没有菜单入口**:后端的菜单种子只种了列表页,甘特是子页面 ——
 * 入口在任务列表页的工具栏按钮(见 src/pages/module_pm/task/index.tsx),
 * 本页顶部给一条回列表的路(与看板页同款)。
 *
 * 三条纪律:
 * 1. **不静默丢**:
 *    - 「后端总数 > 本次取回的条数」⇒ 提示「共 N 条,已显示前 M 条」(分页口径);
 *    - 「缺计划起止日期,画不出条形」⇒ 提示「N 个任务没有计划起止日期,未显示」。
 *    两条**不混成一条**:前者是「没取到」,后者是「取到了但画不出」。
 * 2. **拖拽写回**:整对象 PUT(后端没有 PATCH),写失败把条形**弹回**原位;
 *    错误提示由请求层统一弹,页面自己不弹 message。
 * 3. **页面不自己发 message**:成功/失败都不弹,只回滚界面。
 */

/** 缩放级别(与 GanttChart 的 setZoom 一致) */
type ZoomLevel = 'day' | 'week' | 'month';

/**
 * 时间轴「太窄」的阈值(图表容器的宽度,px)。
 *
 * 右侧常驻着 400px 的 AI 工作台 ⇒ 主内容只剩 ~1050px ⇒ 减去 dhtmlx 那条
 * 320px 的固定网格列,时间轴不到 800px,几个刻度就滚过去了。
 * 低于这个宽度就提示用户把 AI 工作台收起来(⌘B)——
 * 否则用户只会觉得「这图怎么这么挤」,不知道能救。
 */
const NARROW_CHART_WIDTH = 1200;

/** 甘特页 */
const TaskGantt: React.FC = () => {
  const access = useAccess();

  /** 按项目筛选(后端列表接口的 project_id 参数) */
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  /** 缩放级别(「日/周/月」) */
  const [zoom, setZoom] = useState<ZoomLevel>('week');

  const { mapping, loading, total, truncated, applyDateChange } = useGanttTasks(
    { projectId },
  );

  /** 甘特图的命令式句柄(回滚 / 缩放 / 滚动) */
  const chartRef = useRef<GanttChartHandle | null>(null);
  /** 宽度观察器(图表容器出现/消失时都要重建) */
  const observerRef = useRef<ResizeObserver | null>(null);
  /** 容器是不是太窄了 */
  const [narrow, setNarrow] = useState(false);

  // 项目筛选的候选:侧载的项目列表(不自己发请求)
  //
  // ⚠️ 这里与 useGanttTasks 内部的侧载是**两份**:钩子要项目/里程碑的名字
  // (分组行的标题),页面要项目的 id + 名字(筛选下拉的候选)。
  // useProjectNames 没有模块级缓存 ⇒ 多两次列表请求;换来的是
  // 「筛选下拉能列出所有项目」而不是「只列当前结果里的项目」。
  const { projectOptions } = useProjectNames();

  // 状态/优先级的显示文案:查字典(线上码 → 中文);查不到就回退线上码
  const { options: statusOptions } = useDictOptions('module_pm_task_status');
  const { options: priorityOptions } = useDictOptions('module_pm_priority');

  const labels = useMemo(
    () => ({
      status: Object.fromEntries(
        statusOptions.map((option) => [option.value, option.label]),
      ),
      priority: Object.fromEntries(
        priorityOptions.map((option) => [option.value, option.label]),
      ),
    }),
    [statusOptions, priorityOptions],
  );

  /**
   * 传给甘特图的行数据。
   *
   * ⚠️ **必须 useMemo 住身份**:GanttChart 在 `data` 身份变化时会清空
   * 「拖动前的旧日期」缓存 ⇒ 写失败后的 `revertTask` 会**静默失效**
   * (条形停在拖动后的位置,像是写成功了)。
   * 页面每次渲染都造新数组的话,这个回滚就永远不管用。
   */
  const data = useMemo(() => mapping.data, [mapping.data]);

  // 量容器宽度:窄了就提示(ResizeObserver 是浏览器原生 API,不必引依赖)
  //
  // ⚠️ 用**回调 ref**而不是 useEffect:图表容器只在「加载完了且有任务」时
  // 才挂载 ⇒ useEffect(…, []) 跑的时候它还不存在,量不到宽度。
  // 回调 ref 在节点挂上/摘下时都会来一次 ⇒ 什么时候出现都能量。
  const attachBox = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const measure = () => setNarrow(element.clientWidth < NARROW_CHART_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  // 卸载时断开观察器
  useEffect(() => () => observerRef.current?.disconnect(), []);

  /**
   * 拖拽结束:写回;写失败就把条弹回拖动前的位置。
   *
   * ⚠️ 写回**成功**时不用回滚 —— 数据 hook 已经把新日期写回本地 state,
   * 甘特图会按新数据重画,条就停在用户拖的位置上。
   */
  const handleTaskDragEnd = useCallback(
    async (rowId: string, change: TaskDateChange) => {
      const ok = await applyDateChange(rowId, change);
      if (!ok) {
        chartRef.current?.revertTask(rowId);
      }
    },
    [applyDateChange],
  );

  /** 拖拽改期要 update 权限;没有就只能看 */
  const canUpdate = access.hasPermission('module_pm_project:pm_task:update');

  /** 本次取回的任务条数(画进甘特的 + 因缺日期被排除的) */
  const fetched = mapping.taskCount + mapping.excludedCount;

  return (
    <div className="flex flex-col gap-4">
      {/* 页面标题:与看板页同款 */}
      <div className="flex items-center gap-3">
        <span className="text-base font-semibold">任务甘特</span>
        {/* 甘特没有菜单入口,列表页才是入口 —— 这里给一条回去的路 */}
        <Link to="/pm/task" className="text-sm">
          返回任务列表
        </Link>
      </div>

      {truncated ? (
        <Alert
          type="info"
          showIcon
          title={`共 ${total} 条,已显示前 ${fetched} 条`}
          description="甘特一次只拉一页(后端 page_size 上限 100),其余任务请到「任务管理」页查看。"
        />
      ) : null}

      {mapping.excludedCount > 0 ? (
        <Alert
          type="info"
          showIcon
          title={`${mapping.excludedCount} 个任务没有计划起止日期,未显示`}
          description={
            mapping.excludedTitles.length > 0
              ? `例如:${mapping.excludedTitles.join('、')}。给任务补上计划开始与截止日期后就会出现在甘特上。`
              : '给任务补上计划开始与截止日期后就会出现在甘特上。'
          }
        />
      ) : null}

      {narrow ? (
        <Alert
          type="warning"
          showIcon
          title="时间轴空间有限？按 ⌘B 收起右侧 AI 工作台"
          description="甘特图左侧的网格列是固定的,右边留给时间轴的宽度会被常驻的 AI 工作台挤掉。"
        />
      ) : null}

      {/* 工具栏:项目筛选 + 缩放 + 今天/适应 */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          allowClear
          className="w-60"
          placeholder="按项目筛选"
          value={projectId}
          options={projectOptions}
          onChange={(value) => setProjectId(value ?? undefined)}
        />
        <Segmented<ZoomLevel>
          value={zoom}
          options={[
            { label: '日', value: 'day' },
            { label: '周', value: 'week' },
            { label: '月', value: 'month' },
          ]}
          onChange={(value) => {
            setZoom(value);
            chartRef.current?.setZoom(value);
          }}
        />
        <Button onClick={() => chartRef.current?.scrollToToday()}>今天</Button>
        <Button onClick={() => chartRef.current?.zoomToFit()}>适应</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spin />
        </div>
      ) : mapping.taskCount === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="没有可排期的任务 —— 任务需要计划开始与截止日期才会出现在甘特上"
        />
      ) : (
        <div ref={attachBox} data-testid="pm-gantt-box">
          <GanttChart
            ref={chartRef}
            data={data}
            readOnly={!canUpdate}
            labels={labels}
            onTaskDragEnd={(rowId, change) => {
              void handleTaskDragEnd(rowId, change);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default TaskGantt;
