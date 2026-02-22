import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculateCostCents, aiBudgetService } from '../../src/services/aiBudgetService';
import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';
import { AI_CONFIG } from 'shared';

// Helper: generate the current month key in the same format as the service
function currentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

describe('calculateCostCents', () => {
  it('calculates Sonnet pricing when no model is specified', () => {
    // Sonnet: $3/1M input, $15/1M output
    // 1_000_000 input + 1_000_000 output = $3 + $15 = $18 = 1800 cents
    const result = calculateCostCents(1_000_000, 1_000_000);
    expect(result).toBe(1800);
  });

  it('calculates Sonnet pricing when model does not contain "haiku"', () => {
    // 500_000 input tokens: (0.5 * $3) = $1.50 = 150 cents
    // 200_000 output tokens: (0.2 * $15) = $3.00 = 300 cents
    // total = 450 cents
    const result = calculateCostCents(500_000, 200_000, 'claude-sonnet-4-6');
    expect(result).toBe(450);
  });

  it('calculates Haiku pricing when model contains "haiku"', () => {
    // Haiku: $1/1M input, $5/1M output
    // 1_000_000 input + 1_000_000 output = $1 + $5 = $6 = 600 cents
    const result = calculateCostCents(1_000_000, 1_000_000, 'claude-haiku-4-5-20241022');
    expect(result).toBe(600);
  });

  it('returns 0 cents for zero tokens', () => {
    expect(calculateCostCents(0, 0)).toBe(0);
    expect(calculateCostCents(0, 0, 'claude-haiku-4-5')).toBe(0);
  });

  it('rounds up fractional cents (ceiling)', () => {
    // Sonnet: 1 input token = 3/1_000_000 dollars = 0.0003 cents
    // Math.ceil(0.0003) = 1 cent
    const result = calculateCostCents(1, 0);
    expect(result).toBe(1);
  });

  it('rounds up fractional cents for Haiku too', () => {
    // Haiku: 1 input token = 1/1_000_000 dollars = 0.0001 cents
    // Math.ceil(0.0001) = 1 cent
    const result = calculateCostCents(1, 0, 'claude-haiku-4-5');
    expect(result).toBe(1);
  });

  it('handles small non-zero costs correctly (ceiling)', () => {
    // Sonnet: 100 input tokens = (100/1_000_000) * 3 * 100 = 0.03 cents -> ceil = 1
    // 100 output tokens = (100/1_000_000) * 15 * 100 = 0.15 cents
    // total raw = 0.18 cents -> ceil = 1
    const result = calculateCostCents(100, 100);
    expect(result).toBe(1);
  });

  it('haiku is cheaper than sonnet for the same tokens', () => {
    const sonnet = calculateCostCents(100_000, 100_000);
    const haiku = calculateCostCents(100_000, 100_000, 'claude-haiku-4-5');
    expect(haiku).toBeLessThan(sonnet);
  });
});

describe('aiBudgetService.checkBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns hasRemaining=true when well under budget', async () => {
    // Budget from env: 5000 cents; spent: 100
    vi.mocked(redis.get).mockResolvedValue('100');

    const result = await aiBudgetService.checkBudget();

    expect(result.hasRemaining).toBe(true);
    expect(result.spentCents).toBe(100);
    expect(result.totalBudgetCents).toBe(5000);
    expect(result.remainingCents).toBe(4900);
  });

  it('returns hasRemaining=false when budget is fully exhausted', async () => {
    vi.mocked(redis.get).mockResolvedValue('5000');

    const result = await aiBudgetService.checkBudget();

    expect(result.hasRemaining).toBe(false);
    expect(result.remainingCents).toBe(0);
    expect(result.spentCents).toBe(5000);
  });

  it('returns hasRemaining=false when spent exceeds budget', async () => {
    vi.mocked(redis.get).mockResolvedValue('9999');

    const result = await aiBudgetService.checkBudget();

    expect(result.hasRemaining).toBe(false);
    expect(result.remainingCents).toBe(0);
  });

  it('returns hasRemaining=true when Redis returns null (first call of month)', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    const result = await aiBudgetService.checkBudget();

    expect(result.hasRemaining).toBe(true);
    expect(result.spentCents).toBe(0);
    expect(result.remainingCents).toBe(5000);
  });

  it('fails open when Redis throws (budget check error)', async () => {
    vi.mocked(redis.get).mockRejectedValue(new Error('Redis connection refused'));

    const result = await aiBudgetService.checkBudget();

    // On failure, allow the request (fail open)
    expect(result.hasRemaining).toBe(true);
    expect(result.spentCents).toBe(0);
  });

  it('uses AI_CONFIG.MONTHLY_BUDGET_CENTS_DEFAULT when env var not set', async () => {
    const original = process.env.AI_MONTHLY_BUDGET_CENTS;
    delete process.env.AI_MONTHLY_BUDGET_CENTS;

    vi.mocked(redis.get).mockResolvedValue('0');

    const result = await aiBudgetService.checkBudget();

    expect(result.totalBudgetCents).toBe(AI_CONFIG.MONTHLY_BUDGET_CENTS_DEFAULT);

    process.env.AI_MONTHLY_BUDGET_CENTS = original;
  });

  it('reads key scoped to the current month', async () => {
    vi.mocked(redis.get).mockResolvedValue('50');

    await aiBudgetService.checkBudget();

    const calledKey = vi.mocked(redis.get).mock.calls[0][0];
    const monthKey = currentMonthKey();
    expect(calledKey).toContain(monthKey);
    expect(calledKey).toContain('total');
  });
});

