# AI 增强企业级项目管理系统 — 原型设计文档

> 静态 HTML 原型设计说明，用于需求评审。可直接双击 `index.html` 在浏览器打开。

---

## 1. 全局架构

### 1.1 目录结构
```
docs/prototype/
├── 00-plan.md                  ← 当前文件
├── README.md                   ← 打开方式
├── index.html                  ← 登录页（入口）
├── dashboard.html              ← 仪表盘
├── projects.html               ← 项目列表
├── project-detail.html         ← 项目详情（含里程碑时间线 Tab）
├── milestones.html             ← 里程碑管理（甘特）
├── task-board.html             ← 任务看板（6 列 Kanban）
├── task-list.html              ← 任务列表
├── risks.html                  ← 风险登记册（5x5 热力图）
├── comments.html               ← 评论中心
├── ai-assistant.html           ← AI 项目助理独立页
├── meeting-summary.html        ← 会议纪要总结
├── settings.html               ← 项目模板与字段配置
└── assets/
    ├── css/app.css             ← 微调样式
    └── js/
        ├── mock-data.js        ← 全局 mock 数据
        ├── partials.js         ← 侧边栏/顶栏/AI 浮窗注入
        └── app.js              ← 通用行为
```

### 1.2 技术栈
- Tailwind CSS (CDN) + Element Plus 视觉风格
- Lucide Icons (CDN) + Chart.js (CDN)
- 纯 HTML + Vanilla JS，零构建
- 中文 mock 数据 + 北京时区日期

### 1.3 视觉规范
| 项 | 取值 |
|---|---|
| 主色 (Element) | `#409EFF` |
| 成功 | `#67C23A` |
| 警告 | `#E6A23C` |
| 危险 | `#F56C6C` |
| 信息 | `#909399` |
| 背景 | `#F5F7FA`（淡灰） |
| 圆角 | 4 px（紧凑） |
| 字号 | 12 / 14 / 16（标准 Element） |

### 1.4 全局组件
- 左侧 240 px 菜单（基于 FastapiAdmin `/menus/me` 风格）
- 顶栏（面包屑 + 全局搜索 + 通知 + 用户）
- AI 浮窗（右下角紫色脉冲，点击展开 400 × 600 对话）
- 顶部 Tab（仅部分页面：项目详情等）

---

## 2. 页面清单（12 页）

| # | 文件 | 入口来源 | 核心元素 | AI 浮窗演示能力 |
|---|---|---|---|---|
| 1 | `index.html` | 直接进入 / 顶栏切换 | 登录表单 + SSO mock + 双因子 + Demo 账号一键登入 | — |
| 2 | `dashboard.html` | 顶栏菜单「工作台」 | PMO 视角 4 KPI + 燃尽图 + 健康度饼图；高管视角 + 关键节点 | NL 建任务、查询项目进度、AI 周报总结 |
| 3 | `projects.html` | 侧边栏「项目管理」 | 列表/看板视图切换、筛选、组合卡片、AI 标签 | AI 模板推荐 |
| 4 | `project-detail.html` | 项目列表点入 | 项目元信息 + 6 Tab + 里程碑时间线（默认展开）+ AI Coach | NL 拆任务、进度预测、风险预警 |
| 5 | `milestones.html` | 项目详情 Tab | 甘特时间线 + 状态徽章 + AI 预测达成日 | 进度预测、ETA |
| 6 | `task-board.html` | 项目详情 Tab / 侧边栏「任务」 | 6 列 Kanban + 卡片（含 assignee/估时/优先级/AI 标签） + 拖拽提示 | NL 建任务、NL 拆任务、智能分派 |
| 7 | `task-list.html` | 任务模块切换 | 表格 + 多列筛选 + Inline edit + 依赖箭头 | NL 查询、风险预警 |
| 8 | `risks.html` | 侧边栏「风险」 | 5×5 热力图 + 风险卡片列表 + AI Coach 卡片 | 风险预警（5 类） |
| 9 | `comments.html` | 项目评论 Tab | 评论树 + @人 mock + 附件 + AI 总结卡片 | 评论/纪要总结 |
| 10 | `ai-assistant.html` | 顶栏 AI 入口 | 10 类意图示例 query + 对话流 + 引用卡片 | 智能问答（10 类） |
| 11 | `meeting-summary.html` | 顶栏快捷入口 | 上传 mock + 转写 + 结构化抽取（decisions/actions/risks/questions） | 会议纪要总结 |
| 12 | `settings.html` | 顶栏个人中心 → 设置 | 范式模板 CRUD + 自定义字段 + 状态机配置 + AI 配额 | AI 模型选择 |

