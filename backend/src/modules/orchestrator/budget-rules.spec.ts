import { describe, expect, it } from 'vitest';
import { calculateRunCostUsd, evaluateStudioBudget } from './budget-rules.js';

describe('budget-rules', () => {
  it('calculates run cost in USD from MTok rates', () => {
    const cost = calculateRunCostUsd(100_000, 50_000, {
      inputCostPerMTok: 3.0,
      outputCostPerMTok: 15.0,
    });
    // 0.1 * 3.0 + 0.05 * 15.0 = 0.30 + 0.75 = 1.05
    expect(cost).toBeCloseTo(1.05, 5);
  });

  it('flags exceeded daily token and per-task budgets', () => {
    const dailyExceeded = evaluateStudioBudget({
      dailyTokenBudget: 500_000,
      dailyCostBudgetUsd: null,
      perTaskTokenBudget: null,
      todayTotalTokens: 520_000,
      todayTotalCostUsd: 0,
    });
    expect(dailyExceeded.allowed).toBe(false);
    expect(dailyExceeded.exceededKind).toBe('DAILY_TOKENS');

    const taskExceeded = evaluateStudioBudget({
      dailyTokenBudget: null,
      dailyCostBudgetUsd: null,
      perTaskTokenBudget: 50_000,
      todayTotalTokens: 10_000,
      todayTotalCostUsd: 0,
      currentRunTokens: 55_000,
    });
    expect(taskExceeded.allowed).toBe(false);
    expect(taskExceeded.exceededKind).toBe('PER_TASK_TOKENS');
  });
});
