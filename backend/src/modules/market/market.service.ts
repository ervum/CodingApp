import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  LeaderboardQuery,
  MarketHistoryPointDto,
  MarketIngestionRunDto,
  MarketLeaderboardDto,
  MarketRowDto,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { bigIntToString } from '../../common/serialization/bigint.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MarketIngestionService } from './market-ingestion.service.js';
import {
  delta7dPct,
  likeRatio,
  SORT_ID_TO_PRISMA,
  sparkline,
} from './market-metrics.js';

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: MarketIngestionService,
  ) {}

  async leaderboard(query: LeaderboardQuery): Promise<MarketLeaderboardDto> {
    const prismaSort = SORT_ID_TO_PRISMA[query.sort];

    let targetRun = await this.prisma.marketIngestionRun.findFirst({
      where: {
        status: { in: ['SUCCEEDED', 'PARTIAL'] },
        source: 'LIVE',
        sortEntries: {
          some: { sort: prismaSort },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!targetRun) {
      targetRun = await this.prisma.marketIngestionRun.findFirst({
        where: {
          status: { in: ['SUCCEEDED', 'PARTIAL'] },
          source: 'SEED',
          sortEntries: {
            some: { sort: prismaSort },
          },
        },
        orderBy: { startedAt: 'desc' },
      });
    }

    if (!targetRun) {
      return {
        sort: query.sort,
        source: 'SEED',
        capturedAt: null,
        isStale: true,
        lastError: null,
        genres: [],
        rows: [],
      };
    }

    const capturedAt = targetRun.startedAt;
    const isStale = capturedAt.getTime() < Date.now() - 2 * 60 * 60 * 1000;

    const latestFailed = await this.prisma.marketIngestionRun.findFirst({
      where: {
        status: 'FAILED',
        startedAt: { gt: capturedAt },
      },
      orderBy: { startedAt: 'desc' },
      select: { errorMessage: true, errorCode: true },
    });
    const lastError = latestFailed
      ? (latestFailed.errorMessage ?? latestFailed.errorCode ?? 'Ingestion failed')
      : null;

    const entries = await this.prisma.marketSortEntry.findMany({
      where: {
        ingestionRunId: targetRun.id,
        sort: prismaSort,
      },
      include: {
        marketGame: {
          include: {
            snapshots: {
              where: { capturedAt: { lte: new Date(capturedAt.getTime() + 60_000) } },
              orderBy: { capturedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { rank: 'asc' },
    });

    const genreSet = new Set<string>();
    for (const e of entries) {
      if (e.marketGame.genreL1) {
        genreSet.add(e.marketGame.genreL1);
      }
    }
    const genres = [...genreSet].sort((a, b) => a.localeCompare(b));

    const searchLower = query.search?.trim().toLowerCase();
    const genreFilter = query.genre?.trim();

    const filteredEntries = entries
      .filter((e) => {
        if (genreFilter && e.marketGame.genreL1 !== genreFilter) {
          return false;
        }
        if (
          searchLower &&
          !e.marketGame.name.toLowerCase().includes(searchLower) &&
          !e.marketGame.creatorName.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
        return true;
      })
      .slice(0, query.limit);

    const gameIds = filteredEntries.map((e) => e.marketGameId);
    const dailyByGame = await this.fetchDailyAverages(gameIds, capturedAt);

    const rows: MarketRowDto[] = filteredEntries.map((entry) => {
      const game = entry.marketGame;
      const snap = game.snapshots[0];
      const playing = snap?.playing ?? 0;
      const visits = Number(snap?.visits ?? 0n);
      const favoritedCount = Number(snap?.favoritedCount ?? 0n);
      const upVotes = snap?.upVotes ?? 0;
      const downVotes = snap?.downVotes ?? 0;
      const daily = dailyByGame.get(game.id) ?? [];

      return {
        rank: entry.rank,
        universeId: String(game.universeId),
        rootPlaceId: bigIntToString(game.rootPlaceId),
        name: game.name,
        creatorName: game.creatorName,
        genre: game.genreL1,
        iconUrl: game.iconUrl,
        playing,
        visits,
        favoritedCount,
        upVotes,
        downVotes,
        likeRatio: likeRatio(upVotes, downVotes),
        delta7dPct: delta7dPct(daily),
        sparkline: sparkline(daily),
        updatedAt: (snap?.capturedAt ?? game.lastSeenAt).toISOString(),
      };
    });

    const source =
      entries.length > 0 && entries.every((e) => e.source === 'COMPUTED')
        ? 'COMPUTED'
        : targetRun.source;

    return {
      sort: query.sort,
      source,
      capturedAt: capturedAt.toISOString(),
      isStale,
      lastError,
      genres,
      rows,
    };
  }

  async history(universeIdStr: string, days: number): Promise<MarketHistoryPointDto[]> {
    if (!/^\d+$/.test(universeIdStr)) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Market game not found');
    }

    const game = await this.prisma.marketGame.findUnique({
      where: { universeId: BigInt(universeIdStr) },
      select: { id: true },
    });
    if (!game) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Market game not found');
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const snapshots = await this.prisma.marketSnapshot.findMany({
      where: {
        marketGameId: game.id,
        capturedAt: { gte: since },
      },
      orderBy: { capturedAt: 'asc' },
    });

    return snapshots.map((s) => ({
      capturedAt: s.capturedAt.toISOString(),
      playing: s.playing,
      upVotes: s.upVotes,
      downVotes: s.downVotes,
    }));
  }

  async listIngestionRuns(limit = 10): Promise<MarketIngestionRunDto[]> {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const runs = await this.prisma.marketIngestionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: safeLimit,
    });
    return runs.map((r) => this.ingestion.toRunDto(r));
  }

  async triggerRefresh(userId: string): Promise<MarketIngestionRunDto> {
    const adminMembership = await this.prisma.studioMembership.findFirst({
      where: {
        userId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { id: true },
    });
    if (!adminMembership) {
      throw new AppError(
        'FORBIDDEN',
        HttpStatus.FORBIDDEN,
        'ADMIN role in at least one studio is required to refresh market data',
      );
    }

    const result = await this.ingestion.ingest({ throwIfBusy: true });
    if (!result) {
      throw new AppError(
        'INGESTION_IN_PROGRESS',
        HttpStatus.CONFLICT,
        'Market ingestion is already in progress',
      );
    }
    return result;
  }

  private async fetchDailyAverages(
    gameIds: string[],
    referenceTime: Date,
  ): Promise<Map<string, Array<{ day: string; avg: number }>>> {
    const result = new Map<string, Array<{ day: string; avg: number }>>();
    if (gameIds.length === 0) return result;

    const cutoff = new Date(referenceTime.getTime() - 8 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<
      Array<{ marketGameId: string; day: string; avgPlaying: number }>
    >`
      SELECT
        "marketGameId",
        to_char(date_trunc('day', "capturedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        AVG("playing")::float8 AS "avgPlaying"
      FROM "MarketSnapshot"
      WHERE "marketGameId" = ANY(${gameIds}::text[])
        AND "capturedAt" >= ${cutoff}
      GROUP BY "marketGameId", date_trunc('day', "capturedAt" AT TIME ZONE 'UTC')
      ORDER BY day ASC
    `;

    for (const row of rows) {
      const list = result.get(row.marketGameId) ?? [];
      list.push({ day: row.day, avg: Number(row.avgPlaying) });
      result.set(row.marketGameId, list);
    }

    return result;
  }
}
