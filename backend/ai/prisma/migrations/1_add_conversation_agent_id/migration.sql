-- 1_add_conversation_agent_id · 会话加「智能体」维度（**增量加一列**）
--
-- ⚠️ **绝对不能用 `prisma migrate dev` / `migrate reset`**：
--    共享库（aipm）里还有 AiAdmin 的 56 张业务表 ⇒ 那两条命令会把它们当 drift
--    并要求 `DROP DATABASE aipm` ⇒ **连别人的业务表一起没**。
--
-- 生成方式（离线，不连库、不做 drift 检查 ⇒ 不可能把别人的表算成 DROP）：
--   git log -1 --diff-filter=A --format=%H -- prisma/migrations   # 取基线
--   git show <base_sha>:prisma/schema.prisma > /tmp/schema_before.prisma
--   npx prisma migrate diff --from-schema-datamodel /tmp/schema_before.prisma \
--     --to-schema-datamodel prisma/schema.prisma --script > 本文件
--
-- ⚠️ 本文件**只加一列**（可空 ⇒ 迁移前的旧会话读得到、不会丢）：
--   - 不改已有列；不动别的表；不删任何东西。
--
-- 部署：`npx prisma migrate deploy --schema prisma/schema.prisma`（**只在测试库先验**）。

-- AlterTable
ALTER TABLE `ai_conversation` ADD COLUMN `agent_id` VARCHAR(64) NULL;
