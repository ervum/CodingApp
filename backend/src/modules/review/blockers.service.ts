import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AgentKey,
  BlockerDto,
  BlockerSeverity,
  BlockerStatus,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class BlockersService {
  constructor(private readonly prisma: PrismaService) {}

  async flag(params: {
    studioId: string;
    gameId: string | null;
    taskId?: string | null;
    runId?: string | null;
    agentId?: string | null;
    severity: BlockerSeverity;
    title: string;
    detail: string;
    buildVersion?: number | null;
  }): Promise<BlockerDto> {
    let reviewItemId: string | null = null;

    if (params.gameId && params.buildVersion !== null && params.buildVersion !== undefined) {
      const openCandidates = await this.prisma.reviewItem.findMany({
        where: {
          studioId: params.studioId,
          gameId: params.gameId,
          kind: { in: ['STAGE', 'PUBLISH'] },
          status: { in: ['TO_REVIEW', 'CHANGES_ASKED'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      const matched = openCandidates.find((item) => {
        if (typeof item.payload === 'object' && item.payload !== null) {
          return (
            (item.payload as Record<string, unknown>)['buildVersion'] === params.buildVersion
          );
        }
        return false;
      });
      if (matched) {
        reviewItemId = matched.id;
      }
    }

    const created = await this.prisma.blocker.create({
      data: {
        studioId: params.studioId,
        gameId: params.gameId,
        taskId: params.taskId ?? null,
        runId: params.runId ?? null,
        reviewItemId,
        agentId: params.agentId ?? null,
        severity: params.severity,
        status: 'OPEN',
        title: params.title,
        detail: params.detail,
        buildVersion: params.buildVersion ?? null,
      },
      include: {
        agent: { select: { key: true } },
      },
    });

    return this.toDto(created);
  }

  async updateStatus(
    studioId: string,
    blockerId: string,
    status: BlockerStatus,
  ): Promise<{ blocker: BlockerDto; reviewItemId: string | null }> {
    const existing = await this.prisma.blocker.findFirst({
      where: { id: blockerId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Blocker not found');
    }

    const updated = await this.prisma.blocker.update({
      where: { id: existing.id },
      data: {
        status,
        resolvedAt: status === 'OPEN' ? null : new Date(),
      },
      include: {
        agent: { select: { key: true } },
      },
    });

    return {
      blocker: this.toDto(updated),
      reviewItemId: updated.reviewItemId,
    };
  }

  toDto(row: {
    id: string;
    severity: BlockerSeverity;
    status: BlockerStatus;
    title: string;
    detail: string;
    buildVersion: number | null;
    createdAt: Date;
    agent?: { key: AgentKey } | null;
  }): BlockerDto {
    return {
      id: row.id,
      severity: row.severity,
      status: row.status,
      title: row.title,
      detail: row.detail,
      agentKey: row.agent?.key ?? null,
      buildVersion: row.buildVersion,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
