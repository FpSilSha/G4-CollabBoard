// .env is loaded via --env-file flag in the dev/start scripts

import { createServer } from 'http';
import app from './app';
import prisma from './models/index';
import { redis } from './utils/redis';
import { logger } from './utils/logger';
import { DEFAULT_PORT } from 'shared';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;

const httpServer = createServer(app);

// Socket.io WebSocket server
import { initializeWebSocket } from './websocket/server';
initializeWebSocket(httpServer);

httpServer.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${port}/health`);
});

// Graceful shutdown — close HTTP, Prisma, and Redis connections
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received. Shutting down gracefully...`);

  httpServer.close(async () => {
    logger.info('HTTP server closed');

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
