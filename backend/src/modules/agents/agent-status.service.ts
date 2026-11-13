import { Injectable } from '@nestjs/common';
import type { AgentStatus } from '@robdev/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RunRegistryService } from '../orchestrator/run-registry.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { deriveAgentStatus } from './agent-status.rules.js';

interface EmittedAgentSnapshot {
  status: AgentStatus;
  currentTaskId: string | null;
  currentRunId: string | null;
  lastErrorCode: string | null;
}

@Injectable()
export class AgentStatusService {
  private readonly lastEmitted = new Map<string, EmittedAgentSnapshot>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RunRegistryService,
    private readonly realtime: RealtimeService,
  ) {}

  async recompute(agentId: string): Promise<AgentStatus | null> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        studio: { select: { isPaused: true } },
        llmConnection: { select: { isEnabled: true } },
      },
    });
    if (!agent) {
      return null;
    }

    const [needsHumanTaskCount, blockedTaskCount, queuedTaskCount, currentTask] =
      await Promise.all([
        this.prisma.task.count({ where: { agentId: agent.id, status: 'NEEDS_HUMAN' } }),
        this.prisma.task.count({ where: { agentId: agent.id, status: 'BLOCKED' } }),
        this.prisma.task.count({ where: { agentId: agent.id, status: 'QUEUED' } }),
        agent.currentTaskId
          ? this.prisma.task.findUnique({
              where: { id: agent.currentTaskId },
              select: { title: true, gameId: true },
            })
          : Promise.resolve(null),
      ]);

    const hasActiveRun =
      (agent.currentRunId !== null && this.registry.isActive(agent.currentRunId)) ||
      this.registry.hasActiveRunForAgent(agent.id);

    const nextStatus = deriveAgentStatus({
      isEnabled: agent.isEnabled,
      llmConnectionId: agent.llmConnectionId,
      modelId: agent.modelId,
      connectionIsEnabled: agent.llmConnection?.isEnabled ?? false,
      hasActiveRun,
      studioIsPaused: agent.studio.isPaused,
      lastErrorCode: agent.lastErrorCode,
      needsHumanTaskCount,
      blockedTaskCount,
      queuedTaskCount,
    });

    const dbChanged = agent.status !== nextStatus;
    if (dbChanged) {
      await this.prisma.agent.update({
        where: { id: agent.id },
        data: { status: nextStatus },
      });
    }

    const prev = this.lastEmitted.get(agent.id);
    const snapshotChanged =
      dbChanged ||
      (prev !== undefined &&
        (prev.status !== nextStatus ||
          prev.currentTaskId !== agent.currentTaskId ||
          prev.currentRunId !== agent.currentRunId ||
          prev.lastErrorCode !== agent.lastErrorCode));

    this.lastEmitted.set(agent.id, {
      status: nextStatus,
      currentTaskId: agent.currentTaskId,
      currentRunId: agent.currentRunId,
      lastErrorCode: agent.lastErrorCode,
    });

    if (snapshotChanged) {
      this.realtime.emitToStudio(agent.studioId, 'agent:status', {
        agentKey: agent.key,
        status: nextStatus,
        currentTaskId: agent.currentTaskId,
        currentTaskTitle: currentTask?.title ?? null,
        currentRunId: agent.currentRunId,
        currentGameId: currentTask?.gameId ?? null,
        lastSnippet: agent.lastSnippet,
        lastErrorCode: agent.lastErrorCode,
      });
      this.realtime.broadcastCounts(agent.studioId);
    }

    return nextStatus;
  }

  async recomputeStudio(studioId: string): Promise<void> {
    const agents = await this.prisma.agent.findMany({
      where: { studioId },
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
    });
    for (const agent of agents) {
      await this.recompute(agent.id);
    }
  }

  async recomputeAll(): Promise<void> {
    const agents = await this.prisma.agent.findMany({
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
    });
    for (const agent of agents) {
      await this.recompute(agent.id);
    }
  }
}
