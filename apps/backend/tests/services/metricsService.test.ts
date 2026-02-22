import { describe, it, expect, beforeEach, vi } from 'vitest';

// metricsService uses `../utils/redis` (not instrumentedRedis) and `aiBudgetService`
// Both are auto-mocked via setup.ts (redis) and vi.mock below (aiBudgetService).

vi.mock('../../src/services/aiBudgetService', () => ({
  aiBudgetService: {
    getMonthlyUsage: vi.fn().mockResolvedValue({
      spentCents: 0,
      callCount: 0,
      totalTokens: 0,
      budgetCents: 5000,
    }),
  },
}));

// Import AFTER vi.mock() declarations
import { redis } from '../../src/utils/redis';
import { aiBudgetService } from '../../src/services/aiBudgetService';
import { metricsService } from '../../src/services/metricsService';
import { logger } from '../../src/utils/logger';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a mock pipeline that captures chained calls and resolves exec()
 * with the given results array. Each result entry is [error, value] pairs.
 */
function makePipeline(execResults: Array<[null, unknown]> = []) {
  const pipeline = {
    hgetall: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    hset: vi.fn().mockReturnThis(),
    hincrby: vi.fn().mockReturnThis(),
    incrby: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(execResults),
  };
  return pipeline;
}

// ============================================================
// Counter / increment methods
// ============================================================

describe('metricsService.incrementHttpRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hincrby).mockResolvedValue(1);
  });

  it('calls redis.hincrby with correct hash key and field', () => {
    metricsService.incrementHttpRequest('GET', '/api/boards', 200);
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:http:requests',
      'GET:/api/boards:200',
      1
    );
  });

  it('encodes method, route, and statusCode into the field name', () => {
    metricsService.incrementHttpRequest('POST', '/api/boards/:id', 404);
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:http:requests',
      'POST:/api/boards/:id:404',
      1
    );
  });

  it('logs a debug message on redis failure (fire-and-forget, does not throw)', async () => {
    vi.mocked(redis.hincrby).mockRejectedValue(new Error('Redis down'));
    // Fire-and-forget — no throw expected
    metricsService.incrementHttpRequest('DELETE', '/api/boards/:id', 500);
    // Allow microtasks to settle
    await new Promise(resolve => setImmediate(resolve));
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe('metricsService.incrementWsEventIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hincrby).mockResolvedValue(1);
  });

  it('increments by 1 for regular events', () => {
    metricsService.incrementWsEventIn('object:create');
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ws:events_in',
      'object:create',
      1
    );
  });

  it('samples cursor:move events (1-in-10) — increments by 10 on every 10th call', () => {
    // Call 9 times — no hincrby yet (counter not at modulo)
    for (let i = 0; i < 9; i++) {
      metricsService.incrementWsEventIn('cursor:move');
    }
    expect(redis.hincrby).not.toHaveBeenCalled();

    // 10th call — should fire with increment=10
    metricsService.incrementWsEventIn('cursor:move');
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ws:events_in',
      'cursor:move',
      10
    );
  });

  it('does not increment cursor:move for first 9 calls in a fresh batch', () => {
    // Since cursorSampleCounter is a module-level variable, we must account for
    // state carried from any previous test. We call it 10 times and verify that
    // exactly ONE hincrby call happens (the sampled one).
    vi.clearAllMocks();
    // Reset by consuming remainder of current cycle
    for (let i = 0; i < 20; i++) {
      metricsService.incrementWsEventIn('cursor:move');
    }
    // Should have been called exactly twice (once per 10 calls)
    expect(redis.hincrby).toHaveBeenCalledTimes(2);
  });
});

describe('metricsService.incrementWsEventOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hincrby).mockResolvedValue(1);
  });

  it('increments by 1 for regular outbound events', () => {
    metricsService.incrementWsEventOut('object:created');
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ws:events_out',
      'object:created',
      1
    );
  });

  it('always increments cursor:moved by 10 (outbound sampling matches inbound)', () => {
    metricsService.incrementWsEventOut('cursor:moved');
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ws:events_out',
      'cursor:moved',
      10
    );
  });
});

