/**
 * 项目管理页 —— 路由 `/pm/project`（菜单由后端下发）。
 *
 * 本页是**壳**：真正的界面在 `ProjectWorkspace` 里
 * （列表 / 卡片两种视图，用 Segmented 切，共享同一份数据）。
 */
import type React from 'react';
import { ProjectWorkspace } from '@/components/pm/project/ProjectWorkspace';

const ProjectManagement: React.FC = () => <ProjectWorkspace />;

export default ProjectManagement;
