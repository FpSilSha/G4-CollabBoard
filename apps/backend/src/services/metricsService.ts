import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

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
  if (n === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };

  const sorted = Array.from(bucket.samples.subarray(0, n)).sort((a, b) => a - b);
  return {
    avg: Math.round((bucket.sum / bucket.count) * 100) / 100,
    p50: sorted[Math.floor(n * 0.5)],
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
    commands: Record<string, number>;  // total, success, failure
    latency: Record<string, LatencyStats>;
    costCents: number;
    totalTokens: number;
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
    tokenCount: number;
    success: boolean;
    errorCode?: string;
  }): void {
    hincrby(KEYS.AI, 'total');
    hincrby(KEYS.AI, stats.success ? 'success' : 'failure');
    hincrby(KEYS.AI, 'cost_cents', stats.costCents);
    hincrby(KEYS.AI, 'tokens', stats.tokenCount);
    if (stats.errorCode) {
      hincrby(KEYS.AI, `error:${stats.errorCode}`);
    }
    recordLatency('ai:command', stats.latencyMs);
  },

  // --- Retrieval (for /metrics endpoint) ---

  async getAll(): Promise<MetricsSnapshot> {
    // Fetch all Redis hashes in a single pipeline
    const pipeline = redis.pipeline();
    pipeline.hgetall(KEYS.HTTP_REQUESTS);
    pipeline.hgetall(KEYS.WS_EVENTS_IN);
    pipeline.hgetall(KEYS.WS_EVENTS_OUT);
    pipeline.hgetall(KEYS.DB_QUERIES);
    pipeline.hgetall(KEYS.REDIS_OPS);
    pipeline.hgetall(KEYS.WS_CONNECTIONS);
    pipeline.hgetall(KEYS.AI);
    pipeline.hgetall(KEYS.META);

    const results = await pipeline.exec();

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

    const startedAt = meta.started_at ? new Date(meta.started_at).getTime() : Date.now();
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

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
        commands: aiMetrics,
        latency: getAllLatencyStats('ai:'),
        costCents: aiMetrics.cost_cents ?? 0,
        totalTokens: aiMetrics.tokens ?? 0,
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
