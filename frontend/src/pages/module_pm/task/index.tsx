/**
 * 任务管理列表页 —— 路由 `/pm/task`（菜单由后端下发，后端的路径是插件源码路径，
 * 靠 config/routes.ts 里的重定向路由落到本页）。
 *
 * ⚠️ 本页只是**路由壳**：列表界面在 `TaskListView` 里
 * （项目详情页的「任务」页签用的是**同一个组件**，只是限定了当前项目）。
 */
import type React from 'react';
import { TaskListView } from '@/components/pm/task/TaskListView';

const TaskManagement: React.FC = () => <TaskListView />;

export default TaskManagement;
