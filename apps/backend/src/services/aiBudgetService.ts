import { instrumentedRedis as redis } from '../utils/instrumentedRedis';
import { SONNET_4_PRICING, HAIKU_35_PRICING, AI_CONFIG } from 'shared';
import type { AIBudgetCheck } from 'shared';
import { logger } from '../utils/logger';

// ============================================================
// AI Budget Service — Redis-backed monthly spend tracking
// ============================================================

/**
 * Redis key helpers. Keys are scoped by month (YYYY-MM) so they
 * naturally reset on the 1st of each month.
 */
function monthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function budgetTotalKey(): string {
  return `ai:budget:month:${monthKey()}:total`;
}

function budgetCallsKey(): string {
  return `ai:budget:month:${monthKey()}:calls`;
}

function budgetTokensKey(): string {
  return `ai:budget:month:${monthKey()}:tokens`;
}

// ============================================================
// Cost Calculation
// ============================================================

/**
 * Calculate cost in cents for a given number of input/output tokens.
 * Model-aware: uses Haiku pricing when model contains 'haiku', otherwise Sonnet.
 * Result is rounded up to nearest cent.
 */
export function calculateCostCents(
  inputTokens: number,
  outputTokens: number,
  model?: string
): number {
  const pricing = model && model.includes('haiku')
    ? HAIKU_35_PRICING
    : SONNET_4_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillionTokens;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillionTokens;
  return Math.ceil((inputCost + outputCost) * 100);
}

// ============================================================
// Budget Service
// ============================================================

export const aiBudgetService = {
  /**
   * Check whether budget is available for a new AI command.
   * Reads the monthly spend from Redis and compares against the budget ceiling.
   */
  async checkBudget(): Promise<AIBudgetCheck> {
    const budgetCents = parseInt(process.env.AI_MONTHLY_BUDGET_CENTS || '', 10)
      || AI_CONFIG.MONTHLY_BUDGET_CENTS_DEFAULT;

    try {
      const spentRaw = await redis.get(budgetTotalKey());
      const spentCents = parseInt(spentRaw ?? '0', 10);

      const remainingCents = Math.max(0, budgetCents - spentCents);
      return {
        hasRemaining: remainingCents > 0,
        remainingCents,
        totalBudgetCents: budgetCents,
        spentCents,
      };
    } catch (err) {
      // If Redis is down, fail open (allow request) but log a warning.
      // Budget enforcement is best-effort — we don't want Redis outages
      // to completely block AI functionality.
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Budget check failed (allowing request): ${message}`);
      return {
        hasRemaining: true,
        remainingCents: budgetCents,
        totalBudgetCents: budgetCents,
        spentCents: 0,
      };
    }
  },

  /**
   * Record AI usage after a command completes.
   * Atomically increments spend, call count, and token count.
   */
  async recordUsage(
    _userId: string,
    costCents: number,
    details: {
      inputTokens: number;
      outputTokens: number;
      command: string;
      boardId: string;
      turnsUsed: number;
      toolCallCount: number;
    }
  ): Promise<void> {
    try {
      const totalTokens = details.inputTokens + details.outputTokens;

      // Use pipeline for atomicity
      const pipeline = redis.pipeline();
      pipeline.incrby(budgetTotalKey(), costCents);
      pipeline.incrby(budgetCallsKey(), 1);
      pipeline.incrby(budgetTokensKey(), totalTokens);

      // Set 35-day TTL on all keys (auto-cleanup after month ends)
      pipeline.expire(budgetTotalKey(), 35 * 24 * 60 * 60);
      pipeline.expire(budgetCallsKey(), 35 * 24 * 60 * 60);
      pipeline.expire(budgetTokensKey(), 35 * 24 * 60 * 60);

      await pipeline.exec();

      logger.debug(
        `AI usage recorded: ${costCents}¢, ${totalTokens} tokens, ` +
        `${details.turnsUsed} turns, ${details.toolCallCount} tools`
      );
    } catch (err) {
      // Non-critical: log but don't throw. Budget tracking loss is acceptable.
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Failed to record AI usage: ${message}`);
    }
  },

  /**
   * Get current month's usage summary. Used by /ai/status and admin dashboard.
   */
  async getMonthlyUsage(): Promise<{
    spentCents: number;
    callCount: number;
    totalTokens: number;
    budgetCents: number;
  }> {
    const budgetCents = parseInt(process.env.AI_MONTHLY_BUDGET_CENTS || '', 10)
      || AI_CONFIG.MONTHLY_BUDGET_CENTS_DEFAULT;

    try {
      const pipeline = redis.pipeline();
      pipeline.get(budgetTotalKey());
      pipeline.get(budgetCallsKey());
      pipeline.get(budgetTokensKey());
      const results = await pipeline.exec();

      return {
        spentCents: parseInt((results?.[0]?.[1] as string) ?? '0', 10),
        callCount: parseInt((results?.[1]?.[1] as string) ?? '0', 10),
        totalTokens: parseInt((results?.[2]?.[1] as string) ?? '0', 10),
        budgetCents,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Failed to get monthly usage: ${message}`);
      return { spentCents: 0, callCount: 0, totalTokens: 0, budgetCents };
    }
  },
};