---

## 3. AI 浮窗（全局）

- **位置**：右下角圆形按钮（紫色 `#7C3AED`，带脉冲动画），`fixed` 定位
- **展开尺寸**：400 × 600，圆角 12，阴影大
- **预置 5-6 个 query 模板**：
  1. "帮我建一个 SSO 登录任务"（NL 建任务）
  2. "上周我负责的项目进度如何？"（进度查询）
  3. "拆解『用户中心重构』为 6 个子任务"（NL 拆任务）
  4. "识别『财务对账系统』的潜在风险"（风险预警）
  5. "总结这段会议纪要"（纪要总结）
  6. "本周公司项目亮点与风险？"（AI 周报）
- 点击示例 → 打字动画 + 模拟 AI JSON 卡片回复
- 每个页面都存在（由 `_partials.js` 注入到 `#ai-fab`）

---

## 4. 页面跳转 & 面包屑

- 顶部面包屑基于 URL `?from=` 参数（如 `?from=dashboard`）
- 至少 3 处跨页跳转：
  - 仪表盘 KPI「活跃项目 18」→ `projects.html?from=dashboard`
  - 项目列表点击项目 → `project-detail.html?from=projects`
  - 项目详情「任务进度 64%」→ `task-board.html?from=project-detail`
  - 项目详情「风险」 Tab → `risks.html?from=project-detail`
  - 任务卡片评论图标 → `comments.html?from=task-board`

---

## 5. 自检清单

- [x] 12 个 HTML 页面全部为真实视觉，无 `TBD` 占位
- [x] 顶部 Tailwind CDN 在 `<head>` 中引入，所有 CDN 紧跟 `<meta name="viewport">` 之后
- [x] AI 浮窗在 12 个页面全部存在（注入式）
- [x] 顶栏菜单根据当前页面 `.active` 高亮
- [x] 至少 3 个跨页面跳转（带 `?from=` 面包屑）
- [x] mock 数据字段与 PRD §5 完全对应
- [x] 5-6 个真实 AI 回复场景（带打字动画 + JSON 卡片）
- [x] 阅读 README.md 可直接打开

---

## 6. 数据建模决策（关联 PRD §6.0）

> **核心原则：Schema 反映业务不变性，API 反映查询便利性。**

### 6.1 里程碑与任务保持分表

虽然两者字段相似度高，但**不能用 `type` 字段合并到同一张表**——会立即付出 7 大代价：

1. 状态机不同（里程碑 vs 任务各自枚举）
2. 字段语义冲突（一半 NULL）
3. 依赖关系失效（任务的 `dependencies`/`parent_id` 与里程碑不通用）
4. 外键污染（`comments.target_type` / `risk_relations.target_type` 多态）
5. AI 预测输入分裂（里程碑走 CPM，任务走速率）
6. 权限粒度丢失
7. 报表/导出混乱

详见 PRD §6.0.2。

### 6.2 前端如何"一次拿全"

后端提供嵌套返回 API：

```
GET /projects/:id/milestones?include=tasks
```

返回结构：

```json
{
  "milestones": [
    {
      "id": 102,
      "name": "预付款模块",
      "progress": { "total": 6, "done": 2, "blocked": 1 },
      "tasks": [ /* 任务列表 */ ]
    }
  ]
}
```

前端只调一个接口，后端内部 JOIN。**单次请求、嵌套返回、表是干净的**——这是工程上"想要的便利"与"schema 干净"的正确解耦。

### 6.3 原型里的体现

- `milestones.html` 和 `project-detail.html` 都用 `MOCK.tasks.filter(t => t.milestone_id === m.id)` 这种客户端聚合，模拟后端嵌套返回
- 完成情况聚合（done/in_progress/blocked/todo/backlog 分布）由前端 `aggregate()` 函数计算，未来直接复用后端返回的 `progress` 字段
- AI 预测由前端 `aiPredictDate()` 模拟，未来替换为后端 ETA 服务

### 6.4 一行话原则

> 不要为"查询方便"破坏 schema 不变性。**用 API 层做 join，不在 schema 层做 join**。

---

**文档版本**：v1 · 2026-06-30