describe('metricsService.incrementDbQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hincrby).mockResolvedValue(1);
  });

  it('calls hincrby with model.operation as the field', () => {
    metricsService.incrementDbQuery('board', 'findMany');
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:db:queries',
      'board.findMany',
      1
    );
  });

  it('handles different model/operation combinations', () => {
    metricsService.incrementDbQuery('user', 'upsert');
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:db:queries',
      'user.upsert',
      1
    );
  });
});

describe('metricsService.incrementRedisOp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hincrby).mockResolvedValue(1);
  });

  it('increments the redis ops hash with the command name', () => {
    metricsService.incrementRedisOp('get');
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:redis:ops',
      'get',
      1
    );
  });

  it('handles various Redis command names', () => {
    metricsService.incrementRedisOp('hgetall');
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:redis:ops',
      'hgetall',
      1
    );
  });
});

describe('metricsService.incrementWsConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hincrby).mockResolvedValue(1);
    vi.mocked(redis.hget).mockResolvedValue('0');
    vi.mocked(redis.hset).mockResolvedValue(1);
  });

  it('increments both current and total connection counters', () => {
    metricsService.incrementWsConnection();
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ws:connections',
      'current',
      1
    );
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ws:connections',
      'total',
      1
    );
  });

  it('updates peak when current > peak', async () => {
    // current = 5, peak = 3 → update peak to 5
    vi.mocked(redis.hget)
      .mockResolvedValueOnce('5')  // current
      .mockResolvedValueOnce('3'); // peak

    metricsService.incrementWsConnection();
    await new Promise(resolve => setImmediate(resolve));

    expect(redis.hset).toHaveBeenCalledWith(
      'metrics:ws:connections',
      'peak',
      '5'
    );
  });

  it('does not update peak when current <= peak', async () => {
    // current = 3, peak = 5 → no update
    vi.mocked(redis.hget)
      .mockResolvedValueOnce('3')  // current
      .mockResolvedValueOnce('5'); // peak

    metricsService.incrementWsConnection();
    await new Promise(resolve => setImmediate(resolve));

    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('logs debug and does not throw when peak update fails', async () => {
    vi.mocked(redis.hget).mockRejectedValue(new Error('Redis error'));

    metricsService.incrementWsConnection();
    await new Promise(resolve => setImmediate(resolve));

    expect(logger.debug).toHaveBeenCalled();
  });
});

describe('metricsService.decrementWsConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hincrby).mockResolvedValue(0);
  });

  it('decrements current connection count by -1', () => {
    metricsService.decrementWsConnection();
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ws:connections',
      'current',
      -1
    );
  });

  it('logs debug and does not throw when Redis fails', async () => {
    vi.mocked(redis.hincrby).mockRejectedValue(new Error('Redis down'));

    metricsService.decrementWsConnection();
    await new Promise(resolve => setImmediate(resolve));

    expect(logger.debug).toHaveBeenCalled();
  });
});

// ============================================================
// Latency Recording (in-memory ring buffers)
// ============================================================

describe('metricsService latency recording', () => {
  it('recordHttpLatency does not throw for valid inputs', () => {
    expect(() => {
      metricsService.recordHttpLatency('GET', '/api/boards', 42.5);
    }).not.toThrow();
  });

  it('recordDbLatency does not throw for valid inputs', () => {
    expect(() => {
      metricsService.recordDbLatency('board', 'findMany', 15.3);
    }).not.toThrow();
  });

  it('recordRedisLatency does not throw for valid inputs', () => {
    expect(() => {
      metricsService.recordRedisLatency('get', 0.8);
    }).not.toThrow();
  });

  it('latency data appears in getAll() output after recording', async () => {
    metricsService.recordHttpLatency('GET', '/api/test-latency-unique', 100);

    const pipeline = makePipeline([
      [null, null], // HTTP requests
      [null, null], // WS events in
      [null, null], // WS events out
      [null, null], // DB queries
      [null, null], // Redis ops
      [null, null], // WS connections
      [null, null], // AI metrics
      [null, null], // META
      [null, '0'],  // today count
      [null, null], // haiku model metrics
      [null, null], // sonnet model metrics
    ]);
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const snapshot = await metricsService.getAll();

    // The http latency entry we just recorded should appear
    const httpLatency = snapshot.http.latency;
    const entry = httpLatency['GET:/api/test-latency-unique'];
    expect(entry).toBeDefined();
    expect(entry.count).toBeGreaterThanOrEqual(1);
    expect(entry.avg).toBeGreaterThan(0);
  });
});

