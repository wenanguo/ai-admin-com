# session / skills / tools 三层归位（2026-11-25）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue **#169**（阶段一）· PR **（待填）**
- **一句话**：把 `backend/ai/src/core/` 里**重复实现 dsh** 的三块（技能目录 / 命令工具 /
  session 层）删掉 ⇒ 只留 **业务事实 · 对外契约 · 业务政策**。

## 状态

**进行中**（阶段一：骨架 + 验收脚本已落 ⇒ 实现按 S2 / S3 / S4 推进）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| （本条） | 骨架：静态验收脚本 `scripts/e2e/ai-subtraction.static.cjs`（把 issue 的验收标准写成可执行断言）+ 本交接文档 |

**下一步（具体到文件与命令）**：

```
S3：删 backend/ai/src/core/tools/{index,types}.ts ⇒ 命令改「MCP 工具形状」（core/mcp/tool.ts）
    然后 cd backend/ai && npm run typecheck && npm test
S2：删 backend/ai/src/core/skills/skill-catalog.ts ⇒ 清单改用 dsh 自己的发现
S4：删 backend/ai/src/core/session/frame-buffer.ts ⇒ 瘦身 session-registry.ts / runtime.ts
最后：node scripts/e2e/ai-subtraction.static.cjs && node scripts/check-dsh-boundary.cjs
```

## 决策记录（★ 最值钱的部分）

> 每个关键决定：**定了什么 / 为什么 / 错了的代价**。

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| `core/session/events.ts` **一个字都不改** | 前端按那 10 种 SSE 事件写 ⇒ 改了就断 | 前端大面积坏掉（且违反 issue 的「前端 0 改动」） |
| | | |
| | | |

## 怎么验

```bash
# ① 服务侧单测
cd backend/ai && npm test

# ② 类型 + 静态验收 + 边界守卫
cd backend/ai && npm run typecheck
node scripts/e2e/ai-subtraction.static.cjs
node scripts/check-dsh-boundary.cjs
node scripts/check-core-purity.cjs
node scripts/e2e/dsh-skills-mcp-plugins.static.cjs
```

## 坑与提醒

- ⚠️ **别把仓库翻个遍**：issue / 任务书里已经指了路径 ⇒ 读完就动手。
