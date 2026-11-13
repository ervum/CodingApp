import { z } from 'zod';
import { MarketSortIdTuple } from '../enums.js';

export const LeaderboardQuerySchema = z.object({
  sort: z.enum(MarketSortIdTuple).default('top-earning'),
  genre: z.string().max(60).optional(),
  search: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export const HistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(14),
});
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
