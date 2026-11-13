-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'PRODUCER', 'VIEWER');

-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'XAI', 'OLLAMA', 'OPENAI_COMPATIBLE');

-- CreateEnum
CREATE TYPE "AgentKey" AS ENUM ('lead', 'pulse', 'architect', 'builder', 'frame', 'scenic', 'balance', 'librarian', 'splash', 'producer', 'liveops', 'merchant', 'playtest', 'tester108', 'reviewer');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('IDLE', 'WORKING', 'WAITING_ON_HUMAN', 'BLOCKED', 'PAUSED', 'ERROR', 'OFFLINE');

-- CreateEnum
CREATE TYPE "AgentTool" AS ENUM ('vault_search', 'vault_read', 'vault_update_document', 'delegate_task', 'request_human', 'save_artifact', 'market_query', 'create_pitch', 'generate_image', 'submit_for_review', 'flag_blocker', 'acquire_studio_lane', 'release_studio_lane', 'record_build', 'update_milestone');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'NEEDS_HUMAN', 'BLOCKED', 'PAUSED', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskOrigin" AS ENUM ('USER', 'LEAD_DELEGATION', 'AGENT_DELEGATION', 'SYSTEM', 'REVIEW_FEEDBACK');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'AWAITING_HUMAN');

-- CreateEnum
CREATE TYPE "LogEntryKind" AS ENUM ('SYSTEM', 'CONTEXT', 'TEXT', 'TOOL_CALL', 'TOOL_RESULT', 'HANDOFF', 'ERROR', 'USAGE');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "HumanRequestKind" AS ENUM ('PICK_NEXT_GAME', 'TRY_IT', 'DECISION', 'INFO');

-- CreateEnum
CREATE TYPE "HumanRequestStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('ICON', 'THUMBNAIL', 'TRAILER', 'STORYBOARD', 'STAGE', 'PUBLISH');

