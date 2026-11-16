# 归档区（legacy）—— **上游 Ant Design Pro 的遗留**

> 这里放**从上游 Ant Design Pro 模板带过来、但已不属于本仓事实源**的文档。
> ⚠️ **归档 ≠ 删除**：内容都还在，只是不再当依据。
> 本仓自己的现行文档在 [`docs/`](../)（索引见 [`../directory-structure.md`](../directory-structure.md)）。

## 为什么归档（2026-11-16，issue #55）

上游 Pro 的 README / cheatsheet / 升级计划**讲的是上游的事**（issue 号是上游 Ant Design Pro 的，
功能清单按上游模板写）。本仓已经改成 monorepo（`frontend/` + `backend/ai/`）⇒ 继续把它们摊在
仓库顶层和 `docs/` 根下，会让人误以为是本仓的现行说明 ⇒ **同一件事出现第二份真相**。

## `ant-design-pro/` —— 上游 Pro 模板遗留

| 文件 | 是什么 | 现在归谁管 |
| ---- | ------ | ---------- |
| `README.ant-design-pro.md` | 上游 Pro 英文说明 | 上游仓库 |
| `README.ant-design-pro.zh-CN.md` | 上游 Pro 中文说明 | 上游仓库 |
| `THIRD-PARTY-NOTICES.md` | 第三方依赖声明（MIT 等） | 上游仓库（声明仍有效） |
| `cheatsheet.en-US.md` / `cheatsheet.zh-CN.md` | antd 组件速查表 | 上游 antd 文档 |
| `v6.1.0-release-plan.md` | 上游 Pro 的 v6.1.0 升级计划 | 上游仓库 |
| `v6.1.0-upgrade-evaluation.md` | 上游 Pro 的 v6.1.0 升级评估 | 上游仓库 |

### ⚠️ 两个「还在被用」的地方（别以为归档了就是死文件）

1. **`cheatsheet.*.md` 是前端构建输入** ——
   `frontend/src/pages/Welcome.tsx` 直接 `import` 它们（utoopack 的 `*.md` loader），
   `docker/web/Dockerfile` 也 `COPY` 它们 ⇒ **改了路径必须同步改 Dockerfile 与 import**。
2. **`THIRD-PARTY-NOTICES.md` 是第三方声明** —— 别当垃圾清掉。

### ⚠️ 别照抄上游的 issue 号

`v6.1.0-release-plan.md` 里的 issue 号（如 `#11772`）属**上游 Ant Design Pro**，不是本仓的。
本仓的待修清单一律**按本仓实际重新核对**后开单（见 [`../pm/roadmap.md`](../pm/roadmap.md)）。

## 本仓自己的「搁置物」在别处

本仓**自己写过、但因决策搁置**的文档（例如 M1 AIPM 规格与原型）不在这里 ⇒ 在
[`../archive/`](../archive/)（**本仓的决策** vs **上游的遗留**，两类分开放，才分得清）。
