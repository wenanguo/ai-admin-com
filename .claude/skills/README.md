# `.claude/skills/` —— **指路存根，不是正文**

> 本仓的项目级技能（`antd`、`pro-upgrade`）**正文只有一份**，在
> [`.agents/skills/`](../../.agents/skills/)（Agent Skills 标准位置 ⇒ pi / Claude Code / Codex 等宿主都能发现）。

| 技能 | 正文（唯一） | 本目录里的东西 |
| ---- | ------------ | -------------- |
| `antd` | [`.agents/skills/antd/SKILL.md`](../../.agents/skills/antd/SKILL.md) | [`antd/SKILL.md`](antd/SKILL.md)（指路存根） |
| `pro-upgrade` | [`.agents/skills/pro-upgrade/SKILL.md`](../../.agents/skills/pro-upgrade/SKILL.md) | [`pro-upgrade/SKILL.md`](pro-upgrade/SKILL.md)（指路存根） |

## 为什么留存根而不是删掉

有些宿主（Claude Code）**只扫 `.claude/skills/`** ⇒ 把文件删了，这些宿主就再也看不到技能。
⇒ 留一个**只带 frontmatter + 一句指路**的存根：技能照样能被注册，**正文却只有一份** ⇒ 不会再漂移。

## 规矩

- **改正文 ⇒ 只改 `.agents/skills/<name>/SKILL.md`**（两份一起改的老规矩已经取消，2026-11-16，issue #55）。
- 升级技能定义：`npx skills add ant-design/ant-design-pro`。
  ⚠️ 该工具会往 `.claude/skills/` 里写**完整副本** ⇒ 升级后请把它换回指路存根（或删掉），
  否则又变成两份独立维护。
- `skills-lock.json` 记的是**技能的来源与安装位置**（工具产物）⇒ 它里面的 `skillPath` 指向
  `.claude/skills/…` 属于历史事实，正文位置以本文件为准。
