import { z } from 'zod';
import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, LlmProvider } from '../enums.js';

export type UsageGroupBy = 'agent' | 'model' | 'game' | 'day';

export const UsageQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  groupBy: z.enum(['agent', 'model', 'game', 'day']).default('agent'),
});
export type UsageQuery = z.infer<typeof UsageQuerySchema>;

export interface UsageBucketDto {
  key: string;
  label: string;
  sublabel?: string | null;
  agentKey?: AgentKey | null;
  provider?: LlmProvider | null;
  gameId?: Id | null;
  runCount: number;
  failedRunCount: number;
  failureRatePct: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCallCount: number;
  costUsd: number;
  medianDurationMs: number;
}

export interface UsageDailyPointDto {
  day: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  runCount: number;
}

export interface StudioUsageReportDto {
  studioId: Id;
  from: IsoDateString;
  to: IsoDateString;
  totals: {
    todayTokens: number;
    todayCostUsd: number;
    periodInputTokens: number;
    periodOutputTokens: number;
    periodTotalTokens: number;
    periodCostUsd: number;
    periodRuns: number;
    periodFailedRuns: number;
    periodFailureRatePct: number;
    periodToolCalls: number;
  };
  budgets: {
    dailyTokenBudget: number | null;
    dailyCostBudgetUsd: number | null;
    perTaskTokenBudget: number | null;
  };
  dailySeries: UsageDailyPointDto[];
  byAgent: UsageBucketDto[];
  byModel: UsageBucketDto[];
  byGame: UsageBucketDto[];
}