-- CreateEnum
CREATE TYPE "ReviewTab" AS ENUM ('IMAGES_VIDEO', 'STAGES_PUBLISH');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('TO_REVIEW', 'CHANGES_ASKED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('APPROVE', 'ASK_CHANGES', 'REJECT');

-- CreateEnum
CREATE TYPE "BlockerSeverity" AS ENUM ('FIX_FIRST', 'SHOULD_FIX', 'NIT');

-- CreateEnum
CREATE TYPE "BlockerStatus" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('CONCEPT', 'BLUEPRINT', 'BUILDING', 'TESTING', 'LIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "BuildKind" AS ENUM ('SAVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MobilePassStatus" AS ENUM ('NOT_STARTED', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "PitchStatus" AS ENUM ('DRAFT', 'PROPOSED', 'CHANGES_REQUESTED', 'PICKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PitchSectionKey" AS ENUM ('FIRST_60_SECONDS', 'FIVE_MINUTE_LOOP', 'MINUTES_10_30', 'MONETIZATION', 'COMPETITORS', 'RISKS');

-- CreateEnum
CREATE TYPE "MarketSort" AS ENUM ('top-earning', 'top-playing-now', 'up-and-coming', 'top-rated');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('LIVE', 'SEED', 'COMPUTED');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AuthorKind" AS ENUM ('USER', 'AGENT', 'DISK', 'SEED');

-- CreateEnum
CREATE TYPE "StudioAssetKind" AS ENUM ('MESH', 'AUDIO', 'DECAL', 'IMAGE', 'ANIMATION', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT '#7C3AED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Studio" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspaceLabel" TEXT NOT NULL DEFAULT 'robdev',
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Studio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioMembership" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmConnection" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "provider" "LlmProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyCiphertext" TEXT,
    "apiKeyIv" TEXT,
    "apiKeyTag" TEXT,
    "apiKeyLast4" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "key" "AgentKey" NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "glyph" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "tools" "AgentTool"[],
    "status" "AgentStatus" NOT NULL DEFAULT 'OFFLINE',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "llmConnectionId" TEXT,
    "modelId" TEXT,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 4096,
    "imageConnectionId" TEXT,
    "imageModelId" TEXT,
    "currentTaskId" TEXT,
    "currentRunId" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "lastSnippet" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentVaultBinding" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,

    CONSTRAINT "AgentVaultBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "GameStatus" NOT NULL DEFAULT 'CONCEPT',
    "accentColor" TEXT NOT NULL DEFAULT '#A855F7',
    "robloxUniverseId" BIGINT,
    "robloxPlaceId" BIGINT,
    "iconMediaId" TEXT,
    "latestSavedVersion" INTEGER,
    "latestPublishedVersion" INTEGER,
    "createdFromPitchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameMilestone" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'TODO',
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GameMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameBuild" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "BuildKind" NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdByAgentId" TEXT,
    "createdByUserId" TEXT,
    "mobilePassA" "MobilePassStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "mobilePassB" "MobilePassStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioLane" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "heldByAgentId" TEXT,
    "heldForGameId" TEXT,
    "heldByRunId" TEXT,
    "heldSince" TIMESTAMP(3),

    CONSTRAINT "StudioLane_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "gameId" TEXT,
    "agentId" TEXT NOT NULL,
    "parentTaskId" TEXT,
    "createdByUserId" TEXT,
    "createdByAgentId" TEXT,
    "origin" "TaskOrigin" NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "tags" TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resultSummary" TEXT,
    "metadata" JSONB,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" "LlmProvider" NOT NULL,
    "modelId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunLogEntry" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "LogEntryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunArtifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunVaultInjection" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "estimatedTokens" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunVaultInjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "userId" TEXT,
    "taskId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanRequest" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "kind" "HumanRequestKind" NOT NULL,
    "status" "HumanRequestStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "gameId" TEXT,
    "agentId" TEXT,
    "taskId" TEXT,
    "options" JSONB,
    "pitchIds" TEXT[],
    "buildVersion" INTEGER,
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "gameId" TEXT,
    "kind" "ReviewKind" NOT NULL,
    "tab" "ReviewTab" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'TO_REVIEW',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "madeByAgentId" TEXT,
    "mediaId" TEXT,
    "taskId" TEXT,
    "runId" TEXT,
    "payload" JSONB,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "previousItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewVerdict" (
    "id" TEXT NOT NULL,
    "reviewItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blocker" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "gameId" TEXT,
    "taskId" TEXT,
    "runId" TEXT,
    "reviewItemId" TEXT,
    "agentId" TEXT,
    "severity" "BlockerSeverity" NOT NULL,
    "status" "BlockerStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "buildVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Blocker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pitch" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "logline" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "status" "PitchStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdByAgentId" TEXT,
    "runId" TEXT,
    "metrics" JSONB NOT NULL,
    "whatChanged" TEXT NOT NULL,
    "howDifferent" TEXT NOT NULL,
    "comparables" JSONB NOT NULL,
    "feedback" TEXT,
    "pickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pitch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PitchSection" (
    "id" TEXT NOT NULL,
    "pitchId" TEXT NOT NULL,
    "key" "PitchSectionKey" NOT NULL,
    "markdown" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "PitchSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketGame" (
    "id" TEXT NOT NULL,
    "universeId" BIGINT NOT NULL,
    "rootPlaceId" BIGINT,
    "name" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "creatorType" TEXT,
    "genreL1" TEXT,
    "genreL2" TEXT,
    "iconUrl" TEXT,
    "source" "DataSource" NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "marketGameId" TEXT NOT NULL,
    "ingestionRunId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "playing" INTEGER NOT NULL,
    "visits" BIGINT NOT NULL,
    "favoritedCount" BIGINT NOT NULL,
    "upVotes" INTEGER NOT NULL,
    "downVotes" INTEGER NOT NULL,
    "maxPlayers" INTEGER,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSortEntry" (
    "id" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "sort" "MarketSort" NOT NULL,
    "rank" INTEGER NOT NULL,
    "marketGameId" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,

    CONSTRAINT "MarketSortEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketIngestionRun" (
    "id" TEXT NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'RUNNING',
    "source" "DataSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "sortsFetched" TEXT[],
    "gamesFetched" INTEGER NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "warnings" TEXT[],

    CONSTRAINT "MarketIngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultFolder" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "VaultFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultDocument" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "alwaysInject" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "diskMtime" TIMESTAMP(3),
    "updatedByKind" "AuthorKind" NOT NULL DEFAULT 'SEED',
    "updatedByUserId" TEXT,
    "updatedByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultDocumentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "authorKind" "AuthorKind" NOT NULL,
    "authorUserId" TEXT,
    "authorAgentId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultDocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultLink" (
    "id" TEXT NOT NULL,
    "fromDocumentId" TEXT NOT NULL,
    "toDocumentId" TEXT,
    "targetPath" TEXT NOT NULL,

    CONSTRAINT "VaultLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioAsset" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "kind" "StudioAssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT[],
    "mediaId" TEXT,
    "robloxAssetId" BIGINT,
    "notes" TEXT NOT NULL DEFAULT '',
    "curatedByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Studio_slug_key" ON "Studio"("slug");

-- CreateIndex
CREATE INDEX "StudioMembership_userId_idx" ON "StudioMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioMembership_studioId_userId_key" ON "StudioMembership"("studioId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LlmConnection_studioId_label_key" ON "LlmConnection"("studioId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_studioId_key_key" ON "Agent"("studioId", "key");

-- CreateIndex
CREATE INDEX "AgentVaultBinding_documentId_idx" ON "AgentVaultBinding"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentVaultBinding_agentId_documentId_key" ON "AgentVaultBinding"("agentId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_createdFromPitchId_key" ON "Game"("createdFromPitchId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_studioId_slug_key" ON "Game"("studioId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "GameMilestone_gameId_key_key" ON "GameMilestone"("gameId", "key");

-- CreateIndex
CREATE INDEX "GameBuild_gameId_createdAt_idx" ON "GameBuild"("gameId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "GameBuild_gameId_version_kind_key" ON "GameBuild"("gameId", "version", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "StudioLane_studioId_name_key" ON "StudioLane"("studioId", "name");

-- CreateIndex
CREATE INDEX "Task_studioId_status_idx" ON "Task"("studioId", "status");

-- CreateIndex
CREATE INDEX "Task_agentId_status_idx" ON "Task"("agentId", "status");

-- CreateIndex
CREATE INDEX "Task_gameId_idx" ON "Task"("gameId");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_startedAt_idx" ON "AgentRun"("agentId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AgentRun_taskId_idx" ON "AgentRun"("taskId");

-- CreateIndex
CREATE INDEX "AgentRun_studioId_status_idx" ON "AgentRun"("studioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RunLogEntry_runId_seq_key" ON "RunLogEntry"("runId", "seq");

-- CreateIndex
CREATE INDEX "RunArtifact_runId_idx" ON "RunArtifact"("runId");

-- CreateIndex
CREATE INDEX "RunVaultInjection_documentId_createdAt_idx" ON "RunVaultInjection"("documentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RunVaultInjection_runId_idx" ON "RunVaultInjection"("runId");

-- CreateIndex
CREATE INDEX "AgentMessage_agentId_createdAt_idx" ON "AgentMessage"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "HumanRequest_studioId_status_idx" ON "HumanRequest"("studioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFile_storageKey_key" ON "MediaFile"("storageKey");

-- CreateIndex
CREATE INDEX "ReviewItem_studioId_tab_status_idx" ON "ReviewItem"("studioId", "tab", "status");

-- CreateIndex
CREATE INDEX "ReviewItem_gameId_idx" ON "ReviewItem"("gameId");

-- CreateIndex
CREATE INDEX "ReviewVerdict_reviewItemId_idx" ON "ReviewVerdict"("reviewItemId");

-- CreateIndex
CREATE INDEX "Blocker_studioId_status_idx" ON "Blocker"("studioId", "status");

-- CreateIndex
CREATE INDEX "Blocker_reviewItemId_idx" ON "Blocker"("reviewItemId");

-- CreateIndex
CREATE INDEX "Pitch_studioId_status_idx" ON "Pitch"("studioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PitchSection_pitchId_key_key" ON "PitchSection"("pitchId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MarketGame_universeId_key" ON "MarketGame"("universeId");

-- CreateIndex
CREATE INDEX "MarketSnapshot_marketGameId_capturedAt_idx" ON "MarketSnapshot"("marketGameId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "MarketSortEntry_marketGameId_idx" ON "MarketSortEntry"("marketGameId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSortEntry_ingestionRunId_sort_rank_key" ON "MarketSortEntry"("ingestionRunId", "sort", "rank");

-- CreateIndex
CREATE INDEX "MarketIngestionRun_status_startedAt_idx" ON "MarketIngestionRun"("status", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "VaultFolder_studioId_path_key" ON "VaultFolder"("studioId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "VaultDocument_studioId_path_key" ON "VaultDocument"("studioId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "VaultDocumentRevision_documentId_version_key" ON "VaultDocumentRevision"("documentId", "version");

-- CreateIndex
CREATE INDEX "VaultLink_toDocumentId_idx" ON "VaultLink"("toDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultLink_fromDocumentId_targetPath_key" ON "VaultLink"("fromDocumentId", "targetPath");

-- CreateIndex
CREATE INDEX "StudioAsset_studioId_kind_idx" ON "StudioAsset"("studioId", "kind");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioMembership" ADD CONSTRAINT "StudioMembership_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioMembership" ADD CONSTRAINT "StudioMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmConnection" ADD CONSTRAINT "LlmConnection_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_llmConnectionId_fkey" FOREIGN KEY ("llmConnectionId") REFERENCES "LlmConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_imageConnectionId_fkey" FOREIGN KEY ("imageConnectionId") REFERENCES "LlmConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVaultBinding" ADD CONSTRAINT "AgentVaultBinding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVaultBinding" ADD CONSTRAINT "AgentVaultBinding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "VaultDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_iconMediaId_fkey" FOREIGN KEY ("iconMediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_createdFromPitchId_fkey" FOREIGN KEY ("createdFromPitchId") REFERENCES "Pitch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMilestone" ADD CONSTRAINT "GameMilestone_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBuild" ADD CONSTRAINT "GameBuild_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBuild" ADD CONSTRAINT "GameBuild_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBuild" ADD CONSTRAINT "GameBuild_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioLane" ADD CONSTRAINT "StudioLane_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioLane" ADD CONSTRAINT "StudioLane_heldByAgentId_fkey" FOREIGN KEY ("heldByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioLane" ADD CONSTRAINT "StudioLane_heldForGameId_fkey" FOREIGN KEY ("heldForGameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunLogEntry" ADD CONSTRAINT "RunLogEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunArtifact" ADD CONSTRAINT "RunArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunVaultInjection" ADD CONSTRAINT "RunVaultInjection_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunVaultInjection" ADD CONSTRAINT "RunVaultInjection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "VaultDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanRequest" ADD CONSTRAINT "HumanRequest_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanRequest" ADD CONSTRAINT "HumanRequest_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanRequest" ADD CONSTRAINT "HumanRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanRequest" ADD CONSTRAINT "HumanRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanRequest" ADD CONSTRAINT "HumanRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_madeByAgentId_fkey" FOREIGN KEY ("madeByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_previousItemId_fkey" FOREIGN KEY ("previousItemId") REFERENCES "ReviewItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVerdict" ADD CONSTRAINT "ReviewVerdict_reviewItemId_fkey" FOREIGN KEY ("reviewItemId") REFERENCES "ReviewItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVerdict" ADD CONSTRAINT "ReviewVerdict_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blocker" ADD CONSTRAINT "Blocker_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blocker" ADD CONSTRAINT "Blocker_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blocker" ADD CONSTRAINT "Blocker_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blocker" ADD CONSTRAINT "Blocker_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blocker" ADD CONSTRAINT "Blocker_reviewItemId_fkey" FOREIGN KEY ("reviewItemId") REFERENCES "ReviewItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blocker" ADD CONSTRAINT "Blocker_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitchSection" ADD CONSTRAINT "PitchSection_pitchId_fkey" FOREIGN KEY ("pitchId") REFERENCES "Pitch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_marketGameId_fkey" FOREIGN KEY ("marketGameId") REFERENCES "MarketGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "MarketIngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSortEntry" ADD CONSTRAINT "MarketSortEntry_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "MarketIngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSortEntry" ADD CONSTRAINT "MarketSortEntry_marketGameId_fkey" FOREIGN KEY ("marketGameId") REFERENCES "MarketGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VaultFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocumentRevision" ADD CONSTRAINT "VaultDocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "VaultDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocumentRevision" ADD CONSTRAINT "VaultDocumentRevision_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocumentRevision" ADD CONSTRAINT "VaultDocumentRevision_authorAgentId_fkey" FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultLink" ADD CONSTRAINT "VaultLink_fromDocumentId_fkey" FOREIGN KEY ("fromDocumentId") REFERENCES "VaultDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultLink" ADD CONSTRAINT "VaultLink_toDocumentId_fkey" FOREIGN KEY ("toDocumentId") REFERENCES "VaultDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioAsset" ADD CONSTRAINT "StudioAsset_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioAsset" ADD CONSTRAINT "StudioAsset_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioAsset" ADD CONSTRAINT "StudioAsset_curatedByAgentId_fkey" FOREIGN KEY ("curatedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
