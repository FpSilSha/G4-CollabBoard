// .env is loaded via --env-file flag in the dev/start scripts

import { createServer } from 'http';
import app from './app';
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});
