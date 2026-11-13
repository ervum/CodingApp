export interface CostPricing {
  inputCostPerMTok?: number | null;
  outputCostPerMTok?: number | null;
}

export function calculateRunCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing?: CostPricing | null,
): number {
  const inRate = pricing?.inputCostPerMTok ?? 0;
  const outRate = pricing?.outputCostPerMTok ?? 0;
  if (inRate <= 0 && outRate <= 0) {
    return 0;
  }
  const raw =
    (Math.max(0, inputTokens) / 1_000_000) * inRate +
    (Math.max(0, outputTokens) / 1_000_000) * outRate;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

export interface StudioBudgetEvaluationInput {
  dailyTokenBudget: number | null;
  dailyCostBudgetUsd: number | null;
  perTaskTokenBudget: number | null;
  todayTotalTokens: number;
  todayTotalCostUsd: number;
  currentRunTokens?: number;
}

export interface StudioBudgetEvaluationResult {
  allowed: boolean;
  exceededKind: 'DAILY_TOKENS' | 'DAILY_COST' | 'PER_TASK_TOKENS' | null;
  reason: string | null;
}

export function evaluateStudioBudget(
  input: StudioBudgetEvaluationInput,
): StudioBudgetEvaluationResult {
  if (
    input.perTaskTokenBudget !== null &&
    input.perTaskTokenBudget > 0 &&
    (input.currentRunTokens ?? 0) >= input.perTaskTokenBudget
  ) {
    return {
      allowed: false,
      exceededKind: 'PER_TASK_TOKENS',
      reason: `Per-task token budget exceeded (${(input.currentRunTokens ?? 0).toLocaleString()} >= ${input.perTaskTokenBudget.toLocaleString()} tokens)`,
    };
  }

  if (
    input.dailyTokenBudget !== null &&
    input.dailyTokenBudget > 0 &&
    input.todayTotalTokens >= input.dailyTokenBudget
  ) {
    return {
      allowed: false,
      exceededKind: 'DAILY_TOKENS',
      reason: `Studio daily token budget exceeded (${input.todayTotalTokens.toLocaleString()} >= ${input.dailyTokenBudget.toLocaleString()} tokens today)`,
    };
  }

  if (
    input.dailyCostBudgetUsd !== null &&
    input.dailyCostBudgetUsd > 0 &&
    input.todayTotalCostUsd >= input.dailyCostBudgetUsd
  ) {
    return {
      allowed: false,
      exceededKind: 'DAILY_COST',
      reason: `Studio daily cost budget exceeded ($${input.todayTotalCostUsd.toFixed(4)} >= $${input.dailyCostBudgetUsd.toFixed(2)} today)`,
    };
  }

  return {
    allowed: true,
    exceededKind: null,
    reason: null,
  };
}
