import type { AgentKey } from '@robdev/shared';
import type { Agent, PrismaClient } from '../../src/generated/prisma/client.js';
import { provisionStudioAgents } from '../../src/modules/studios/provision-studio.js';
import { deriveAgentStatus } from '../../src/modules/agents/agent-status.rules.js';

export { provisionStudioAgents as seedAgents };

export async function finalizeAgentStatuses(
  prisma: PrismaClient,
  studioId: string,
): Promise<void> {
  const studio = await prisma.studio.findUniqueOrThrow({
    where: { id: studioId },
  });
  const agents = await prisma.agent.findMany({
    where: { studioId },
    include: {
      llmConnection: true,
      tasks: true,
      runs: {
        where: { status: 'RUNNING' },
      },
    },
  });

  for (const agent of agents) {
    const needsHumanTaskCount = agent.tasks.filter((t) => t.status === 'NEEDS_HUMAN').length;
    const blockedTaskCount = agent.tasks.filter((t) => t.status === 'BLOCKED').length;
    const queuedTaskCount = agent.tasks.filter((t) => t.status === 'QUEUED').length;
    const hasActiveRun = agent.runs.length > 0;

    const status = deriveAgentStatus({
      isEnabled: agent.isEnabled,
      llmConnectionId: agent.llmConnectionId,
      modelId: agent.modelId,
      connectionIsEnabled: agent.llmConnection?.isEnabled ?? false,
      hasActiveRun,
      studioIsPaused: studio.isPaused,
      lastErrorCode: agent.lastErrorCode,
      needsHumanTaskCount,
      blockedTaskCount,
      queuedTaskCount,
    });

    await prisma.agent.update({
      where: { id: agent.id },
      data: { status },
    });
  }
}

export type AgentsByKey = Record<AgentKey, Agent>;
