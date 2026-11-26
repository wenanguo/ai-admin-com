-- 3_add_command_ack · 命令回执（**幂等的事实源**）—— issue #175 · S4
--
-- ⚠️ **绝对不能用 `prisma migrate dev` / `migrate reset`**：
--    共享库（aipm）里还有 AiAdmin 的 56 张业务表 ⇒ 那两条命令会把它当成本地草稿库，
--    并要求 `DROP DATABASE aipm` ⇒ **级别别人的业务表一行都没了**。
--
-- 生成方式（离线，不连库、不做 drift 检查 ⇒ 不可能把人家的表算成 DROP）：
--   git log -1 --diff-filter=A --format=%H -- prisma/migrations   # 取基线
--   git show <base_sha>:prisma/schema.prisma > /tmp/schema_before.prisma
--   npx prisma migrate diff --from-schema-datamodel /tmp/schema_before.prisma \
--     --to-schema-datamodel prisma/schema.prisma --script > 本文件
--
-- ⚠️ 本文件**只增**（共享库规矩：只允许新增表 / 加列，不改既有列的含义、不删数据）：
--   - **新建一张表** `ai_command_ack`（命令回执：幂等的事实源 ⇒ 跨进程也去重）。
--
-- 部署：npx prisma migrate deploy --schema prisma/schema.prisma`（**只在测试库先验**）。

-- CreateTable
CREATE TABLE `ai_command_ack` (
    `id` VARCHAR(64) NOT NULL,
    `conversation_id` VARCHAR(64) NOT NULL,
    `command_id` VARCHAR(128) NOT NULL,
    `ack` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_command_ack_conversation_id_command_id_key`(`conversation_id`, `command_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_command_ack` ADD CONSTRAINT `ai_command_ack_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
