import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../config/app-config.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: AppConfigService) {
    const adapter = new PrismaPg({ connectionString: config.databaseUrl });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.$executeRawUnsafe(
      `ALTER TABLE "Studio" ADD COLUMN IF NOT EXISTS "codingMode" TEXT NOT NULL DEFAULT 'LOCAL_SYNC';`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `ALTER TABLE "Studio" ADD COLUMN IF NOT EXISTS "codingSyncTool" TEXT NOT NULL DEFAULT 'SILICON';`,
    ).catch(() => {});
    for (const toolVal of [
      'list_workspace_files',
      'read_workspace_file',
      'grep_workspace',
      'edit_workspace_file',
      'studio_inspect_tree',
      'studio_read_script',
      'studio_run_diagnostics',
      'studio_run_playtest',
      'run_terminal_command',
      'comment_workspace_file',
      'pc_observe',
      'pc_act',
      'pc_window',
      'pc_sandbox',
      'studio_direct',
      'browser_navigate',
      'browser_observe',
      'browser_act',
      'browser_extract',
      'browser_tabs',
    ]) {
      await this.$executeRawUnsafe(
        `ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS '${toolVal}';`,
      ).catch(() => {});
    }
    await this.$executeRawUnsafe(
      `ALTER TYPE "AgentKey" ADD VALUE IF NOT EXISTS 'browser';`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `DO $$ BEGIN CREATE TYPE "ChatArchiveKind" AS ENUM ('FRESH_START', 'BRANCH'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "ChatArchive" (
        "id" TEXT NOT NULL,
        "studioId" TEXT NOT NULL,
        "agentId" TEXT NOT NULL,
        "kind" "ChatArchiveKind" NOT NULL,
        "number" INTEGER NOT NULL,
        "createdByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ChatArchive_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ChatArchive_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "ChatArchive_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ChatArchive_agentId_kind_number_key" ON "ChatArchive"("agentId", "kind", "number");`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "archiveId" TEXT REFERENCES "ChatArchive"("id") ON DELETE CASCADE;`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "llmConnectionId" TEXT;`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "temperature" DOUBLE PRECISION;`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "maxOutputTokens" INTEGER;`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `ALTER TABLE "AgentMessage" ADD COLUMN IF NOT EXISTS "archiveId" TEXT REFERENCES "ChatArchive"("id") ON DELETE CASCADE;`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `ALTER TABLE "AgentMessage" ADD COLUMN IF NOT EXISTS "attachments" JSONB;`,
    ).catch(() => {});
    await this.$executeRawUnsafe(
      `ALTER TABLE "AgentMessage" ADD COLUMN IF NOT EXISTS "directives" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];`,
    ).catch(() => {});
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
