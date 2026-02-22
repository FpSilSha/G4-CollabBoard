import { vi } from 'vitest';

// ─── Silence logger in tests ────────────────────────────────────────────────
vi.mock('../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Mock Redis (prevent real connection) ───────────────────────────────────
vi.mock('../src/utils/redis', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    keys: vi.fn(),
    hset: vi.fn(),
    hget: vi.fn(),
    hgetall: vi.fn(),
    hincrby: vi.fn(),
    hdel: vi.fn(),
    exists: vi.fn(),
    ttl: vi.fn(),
    mget: vi.fn(),
    pipeline: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockReturnThis(),
      setex: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      hset: vi.fn().mockReturnThis(),
      hincrby: vi.fn().mockReturnThis(),
    })),
    on: vi.fn(),
    disconnect: vi.fn(),
  },
}));

// ─── Mock instrumentedRedis (wraps redis, must mirror same interface) ────────
vi.mock('../src/utils/instrumentedRedis', () => ({
  instrumentedRedis: {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    keys: vi.fn(),
    hset: vi.fn(),
    hget: vi.fn(),
    hgetall: vi.fn(),
    hincrby: vi.fn(),
    hdel: vi.fn(),
    exists: vi.fn(),
    ttl: vi.fn(),
    mget: vi.fn(),
    pipeline: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockReturnThis(),
      setex: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      hset: vi.fn().mockReturnThis(),
      hincrby: vi.fn().mockReturnThis(),
    })),
  },
  rawRedis: {
    get: vi.fn(),
    set: vi.fn(),
    on: vi.fn(),
  },
  setMetricsGuard: vi.fn(),
}));

// ─── Mock Prisma ─────────────────────────────────────────────────────────────
vi.mock('../src/models/index', () => ({
  default: {
    board: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    linkedBoard: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    boardVersion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      createMany: vi.fn(),
      create: vi.fn(),
    },
    $use: vi.fn(),
    $transaction: vi.fn(),
  },
}));

// ─── Mock Anthropic SDK ──────────────────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

// ─── Mock Socket.io server ───────────────────────────────────────────────────
vi.mock('../src/websocket/server', () => ({
  getIO: vi.fn(() => ({
    to: vi.fn(() => ({
      emit: vi.fn(),
    })),
    emit: vi.fn(),
    sockets: {
      sockets: new Map(),
    },
  })),
}));

// ─── Environment variables ───────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.AI_MONTHLY_BUDGET_CENTS = '5000';
process.env.AI_MAX_TURNS_SIMPLE = '5';
process.env.AI_MAX_TURNS_COMPLEX = '7';
