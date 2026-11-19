-- 2_add_dsh_session_storage · 会话 ↔ dsh session 的映射列 + **dsh 形状的会话事件日志**
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
-- ⚠️ 本文件**只加**（共享库规矩：只许加表 / 加列，不改已有列的含义、不删数据）：
--   - `ai_conversation` **加一列** `dsh_session_id`（**可空** ⇒ 迁移前的旧会话读得到、
--     不用回填 ⇒ 共享库上零写操作）；
--   - **新建一张表** `ai_session_event`（dsh 形状的追加式事件日志 ⇒ 只增不改）。
--
-- 部署：`npx prisma migrate deploy --schema prisma/schema.prisma`（**只在测试库先验**）。

-- AlterTable
ALTER TABLE `ai_conversation` ADD COLUMN `dsh_session_id` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `ai_session_event` (
    `id` VARCHAR(64) NOT NULL,
    `conversation_id` VARCHAR(64) NOT NULL,
    `dsh_session_id` VARCHAR(64) NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `kind` VARCHAR(32) NOT NULL,
    `event_name` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_session_event_conversation_id_seq_idx`(`conversation_id`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_session_event` ADD CONSTRAINT `ai_session_event_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
