-- 0_init_ai_tables · AI 服务的元数据表（首个迁移 = 基线）
--
-- ⚠️ 这几张表与 AiAdmin 的业务表同库（aipm），所以首个迁移只能「基线」：
--    建表 SQL 用 `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
--    生成、人工审过（只有这 5 张 ai_ 表、没有 DROP）之后，再用 `prisma db execute` 执行。
--    绝不能用 `prisma migrate dev` —— 它会把共享库整体判成 drift 并要求 reset（DROP 全部 56 张表，含 AiAdmin 业务表）。
--
-- 只建 5 张 ai_ 表：ai_conversation / ai_message / ai_pending_action / ai_audit_log / ai_entity_ref。
-- 后端遗留的空表 ai_action_log 与本迁移无关，不动。

-- CreateTable
CREATE TABLE `ai_conversation` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `project_ref` VARCHAR(128) NULL,
    `channel` ENUM('WEB') NOT NULL DEFAULT 'WEB',
    `title` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_conversation_user_id_updated_at_idx`(`user_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_message` (
    `id` VARCHAR(64) NOT NULL,
    `conversation_id` VARCHAR(64) NOT NULL,
    `role` ENUM('USER', 'ASSISTANT', 'SYSTEM') NOT NULL,
    `content` TEXT NOT NULL,
    `tool_calls` JSON NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_message_conversation_id_seq_idx`(`conversation_id`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_pending_action` (
    `id` VARCHAR(64) NOT NULL,
    `conversation_id` VARCHAR(64) NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `command` VARCHAR(64) NOT NULL,
    `args` JSON NOT NULL,
    `preview` JSON NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'EXECUTED') NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolved_by` VARCHAR(64) NULL,
    `adjusted_from` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_pending_action_status_user_id_idx`(`status`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_audit_log` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `actor_type` ENUM('USER', 'AI') NOT NULL,
    `command` VARCHAR(64) NOT NULL,
    `args` JSON NOT NULL,
    `before_snapshot` JSON NULL,
    `after_snapshot` JSON NULL,
    `undo_of` VARCHAR(64) NULL,
    `undone_at` DATETIME(3) NULL,
    `adopted` BOOLEAN NULL,
    `model` VARCHAR(128) NULL,
    `tokens` INTEGER NULL,
    `latency_ms` INTEGER NULL,
    `trace_id` VARCHAR(64) NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_audit_log_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `ai_audit_log_undo_of_idx`(`undo_of`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_entity_ref` (
    `id` VARCHAR(64) NOT NULL,
    `entity_type` ENUM('PROJECT', 'MILESTONE', 'TASK', 'RISK') NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `title_cache` VARCHAR(255) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_entity_ref_entity_type_external_id_key`(`entity_type`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_message` ADD CONSTRAINT `ai_message_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_pending_action` ADD CONSTRAINT `ai_pending_action_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

