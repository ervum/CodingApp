-- AlterTable
ALTER TABLE "Studio" ADD COLUMN IF NOT EXISTS "browserHeadless" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "autoDeleteCreatedChats" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "WebChatSession" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "runId" TEXT,
    "taskId" TEXT,
    "rootTaskId" TEXT,
    "agentId" TEXT NOT NULL,
    "agentKey" "AgentKey" NOT NULL,
    "platform" TEXT NOT NULL,
    "guestMode" BOOLEAN NOT NULL DEFAULT false,
    "externalChatId" TEXT NOT NULL,
    "chatTitle" TEXT NOT NULL,
    "chatUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedFromWebAt" TIMESTAMP(3),

    CONSTRAINT "WebChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebChatSession_studioId_status_idx" ON "WebChatSession"("studioId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebChatSession_agentId_createdAt_idx" ON "WebChatSession"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebChatSession_runId_idx" ON "WebChatSession"("runId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebChatSession_rootTaskId_idx" ON "WebChatSession"("rootTaskId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WebChatSession" ADD CONSTRAINT "WebChatSession_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WebChatSession" ADD CONSTRAINT "WebChatSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WebChatSession" ADD CONSTRAINT "WebChatSession_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WebChatSession" ADD CONSTRAINT "WebChatSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