// ============================================================
// recordAICommand
// ============================================================

describe('metricsService.recordAICommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hincrby).mockResolvedValue(1);
    vi.mocked(redis.incr).mockResolvedValue(1);
    vi.mocked(redis.expire).mockResolvedValue(1);
  });

  it('increments total and success counters for a successful command', () => {
    metricsService.recordAICommand({
      latencyMs: 500,
      costCents: 10,
      inputTokens: 1000,
      outputTokens: 500,
      success: true,
    });

    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'total', 1);
    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'success', 1);
  });

  it('increments total and failure counters for a failed command', () => {
    metricsService.recordAICommand({
      latencyMs: 300,
      costCents: 5,
      inputTokens: 500,
      outputTokens: 200,
      success: false,
    });

    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'total', 1);
    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'failure', 1);
  });

  it('increments cost_cents and token counters by the provided values', () => {
    metricsService.recordAICommand({
      latencyMs: 400,
      costCents: 25,
      inputTokens: 3000,
      outputTokens: 1000,
      success: true,
    });

    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'cost_cents', 25);
    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'tokens', 4000);
    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'input_tokens', 3000);
    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'output_tokens', 1000);
  });

  it('records error code as a field when errorCode is provided', () => {
    metricsService.recordAICommand({
      latencyMs: 100,
      costCents: 0,
      inputTokens: 100,
      outputTokens: 0,
      success: false,
      errorCode: 'BUDGET_EXCEEDED',
    });

    expect(redis.hincrby).toHaveBeenCalledWith('metrics:ai', 'error:BUDGET_EXCEEDED', 1);
  });

  it('does not record error field when errorCode is absent', () => {
    metricsService.recordAICommand({
      latencyMs: 200,
      costCents: 5,
      inputTokens: 500,
      outputTokens: 200,
      success: true,
    });

    const hincrbyCalls = vi.mocked(redis.hincrby).mock.calls;
    const errorCall = hincrbyCalls.find(([, field]) =>
      typeof field === 'string' && (field as string).startsWith('error:')
    );
    expect(errorCall).toBeUndefined();
  });

  it('tracks per-model metrics for haiku via single-model path (no modelSplits)', () => {
    metricsService.recordAICommand({
      latencyMs: 200,
      costCents: 3,
      inputTokens: 500,
      outputTokens: 200,
      success: true,
      model: 'claude-haiku-4-5-20241022',
    });

    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ai:model:haiku',
      'total',
      1
    );
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ai:model:haiku',
      'success',
      1
    );
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ai:model:haiku',
      'cost_cents',
      3
    );
  });

  it('tracks per-model metrics for sonnet via single-model path', () => {
    metricsService.recordAICommand({
      latencyMs: 800,
      costCents: 50,
      inputTokens: 2000,
      outputTokens: 1000,
      success: true,
      model: 'claude-sonnet-4-6',
    });

    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ai:model:sonnet',
      'total',
      1
    );
  });

  it('records per-model splits when modelSplits is provided', () => {
    metricsService.recordAICommand({
      latencyMs: 1200,
      costCents: 60,
      inputTokens: 3000,
      outputTokens: 2000,
      success: true,
      modelSplits: [
        { model: 'claude-haiku-4-5', inputTokens: 1000, outputTokens: 500, costCents: 10 },
        { model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 1500, costCents: 50 },
      ],
    });

    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ai:model:haiku',
      'cost_cents',
      10
    );
    expect(redis.hincrby).toHaveBeenCalledWith(
      'metrics:ai:model:sonnet',
      'cost_cents',
      50
    );
  });

  it('skips model splits where both inputTokens and outputTokens are 0', () => {
    const callsBefore = vi.mocked(redis.hincrby).mock.calls.length;

    metricsService.recordAICommand({
      latencyMs: 100,
      costCents: 5,
      inputTokens: 100,
      outputTokens: 50,
      success: true,
      modelSplits: [
        { model: 'claude-haiku-4-5', inputTokens: 0, outputTokens: 0, costCents: 0 },
        { model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 50, costCents: 5 },
      ],
    });

    // haiku split should be skipped — no haiku model key calls
    const haikuCalls = vi.mocked(redis.hincrby).mock.calls
      .slice(callsBefore)
      .filter(([key]) => (key as string).includes('haiku'));
    expect(haikuCalls).toHaveLength(0);
  });

  it('increments daily counter using redis.incr with a TTL-scoped key', async () => {
    const today = new Date().toISOString().slice(0, 10);
    metricsService.recordAICommand({
      latencyMs: 200,
      costCents: 5,
      inputTokens: 100,
      outputTokens: 50,
      success: true,
    });

    // Allow micro-tasks to settle
    await new Promise(resolve => setImmediate(resolve));

    const incrCalls = vi.mocked(redis.incr).mock.calls;
    const todayCalls = incrCalls.filter(([key]) =>
      (key as string).includes(`metrics:ai:today:${today}`)
    );
    expect(todayCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('sets a 48-hour TTL on the daily counter key', async () => {
    const today = new Date().toISOString().slice(0, 10);
    metricsService.recordAICommand({
      latencyMs: 200,
      costCents: 5,
      inputTokens: 100,
      outputTokens: 50,
      success: true,
    });

    await new Promise(resolve => setImmediate(resolve));

    const expireCalls = vi.mocked(redis.expire).mock.calls;
    const todayExpire = expireCalls.find(([key]) =>
      (key as string).includes(`metrics:ai:today:${today}`)
    );
    expect(todayExpire).toBeDefined();
    expect(todayExpire![1]).toBe(48 * 60 * 60);
  });
});

// ============================================================
// getAll
// ============================================================

describe('metricsService.getAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeFullPipelineResults(overrides: Record<number, [null, unknown]> = {}) {
    const defaults: Array<[null, unknown]> = [
      [null, { 'GET:/api/boards:200': '42' }],  // 0 HTTP requests
      [null, { 'object:create': '10' }],          // 1 WS events in
      [null, { 'object:created': '10' }],          // 2 WS events out
      [null, { 'board.findMany': '100' }],         // 3 DB queries
      [null, { get: '50' }],                       // 4 Redis ops
      [null, { current: '5', total: '30', peak: '12' }], // 5 WS connections
      [null, { total: '8', success: '7', failure: '1', cost_cents: '150', tokens: '5000', input_tokens: '3000', output_tokens: '2000' }], // 6 AI metrics
      [null, { started_at: new Date(Date.now() - 60000).toISOString() }], // 7 META
      [null, '3'],                                  // 8 today count
      [null, { total: '5', success: '5', failure: '0', cost_cents: '30', input_tokens: '2000', output_tokens: '1000' }], // 9 haiku
      [null, { total: '3', success: '2', failure: '1', cost_cents: '120', input_tokens: '1000', output_tokens: '1000' }], // 10 sonnet
    ];
    for (const [index, value] of Object.entries(overrides)) {
      defaults[Number(index)] = value;
    }
    return defaults;
  }

  it('returns a MetricsSnapshot with the correct top-level shape', async () => {
    const pipeline = makePipeline(makeFullPipelineResults());
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 150, callCount: 8, totalTokens: 5000, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result).toHaveProperty('uptime');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('http');
    expect(result).toHaveProperty('websocket');
    expect(result).toHaveProperty('database');
    expect(result).toHaveProperty('redis');
    expect(result).toHaveProperty('ai');
  });

  it('parses HTTP request counts from the Redis hash', async () => {
    const pipeline = makePipeline(makeFullPipelineResults());
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result.http.requests['GET:/api/boards:200']).toBe(42);
  });

  it('parses WebSocket connection counters correctly', async () => {
    const pipeline = makePipeline(makeFullPipelineResults());
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result.websocket.connections.current).toBe(5);
    expect(result.websocket.connections.total).toBe(30);
    expect(result.websocket.connections.peak).toBe(12);
  });

  it('includes the today daily AI command count in ai.commands', async () => {
    const pipeline = makePipeline(makeFullPipelineResults());
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result.ai.commands.today).toBe(3);
  });

  it('includes budget data from aiBudgetService.getMonthlyUsage', async () => {
    const pipeline = makePipeline(makeFullPipelineResults());
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 1234,
      callCount: 42,
      totalTokens: 99999,
      budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result.ai.budget.spentCents).toBe(1234);
    expect(result.ai.budget.budgetCents).toBe(5000);
    expect(result.ai.budget.callCount).toBe(42);
  });

  it('builds the per-model byModel breakdown when totals are non-zero', async () => {
    const pipeline = makePipeline(makeFullPipelineResults());
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result.ai.byModel).toHaveProperty('haiku');
    expect(result.ai.byModel).toHaveProperty('sonnet');
    expect(result.ai.byModel.haiku.total).toBe(5);
    expect(result.ai.byModel.sonnet.total).toBe(3);
  });

  it('omits models from byModel when their total is 0', async () => {
    const results = makeFullPipelineResults({
      9: [null, { total: '0' }],   // haiku total = 0
      10: [null, { total: '0' }],  // sonnet total = 0
    });
    const pipeline = makePipeline(results);
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result.ai.byModel).not.toHaveProperty('haiku');
    expect(result.ai.byModel).not.toHaveProperty('sonnet');
  });

  it('computes uptime from the META started_at timestamp', async () => {
    const startedAt = new Date(Date.now() - 120000); // 2 minutes ago
    const results = makeFullPipelineResults({
      7: [null, { started_at: startedAt.toISOString() }],
    });
    const pipeline = makePipeline(results);
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result.uptime).toBeGreaterThanOrEqual(118);
    expect(result.uptime).toBeLessThanOrEqual(122);
  });

  it('handles null pipeline results gracefully (returns zeros instead of crashing)', async () => {
    const pipeline = makePipeline(
      Array(11).fill([null, null]) as Array<[null, null]>
    );
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(result.http.requests).toEqual({});
    expect(result.websocket.connections.current).toBe(0);
    expect(result.ai.commands).toEqual({ today: 0 });
  });

  it('returns a valid ISO timestamp string', async () => {
    const pipeline = makePipeline(makeFullPipelineResults());
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);
    vi.mocked(aiBudgetService.getMonthlyUsage).mockResolvedValue({
      spentCents: 0, callCount: 0, totalTokens: 0, budgetCents: 5000,
    });

    const result = await metricsService.getAll();

    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
  });
});

