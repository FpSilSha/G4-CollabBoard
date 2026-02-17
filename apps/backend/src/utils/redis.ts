import Redis from 'ioredis';
import { logger } from './logger';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL environment variable is required');
}

const isUpstash = redisUrl.startsWith('rediss://');

export const redis = new Redis(redisUrl, {
  ...(isUpstash ? { tls: { rejectUnauthorized: false } } : {}),
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error:', err));
