import { HttpStatus, Injectable } from '@nestjs/common';
import type { GameBuildDto, Paginated } from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { decodeCursor, toPaginated } from '../../common/http/pagination.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { GamesService } from './games.service.js';

@Injectable()
export class BuildsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly games: GamesService,
    private readonly tasks: TasksService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    studioId: string,
    gameId: string,
    cursorRaw?: string,
    limit = 25,
  ): Promise<Paginated<GameBuildDto>> {
    const game = await this.prisma.game.findFirst({
      where: { id: gameId, studioId },
      select: { id: true },
    });
    if (!game) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game not found');
    }

    const cursor = decodeCursor(cursorRaw);
    const rows = await this.prisma.gameBuild.findMany({
      where: {
        gameId: game.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        createdByAgent: { select: { key: true } },
        createdByUser: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    return toPaginated(rows, limit, (r) => this.games.toBuildDto(r));
  }

  async record(params: {
    studioId: string;
    gameId: string;
    version: number;
    kind: 'SAVED' | 'PUBLISHED';
    notes: string;
    agentId?: string | null;
    userId?: string | null;
  }): Promise<GameBuildDto> {
    const game = await this.prisma.game.findFirst({
      where: { id: params.gameId, studioId: params.studioId },
    });
    if (!game) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game not found');
    }

    const build = await this.prisma.gameBuild.upsert({
      where: {
        gameId_version_kind: {
          gameId: game.id,
          version: params.version,
          kind: params.kind,
        },
      },
      update: {
        notes: params.notes,
        ...(params.agentId ? { createdByAgentId: params.agentId } : {}),
        ...(params.userId ? { createdByUserId: params.userId } : {}),
        ...(params.kind === 'SAVED' ? { mobilePassA: 'QUEUED' } : {}),
      },
      create: {
        gameId: game.id,
        version: params.version,
        kind: params.kind,
        notes: params.notes,
        createdByAgentId: params.agentId ?? null,
        createdByUserId: params.userId ?? null,
        mobilePassA: params.kind === 'SAVED' ? 'QUEUED' : 'NOT_STARTED',
        mobilePassB: 'NOT_STARTED',
      },
      include: {
        createdByAgent: { select: { key: true } },
        createdByUser: { select: { displayName: true } },
      },
    });

    const nextSaved =
      params.kind === 'SAVED'
        ? Math.max(game.latestSavedVersion ?? 0, params.version)
        : game.latestSavedVersion;
    const nextPublished =
      params.kind === 'PUBLISHED'
        ? Math.max(game.latestPublishedVersion ?? 0, params.version)
        : game.latestPublishedVersion;

    await this.prisma.game.update({
      where: { id: game.id },
      data: {
        latestSavedVersion: nextSaved,
        latestPublishedVersion: nextPublished,
      },
    });

    if (params.kind === 'SAVED') {
      const tester = await this.prisma.agent.findUnique({
        where: { studioId_key: { studioId: params.studioId, key: 'tester108' } },
        select: { id: true },
      });
      if (tester) {
        await this.tasks.createInternal({
          studioId: params.studioId,
          agentId: tester.id,
          gameId: game.id,
          origin: 'SYSTEM',
          priority: 'HIGH',
          title: `Mobile pass A · v${params.version}`,
          brief: `Execute mobile viewport stress Pass A on saved build v${params.version} of "${game.name}" (${params.notes || 'saved build'}). Check 844x390 notched, 800x360 short, safe-zone insets, and tap targets per [08 Mobile].`,
          tags: ['mobile', 'pass-a'],
          metadata: { buildId: build.id, pass: 'A', buildVersion: params.version },
        });
      }
    }

    const gameDto = await this.games.getById(params.studioId, game.id);
    this.realtime.emitToStudio(params.studioId, 'game:updated', { game: gameDto });

    return this.games.toBuildDto(build);
  }

  async enqueueMobilePassB(
    studioId: string,
    gameId: string,
    buildVersion: number,
  ): Promise<void> {
    const game = await this.prisma.game.findFirst({
      where: { id: gameId, studioId },
      select: { id: true, name: true },
    });
    if (!game) return;

    let build = await this.prisma.gameBuild.findFirst({
      where: { gameId: game.id, version: buildVersion },
      orderBy: { createdAt: 'desc' },
    });

    if (!build) {
      build = await this.prisma.gameBuild.create({
        data: {
          gameId: game.id,
          version: buildVersion,
          kind: 'SAVED',
          notes: `Auto-created for publish review v${buildVersion}`,
          mobilePassA: 'NOT_STARTED',
          mobilePassB: 'QUEUED',
        },
      });
    } else {
      build = await this.prisma.gameBuild.update({
        where: { id: build.id },
        data: { mobilePassB: 'QUEUED' },
      });
    }

    const tester = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: 'tester108' } },
      select: { id: true },
    });
    if (tester) {
      await this.tasks.createInternal({
        studioId,
        agentId: tester.id,
        gameId: game.id,
        origin: 'SYSTEM',
        priority: 'HIGH',
        title: `Mobile pass B · v${buildVersion}`,
        brief: `Execute pre-publish mobile viewport stress Pass B on build v${buildVersion} of "${game.name}". Verify all [08 Mobile] and [05 UI and HUD] checks prior to publish approval.`,
        tags: ['mobile', 'pass-b'],
        metadata: { buildId: build.id, pass: 'B', buildVersion },
      });
    }

    const gameDto = await this.games.getById(studioId, game.id);
    this.realtime.emitToStudio(studioId, 'game:updated', { game: gameDto });
  }

  async onTaskFinished(
    studioId: string,
    task: { id: string; gameId: string | null; metadata: unknown },
    runId: string,
    succeeded: boolean,
  ): Promise<void> {
    if (!task.gameId || typeof task.metadata !== 'object' || task.metadata === null) {
      return;
    }
    const meta = task.metadata as Record<string, unknown>;
    const buildId = typeof meta['buildId'] === 'string' ? meta['buildId'] : null;
    const pass = meta['pass'] === 'A' || meta['pass'] === 'B' ? meta['pass'] : null;
    if (!buildId || !pass) {
      return;
    }

    let status: 'PASSED' | 'FAILED' = 'FAILED';
    if (succeeded) {
      const fixFirstCount = await this.prisma.blocker.count({
        where: {
          runId,
          severity: 'FIX_FIRST',
          status: 'OPEN',
        },
      });
      status = fixFirstCount === 0 ? 'PASSED' : 'FAILED';
    }

    await this.prisma.gameBuild.updateMany({
      where: { id: buildId, gameId: task.gameId },
      data: pass === 'A' ? { mobilePassA: status } : { mobilePassB: status },
    });

    const gameDto = await this.games.getById(studioId, task.gameId);
    this.realtime.emitToStudio(studioId, 'game:updated', { game: gameDto });
  }
}
