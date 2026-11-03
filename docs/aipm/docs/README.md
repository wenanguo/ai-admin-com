# AIPM 文档索引

> AI 驱动的项目管理平台。**一句话**：用一句话完成项目/里程碑/任务/风险的日常操作，AI 同时基于平台数据给出可解释的进度预测与风险预警。

## 文档地图

| 文档 | 回答什么问题 | 谁看 |
|---|---|---|
| [`00-master-spec.md`](00-master-spec.md) | 整体范围、目标、非目标、方案决策记录 | 全员 · 评审主文档 |
| [`01-architecture.md`](01-architecture.md) | 系统分几块？每块负责什么？怎么通信？ | 架构 · 全体开发 |
| [`02-domain-model.md`](02-domain-model.md) | 有哪些实体？状态怎么流转？指标怎么算？ | 业务 · 后端 · 测试 |
| [`03-api-contract.md`](03-api-contract.md) | 前后端之间到底传什么？ | 前端 · 后端 |
| [`04-command-catalog.md`](04-command-catalog.md) | AI 能做哪些操作？参数长什么样？哪些要人确认？ | 全体开发 · 测试 |
| [`05-agent-runtime.md`](05-agent-runtime.md) | pi agent 怎么接？会话怎么管？流式怎么传？降级怎么办？ | Agent 开发 |
| [`06-adapter-interface.md`](06-adapter-interface.md) | 外部 API 怎么接？能力差异怎么兜？ | 后端 · 适配层开发 |
| [`07-open-questions.md`](07-open-questions.md) | 还有哪些没定？谁来定？ | 全员 · 决策人 |

## 阅读顺序

- **第一次接触**：00 → 01 → 07
- **要写代码**：00 → 01 → 自己负责的那篇（02/03/04/05/06）→ 07 看有没有卡住自己的问题
- **要评审**：00 的"方案决策记录" + 07

## 上游文档

- [`superpowers/specs/PRD-v2.md`](superpowers/specs/PRD-v2.md) —— 企业级 AI 增强 PM 系统 PRD（基于 AiAdmin）。本项目吸收了它的**业务模型层**（状态机、不变量、计算口径、风险矩阵、预测算法、评测体系），未吸收它的框架层（FastAPI/Vue3/MySQL/LiteLLM）。
- [`superpowers/specs/2026-03-09-aipm-design.md`](superpowers/specs/2026-03-09-aipm-design.md) —— 设计过程的主文档（含完整方案对比与取舍记录）。本目录是它的**可执行拆分**。

## 原型

**主原型：`prototype/`** —— 12 页静态原型（Tailwind + Lucide + Chart.js），由上游 AiAdmin 原型整合 AIPM 能力而来：

- 常驻右侧 **AI 工作台**（对话 / 待确认 / 审计），取代原来的右下角浮窗
- 命令卡片、待确认队列、审计与撤销、候选风险、里程碑判定依据、ETA 预测
- 本地运行：`cd prototype && python3 -m http.server 8123` → http://127.0.0.1:8123/index.html

早期单文件原型（v1–v8）保留在 `.superpowers/brainstorm/*/content/` 作为设计过程记录，**不是当前主线**。

## 术语

| 术语 | 含义 |
|---|---|
| **模块① / 适配层** | 后端里负责与业务数据打交道的 CRUD 代码。默认通路是**转发外部已实现的 API** |
| **模块② / Agent** | 后端里用 pi agent 实现的 AI 编排层 |
| **命令 / tool** | 一次可被 AI 调用、可被审计、可被撤销的业务操作 |
| **领域模型** | 我们内部统一的实体与状态定义，外部 API 的字段与枚举都映射到它 |
| **待确认（PendingAction）** | 需要人点头才执行的操作，持久化在本地表里 |
| **补偿式撤销** | 外部 API 无历史版本时，用写前快照做反向写入来撤销 |
