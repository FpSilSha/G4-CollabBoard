import { PrismaClient } from '@prisma/client';
import { metricsService } from '../services/metricsService';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// --- Metrics middleware: count and time all DB queries ---
prisma.$use(async (params, next) => {
  const model = params.model ?? 'unknown';
  const action = params.action;
  const start = Date.now();

  const result = await next(params);

  const durationMs = Date.now() - start;
  metricsService.incrementDbQuery(model, action);
  metricsService.recordDbLatency(model, action, durationMs);

  return result;
});

export default prisma;
