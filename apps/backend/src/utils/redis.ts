import Redis from 'ioredis';
import { logger } from './logger';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL environment variable is required');
}

export const redis = new Redis(redisUrl, {
  // TLS is auto-negotiated from the rediss:// protocol in the URL.
  // Do NOT set rejectUnauthorized: false — Upstash certs are valid
  // and disabling verification exposes the connection to MITM attacks.
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error:', err));
