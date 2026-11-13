-- Idempotent migration reconciling prior schema additions and Phase 0-5 roadmap features

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE "ChatArchiveKind" AS ENUM ('FRESH_START', 'BRANCH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'CLAUDE_WEB';
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'CHATGPT_WEB';
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'GEMINI_APP';
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'CLAUDE_APP';
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'GPT_APP';
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'ANTIGRAVITY';
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'CLAUDE_CODE';
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'CODEX';

ALTER TYPE "AgentKey" ADD VALUE IF NOT EXISTS 'browser';

ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'list_workspace_files';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'read_workspace_file';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'grep_workspace';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'edit_workspace_file';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'studio_inspect_tree';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'studio_read_script';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'studio_run_diagnostics';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'studio_run_playtest';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'run_terminal_command';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'comment_workspace_file';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'pc_observe';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'pc_act';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'pc_window';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'pc_sandbox';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'studio_direct';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'browser_navigate';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'browser_observe';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'browser_act';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'browser_extract';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'browser_tabs';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'asset_register';
ALTER TYPE "AgentTool" ADD VALUE IF NOT EXISTS 'asset_search';

-- 2. Studio columns (prior + Phase 0 encrypted Open Cloud key + Phase 3 budgets)
ALTER TABLE "Studio"
  ADD COLUMN IF NOT EXISTS "codingMode" TEXT NOT NULL DEFAULT 'LOCAL_SYNC',
  ADD COLUMN IF NOT EXISTS "codingSyncTool" TEXT NOT NULL DEFAULT 'SILICON',
  ADD COLUMN IF NOT EXISTS "contextMode" TEXT NOT NULL DEFAULT 'ROBLOX',
  ADD COLUMN IF NOT EXISTS "allowTerminalWithoutPermission" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allowExternalFilesWithoutPermission" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allowPcControlWithoutPermission" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pcIdleTakeoverSeconds" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "sandboxAccessPolicy" TEXT NOT NULL DEFAULT 'ALLOW',
  ADD COLUMN IF NOT EXISTS "sandboxProviderKind" TEXT NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN IF NOT EXISTS "maxConcurrentSandboxes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "allowAutoSaveVersion" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "allowAutoPublish" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "robloxUniverseId" TEXT,
  ADD COLUMN IF NOT EXISTS "robloxPlaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "openCloudApiKey" TEXT,
  ADD COLUMN IF NOT EXISTS "openCloudApiKeyCiphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "openCloudApiKeyIv" TEXT,
  ADD COLUMN IF NOT EXISTS "openCloudApiKeyTag" TEXT,
  ADD COLUMN IF NOT EXISTS "openCloudApiKeyLast4" TEXT,
  ADD COLUMN IF NOT EXISTS "dailyTokenBudget" INTEGER,
  ADD COLUMN IF NOT EXISTS "dailyCostBudgetUsd" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "perTaskTokenBudget" INTEGER;

-- 3. LlmConnection pricing columns (Phase 3)
ALTER TABLE "LlmConnection"
  ADD COLUMN IF NOT EXISTS "inputCostPerMTok" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "outputCostPerMTok" DOUBLE PRECISION;

-- 4. Task acceptance & metadata columns (prior + Phase 1)
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "acceptedByUserId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_acceptedByUserId_fkey"
    FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. ChatArchive table + AgentRun / AgentMessage archive columns
CREATE TABLE IF NOT EXISTS "ChatArchive" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" "ChatArchiveKind" NOT NULL,
    "number" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatArchive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChatArchive_agentId_kind_number_key" ON "ChatArchive"("agentId", "kind", "number");
CREATE INDEX IF NOT EXISTS "ChatArchive_agentId_createdAt_idx" ON "ChatArchive"("agentId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ChatArchive" ADD CONSTRAINT "ChatArchive_studioId_fkey"
    FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChatArchive" ADD CONSTRAINT "ChatArchive_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "AgentRun"
  ADD COLUMN IF NOT EXISTS "archiveId" TEXT,
  ADD COLUMN IF NOT EXISTS "costUsd" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "AgentRun_agentId_archiveId_startedAt_idx" ON "AgentRun"("agentId", "archiveId", "startedAt" DESC);

DO $$ BEGIN
  ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_archiveId_fkey"
    FOREIGN KEY ("archiveId") REFERENCES "ChatArchive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "RunLogEntry"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "RunArtifact"
  ADD COLUMN IF NOT EXISTS "agentComment" TEXT;

ALTER TABLE "AgentMessage"
  ADD COLUMN IF NOT EXISTS "archiveId" TEXT,
  ADD COLUMN IF NOT EXISTS "attachments" JSONB,
  ADD COLUMN IF NOT EXISTS "directives" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "AgentMessage_agentId_archiveId_createdAt_idx" ON "AgentMessage"("agentId", "archiveId", "createdAt" DESC);

DO $$ BEGIN
  ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_archiveId_fkey"
    FOREIGN KEY ("archiveId") REFERENCES "ChatArchive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6. WorkspaceFileComment table
CREATE TABLE IF NOT EXISTS "WorkspaceFileComment" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "authorKind" "MessageAuthor" NOT NULL DEFAULT 'AGENT',
    "agentId" TEXT,
    "agentKey" "AgentKey",
    "userId" TEXT,
    "runId" TEXT,
    "taskId" TEXT,
    "version" INTEGER,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceFileComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkspaceFileComment_studioId_path_createdAt_idx" ON "WorkspaceFileComment"("studioId", "path", "createdAt" DESC);

DO $$ BEGIN
  ALTER TABLE "WorkspaceFileComment" ADD CONSTRAINT "WorkspaceFileComment_studioId_fkey"
    FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WorkspaceFileComment" ADD CONSTRAINT "WorkspaceFileComment_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WorkspaceFileComment" ADD CONSTRAINT "WorkspaceFileComment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WorkspaceFileComment" ADD CONSTRAINT "WorkspaceFileComment_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WorkspaceFileComment" ADD CONSTRAINT "WorkspaceFileComment_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7. ReviewVerdict annotations (Phase 5b)
ALTER TABLE "ReviewVerdict"
  ADD COLUMN IF NOT EXISTS "annotations" JSONB;

-- 8. Playbook table (Phase 4)
CREATE TABLE IF NOT EXISTS "Playbook" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL,
    "suggestOnGameStatus" "GameStatus",
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Playbook_studioId_key_key" ON "Playbook"("studioId", "key");
CREATE INDEX IF NOT EXISTS "Playbook_studioId_idx" ON "Playbook"("studioId");

DO $$ BEGIN
  ALTER TABLE "Playbook" ADD CONSTRAINT "Playbook_studioId_fkey"
    FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 9. Vault full-text search index (Phase 2)
CREATE INDEX IF NOT EXISTS vault_document_fts
  ON "VaultDocument" USING gin (to_tsvector('simple', title || ' ' || markdown));
