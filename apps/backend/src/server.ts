// .env is loaded via --env-file flag in the dev/start scripts

import { createServer } from 'http';
import app from './app';
import prisma from './models/index';
import { redis } from './utils/redis';
import { logger } from './utils/logger';
import { metricsService } from './services/metricsService';
import { DEFAULT_PORT } from 'shared';
import { startAutoSaveWorker, stopAutoSaveWorker } from './workers/autoSave';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;

const httpServer = createServer(app);

// Socket.io WebSocket server
import { initializeWebSocket } from './websocket/server';
initializeWebSocket(httpServer);

// Initialize metrics counters in Redis
metricsService.initialize().catch((err) => {
  logger.error(`Metrics initialization failed: ${err instanceof Error ? err.message : err}`);
});

// Start background auto-save worker (flushes Redis → Postgres every 60s)
startAutoSaveWorker();

httpServer.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${port}/health`);
  logger.info(`Metrics endpoint: http://localhost:${port}/metrics`);
});

// Graceful shutdown — close HTTP, Prisma, and Redis connections
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received. Shutting down gracefully...`);

  httpServer.close(async () => {
    logger.info('HTTP server closed');

    // Flush all active boards from Redis to Postgres before disconnecting
    try {
      await stopAutoSaveWorker();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Auto-save worker shutdown error: ${message}`);
    }

    try {
      await prisma.$disconnect();
      logger.info('Prisma disconnected');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Prisma disconnect error: ${message}`);
    }

    try {
      redis.disconnect();
      logger.info('Redis disconnected');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Redis disconnect error: ${message}`);
    }

    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
