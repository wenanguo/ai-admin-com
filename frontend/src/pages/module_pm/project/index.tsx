/**
 * 项目管理页 —— 路由 `/pm/project`（菜单由后端下发）。
 *
 * ⚠️ 本页暂时只渲染列表视图；卡片视图与切换器在 Task 5 的 `ProjectWorkspace` 里
 * （列表 / 卡片两种视图，用 Segmented 切，共享同一份数据）。
 */
import type React from 'react';
import { ProjectListView } from '@/components/pm/project/ProjectListView';

const ProjectManagement: React.FC = () => <ProjectListView />;

export default ProjectManagement;
