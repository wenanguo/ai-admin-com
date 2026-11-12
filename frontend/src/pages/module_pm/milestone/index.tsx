/**
 * 里程碑管理页 —— 路由 `/pm/milestone`（菜单由后端下发，目录挂在 /pm 下）。
 *
 * ⚠️ 本页只是**路由壳**：列表界面在 `MilestoneListView` 里
 * （项目详情页的「里程碑」页签用的是**同一个组件**，只是限定了当前项目）。
 */
import type React from 'react';
import { MilestoneListView } from '@/components/pm/milestone/MilestoneListView';

const MilestoneManagement: React.FC = () => <MilestoneListView />;

export default MilestoneManagement;
