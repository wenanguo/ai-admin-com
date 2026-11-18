# 目录拆分 · 阶段 5：收口（`AIADMIN_*` 归插件 + 公开入口 + 零业务词）（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #82 · PR（阶段 5；**本阶段后 #82 关闭**）
- **一句话**：把最后三块「业务」从内核里搬出去（`AIADMIN_*` 环境变量 / 健康检查探针 /
  MCP 默认地址），并立起**公开入口** ⇒ 内核真的**零业务词**、**依赖不外泄**。

## 状态

**阶段 5 已完成** ⇒ **#82 全部阶段做完了**（阶段 0~5）⇒ issue 可以关。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `backend/ai/src/plugins/pm/env.ts` | ★ **插件声明自己的环境变量**（`AIADMIN_BASE_URL` / `AIADMIN_MCP_URL`）⇒ **变量名一个字没改** ⇒ 现有部署不用改配置；import 即校验 ⇒ 缺变量启动即失败 |
| `backend/ai/src/plugins/pm/health.ts` | ★ **业务探针归插件**（探上游能不能连上；内核只探自己的依赖：库、模型） |
| `backend/ai/src/core/plugins.ts` | 插件契约多两个能力：`health`（探针表）与 `mcpDefaultUrl`（MCP 默认地址） |
| `backend/ai/src/core/env/env.ts` | ★ **去掉 `AIADMIN_*`** ⇒ 内核的 env 只剩通用变量 |
| `backend/ai/src/core/routes/health-probes.ts` | ★ **去掉「探 AiAdmin」**（归插件） |
| `backend/ai/src/core/session/runtime.ts` | MCP 默认地址改从**插件**取（`options.mcpUrl` 仍可覆盖；`null` 仍表示显式不接） |
| `backend/ai/src/plugins.ts` | 导出 `plugins`（入口侧唯一知道业务插件的地方）⇒ server 用它拼探针 |
| `backend/ai/src/server.ts` | 探针 = 内核的（库、模型）+ **插件的**（上游）⇒ 响应形状不变（`checks.aiadmin` 还在） |
| `backend/ai/src/core/index.ts` | ★ **公开入口**（外部只从这里 import）：配置 / 插件契约 / 运行时 / 锚点 / 工具 / 身份 |
| `backend/ai/src/core/index.test.ts` | ★ 两条**可执行**断言：① 公开入口导出对外的那一套 ② **依赖不外泄**（内核只依赖通用件） |
| `backend/ai/src/core/README.md` | 内核说明（能力清单 / 依赖清单 / 硬规矩 / 「怎么写自己的插件」） |
| `backend/ai/src/plugins/pm/env.test.ts` | 插件 env 的校验用例 |
| `scripts/check-core-business-words.cjs` | ★ **允许清单清空**（3 条 ⇒ **0 条**）⇒ 「内核零业务词」真的成立 |

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **环境变量「声明」挪进插件，但变量名一个字不改** | `AIADMIN_BASE_URL` 是**部署契约**（.env / compose / k8s）⇒ 改名 ⇒ 所有部署起不来 | 顺手改成 `PM_UPSTREAM_URL` ⇒ 线上全挂 |
| **健康检查的探针做成插件能力**（键名也由插件定） | 「上游是谁」是业务知识 ⇒ 内核只探**自己**的依赖（库、模型） | 探针留内核 ⇒ 内核继续知道 AiAdmin ⇒ 零业务词做不到 |
| **MCP 默认地址改成「按插件取」** | 地址属于业务系统 ⇒ 插件给 ⇒ 换系统不用改内核 | 留成全局 env ⇒ 第二个插件没法用自己那台 MCP |
| **公开入口 = `core/index.ts`**（只导出稳定的那一套） | 内核将来要能**独立成包/独立仓** ⇒ 外部只从这里 import ⇒ 内部重构不破坏外部 | 外部到处 import 内核文件 ⇒ 每次搬家都要改外部 |
| **依赖清单用单测断言**（不许出现通用件之外的包） | 「依赖不外泄」是设计 §⑧ 的硬要求 ⇒ 光写在文档里没用 | 只写文档 ⇒ 半年后有人 import 了业务 SDK ⇒ 没人发现 |
| **依赖检查跳过测试文件** | 测试里的字符串是**夹具**（模拟上游载荷）⇒ 不是真的依赖 | 连测试一起查 ⇒ 误报 ⇒ 检查形同虚设 |

## 怎么验

```bash
cd backend/ai
npm run typecheck        # ✅
npm test                 # ✅ 51 个文件 / 459 条
rm -rf dist && npm run build   # ✅
cd ../..
node scripts/check-core-purity.cjs           # ✅ 内核不 import 插件
node scripts/check-core-business-words.cjs   # ✅ 内核零业务词（**允许清单为空**）
node scripts/e2e/ai-container.static.cjs     # ✅ 20 条
```

**端到端手测（本地起服务）**：

```bash
cd backend/ai && npm run dev
curl -s localhost:3100/health
# ⇒ checks 里仍有 database / aiadmin / model 三项（形状没变）
```

## 坑与提醒

- ⚠️ **健康检查的响应形状没变**（`checks.aiadmin` 还在）⇒ 编排系统的监控不用改 ✓
  （探针的**提供者**变了：从内核挪到了插件）。
- ⚠️ **`AIADMIN_BASE_URL` 现在由插件校验** ⇒ 缺它 ⇒ 启动即失败（消息一样点名缺哪个 ✓）。
- ⚠️ **`core/index.ts` 是新增的公开面** ⇒ 以后内核内部搬家**不要**改它（改了 = 改对外契约）。
- ⚠️ **工作区里前端的浏览器模式测试与 `npm run build` 跑不起来**（junction 软链）⇒ 与本改动无关。

## #82 收工清单（对照 issue 的验收）

- [x] `core/` 目录**零业务词**（**可执行的校验** ⇒ CI 跑，允许清单为空）
- [x] 业务代码全部落在 `plugins/pm/`
- [x] **依赖方向单向**：core 不 import 插件（单测 + CI 脚本钉住）
- [x] **插件可插拔**：不挂 PM 插件时，服务照常能起（通用智能体场景）
- [x] 迁移一律用 **`git mv`**（历史可追）
- [x] **行为完全不变**：现有 e2e 全绿
- [x] 文档同步：`docs/directory-structure.md` · `AGENTS.md` 架构一节 · `docs/ai-architecture.md` · `backend/ai/README.md` · `backend/ai/src/core/README.md`
