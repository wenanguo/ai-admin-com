## 做了什么

<!-- 一两句：这个问题要解决什么。现在是什么行为，改完是什么行为。 -->

Closes #<issue 号>

## 怎么验

<!-- 可复制的命令或操作步骤。CI 应该能自动验一部分，但「人眼要看的东西」写在这里。 -->

```bash
# 例：
# cd backend/ai && npx vitest run
# cd frontend && npx vitest run src/components/ai-workspace
```

- [ ] 我本地跑过上面的命令，结果贴在下面对话里

## 影响面

<!-- 改到了哪些目录/模块；有没有跨仓（backend/ai 与 frontend 是同一个仓，AiAdmin 是**另一个仓**）。 -->

- [ ] 只改了 `frontend/`
- [ ] 只改了 `backend/ai/`
- [ ] 两个都改了
- [ ] 涉及 `AiAdmin`（**另一个仓** ⇒ 需要在那边单独提 PR）

## 风险与回退

<!-- 会不会影响线上？数据会不会变？能不能一键回退？ -->

- 数据影响：（无 / 写操作 ⇒ 说明）
- 回退方式：

## 自审结论

<!-- agent 自审的结果：Critical / Important 必须已修；Minor 列在这里。 -->

- Critical：0
- Important：0
- Minor（可延后）：
  - （例：xxx 的边界情况没覆盖到，先记着）