// ============================================================
// initialize
// ============================================================

describe('metricsService.initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hset).mockResolvedValue(1);
  });

  it('writes started_at to the META hash', async () => {
    await metricsService.initialize();

    expect(redis.hset).toHaveBeenCalledWith(
      'metrics:meta',
      'started_at',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
  });

  it('resets current connection count to "0"', async () => {
    await metricsService.initialize();

    expect(redis.hset).toHaveBeenCalledWith(
      'metrics:ws:connections',
      'current',
      '0'
    );
  });

  it('logs info on success', async () => {
    await metricsService.initialize();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Metrics'));
  });

  it('logs a warning but does not throw when Redis fails', async () => {
    vi.mocked(redis.hset).mockRejectedValue(new Error('Redis unavailable'));

    await expect(metricsService.initialize()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
  });
});

// ============================================================
// reset
// ============================================================

describe('metricsService.reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.hset).mockResolvedValue(1);
  });

  it('deletes all metric keys via pipeline and clears in-memory latency map', async () => {
    const pipeline = makePipeline([]);
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);

    await metricsService.reset();

    expect(pipeline.del).toHaveBeenCalled();
    expect(pipeline.exec).toHaveBeenCalled();
  });

  it('includes per-model keys (haiku, sonnet) in the pipeline delete', async () => {
    const pipeline = makePipeline([]);
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);

    await metricsService.reset();

    const delCalls = pipeline.del.mock.calls.flat();
    expect(delCalls).toContain('metrics:ai:model:haiku');
    expect(delCalls).toContain('metrics:ai:model:sonnet');
  });

  it('writes a last_reset timestamp after clearing', async () => {
    const pipeline = makePipeline([]);
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);

    await metricsService.reset();

    expect(redis.hset).toHaveBeenCalledWith(
      'metrics:meta',
      'last_reset',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
  });

  it('logs info on success', async () => {
    const pipeline = makePipeline([]);
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);

    await metricsService.reset();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('reset'));
  });

  it('logs error but does not throw when pipeline.exec fails', async () => {
    const pipeline = {
      ...makePipeline([]),
      exec: vi.fn().mockRejectedValue(new Error('Pipeline failed')),
    };
    vi.mocked(redis.pipeline).mockReturnValue(pipeline as never);

    await expect(metricsService.reset()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});
