import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CodingMode,
  CodingSyncTool,
  ContextMode,
  LiveRunDto,
  MembershipRole,
  SandboxAccessPolicy,
  SandboxProviderKind,
  StudioDto,
  StudioSnapshotDto,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentsService } from '../agents/agents.service.js';
import { GamesService } from '../games/games.service.js';
import { HumanRequestsService } from '../human-requests/human-requests.service.js';
import { LanesService } from '../lanes/lanes.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

@Injectable()
export class SnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly games: GamesService,
    private readonly agents: AgentsService,
    private readonly lanes: LanesService,
    private readonly humanRequests: HumanRequestsService,
    private readonly realtime: RealtimeService,
  ) {}

  async getSnapshot(
    studioId: string,
    myRole: MembershipRole,
  ): Promise<StudioSnapshotDto> {
    const studioRow = await this.prisma.studio.findUnique({
      where: { id: studioId },
    });
    if (!studioRow) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio not found');
    }

    const [
      games,
      agents,
      lanes,
      humanRequests,
      counts,
      activeRuns,
      llmConnectionCount,
      latestMarketIngest,
      vaultAgg,
      assetAgg,
    ] = await Promise.all([
      this.games.list(studioId),
      this.agents.list(studioId),
      this.lanes.list(studioId),
      this.humanRequests.list(studioId, 'OPEN'),
      this.realtime.computeStudioCounts(studioId),
      this.prisma.agentRun.findMany({
        where: { studioId, status: 'RUNNING' },
        include: {
          agent: { select: { key: true, lastSnippet: true } },
          task: { select: { id: true, title: true, gameId: true } },
        },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.llmConnection.count({
        where: { studioId, isEnabled: true },
      }),
      this.prisma.marketIngestionRun.findFirst({
        where: { status: { in: ['SUCCEEDED', 'PARTIAL'] } },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true, startedAt: true },
      }),
      this.prisma.vaultDocument.aggregate({
        where: { studioId },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      this.prisma.studioAsset.aggregate({
        where: { studioId },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);

    const studio: StudioDto = {
      id: studioRow.id,
      slug: studioRow.slug,
      name: studioRow.name,
      workspaceLabel: studioRow.workspaceLabel,
      isPaused: studioRow.isPaused,
      pausedAt: studioRow.pausedAt ? studioRow.pausedAt.toISOString() : null,
      browserHeadless: studioRow.browserHeadless,
      autoDeleteCreatedChats: studioRow.autoDeleteCreatedChats,
      codingMode: (studioRow.codingMode === 'ROBLOX_MCP'
        ? 'ROBLOX_MCP'
        : 'LOCAL_SYNC') as CodingMode,
      codingSyncTool: (['SILICON', 'ROJO', 'AZUL', 'ARGON', 'PESTO', 'RBXMK'].includes(
        studioRow.codingSyncTool,
      )
        ? studioRow.codingSyncTool
        : 'SILICON') as CodingSyncTool,
      contextMode: (studioRow.contextMode === 'GENERAL'
        ? 'GENERAL'
        : 'ROBLOX') as ContextMode,
      allowTerminalWithoutPermission:
        studioRow.allowTerminalWithoutPermission ?? false,
      allowExternalFilesWithoutPermission:
        studioRow.allowExternalFilesWithoutPermission ?? false,
      allowPcControlWithoutPermission:
        studioRow.allowPcControlWithoutPermission ?? false,
      pcIdleTakeoverSeconds: studioRow.pcIdleTakeoverSeconds ?? 60,
      sandboxAccessPolicy: (studioRow.sandboxAccessPolicy === 'ASK' ||
      studioRow.sandboxAccessPolicy === 'DENY'
        ? studioRow.sandboxAccessPolicy
        : 'ALLOW') as SandboxAccessPolicy,
      sandboxProviderKind: (studioRow.sandboxProviderKind === 'CLOUD_GPU'
        ? 'CLOUD_GPU'
        : 'LOCAL') as SandboxProviderKind,
      maxConcurrentSandboxes: studioRow.maxConcurrentSandboxes ?? 15,
      allowAutoSaveVersion: studioRow.allowAutoSaveVersion ?? true,
      allowAutoPublish: studioRow.allowAutoPublish ?? true,
      robloxUniverseId: studioRow.robloxUniverseId ?? null,
      robloxPlaceId: studioRow.robloxPlaceId ?? null,
      hasOpenCloudApiKey: Boolean(
        studioRow.openCloudApiKeyCiphertext || studioRow.openCloudApiKey,
      ),
      openCloudApiKeyLast4:
        studioRow.openCloudApiKeyLast4 ??
        (studioRow.openCloudApiKey ? studioRow.openCloudApiKey.slice(-4) : null),
      dailyTokenBudget: studioRow.dailyTokenBudget ?? null,
      dailyCostBudgetUsd: studioRow.dailyCostBudgetUsd ?? null,
      perTaskTokenBudget: studioRow.perTaskTokenBudget ?? null,
    };

    const liveRuns: LiveRunDto[] = activeRuns.map((r) => ({
      runId: r.id,
      taskId: r.task.id,
      taskTitle: r.task.title,
      agentKey: r.agent.key,
      gameId: r.task.gameId,
      startedAt: r.startedAt.toISOString(),
      lastSnippet: r.agent.lastSnippet,
      laneName: lanes.find((l) => l.heldByRunId === r.id)?.name ?? null,
    }));

    const unboundAgentKeys = agents
      .filter((a) => !a.modelLabel)
      .map((a) => a.key);

    const marketTs =
      latestMarketIngest?.finishedAt ?? latestMarketIngest?.startedAt ?? null;

    return {
      studio,
      myRole,
      games,
      agents,
      liveRuns,
      lanes,
      humanRequests,
      counts,
      freshness: {
        marketLastSuccessAt: marketTs ? marketTs.toISOString() : null,
        vaultDocCount: vaultAgg._count._all,
        vaultLastUpdatedAt: vaultAgg._max.updatedAt
          ? vaultAgg._max.updatedAt.toISOString()
          : null,
        assetCount: assetAgg._count._all,
        assetLastUpdatedAt: assetAgg._max.createdAt
          ? assetAgg._max.createdAt.toISOString()
          : null,
      },
      agentScreens: this.realtime.getAgentScreens(studioId),
      setup: {
        hasAnyLlmConnection: llmConnectionCount > 0,
        unboundAgentKeys,
      },
      serverTime: new Date().toISOString(),
    };
  }
}
