import type { MarketSortId } from '@robdev/shared';
import type { MarketSort as PrismaMarketSort } from '../../generated/prisma/enums.js';

export const SORT_ID_TO_PRISMA: Record<MarketSortId, PrismaMarketSort> = {
  'top-earning': 'TOP_EARNING',
  'top-playing-now': 'TOP_PLAYING_NOW',
  'up-and-coming': 'UP_AND_COMING',
  'top-rated': 'TOP_RATED',
};

export const PRISMA_TO_SORT_ID: Record<PrismaMarketSort, MarketSortId> = {
  TOP_EARNING: 'top-earning',
  TOP_PLAYING_NOW: 'top-playing-now',
  UP_AND_COMING: 'up-and-coming',
  TOP_RATED: 'top-rated',
};

export function likeRatio(up: number, down: number): number | null {
  const total = up + down;
  return total === 0 ? null : up / total;
}

/**
 * daily: Array<{ day: string; avg: number }> built from snapshots in the last 8 UTC days.
 * Computes the percentage delta between the latest day and 7 days prior.
 */
export function delta7dPct(daily: Array<{ day: string; avg: number }>): number | null {
  if (daily.length < 2) return null;
  const sorted = [...daily].sort((a, b) => a.day.localeCompare(b.day));
  const latest = sorted[sorted.length - 1]!;
  const target = new Date(`${latest.day}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - 7);
  const targetDay = target.toISOString().slice(0, 10);
  const baseline = sorted.find((d) => d.day === targetDay) ?? null;
  if (!baseline || baseline.avg <= 0) return null;
  return Math.round(((latest.avg - baseline.avg) / baseline.avg) * 1000) / 10;
}

export function sparkline(daily: Array<{ day: string; avg: number }>): number[] {
  return [...daily]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-8)
    .map((d) => Math.round(d.avg));
}
