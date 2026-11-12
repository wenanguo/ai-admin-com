import {
  AppstoreOutlined,
  BarChartOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useSearchParams } from '@umijs/max';
import { Segmented } from 'antd';
import type React from 'react';
import { TaskBoard } from './TaskBoard';
import { TaskGantt } from './TaskGantt';
import { TaskListView } from './TaskListView';

/**
 * **任务工作台** —— 列表 / 看板 / 甘特三种展现形式，一个页面。
 *
 * ## 为什么是一个页面
 *
 * 以前三个视图是三个路由，切一次 = 跳路由 + 重新挂载 + **重新取数** ⇒ 慢。
 * 现在：三个视图共用**同一份数据**（`useTaskDataset`，react-query 缓存）
 * ⇒ 切视图**零请求**。
 *
 * ## 视图状态放 URL
 *
 * `?view=list|board|gantt` ⇒ 刷新保持、深链接可用、侧边栏「任务」高亮不受影响
 * （pathname 还是 `/pm/task`）。
 *
 * ⚠️ 旧地址 `/pm/task/board` / `/pm/task/gantt` 保留成**重定向**
 * （见 config/routes.ts）⇒ 老链接不失效。
 */

/** 三种展现形式 */
export type TaskView = 'list' | 'board' | 'gantt';

/** 解析 URL 上的 `view` 参数（认不出来 ⇒ 列表） */
export function parseTaskView(raw: string | null): TaskView {
  if (raw === 'board' || raw === 'gantt' || raw === 'list') return raw;
  return 'list';
}

/** Segmented 的选项 */
const VIEW_OPTIONS = [
  { label: '列表', value: 'list', icon: <UnorderedListOutlined /> },
  { label: '看板', value: 'board', icon: <AppstoreOutlined /> },
  { label: '甘特', value: 'gantt', icon: <BarChartOutlined /> },
];

/** 工作台的 props */
export interface TaskWorkspaceProps {
  /**
   * 限定到某个项目。
   *
   * ⚠️ **不传 = 全部项目**（菜单里的「任务」）；传了 = 只看这个项目
   *    （项目详情页的「任务」页签）。
   */
  projectId?: number;
}

/**
 * 任务工作台：顶部 Segmented 切三种视图，下面是当前那个视图。
 *
 * ⚠️ 只挂载**当前**视图（甘特图渲染贵，三个一起挂没必要）；
 *    数据是共享的 ⇒ 切过去不用重新取数。
 *
 * @param props `projectId` 限定项目；不传就是全部
 */
export function TaskWorkspace({
  projectId,
}: TaskWorkspaceProps): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseTaskView(searchParams.get('view'));

  /** 切视图：只改 URL，不动数据 ⇒ 不会触发任何请求 */
  const changeView = (next: string | number) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', String(next));
    // ⚠️ `replace`：切视图不该往浏览器历史里塞一堆垃圾
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">任务管理</span>
        <Segmented value={view} onChange={changeView} options={VIEW_OPTIONS} />
      </div>

      {view === 'list' ? <TaskListView projectId={projectId} /> : null}
      {view === 'board' ? <TaskBoard projectId={projectId} /> : null}
      {view === 'gantt' ? <TaskGantt projectId={projectId} /> : null}
    </div>
  );
}
