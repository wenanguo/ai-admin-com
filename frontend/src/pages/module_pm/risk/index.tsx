/**
 * 风险登记册页 —— 路由 `/pm/risk`（菜单由后端下发，目录挂在 /pm 下）。
 *
 * ⚠️ 本页只是**路由壳**：列表界面在 `RiskListView` 里
 * （项目详情页的「风险」页签用的是**同一个组件**，只是限定了当前项目）。
 */
import type React from 'react';
import { RiskListView } from '@/components/pm/risk/RiskListView';

const RiskRegister: React.FC = () => <RiskListView />;

export default RiskRegister;
