## 做了什么

Closes #24

`/dev.md` 要求 agent 提 PR 时**必写一行高风险标注**（PM 只抽查这类 PR），但 `.github/PULL_REQUEST_TEMPLATE.md` 里**没有这一栏** ⇒ agent 不知道要写（PR #18 是我手补的，下一个大概率会漏）。

- **模板开头**：提醒四栏必填（做了什么 / 怎么验 / 影响面 / 高风险）
- **新增「高风险」栏**：两种合法填法
  - 命中（AI 闸门口径 / 权限 / 数据模型 / 动 AiAdmin 那个仓）⇒ `高风险：<类别> -> <影响面>`
  - 没命中 ⇒ `高风险：无`
  - ⚠️ 明确**不要用复选框**（都勾或都不勾都说不清）⇒ 直接写一行字
- **docs/process.md**：流程第⑤步把「高风险」列进必含项 + 新增「PR 正文必含的四栏」表

## 怎么验

```bash
# 打开模板看「高风险」栏
cat .github/PULL_REQUEST_TEMPLATE.md
```

- [x] 我本地跑过上面的命令（模板与 docs/process.md 的四栏一致）

## 影响面

- [x] 只改了 `.github/PULL_REQUEST_TEMPLATE.md` 与 `docs/process.md`（**只改 `frontend/` 那一项不适用** ⇒ 见下）

⚠️ 实际改动：根级 `.github/`（PR 模板）+ 根级 `docs/`。**没碰 `frontend/`、没碰 `backend/ai/`、没碰 AiAdmin 那个仓。**

高风险：（临时去掉，验证检查会变红）

## 风险与回退

- 数据影响：无
- 回退方式：`git revert 5ffee72`

## 自审结论

- Critical：0
- Important：0
- Minor：
  - 「高风险」目前靠**人工/PM 抽查**；可以再加一个 CI 步骤（读 PR body，缺「高风险：」就提示）⇒ 本 PR 没做，先记着