describe('aiBudgetService.recordUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls pipeline.incrby with correct cost for total key', async () => {
    const mockPipeline = {
      incrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    await aiBudgetService.recordUsage('user-1', 42, {
      inputTokens: 1000,
      outputTokens: 500,
      command: 'create sticky notes',
      boardId: 'board-abc',
      turnsUsed: 2,
      toolCallCount: 3,
    });

    expect(mockPipeline.incrby).toHaveBeenCalled();

    // First incrby call should be for the total cost
    const [firstKey, firstValue] = mockPipeline.incrby.mock.calls[0];
    expect(firstKey).toContain('total');
    expect(firstKey).toContain(currentMonthKey());
    expect(firstValue).toBe(42);
  });

  it('increments call count by 1', async () => {
    const mockPipeline = {
      incrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    await aiBudgetService.recordUsage('user-1', 10, {
      inputTokens: 100,
      outputTokens: 50,
      command: 'test',
      boardId: 'board-1',
      turnsUsed: 1,
      toolCallCount: 1,
    });

    // Second incrby should be for calls with value 1
    const callsCall = mockPipeline.incrby.mock.calls.find(
      ([key, val]: [string, number]) => key.includes('calls') && val === 1
    );
    expect(callsCall).toBeDefined();
  });

  it('increments token count by inputTokens + outputTokens', async () => {
    const mockPipeline = {
      incrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    await aiBudgetService.recordUsage('user-1', 5, {
      inputTokens: 300,
      outputTokens: 200,
      command: 'test',
      boardId: 'board-1',
      turnsUsed: 1,
      toolCallCount: 1,
    });

    // Token incrby should be 300 + 200 = 500
    const tokensCall = mockPipeline.incrby.mock.calls.find(
      ([key, val]: [string, number]) => key.includes('tokens') && val === 500
    );
    expect(tokensCall).toBeDefined();
  });

  it('sets 35-day TTL on all keys', async () => {
    const mockPipeline = {
      incrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    await aiBudgetService.recordUsage('user-1', 5, {
      inputTokens: 100,
      outputTokens: 50,
      command: 'test',
      boardId: 'board-1',
      turnsUsed: 1,
      toolCallCount: 1,
    });

    const expectedTtl = 35 * 24 * 60 * 60;
    const expireCalls = mockPipeline.expire.mock.calls;
    expect(expireCalls.length).toBeGreaterThanOrEqual(3);
    expireCalls.forEach(([, ttl]: [string, number]) => {
      expect(ttl).toBe(expectedTtl);
    });
  });

  it('does not throw when pipeline.exec fails (non-critical path)', async () => {
    const mockPipeline = {
      incrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error('Redis pipeline failed')),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    // Should not throw
    await expect(
      aiBudgetService.recordUsage('user-1', 5, {
        inputTokens: 100,
        outputTokens: 50,
        command: 'test',
        boardId: 'board-1',
        turnsUsed: 1,
        toolCallCount: 1,
      })
    ).resolves.toBeUndefined();
  });
});

describe('aiBudgetService.getMonthlyUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct structure from Redis pipeline results', async () => {
    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, '1500'],  // total cents
        [null, '25'],    // call count
        [null, '75000'], // total tokens
      ]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await aiBudgetService.getMonthlyUsage();

    expect(result.spentCents).toBe(1500);
    expect(result.callCount).toBe(25);
    expect(result.totalTokens).toBe(75000);
    expect(result.budgetCents).toBe(5000); // from env var
  });

  it('returns zeros when pipeline results are null (no data yet)', async () => {
    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, null],
        [null, null],
        [null, null],
      ]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await aiBudgetService.getMonthlyUsage();

    expect(result.spentCents).toBe(0);
    expect(result.callCount).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it('returns zeros and logs warning when pipeline.exec throws', async () => {
    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await aiBudgetService.getMonthlyUsage();

    expect(result.spentCents).toBe(0);
    expect(result.callCount).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.budgetCents).toBe(5000);
  });

  it('includes budgetCents in the returned structure', async () => {
    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, '200'],
        [null, '5'],
        [null, '10000'],
      ]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await aiBudgetService.getMonthlyUsage();

    expect(result).toHaveProperty('budgetCents');
    expect(typeof result.budgetCents).toBe('number');
  });
});
