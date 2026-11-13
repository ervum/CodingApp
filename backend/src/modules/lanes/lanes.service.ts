import { HttpStatus, Injectable } from '@nestjs/common';
import type { AgentKey, StudioLaneDto } from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

@Injectable()
export class LanesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(studioId: string): Promise<StudioLaneDto[]> {
    const lanes = await this.prisma.studioLane.findMany({
      where: { studioId },
      include: { heldByAgent: { select: { key: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return lanes.map((l) => this.toDto(l));
  }

  async create(studioId: string, name?: string): Promise<StudioLaneDto> {
    const existing = await this.prisma.studioLane.findMany({
      where: { studioId },
      orderBy: { sortOrder: 'desc' },
      select: { name: true, sortOrder: true },
    });
    const nextSortOrder = (existing[0]?.sortOrder ?? -1) + 1;
    const laneName =
      name?.trim() || `Studio #${existing.length + 1}`;
    const duplicate = existing.some(
      (l) => l.name.toLowerCase() === laneName.toLowerCase(),
    );
    if (duplicate) {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `Studio lane "${laneName}" already exists`,
      );
    }

    const created = await this.prisma.studioLane.create({
      data: {
        studioId,
        name: laneName,
        sortOrder: nextSortOrder,
      },
      include: { heldByAgent: { select: { key: true } } },
    });
    const dto = this.toDto(created);
    this.realtime.emitToStudio(studioId, 'lane:updated', { lane: dto });
    return dto;
  }

  async acquire(params: {
    studioId: string;
    agentId: string;
    gameId: string;
    runId: string;
  }): Promise<StudioLaneDto | null> {
    const acquired = await this.prisma.$transaction(async (tx) => {
      // Check if this run already holds a lane
      const alreadyHeld = await tx.studioLane.findFirst({
        where: { studioId: params.studioId, heldByRunId: params.runId },
        include: { heldByAgent: { select: { key: true } } },
      });
      if (alreadyHeld) {
        return alreadyHeld;
      }

      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "StudioLane"
        WHERE "studioId" = ${params.studioId}
          AND "heldByAgentId" IS NULL
        ORDER BY "sortOrder" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      const picked = candidates[0];
      if (!picked) {
        return null;
      }

      return tx.studioLane.update({
        where: { id: picked.id },
        data: {
          heldByAgentId: params.agentId,
          heldForGameId: params.gameId,
          heldByRunId: params.runId,
          heldSince: new Date(),
        },
        include: { heldByAgent: { select: { key: true } } },
      });
    });

    if (!acquired) {
      return null;
    }

    const dto = this.toDto(acquired);
    this.realtime.emitToStudio(params.studioId, 'lane:updated', { lane: dto });
    return dto;
  }

  async releaseByRun(studioId: string, runId: string): Promise<boolean> {
    const held = await this.prisma.studioLane.findMany({
      where: { studioId, heldByRunId: runId },
    });
    if (held.length === 0) {
      return false;
    }

    for (const lane of held) {
      const updated = await this.prisma.studioLane.update({
        where: { id: lane.id },
        data: {
          heldByAgentId: null,
          heldForGameId: null,
          heldByRunId: null,
          heldSince: null,
        },
        include: { heldByAgent: { select: { key: true } } },
      });
      this.realtime.emitToStudio(studioId, 'lane:updated', { lane: this.toDto(updated) });
    }
    return true;
  }

  async forceRelease(studioId: string, laneId: string): Promise<StudioLaneDto> {
    const existing = await this.prisma.studioLane.findFirst({
      where: { id: laneId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio lane not found');
    }

    const updated = await this.prisma.studioLane.update({
      where: { id: existing.id },
      data: {
        heldByAgentId: null,
        heldForGameId: null,
        heldByRunId: null,
        heldSince: null,
      },
      include: { heldByAgent: { select: { key: true } } },
    });

    const dto = this.toDto(updated);
    this.realtime.emitToStudio(studioId, 'lane:updated', { lane: dto });
    return dto;
  }

  toDto(lane: {
    id: string;
    name: string;
    sortOrder: number;
    heldForGameId: string | null;
    heldByRunId: string | null;
    heldSince: Date | null;
    heldByAgent?: { key: AgentKey } | null;
  }): StudioLaneDto {
    return {
      id: lane.id,
      name: lane.name,
      sortOrder: lane.sortOrder,
      heldByAgentKey: lane.heldByAgent?.key ?? null,
      heldForGameId: lane.heldForGameId,
      heldByRunId: lane.heldByRunId,
      heldSince: lane.heldSince ? lane.heldSince.toISOString() : null,
    };
  }
}
