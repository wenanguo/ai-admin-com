# 窄版 AI 工作台补「历史对话」（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #72 · PR #75（已合并，CI 全绿）
- **一句话**：把宽版已有的「历史对话」抽成**共用组件**，窄版（400px 小浮层）也接上
  ⇒ 换话题后能回看，AI 不再显得「失忆」。

## 状态

**已完成**（PR #75 已合并 · issue #72 已自动关闭 · CI 全绿）

## 短设计（规模：中 —— 要动宽版文件，做共用化）

**问题**：宽版（最大化）有「历史对话」（`AiWorkspaceWide` 里一段 `handleHistoryOpen` +
一个 `Dropdown`），窄版**整个文件里没有一处 `conversation`** ⇒ 窄版换话题后没法回看。

**做法**（**一份实现，两处用**）：

1. 新增 `frontend/src/components/ai-workspace/ConversationHistory.tsx`：
   - `useConversationHistory(open)` —— **打开才读** `listAiConversations()`，
     状态有 **加载中 / 空 / 失败（能重试）** 三态；
   - `ConversationHistoryList` —— 三态渲染 + 列表项（**标题 + 时间**，
     窄处 `text-overflow: ellipsis` **截断**）；
   - `ConversationHistory` —— 「历史对话」按钮 + 弹层（antd `Popover`），
     点一条 ⇒ `workspace.switchConversation(id)`（它内部读 `getAiState` ⇒ 历史消息上屏）。
2. 宽版：删掉自己那段 `handleHistoryOpen` / `conversations` / `historyError`，
   换成 `<ConversationHistory workspace={workspace} />` ⇒ **行为不变**（同一套实现）。
3. 窄版（`index.tsx` 的头部）：加**同一个**组件（`size="small"`）⇒ 入口与交互一致。

**为什么弹层用 `Popover` 而不是 `Dropdown` + `menu`**：弹层里是**自绘的列表**
（标题 + 时间 + 截断 + 重试按钮），不是 antd 的菜单项 ⇒ `menu` 表达不了；
`Popover` 的 `content` 正好是「一段自定义内容」，两种形态可以**完全同构**。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `edfb8f8`（squash 后是 `0bc290a`） | `ConversationHistory.tsx` 新组件（hook + 列表 + 按钮） |
| `edfb8f8` | 宽版改成用共用组件（删掉自己那段实现） |
| `edfb8f8` | 窄版头部接入共用组件 |
| `edfb8f8` | 单测：`ConversationHistory.test.tsx`（6 条）+ `index.test.tsx` 加 1 条（窄版入口 + 切会话） |
| `edfb8f8` | e2e：`frontend/e2e/ai-workspace.spec.ts` 加「历史对话（窄版也有）」一组 |

**下一步**：无（#72 已完成）。**下一条**：#73（窄版可拖动）—— 但它**不在 `ready` 队列**里
（只有 `agent-task`）⇒ 等 PM 放行（打 `ready`）再领。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 抽成 `ConversationHistory.tsx` 共用组件，**不抄第二份** | 抄一份 ⇒ 三态/截断/重试以后只改一处 ⇒ 必然漏 | 宽窄两边的行为漂移 |
| 弹层用 `Popover`（不是 `Dropdown` + `menu`） | 弹层里是自绘列表（标题+时间+截断+重试按钮），`menu` 表达不了 | 窄版只能显示一行标题 ⇒ 满足不了「标题/时间不溢出」这条验收 |
| **打开弹层不碰 `workspace`**（只读列表） | 验收要求「打开历史对话不打断正在流式输出」⇒ 不能重建会话、不能换订阅 | 正在生成的回答被打断 |
| 列表**按需读**（打开才读） | 面板是浮层（点开才挂载）⇒ 一挂上就发请求会让 AI 服务不可达时用户在别的页面也看到报错 | 无关页面莫名报错 |
| 失败态给「重试」按钮 | 只提示不给出路 ⇒ 用户没法自己恢复（宽版原来只能关掉重开） | 用户卡死在失败态 |
| 宽版**不删**自己的入口位置（仍在头部右侧） | 验收要求「入口与宽版一致的位置与交互」 | 宽版用户找不到入口 |

## 怎么验

```bash
cd frontend && npx vitest run src/components/ai-workspace   # 单测
cd frontend && npm run build && npx playwright test e2e/ai-workspace.spec.ts -g 历史对话  # e2e
cd frontend && npm run lint                                   # biome + tsc
```

## 坑与提醒

- ⚠️ **utoopack 在 worktree 里跑不起来**：`frontend/node_modules` 是 junction
  （指向主 checkout）⇒ utoopack 的原生解析器认为「软链目标跑出了文件系统根」
  ⇒ `max build` / `max dev` 都失败 ⇒ **要跑 e2e 只能在主 checkout 里跑**
  （本次是在主 checkout 上 `git checkout --detach <本分支>` 跑的，跑完切回 `main`）。
- ⚠️ antd 的 `Button` 会给**两个汉字**之间插空格 ⇒ 「重试」的可访问名是
  「重 试」⇒ 单测里要用 `/重\s*试/`。
- ⚠️ `Popover` 的内容渲染在 **body 的 portal** 里 ⇒ 单测里要用
  `render()` 返回的 `getByText`（它绑在 `document.body` 上），不能用 `container`。
