/**
 * 任务管理页 —— 路由 `/pm/task`（菜单由后端下发）。
 *
 * ⚠️ 本页只是**路由壳**：界面在 `TaskWorkspace` 里
 * （列表 / 看板 / 甘特三种展现形式，用 Segmented 切，共享同一份数据）。
 */
import type React from 'react';
import { TaskWorkspace } from '@/components/pm/task/TaskWorkspace';

const TaskManagement: React.FC = () => <TaskWorkspace />;

export default TaskManagement;
