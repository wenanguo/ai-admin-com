import { AppstoreOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useSearchParams } from '@umijs/max';
import { Segmented } from 'antd';
import type React from 'react';
import { ProjectCardView } from './ProjectCardView';
import { ProjectListView } from './ProjectListView';

/**
 * **项目工作台** —— 列表 / 卡片两种展现形式，一个页面。
 *
 * ## 为什么是一个页面
 *
 * 以前只有表格一个视图；加了卡片视图之后，如果做成两个路由，
 * 切一次 = 跳路由 + 重新挂载 + **重新取数** ⇒ 慢。
 * 现在：两个视图共用**同一份数据**（`useProjectDataset`，react-query 缓存）
 * ⇒ 切视图**零请求**。
 *
 * ## 视图状态放 URL
 *
 * `?view=list|card` ⇒ 刷新保持、深链接可用、侧边栏「项目列表」高亮不受影响
 * （pathname 还是 `/pm/project`）。
 */

/** 两种展现形式 */
export type ProjectView = 'list' | 'card';

/** 解析 URL 上的 `view` 参数（认不出来 ⇒ 列表） */
export function parseProjectView(raw: string | null): ProjectView {
  if (raw === 'card' || raw === 'list') return raw;
  return 'list';
}

/** Segmented 的选项 */
const VIEW_OPTIONS = [
  { label: '列表', value: 'list', icon: <UnorderedListOutlined /> },
  { label: '卡片', value: 'card', icon: <AppstoreOutlined /> },
];

/**
 * 项目工作台：顶部 Segmented 切两种视图，下面是当前那个视图。
 *
 * ⚠️ 只挂载**当前**视图（卡片与表格各有各的筛选态，一起挂没必要）；
 *    数据是共享的 ⇒ 切过去不用重新取数。
 */
export function ProjectWorkspace(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseProjectView(searchParams.get('view'));

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
        <span className="text-base font-semibold">项目管理</span>
        <Segmented value={view} onChange={changeView} options={VIEW_OPTIONS} />
      </div>

      {view === 'list' ? <ProjectListView /> : null}
      {view === 'card' ? <ProjectCardView /> : null}
    </div>
  );
}
