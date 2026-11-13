import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  MARKET_ROOM,
  OPEN_TASK_STATUSES,
  runRoom,
  studioRoom,
  type AgentKey,
  type AgentLogChunkEvent,
  type AgentScreenDto,
  type MarketIngestedEvent,
  type ReviewCountsDto,
  type ServerToClientEvents,
  type StudioCountsDto,
  type TaskStatus,
} from '@robdev/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StudioGateway } from './studio.gateway.js';

type StudioEventName = Exclude<keyof ServerToClientEvents, 'market:ingested' | 'agent:log-chunk'>;
type StudioEventPayload<E extends StudioEventName> = Omit<
  Parameters<ServerToClientEvents[E]>[0],
  'studioId' | 'at'
>;

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly countsTimers = new Map<string, NodeJS.Timeout>();
  private readonly agentScreens = new Map<string, Map<AgentKey, AgentScreenDto>>();

  constructor(
    private readonly gateway: StudioGateway,
    private readonly prisma: PrismaService,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.countsTimers.values()) {
      clearTimeout(timer);
    }
    this.countsTimers.clear();
    this.agentScreens.clear();
  }

  emitAgentScreen(studioId: string, screen: AgentScreenDto): void {
    let byStudio = this.agentScreens.get(studioId);
    if (!byStudio) {
      byStudio = new Map<AgentKey, AgentScreenDto>();
      this.agentScreens.set(studioId, byStudio);
    }
    byStudio.set(screen.agentKey, screen);
    this.emitToStudio(studioId, 'agent:screen', { screen });
  }

  getAgentScreens(studioId: string): AgentScreenDto[] {
    const byStudio = this.agentScreens.get(studioId);
    if (!byStudio) return [];
    return [...byStudio.values()];
  }

  emitToStudio<E extends StudioEventName>(
    studioId: string,
    event: E,
    payload: StudioEventPayload<E>,
  ): void {
    const server = this.gateway.server;
    if (!server) return;
    const fullPayload = {
      ...payload,
      studioId,
      at: new Date().toISOString(),
    } as Parameters<ServerToClientEvents[E]>[0];
    // Cast to satisfy socket.io typed emitter union
    (
      server.to(studioRoom(studioId)).emit as (
        ev: E,
        data: Parameters<ServerToClientEvents[E]>[0],
      ) => boolean
    )(event, fullPayload);
  }

  emitToRun(
    studioId: string,
    runId: string,
    payload: Omit<AgentLogChunkEvent, 'studioId' | 'at'>,
  ): void {
    const server = this.gateway.server;
    if (!server) return;
    const fullPayload: AgentLogChunkEvent = {
      ...payload,
      studioId,
      at: new Date().toISOString(),
    };
    server.to([runRoom(runId), studioRoom(studioId)]).emit('agent:log-chunk', fullPayload);
  }

  emitMarket(payload: Omit<MarketIngestedEvent, 'at'>): void {
    const server = this.gateway.server;
    if (!server) return;
    const fullPayload: MarketIngestedEvent = {
      ...payload,
      at: new Date().toISOString(),
    };
    server.to(MARKET_ROOM).emit('market:ingested', fullPayload);
  }

  broadcastCounts(studioId: string): void {
    const existing = this.countsTimers.get(studioId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.countsTimers.delete(studioId);
      void this.flushCounts(studioId);
    }, 250);
    this.countsTimers.set(studioId, timer);
  }

  private async flushCounts(studioId: string): Promise<void> {
    try {
      const counts = await this.computeStudioCounts(studioId);
      this.emitToStudio(studioId, 'studio:counts', { counts });
    } catch {
      // Ignore if studio was deleted or DB is shutting down
    }
  }

  async computeStudioCounts(studioId: string): Promise<StudioCountsDto> {
    const [needsYou, working, queued, openTasks, review] = await Promise.all([
      this.prisma.humanRequest.count({ where: { studioId, status: 'OPEN' } }),
      this.prisma.agent.count({ where: { studioId, status: 'WORKING' } }),
      this.prisma.task.count({ where: { studioId, status: 'QUEUED' } }),
      this.prisma.task.count({
        where: { studioId, status: { in: [...OPEN_TASK_STATUSES] as TaskStatus[] } },
      }),
      this.computeReviewCounts(studioId),
    ]);

    return {
      needsYou,
      working,
      queued,
      openTasks,
      review,
    };
  }

  async computeReviewCounts(studioId: string, gameId?: string): Promise<ReviewCountsDto> {
    const rows = await this.prisma.reviewItem.groupBy({
      by: ['tab', 'status'],
      where: {
        studioId,
        ...(gameId ? { gameId } : {}),
      },
      _count: { _all: true },
    });

    let toReview = 0;
    let changesAsked = 0;
    let approved = 0;
    let rejected = 0;

    const byTab: ReviewCountsDto['byTab'] = {
      IMAGES_VIDEO: { toReview: 0, all: 0 },
      STAGES_PUBLISH: { toReview: 0, all: 0 },
    };

    for (const row of rows) {
      const count = row._count._all;
      if (row.status === 'TO_REVIEW') {
        toReview += count;
        byTab[row.tab].toReview += count;
      } else if (row.status === 'CHANGES_ASKED') {
        changesAsked += count;
      } else if (row.status === 'APPROVED') {
        approved += count;
      } else if (row.status === 'REJECTED') {
        rejected += count;
      }
      byTab[row.tab].all += count;
    }

    return {
      toReview,
      changesAsked,
      approved,
      rejected,
      all: toReview + changesAsked + approved + rejected,
      byTab,
    };
  }
}
