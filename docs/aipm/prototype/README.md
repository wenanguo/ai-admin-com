# AI 增强企业级项目管理系统 — 静态原型（AIPM 整合版）

> 这是一套**纯静态**原型，用于在动手开发前和用户确认需求。无需任何构建工具。
>
> **本版本 = 上游 AiAdmin 原型 + AIPM 整合**。上游原型（12 页、mock 数据对齐 PRD §5、Element 风格视觉）保持原样；整合新增的部分见下表。

## AIPM 整合内容

| # | 改动 | 位置 |
|---|---|---|
| 1 | **AI 浮窗 → 常驻右侧 AI 工作台**（对话 / 待确认 / 审计 三页签，可折叠 ⌘B） | `assets/js/partials.js` |
| 2 | **命令卡片**：AI 回复里展示实际调用的命令、参数摘要、影响范围、状态徽标、撤销入口 | `partials.js` `cmdCard()` |
| 3 | **待确认队列**：批量 / 破坏性操作的预览、命中清单、规则算出的 ⚠ 警告、确认 / 取消 / 调整范围 | `partials.js` `wbPendingHtml()` |
| 4 | **审计日志**：谁（人 / AI）· 做了什么 · 何时 · 可撤销；撤销是新增一条指向原记录的日志 | `partials.js` `wbAuditHtml()` |
| 5 | **AI 候选风险**：规则层识别的候选，**不直接入库**，采纳后进待确认 | `risks.html` |
| 6 | **里程碑判定依据**：把"为什么有风险"的规则依据摆在状态旁边 | `project-detail.html` |
| 7 | **ETA 预测卡**：P50 / P90 / 置信度 / 最大延期因子 | `project-detail.html` 进度 Tab |
| 8 | **AI 今日洞察**：规则算数字 + AI 措辞，并显式标注分工 | `dashboard.html` |
| 9 | **全局入口** `window.__aipmAsk(q)`：任意页面的「✦ 让 AI 处理」按钮都把指令送进工作台对话 | `partials.js` |
| 10 | **模型口径统一**为 MiniMax（`MiniMax-M3.1-Flash`） | `partials.js` / `ai-assistant.html` |

> **上游原型未改动**：本目录是从 `/Users/ruanying/project/AiAdmin/docs/prototype` 复制而来后整合的，AiAdmin 仓库中的原文件保持不变。

## 本地运行

```bash
cd prototype
python3 -m http.server 8123
# 打开 http://127.0.0.1:8123/index.html
```

## 如何打开

### 方式 A：直接双击（最简单）

1. 进入 `docs/prototype/` 目录
2. 双击 `index.html`，默认浏览器会自动打开

> 注意：Chrome / Edge 在 `file://` 协议下可能限制某些 AJAX 和 CDN 行为，本原型所有数据均为内嵌 mock（`assets/js/mock-data.js`），CDN 资源（Tailwind / Lucide / Chart.js）走 HTTPS，不依赖后端。

### 方式 B：本地 HTTP 服务（更接近真实）

```bash
cd docs/prototype
python -m http.server 8000
# 或
npx serve .
```

然后浏览器访问 `http://localhost:8000/`。

> 推荐方式 B —— 浏览器对 HTTP/HTTPS 一致行为，某些 CDN 缓存策略更稳。

## 页面清单

| 入口 | 文件 | 说明 |
|---|---|---|
| 登录 | `index.html` | 登录页 + Demo 账号 |
| 工作台 | `dashboard.html` | 仪表盘（PMO / 高管视角） |
| 项目 | `projects.html` | 项目列表/看板 |
| | `project-detail.html` | 项目详情 + 6 Tab |
| | `milestones.html` | 里程碑甘特 |
| 任务 | `task-board.html` | 6 列 Kanban |
| | `task-list.html` | 表格 + 多列筛选 |
| 风险 | `risks.html` | 5×5 热力图 + 登记册 |
| 评论 | `comments.html` | 评论中心 + AI 总结 |
| AI 助理 | `ai-assistant.html` | 10 类意图对话 |
| 纪要 | `meeting-summary.html` | 上传 + 结构化抽取 |
| 设置 | `settings.html` | 模板/字段配置 |

## 全局组件

- **左侧菜单**：固定 240 px，按角色展示不同菜单
- **顶栏**：面包屑（含 `?from=` 来源）+ 全局搜索 + 通知 + 用户头像
- **AI 浮窗**：右下角紫色脉冲按钮，**每个页面都有**，点击展开 400 × 600 对话框
- **顶部 Tab**：项目详情等页面使用

## 技术栈

| 资源 | 引入方式 |
|---|---|
| Tailwind CSS | `https://cdn.tailwindcss.com` |
| Lucide Icons | `https://unpkg.com/lucide@latest` |
| Chart.js | `https://cdn.jsdelivr.net/npm/chart.js` |

## 数据

- mock 数据见 `assets/js/mock-data.js`
- 字段名对齐 PRD 第 5 节

## 反馈

评审请直接对页面截图 + 文字批注，反馈给产品同学。

