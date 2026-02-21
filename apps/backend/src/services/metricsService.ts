import { redis } from '../utils/redis';
import { logger } from '../utils/logger';
import { aiBudgetService } from './aiBudgetService';

// ============================================================
// Constants
// ============================================================

const RING_BUFFER_SIZE = 1000;

/** Redis HASH keys for atomic HINCRBY counters. */
const KEYS = {
  HTTP_REQUESTS: 'metrics:http:requests',
  WS_EVENTS_IN: 'metrics:ws:events_in',
  WS_EVENTS_OUT: 'metrics:ws:events_out',
  DB_QUERIES: 'metrics:db:queries',
  REDIS_OPS: 'metrics:redis:ops',
  WS_CONNECTIONS: 'metrics:ws:connections',
  AI: 'metrics:ai',
  META: 'metrics:meta',
} as const;

// ============================================================
// Latency Ring Buffer (in-memory only)
// ============================================================

interface LatencyBucket {
  samples: Float64Array; // ring buffer of durations in ms
  writeIndex: number;
  count: number;         // total lifetime count (may exceed buffer size)
  sum: number;           // running sum for average
}

interface LatencyStats {
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  count: number;
}

const latencyMap = new Map<string, LatencyBucket>();

function getOrCreateBucket(key: string): LatencyBucket {
  let bucket = latencyMap.get(key);
  if (!bucket) {
    bucket = {
      samples: new Float64Array(RING_BUFFER_SIZE),
      writeIndex: 0,
      count: 0,
      sum: 0,
    };
    latencyMap.set(key, bucket);
  }
  return bucket;
}

function recordLatency(category: string, durationMs: number): void {
  const bucket = getOrCreateBucket(category);
  bucket.samples[bucket.writeIndex] = durationMs;
  bucket.writeIndex = (bucket.writeIndex + 1) % RING_BUFFER_SIZE;
  bucket.count++;
  bucket.sum += durationMs;
}

function computePercentiles(bucket: LatencyBucket): LatencyStats {
  const n = Math.min(bucket.count, RING_BUFFER_SIZE);
  if (n === 0) return { avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, count: 0 };

  const sorted = Array.from(bucket.samples.subarray(0, n)).sort((a, b) => a - b);
  return {
    avg: Math.round((bucket.sum / bucket.count) * 100) / 100,
    p50: sorted[Math.floor(n * 0.5)],
    p90: sorted[Math.floor(n * 0.90)],
    p95: sorted[Math.floor(n * 0.95)],
    p99: sorted[Math.floor(n * 0.99)],
    count: bucket.count,
  };
}

function getAllLatencyStats(prefix: string): Record<string, LatencyStats> {
  const result: Record<string, LatencyStats> = {};
  for (const [key, bucket] of latencyMap.entries()) {
    if (key.startsWith(prefix)) {
      const label = key.slice(prefix.length);
      result[label] = computePercentiles(bucket);
    }
  }
  return result;
}

// ============================================================
// Fire-and-forget Redis helpers
// ============================================================

/**
 * Fire-and-forget HINCRBY. Never awaited, never blocks the hot path.
 * Failures are logged at debug level (metrics loss is acceptable).
 */
function hincrby(key: string, field: string, increment = 1): void {
  redis.hincrby(key, field, increment).catch((err: Error) => {
    logger.debug(`Metrics HINCRBY failed for ${key}:${field}: ${err.message}`);
  });
}

/**
 * Fire-and-forget HSET.
 */
function hset(key: string, field: string, value: string): void {
  redis.hset(key, field, value).catch((err: Error) => {
    logger.debug(`Metrics HSET failed for ${key}:${field}: ${err.message}`);
  });
}

// ============================================================
// Cursor event sampling
// ============================================================

let cursorSampleCounter = 0;

// ============================================================
// MetricsSnapshot (return type for /metrics)
// ============================================================

export interface MetricsSnapshot {
  uptime: number;   // seconds since started_at
  timestamp: string; // ISO string

  http: {
    requests: Record<string, number>;
    latency: Record<string, LatencyStats>;
  };

  websocket: {
    connections: { current: number; total: number; peak: number };
    eventsIn: Record<string, number>;
    eventsOut: Record<string, number>;
  };

  database: {
    queries: Record<string, number>;
    latency: Record<string, LatencyStats>;
  };

  redis: {
    operations: Record<string, number>;
    latency: Record<string, LatencyStats>;
  };

  ai: {
    commands: Record<string, number>;  // total, success, failure, today, error:*
    latency: Record<string, LatencyStats>;
    costCents: number;
    totalTokens: number;
    budget: {
      spentCents: number;
      budgetCents: number;
      callCount: number;
      inputTokens: number;
      outputTokens: number;
    };
    /** Per-model breakdown (keyed by short model name) */
    byModel: Record<string, {
      total: number;
      success: number;
      failure: number;
      costCents: number;
      inputTokens: number;
      outputTokens: number;
      latency: LatencyStats;
    }>;
  };
}

// ============================================================
// Exported MetricsService
// ============================================================

