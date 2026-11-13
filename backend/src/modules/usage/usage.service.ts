import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AgentKey,
  LlmProvider,
  StudioUsageReportDto,
  UsageBucketDto,
  UsageDailyPointDto,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(studioId: string, days = 14): Promise<StudioUsageReportDto> {
    const clampedDays = Math.min(90, Math.max(1, days));
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: {
        id: true,
        dailyTokenBudget: true,
        dailyCostBudgetUsd: true,
        perTaskTokenBudget: true,
      },
    });
    if (!studio) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio not found');
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (clampedDays - 1));

    const endDate = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayKey = startOfToday.toISOString().slice(0, 10);

    const [runs, agents, games] = await Promise.all([
      this.prisma.agentRun.findMany({
        where: {
          studioId,
          startedAt: { gte: startDate },
        },
        include: {
          agent: { select: { key: true, name: true, title: true } },
          task: {
            select: {
              gameId: true,
              game: { select: { id: true, name: true, genre: true } },
            },
          },
        },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.agent.findMany({
        where: { studioId },
        select: { key: true, name: true, title: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.game.findMany({
        where: { studioId },
        select: { id: true, name: true, genre: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const dailyMap = new Map<string, UsageDailyPointDto>();
    for (let i = 0; i < clampedDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dayStr = d.toISOString().slice(0, 10);
      dailyMap.set(dayStr, {
        day: dayStr,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        runCount: 0,
      });
    }

    type BucketAccumulator = UsageBucketDto & { durationsMs: number[] };

    const byAgentMap = new Map<AgentKey, BucketAccumulator>();
    for (const a of agents) {
      byAgentMap.set(a.key, {
        key: a.key,
        label: a.name,
        sublabel: a.title,
        agentKey: a.key,
        runCount: 0,
        failedRunCount: 0,
        failureRatePct: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        toolCallCount: 0,
        costUsd: 0,
        medianDurationMs: 0,
        durationsMs: [],
      });
    }

    const byModelMap = new Map<string, BucketAccumulator>();
    const byGameMap = new Map<string, BucketAccumulator>();
    for (const g of games) {
      byGameMap.set(g.id, {
        key: g.id,
        label: g.name,
        sublabel: g.genre,
        gameId: g.id,
        runCount: 0,
        failedRunCount: 0,
        failureRatePct: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        toolCallCount: 0,
        costUsd: 0,
        medianDurationMs: 0,
        durationsMs: [],
      });
    }

    let todayTokens = 0;
    let todayCostUsd = 0;
    let periodInputTokens = 0;
    let periodOutputTokens = 0;
    let periodCostUsd = 0;
    let periodRuns = 0;
    let periodFailedRuns = 0;
    let periodToolCalls = 0;

    for (const r of runs) {
      const dayStr = r.startedAt.toISOString().slice(0, 10);
      const tokens = r.inputTokens + r.outputTokens;
      const cost = r.costUsd ?? 0;
      const isFailed = r.status === 'FAILED';
      const durationMs = r.finishedAt
        ? Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime())
        : 0;

      periodInputTokens += r.inputTokens;
      periodOutputTokens += r.outputTokens;
      periodCostUsd += cost;
      periodRuns += 1;
      if (isFailed) periodFailedRuns += 1;
      periodToolCalls += r.toolCallCount;

      if (dayStr === todayKey) {
        todayTokens += tokens;
        todayCostUsd += cost;
      }

      const dayEntry = dailyMap.get(dayStr);
      if (dayEntry) {
        dayEntry.inputTokens += r.inputTokens;
        dayEntry.outputTokens += r.outputTokens;
        dayEntry.totalTokens += tokens;
        dayEntry.costUsd =
          Math.round((dayEntry.costUsd + cost) * 1_000_000) / 1_000_000;
        dayEntry.runCount += 1;
      }

      const agentBucket = byAgentMap.get(r.agent.key);
      if (agentBucket) {
        this.accumulateBucket(agentBucket, r, cost, isFailed, durationMs);
      }

      const modelKey = `${r.provider}::${r.modelId}`;
      let modelBucket = byModelMap.get(modelKey);
      if (!modelBucket) {
        modelBucket = {
          key: modelKey,
          label: r.modelId,
          sublabel: r.provider,
          provider: r.provider as LlmProvider,
          runCount: 0,
          failedRunCount: 0,
          failureRatePct: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallCount: 0,
          costUsd: 0,
          medianDurationMs: 0,
          durationsMs: [],
        };
        byModelMap.set(modelKey, modelBucket);
      }
      this.accumulateBucket(modelBucket, r, cost, isFailed, durationMs);

      const gameId = r.task.gameId ?? '__studio__';
      let gameBucket = byGameMap.get(gameId);
      if (!gameBucket) {
        gameBucket = {
          key: gameId,
          label: r.task.game?.name ?? 'Studio-Wide Tasks',
          sublabel: r.task.game?.genre ?? 'No game bound',
          gameId: r.task.gameId ?? null,
          runCount: 0,
          failedRunCount: 0,
          failureRatePct: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallCount: 0,
          costUsd: 0,
          medianDurationMs: 0,
          durationsMs: [],
        };
        byGameMap.set(gameId, gameBucket);
      }
      this.accumulateBucket(gameBucket, r, cost, isFailed, durationMs);
    }

    const finalize = (buckets: Iterable<BucketAccumulator>): UsageBucketDto[] =>
      [...buckets]
        .map(({ durationsMs, ...b }) => {
          const sorted = [...durationsMs].sort((x, y) => x - y);
          const mid = Math.floor(sorted.length / 2);
          const medianDurationMs =
            sorted.length === 0
              ? 0
              : sorted.length % 2 === 1
                ? sorted[mid]!
                : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
          return {
            ...b,
            failureRatePct:
              b.runCount > 0
                ? Math.round((b.failedRunCount / b.runCount) * 100)
                : 0,
            medianDurationMs,
          };
        })
        .sort((a, b) => b.totalTokens - a.totalTokens || b.runCount - a.runCount);

    return {
      studioId,
      from: startDate.toISOString(),
      to: endDate.toISOString(),
      totals: {
        todayTokens,
        todayCostUsd: Math.round(todayCostUsd * 1_000_000) / 1_000_000,
        periodInputTokens,
        periodOutputTokens,
        periodTotalTokens: periodInputTokens + periodOutputTokens,
        periodCostUsd: Math.round(periodCostUsd * 1_000_000) / 1_000_000,
        periodRuns,
        periodFailedRuns,
        periodFailureRatePct:
          periodRuns > 0 ? Math.round((periodFailedRuns / periodRuns) * 100) : 0,
        periodToolCalls,
      },
      budgets: {
        dailyTokenBudget: studio.dailyTokenBudget ?? null,
        dailyCostBudgetUsd: studio.dailyCostBudgetUsd ?? null,
        perTaskTokenBudget: studio.perTaskTokenBudget ?? null,
      },
      dailySeries: [...dailyMap.values()],
      byAgent: finalize(byAgentMap.values()),
      byModel: finalize(byModelMap.values()),
      byGame: finalize(byGameMap.values()),
    };
  }

  private accumulateBucket(
    bucket: UsageBucketDto & { durationsMs: number[] },
    run: { inputTokens: number; outputTokens: number; toolCallCount: number },
    cost: number,
    isFailed: boolean,
    durationMs: number,
  ): void {
    const tokens = run.inputTokens + run.outputTokens;
    bucket.runCount += 1;
    if (isFailed) bucket.failedRunCount += 1;
    bucket.inputTokens += run.inputTokens;
    bucket.outputTokens += run.outputTokens;
    bucket.totalTokens += tokens;
    bucket.toolCallCount += run.toolCallCount;
    bucket.costUsd =
      Math.round((bucket.costUsd + cost) * 1_000_000) / 1_000_000;
    if (durationMs > 0) {
      bucket.durationsMs.push(durationMs);
    }
  }
}
