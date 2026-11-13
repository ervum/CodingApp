import { randomUUID } from 'node:crypto';
import {
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  MarketSortIdTuple,
  type DataSource,
  type MarketIngestionRunDto,
  type MarketSortId,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { likeRatio, SORT_ID_TO_PRISMA } from './market-metrics.js';
import { RobloxClient } from './roblox/roblox-client.js';

function cronToIntervalMs(cronExpr: string): number {
  const match = /^\*\/(\d+)\s/.exec(cronExpr.trim());
  const minutes = match ? Number.parseInt(match[1]!, 10) : 30;
  return Math.max(1, Number.isFinite(minutes) ? minutes : 30) * 60_000;
}

@Injectable()
export class MarketIngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketIngestionService.name);
  private running = false;
  private bootTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
    private readonly roblox: RobloxClient,
    private readonly realtime: RealtimeService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.cfg.marketIngestEnabled) return;

    try {
      const intervalMs = cronToIntervalMs(this.cfg.marketIngestCron);
      const timer = setInterval(() => {
        void this.ingest().catch((err: unknown) => {
          this.logger.warn(`Scheduled market ingestion failed: ${String(err)}`);
        });
      }, intervalMs);
      this.scheduler.addInterval('market-ingestion', timer);
    } catch (err) {
      this.logger.warn(`Failed to register market-ingestion interval: ${String(err)}`);
    }

    if (this.cfg.marketIngestOnBoot) {
      this.bootTimer = setTimeout(() => {
        void this.ingest().catch((err: unknown) => {
          this.logger.warn(`Boot market ingestion failed: ${String(err)}`);
        });
      }, 5_000);
    }
  }

  onModuleDestroy(): void {
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    try {
      this.scheduler.deleteInterval('market-ingestion');
    } catch {
      // Ignore if not registered
    }
  }

  async ingest(options?: { throwIfBusy?: boolean }): Promise<MarketIngestionRunDto | null> {
    if (this.running) {
      if (options?.throwIfBusy) {
        throw new AppError(
          'INGESTION_IN_PROGRESS',
          HttpStatus.CONFLICT,
          'Market ingestion is already in progress',
        );
      }
      return null;
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const activeDbRun = await this.prisma.marketIngestionRun.findFirst({
      where: {
        status: 'RUNNING',
        startedAt: { gt: tenMinutesAgo },
      },
      select: { id: true },
    });

    if (activeDbRun) {
      if (options?.throwIfBusy) {
        throw new AppError(
          'INGESTION_IN_PROGRESS',
          HttpStatus.CONFLICT,
          'Market ingestion is already in progress',
        );
      }
      return null;
    }

    this.running = true;
    let requestCount = 0;
    const warnings: string[] = [];
    const sortsFetched: MarketSortId[] = [];
    const startedAt = new Date();

    const runRow = await this.prisma.marketIngestionRun.create({
      data: {
        status: 'RUNNING',
        source: 'LIVE',
        startedAt,
        sortsFetched: [],
        gamesFetched: 0,
        requestCount: 0,
        warnings: [],
      },
    });

    const ctx = {
      onRequest: () => {
        requestCount += 1;
      },
    };

    try {
      const sessionId = randomUUID();
      const sortsRes = await this.roblox.getSorts(sessionId, ctx);
      if (sortsRes.ok) {
        const discoveredIds = new Set(sortsRes.data.sorts.map((s) => s.sortId));
        for (const targetSort of MarketSortIdTuple) {
          if (!discoveredIds.has(targetSort)) {
            warnings.push(`MISSING_SORT:${targetSort}`);
          }
        }
      } else if (sortsRes.reason === 'parse') {
        warnings.push('SORTS_SCHEMA_DRIFT');
      } else {
        warnings.push('SORTS_HTTP_FAILURE');
      }

      const sortUniverseMap = new Map<
        MarketSortId,
        { ids: string[]; source: DataSource }
      >();
      let sawParseDrift = false;

      for (const sortId of MarketSortIdTuple) {
        const contentRes = await this.roblox.getSortContent(sessionId, sortId, ctx);
        if (contentRes.ok && contentRes.universeIds.length > 0) {
          const uniqueIds = [...new Set(contentRes.universeIds)].slice(0, 100);
          sortUniverseMap.set(sortId, { ids: uniqueIds, source: 'LIVE' });
          sortsFetched.push(sortId);
        } else {
          if (!contentRes.ok && contentRes.reason === 'parse') {
            sawParseDrift = true;
            warnings.push(`SCHEMA_DRIFT:${sortId}`);
          } else {
            warnings.push(`EMPTY_OR_FAILED_SORT:${sortId}`);
          }
        }
      }

      const unionIdsSet = new Set<string>();
      for (const { ids } of sortUniverseMap.values()) {
        for (const id of ids) {
          if (/^\d+$/.test(id)) {
            unionIdsSet.add(id);
          }
        }
      }

      if (unionIdsSet.size === 0) {
        const errorCode = sawParseDrift ? 'SCHEMA_DRIFT' : 'UPSTREAM_UNAVAILABLE';
        const failed = await this.prisma.marketIngestionRun.update({
          where: { id: runRow.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            requestCount,
            warnings,
            errorCode,
            errorMessage: 'Zero market sorts returned valid universe IDs',
          },
        });
        const dto = this.toRunDto(failed);
        this.realtime.emitMarket({
          ingestionRunId: dto.id,
          status: 'FAILED',
          gamesFetched: 0,
        });
        return dto;
      }

      const unionIds = [...unionIdsSet];
      const [gamesData, votesData, iconsData] = await Promise.all([
        this.roblox.getGames(unionIds, ctx),
        this.roblox.getVotes(unionIds, ctx),
        this.roblox.getIcons(unionIds, ctx),
      ]);

      const votesByUniverse = new Map<
        string,
        { upVotes: number; downVotes: number }
      >();
      for (const v of votesData) {
        votesByUniverse.set(String(v.id), {
          upVotes: v.upVotes,
          downVotes: v.downVotes,
        });
      }

      const iconByUniverse = new Map<string, string>();
      for (const ic of iconsData) {
        if (ic.imageUrl) {
          iconByUniverse.set(String(ic.targetId), ic.imageUrl);
        }
      }

      // Step 5: top-rated fallback if live top-rated returned no IDs
      const liveTopRated = sortUniverseMap.has('top-rated');
      if (!liveTopRated) {
        const candidates: Array<{ universeId: string; ratio: number }> = [];
        for (const g of gamesData) {
          const uid = String(g.id);
          const v = votesByUniverse.get(uid);
          if (!v) continue;
          const totalVotes = v.upVotes + v.downVotes;
          if (totalVotes < 5000) continue;
          const ratio = likeRatio(v.upVotes, v.downVotes);
          if (ratio !== null) {
            candidates.push({ universeId: uid, ratio });
          }
        }
        candidates.sort((a, b) => b.ratio - a.ratio);
        const top50 = candidates.slice(0, 50).map((c) => c.universeId);
        if (top50.length > 0) {
          sortUniverseMap.set('top-rated', { ids: top50, source: 'COMPUTED' });
          warnings.push('TOP_RATED_COMPUTED_FALLBACK');
        }
      }

      const marketGameIdByUniverse = new Map<string, string>();
      const now = new Date();

      for (const g of gamesData) {
        const uidStr = String(g.id);
        const uidBig = BigInt(uidStr);
        const rootPlaceBig =
          g.rootPlaceId !== null && g.rootPlaceId !== undefined
            ? BigInt(g.rootPlaceId)
            : null;
        const iconUrl = iconByUniverse.get(uidStr) ?? null;
        const genreL1 = g.genre_l1 ?? g.genre ?? null;
        const genreL2 = g.genre_l2 ?? null;

        const upserted = await this.prisma.marketGame.upsert({
          where: { universeId: uidBig },
          create: {
            universeId: uidBig,
            rootPlaceId: rootPlaceBig,
            name: g.name,
            creatorName: g.creator.name,
            creatorType: g.creator.type ?? null,
            genreL1,
            genreL2,
            iconUrl,
            source: 'LIVE',
            firstSeenAt: now,
            lastSeenAt: now,
          },
          update: {
            rootPlaceId: rootPlaceBig,
            name: g.name,
            creatorName: g.creator.name,
            creatorType: g.creator.type ?? null,
            ...(genreL1 ? { genreL1 } : {}),
            ...(genreL2 ? { genreL2 } : {}),
            ...(iconUrl ? { iconUrl } : {}),
            source: 'LIVE',
            lastSeenAt: now,
          },
          select: { id: true },
        });

        marketGameIdByUniverse.set(uidStr, upserted.id);
        const votes = votesByUniverse.get(uidStr) ?? { upVotes: 0, downVotes: 0 };

        await this.prisma.marketSnapshot.create({
          data: {
            marketGameId: upserted.id,
            ingestionRunId: runRow.id,
            capturedAt: startedAt,
            playing: g.playing ?? 0,
            visits: BigInt(g.visits ?? 0),
            favoritedCount: BigInt(g.favoritedCount ?? 0),
            upVotes: votes.upVotes,
            downVotes: votes.downVotes,
            maxPlayers: g.maxPlayers ?? null,
          },
        });
      }

      const sortEntryRows: Array<{
        ingestionRunId: string;
        sort: (typeof SORT_ID_TO_PRISMA)[MarketSortId];
        rank: number;
        marketGameId: string;
        source: DataSource;
      }> = [];

      for (const [sortId, entryData] of sortUniverseMap.entries()) {
        let rank = 1;
        for (const uid of entryData.ids) {
          const marketGameId = marketGameIdByUniverse.get(uid);
          if (!marketGameId) continue;
          sortEntryRows.push({
            ingestionRunId: runRow.id,
            sort: SORT_ID_TO_PRISMA[sortId],
            rank,
            marketGameId,
            source: entryData.source,
          });
          rank += 1;
        }
      }

      if (sortEntryRows.length > 0) {
        await this.prisma.marketSortEntry.createMany({
          data: sortEntryRows,
          skipDuplicates: true,
        });
      }

      const allFourLive = sortsFetched.length === 4 && liveTopRated;
      const status = allFourLive ? 'SUCCEEDED' : 'PARTIAL';

      const completed = await this.prisma.marketIngestionRun.update({
        where: { id: runRow.id },
        data: {
          status,
          finishedAt: new Date(),
          sortsFetched,
          gamesFetched: marketGameIdByUniverse.size,
          requestCount,
          warnings,
        },
      });

      // Step 9: Retention (45 days)
      const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      await this.prisma.marketSnapshot.deleteMany({
        where: { capturedAt: { lt: cutoff } },
      });
      await this.prisma.marketIngestionRun.deleteMany({
        where: {
          id: { not: completed.id },
          startedAt: { lt: cutoff },
        },
      });

      const dto = this.toRunDto(completed);
      this.realtime.emitMarket({
        ingestionRunId: dto.id,
        status,
        gamesFetched: dto.gamesFetched,
      });
      return dto;
    } catch (err) {
      const failed = await this.prisma.marketIngestionRun.update({
        where: { id: runRow.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          sortsFetched,
          requestCount,
          warnings,
          errorCode: 'UPSTREAM_UNAVAILABLE',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      const dto = this.toRunDto(failed);
      this.realtime.emitMarket({
        ingestionRunId: dto.id,
        status: 'FAILED',
        gamesFetched: 0,
      });
      return dto;
    } finally {
      this.running = false;
    }
  }

  toRunDto(row: {
    id: string;
    status: MarketIngestionRunDto['status'];
    source: MarketIngestionRunDto['source'];
    startedAt: Date;
    finishedAt: Date | null;
    sortsFetched: string[];
    gamesFetched: number;
    requestCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    warnings: string[];
  }): MarketIngestionRunDto {
    return {
      id: row.id,
      status: row.status,
      source: row.source,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      sortsFetched: row.sortsFetched,
      gamesFetched: row.gamesFetched,
      requestCount: row.requestCount,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      warnings: row.warnings,
    };
  }
}