export const metricsService = {
  // --- Counter Operations (Redis HINCRBY) ---

  incrementHttpRequest(method: string, route: string, statusCode: number): void {
    const field = `${method}:${route}:${statusCode}`;
    hincrby(KEYS.HTTP_REQUESTS, field);
  },

  incrementWsEventIn(eventName: string): void {
    // Sample cursor:move events (1-in-10) to reduce Redis ops
    if (eventName === 'cursor:move') {
      cursorSampleCounter++;
      if (cursorSampleCounter % 10 !== 0) return;
      hincrby(KEYS.WS_EVENTS_IN, eventName, 10);
      return;
    }
    hincrby(KEYS.WS_EVENTS_IN, eventName);
  },

  incrementWsEventOut(eventName: string): void {
    // Sample cursor:moved events (1-in-10) to match inbound sampling
    if (eventName === 'cursor:moved') {
      hincrby(KEYS.WS_EVENTS_OUT, eventName, 10);
      return;
    }
    hincrby(KEYS.WS_EVENTS_OUT, eventName);
  },

  incrementDbQuery(model: string, operation: string): void {
    hincrby(KEYS.DB_QUERIES, `${model}.${operation}`);
  },

  incrementRedisOp(command: string): void {
    hincrby(KEYS.REDIS_OPS, command);
  },

  incrementWsConnection(): void {
    hincrby(KEYS.WS_CONNECTIONS, 'current');
    hincrby(KEYS.WS_CONNECTIONS, 'total');

    // Update peak connection count
    redis.hget(KEYS.WS_CONNECTIONS, 'current').then((val) => {
      const current = parseInt(val ?? '0', 10);
      return redis.hget(KEYS.WS_CONNECTIONS, 'peak').then((peakVal) => {
        const peak = parseInt(peakVal ?? '0', 10);
        if (current > peak) {
          hset(KEYS.WS_CONNECTIONS, 'peak', String(current));
        }
      });
    }).catch((err: Error) => {
      logger.debug(`Metrics peak update failed: ${err.message}`);
    });
  },

  decrementWsConnection(): void {
    redis.hincrby(KEYS.WS_CONNECTIONS, 'current', -1).catch((err: Error) => {
      logger.debug(`Metrics WS decrement failed: ${err.message}`);
    });
  },

  // --- Latency Recording (in-memory ring buffers) ---

  recordHttpLatency(method: string, route: string, durationMs: number): void {
    recordLatency(`http:${method}:${route}`, durationMs);
  },

  recordDbLatency(model: string, operation: string, durationMs: number): void {
    recordLatency(`db:${model}.${operation}`, durationMs);
  },

  recordRedisLatency(command: string, durationMs: number): void {
    recordLatency(`redis:${command}`, durationMs);
  },

  // --- AI Metrics ---

  recordAICommand(stats: {
    latencyMs: number;
    costCents: number;
    inputTokens: number;
    outputTokens: number;
    success: boolean;
    errorCode?: string;
    model?: string;
  }): void {
    const totalTokens = stats.inputTokens + stats.outputTokens;
    hincrby(KEYS.AI, 'total');
    hincrby(KEYS.AI, stats.success ? 'success' : 'failure');
    hincrby(KEYS.AI, 'cost_cents', stats.costCents);
    hincrby(KEYS.AI, 'tokens', totalTokens);
    hincrby(KEYS.AI, 'input_tokens', stats.inputTokens);
    hincrby(KEYS.AI, 'output_tokens', stats.outputTokens);
    if (stats.errorCode) {
      hincrby(KEYS.AI, `error:${stats.errorCode}`);
    }
    recordLatency('ai:command', stats.latencyMs);

    // Per-model tracking (keyed by short name: "haiku" or "sonnet")
    if (stats.model) {
      const shortModel = stats.model.includes('haiku') ? 'haiku' : 'sonnet';
      const modelKey = `metrics:ai:model:${shortModel}`;
      hincrby(modelKey, 'total');
      hincrby(modelKey, stats.success ? 'success' : 'failure');
      hincrby(modelKey, 'cost_cents', stats.costCents);
      hincrby(modelKey, 'input_tokens', stats.inputTokens);
      hincrby(modelKey, 'output_tokens', stats.outputTokens);
      recordLatency(`ai:model:${shortModel}`, stats.latencyMs);
    }

    // Track daily command count (separate key with TTL)
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const todayKey = `metrics:ai:today:${today}`;
    redis.incr(todayKey).catch((err: Error) => {
      logger.debug(`Metrics today counter failed: ${err.message}`);
    });
    redis.expire(todayKey, 48 * 60 * 60).catch(() => {});
  },

  // --- Retrieval (for /metrics endpoint) ---

  async getAll(): Promise<MetricsSnapshot> {
    // Fetch all Redis hashes + today's AI count + budget data in parallel
    const today = new Date().toISOString().slice(0, 10);
    const todayKey = `metrics:ai:today:${today}`;

    const pipeline = redis.pipeline();
    pipeline.hgetall(KEYS.HTTP_REQUESTS);      // 0
    pipeline.hgetall(KEYS.WS_EVENTS_IN);       // 1
    pipeline.hgetall(KEYS.WS_EVENTS_OUT);      // 2
    pipeline.hgetall(KEYS.DB_QUERIES);          // 3
    pipeline.hgetall(KEYS.REDIS_OPS);           // 4
    pipeline.hgetall(KEYS.WS_CONNECTIONS);      // 5
    pipeline.hgetall(KEYS.AI);                  // 6
    pipeline.hgetall(KEYS.META);                // 7
    pipeline.get(todayKey);                     // 8
    pipeline.hgetall('metrics:ai:model:haiku'); // 9
    pipeline.hgetall('metrics:ai:model:sonnet'); // 10

    const [results, budgetUsage] = await Promise.all([
      pipeline.exec(),
      aiBudgetService.getMonthlyUsage(),
    ]);

    const parseHash = (index: number): Record<string, number> => {
      const data = results?.[index]?.[1] as Record<string, string> | null;
      if (!data) return {};
      const parsed: Record<string, number> = {};
      for (const [k, v] of Object.entries(data)) {
        parsed[k] = parseInt(v, 10) || 0;
      }
      return parsed;
    };

    const parseStringHash = (index: number): Record<string, string> => {
      const data = results?.[index]?.[1] as Record<string, string> | null;
      return data ?? {};
    };

    const httpRequests = parseHash(0);
    const wsEventsIn = parseHash(1);
    const wsEventsOut = parseHash(2);
    const dbQueries = parseHash(3);
    const redisOps = parseHash(4);
    const wsConnections = parseHash(5);
    const aiMetrics = parseHash(6);
    const meta = parseStringHash(7);
    const todayCount = parseInt((results?.[8]?.[1] as string) ?? '0', 10);

    const haikuMetrics = parseHash(9);
    const sonnetMetrics = parseHash(10);

    const startedAt = meta.started_at ? new Date(meta.started_at).getTime() : Date.now();
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

    // Include today count in the ai commands hash
    const aiCommandsWithToday = { ...aiMetrics, today: todayCount };

    // Build per-model breakdown
    const byModel: Record<string, { total: number; success: number; failure: number; costCents: number; inputTokens: number; outputTokens: number; latency: LatencyStats }> = {};
    const modelLatencies = getAllLatencyStats('ai:model:');
    for (const [shortName, metrics] of [['haiku', haikuMetrics], ['sonnet', sonnetMetrics]] as const) {
      if ((metrics as Record<string, number>).total > 0) {
        const m = metrics as Record<string, number>;
        byModel[shortName] = {
          total: m.total ?? 0,
          success: m.success ?? 0,
          failure: m.failure ?? 0,
          costCents: m.cost_cents ?? 0,
          inputTokens: m.input_tokens ?? 0,
          outputTokens: m.output_tokens ?? 0,
          latency: modelLatencies[shortName] ?? { avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, count: 0 },
        };
      }
    }

    return {
      uptime: uptimeSeconds,
      timestamp: new Date().toISOString(),

      http: {
        requests: httpRequests,
        latency: getAllLatencyStats('http:'),
      },

      websocket: {
        connections: {
          current: wsConnections.current ?? 0,
          total: wsConnections.total ?? 0,
          peak: wsConnections.peak ?? 0,
        },
        eventsIn: wsEventsIn,
        eventsOut: wsEventsOut,
      },

      database: {
        queries: dbQueries,
        latency: getAllLatencyStats('db:'),
      },

      redis: {
        operations: redisOps,
        latency: getAllLatencyStats('redis:'),
      },

      ai: {
        commands: aiCommandsWithToday,
        latency: getAllLatencyStats('ai:'),
        costCents: aiMetrics.cost_cents ?? 0,
        totalTokens: aiMetrics.tokens ?? 0,
        budget: {
          spentCents: budgetUsage.spentCents,
          budgetCents: budgetUsage.budgetCents,
          callCount: budgetUsage.callCount,
          inputTokens: aiMetrics.input_tokens ?? 0,
          outputTokens: aiMetrics.output_tokens ?? 0,
        },
        byModel,
      },
    };
  },

  // --- Lifecycle ---

  async initialize(): Promise<void> {
    try {
      await redis.hset(KEYS.META, 'started_at', new Date().toISOString());
      // Reset current connections to 0 (stale from previous process)
      await redis.hset(KEYS.WS_CONNECTIONS, 'current', '0');
      logger.info('Metrics service initialized');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Metrics initialization failed (non-fatal): ${message}`);
    }
  },

  async reset(): Promise<void> {
    try {
      const pipeline = redis.pipeline();
      for (const key of Object.values(KEYS)) {
        pipeline.del(key);
      }
      pipeline.del('metrics:ai:model:haiku');
      pipeline.del('metrics:ai:model:sonnet');
      await pipeline.exec();
      latencyMap.clear();
      cursorSampleCounter = 0;
      await redis.hset(KEYS.META, 'last_reset', new Date().toISOString());
      logger.info('Metrics reset');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Metrics reset failed: ${message}`);
    }
  },
};
